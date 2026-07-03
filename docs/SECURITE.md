# SÉCURITÉ — Diagnostic & plan de réparation CatDesk

> **Plan reconstruit le 2026-07-03.** Le document d'origine (le « plan » de
> diagnostic sécurité) n'avait jamais été commité — il vivait hors du dépôt, sur
> le PC d'origine devenu inaccessible. Ce fichier le **reconstruit à partir du
> code actuel**, en croisant avec les commits `§` déjà mergés. Il est versionné
> exprès pour se propager entre machines via git.
>
> Portée : tout le dépôt (pas un diff). À tenir à jour au fil des réparations.

## Modèle de menace

CatDesk est piloté par un LLM local qui **ingère du contenu externe non fiable** —
pages web (`read_webpage`, `browser_get_text`), documents (`parse_document`),
écran (`describe_screen`/OCR), presse-papier, e-mails (`read_email`). Ce contenu
peut contenir des **instructions injectées** (indirect prompt injection) qui
poussent le modèle à appeler des outils dangereux.

La menace principale n'est donc pas « l'utilisateur tape une commande méchante »
mais « une page web / un document fait exécuter une action au modèle ». Les trois
défenses en place : le **gate de permissions** (risk-gated), les **blocklists**
commande/chemin, et le **scan post-exécution §7**.

## Constat d'architecture (cause racine des dérives)

Le sandbox Rust (`apps/desktop/src-tauri/src/core/sandbox.rs`,
`commands/system.rs`) **n'est PAS sur le chemin d'exécution des outils de
l'agent**. Les outils tournent dans Node et appellent `execFile` directement
(`RunCommandTool.ts:63`, `OpenAppTool.ts:49`). Il existe donc **deux blocklists
qui ont divergé** (Rust `substring` vs Node `regex`) ; le Rust ne protège que
d'éventuels appels directs depuis React. Toute la sécurité réelle de l'agent
repose sur le code Node. → *Objectif de fond : une source de vérité unique.*

---

## Vulnérabilités ouvertes

### Vuln 1 — Lecture de fichier arbitraire via traversal dans `read_file` (auto-approuvé)
- **Sévérité : HAUTE** · `path_traversal` · confiance élevée · **STATUT : ✅ CORRIGÉ (2026-07-03)**
- **Correctif appliqué** : `isPathAllowed` (`PermissionEngine.ts`) rejette désormais
  tout segment `..` et exige un match à la frontière de dossier (`allowed + '/'`,
  fini le faux match `Documents` ↔ `Documents-evil`). 3 tests de non-régression
  ajoutés (`PermissionEngine.test.ts`). Suite : 474 tests verts, type-check OK.
- `permissions/PermissionEngine.ts:124-143` — `isPathAllowed` fait
  `normalized.startsWith(allowed)` **sans bloquer `../`** ni canonicaliser.
  `tools/filesystem/ReadFileTool.ts` est `low` / auto-approuvé et lit le chemin
  **brut**.
- **Exploit** : `read_file(path="%USERPROFILE%\\Downloads\\..\\.ssh\\id_rsa")`.
  La chaîne commence par le préfixe whitelisté `…\Downloads`, donc `isPathAllowed`
  renvoie vrai ; Node résout `..` et lit `~/.ssh/id_rsa`. Idem vers
  `~/.aws/credentials`, cookies navigateur, ou le `.env` du repo (mot de passe
  admin Supabase). Puis exfiltration via `send_webhook_message`/`call_api`.
  **Aucune confirmation** (risque faible).
- Le scan §7 masque certains motifs de secrets mais pas un contenu arbitraire
  (cookies, fichiers proprios, URL de webhook) — la lecture elle-même est la fuite.
- **Correctif** : dans `isPathAllowed`, `path.resolve()` **avant** le `startsWith`,
  rejeter tout `..`, exiger un séparateur en fin de préfixe (`allowed + '/'`) pour
  éviter le match `Documents` ↔ `Documents-evil`. Router toutes les lectures par
  une seule fonction `assertPathAllowed`.

### Vuln 2 — `open_app` = exécution de commande arbitraire contournant la blocklist de `run_command`
- **Sévérité : HAUTE** · `command_injection` / `risk_misclassification` · confiance élevée · **STATUT : ✅ CORRIGÉ (2026-07-03)**
- **Correctif appliqué** : `open_app` reclassé `medium` → `high` (`OpenAppTool.ts`
  + `permissions.ts`), ce qui supprime l'auto-approbation « se souvenir » de
  session. `validateAppName` refuse désormais les interpréteurs/LOLBins comme
  cible (powershell/pwsh/cmd/wscript/cscript/mshta/rundll32/regsvr32/python/node/
  bash…), fermant le contournement de `run_command`. Test dédié. 478 tests verts.
- **Résiduel** : un exécutable « légitime » peut toujours recevoir des arguments ;
  la vraie borne reste la confirmation `high`. Le durcissement va plus loin en
  Vuln 4 (source de validation unique).
- `tools/system/OpenAppTool.ts:38-49` construit
  `Start-Process -FilePath '<name>' -ArgumentList '<args>'`. Le nom peut être
  **n'importe quel exécutable**, les args sont arbitraires. Classé `medium`
  (`shared-types/src/permissions.ts:63`) alors que `run_command` équivalent est
  `high` (`permissions.ts:111`).
- **Exploit** : `open_app(name="powershell", args="-enc <base64>")` exécute du code
  arbitraire. La blocklist qui bloque `powershell -enc`, `iex`, `downloadstring`
  dans `run_command` **ne s'applique pas ici**. Étant `medium`, une approbation
  « se souvenir » (`PermissionEngine.ts:73-75`) en fait une primitive persistante ;
  et la confirmation affiche un blob base64 opaque, pas « exécute cette commande ».
- **Correctif** : reclasser `open_app` en `high` (pas de session-remember), valider
  la cible contre une allow-list d'applications, refuser les interpréteurs
  (`powershell/cmd/wscript/cscript/mshta/rundll32/regsvr32`). Fusionner la
  validation avec `run_command`.

### Vuln 3 — La whitelist de chemins ne s'applique qu'aux outils dont le nom contient `"file"`
- **Sévérité : MOYENNE** · `broken_access_control` · confiance élevée · **STATUT : ✅ CORRIGÉ (2026-07-03)**
- **Correctif appliqué** : le gate (`PermissionEngine.check`) valide désormais tout
  argument `path` **et** `db_path` par `isPathAllowed`, quel que soit le nom de
  l'outil (`workdir` volontairement exclu — c'est un cwd de commande, pas une
  cible de lecture/écriture). 3 tests ajoutés (parse_document, run_sqlite cookies,
  chemin whitelisté autorisé). 477 tests verts.
- `PermissionEngine.ts:45` : `if (request.tool.includes('file') || request.tool === 'list_directory')`.
  Or `parse_document`, `analyze_data`, `read_calendar`, `transcribe_audio` prennent
  un `path` et lisent le disque **sans jamais passer par cette vérification**, et
  sont `low`/auto-approuvés.
- Concerne aussi `run_sqlite`/`query_database` (`db_path` non restreint) : permet
  d'ouvrir n'importe quelle base SQLite du disque — p. ex. les cookies Chrome
  (`…\Google\Chrome\User Data\Default\Cookies`) via `SELECT * FROM cookies`.
- **Exploit** : `parse_document(path="…\\confidentiel.pdf")` ou
  `analyze_data(path=…secrets.csv)` lit hors whitelist. Limité aux extensions
  supportées (pdf/docx/csv/ics/audio/sqlite) → info-disclosure ciblée.
- **Correctif** : appliquer `assertPathAllowed` à **tout** argument `path`, quel que
  soit le nom de l'outil (dans `BaseTool` ou le gate, piloté par le schéma).

### Vuln 4 — Blocklist `run_command` contournable (deny-list poreuse)
- **Sévérité : MOYENNE (défense en profondeur)** · `insufficient_input_validation` · **STATUT : ouvert**
- `tools/system/RunCommandTool.ts:17-30`. Contournements : `-enc` bloqué mais
  PowerShell accepte les abréviations `-e`/`-en`/`-ec` ; `/iex\s*\(/` rate
  `iex $x` (sans parenthèse) ; `downloadstring` ne couvre pas
  `Invoke-WebRequest`/`iwr`/`Invoke-RestMethod`/`curl` ; `rm -rf /` et `del /[sf]`
  ne couvrent pas `Remove-Item -Recurse -Force`.
- `run_command` est `high` + confirmation à chaque fois — mais la blocklist donne
  une **fausse assurance** et le dialogue est souvent approuvé de confiance.
- **Correctif** : faire porter la vraie sécurité sur la confirmation explicite + le
  scoping ; fusionner les blocklists Rust/Node en une source unique couvrant les
  alias/abréviations.

---

## Déjà réparé (commits `§` — à ne pas refaire)

- **§7 — scan post-exécution** (`security/sanitizeToolOutput.ts`, câblé
  `AgentOrchestrator.ts:333-347`) : rédaction de secrets + encadrement « contenu
  non fiable » contre l'injection indirecte. **Bonne base.** Angles morts :
  appliqué seulement si `result.success` (les erreurs brutes passent non filtrées),
  et les motifs ne couvrent pas les URL de webhook.
- **`fix(security): path whitelist never matched on Windows`** (aaa5ea3) : la
  normalisation casse/slash de `isPathAllowed` est correcte — mais c'est cette
  même fonction qui reste vulnérable au `../` (Vuln 1).
- **Gate de permissions** bien invoqué avant **chaque** appel d'outil
  (`AgentOrchestrator.ts:312`) ; safe-mode, outils critiques désactivés
  (`delete_file`, `run_as_admin`), timeout 60 s sur les confirmations. Ossature saine.
- **Tests Rust `sandbox.rs`** (7ba00e6) : couvrent la blocklist, mais le chemin
  réellement exécuté est Node — ces tests protègent du code peu utilisé.

---

## Passe complémentaire (surfaces vérifiées — pas de faille nouvelle)

- **Sidecar Python** (`packages/ocr-vision`) : aucun sink dangereux
  (`eval`/`exec`/`pickle`/`yaml.load`/`os.system`/`subprocess shell`). `pd.read_csv`
  /`read_excel` sur un chemin uniquement (rattaché à Vuln 3). ✓
- **Moteur de formules mathjs** (`market/FormulaEngine.ts`) : `evaluate` scopé,
  mathjs 15.x (les évasions classiques `constructor`/`import` sont bloquées dans
  les versions récentes). **Watch-item faible confiance**, pas une faille — à
  re-vérifier à chaque montée de version de mathjs.
- **Exécution de commandes des autres outils** (`clipboard`, `git`, `docker`,
  `kill_process`, `inspect_port`, `standup`…) : tous en `execFile` avec tableau
  d'arguments (pas de shell) → pas d'injection shell. ✓
- **`run_sqlite`** : anti-injection solide (strip commentaires, refus multi-
  instructions, 1er mot-clé vérifié, `-readonly` au niveau SQLite). Seul bémol :
  `db_path` non restreint → rattaché à Vuln 3.

---

## Plan de réparation priorisé

1. ~~**`isPathAllowed` durci** (Vuln 1)~~ — ✅ **FAIT (2026-07-03)**. `..` interdit
   + match à la frontière de dossier.
2. ~~**Étendre le contrôle de chemin à tout argument `path`/`db_path`** (Vuln 3)~~
   — ✅ **FAIT (2026-07-03)**.
3. ~~**Durcir `open_app`** (Vuln 2)~~ — ✅ **FAIT (2026-07-03)**. Reclassé `high`
   + blocage des interpréteurs/LOLBins.
4. **Source de vérité unique pour l'exécution de commandes** : `run_command` +
   `open_app` via une seule couche, pour supprimer la divergence des deux
   blocklists (Vuln 4) + couvrir alias/abréviations.
5. **Boucher les angles morts §7** : sanitiser aussi les sorties d'erreur, ajouter
   les URL de webhook aux motifs.

---

## Journal de progression

- **2026-07-03** — Plan reconstruit à partir du code (ancien PC inaccessible).
  Passe complémentaire effectuée (sidecar Python, mathjs, exec des outils, SQL) :
  aucune faille HAUTE nouvelle au-delà des 4.
- **2026-07-03** — **Vuln 1 corrigée** : `isPathAllowed` rejette le traversal `..`
  et impose un match à la frontière de dossier ; 3 tests de non-régression.
  474 tests verts, type-check OK.
- **2026-07-03** — **Vuln 3 corrigée** : le gate valide `path`/`db_path` pour tout
  outil (plus seulement `*file*`) ; couvre parse_document, analyze_data,
  read_calendar, transcribe_audio, run_sqlite. 3 tests. 477 tests verts.
- **2026-07-03** — **Vuln 2 corrigée** : `open_app` reclassé `high` + blocage des
  interpréteurs/LOLBins comme cible. 1 test. 478 tests verts.

---

*Méthode : diagnostic en lecture directe du chemin d'exécution (références
`fichier:ligne` vérifiables), pas d'exécution de code. À actualiser en cochant le
STATUT de chaque vuln au fur et à mesure des correctifs.*
