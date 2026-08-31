# AMÉLIORATIONS POSSIBLES & CHOIX OUVERTS

> À jour au 2026-08-31. Ce document existe pour que les contradictions et les
> manques **cessent d'être implicites**. Rien ici n'est un bug bloquant : ce sont
> des décisions que quelqu'un doit prendre, et des dettes assumées.
>
> Voir aussi : [CAPACITES.md](CAPACITES.md) (ce que l'agent sait faire) ·
> [LIMITES.md](LIMITES.md) (ce qu'il ne sait pas faire) ·
> [SUIVI.md](SUIVI.md) (journal).

---

## 1. Choix ouverts — à trancher

### 1.1 KV-cache `q4_0` : la doc et le code se contredisent

**Le conflit, tel quel.**

| Source                                                                             | Position                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`CLAUDE.md`](../CLAUDE.md) et [`CAPACITES.md`](CAPACITES.md)                      | « `q4_0` **corrompt la sortie** sur la RX 6700 (Vulkan) — texte illisible, **incident 2026-06-15/16** ». Jamais de KV-cache 4 bits _global_.                                  |
| [`commands/tuning.rs`](../apps/desktop/src-tauri/src/commands/tuning.rs) (en-tête) | « Mesuré sur RX 6700 (10 Go) : `q4_0` coûte ~6 % de vitesse de génération mais libère ~75 % de la mémoire KV. Pour un modèle serré en VRAM, il **ramène +51 %** sur un 14B. » |

**Le fait qui tranche l'urgence** : sur la machine cible (`qwen3:14b` ≈ 9 Go,
RX 6700 10 Gio), `recommend_kv_cache` renvoie **`q4_0`**, et le test
`vram_tight_model_recommends_q4` fige exactement ce cas. **CatDesk applique donc
aujourd'hui la configuration que sa propre doc déclare corruptrice.**

**Ce qui pourrait réconcilier les deux** — deux différences réelles entre
l'incident de juin et le code actuel :

1. Le code n'active `q4_0` **que sur le process Ollama qu'il lance lui-même**
   (`cmd.env(...)` dans [`core/ollama.rs`](../apps/desktop/src-tauri/src/core/ollama.rs)),
   jamais en variable d'environnement globale — ce que la doc interdit
   littéralement (« KV-cache q4_0 **global** »).
2. Le code l'active **toujours en paire avec `OLLAMA_FLASH_ATTENTION=1`**.
   Un KV 4 bits sans flash attention est précisément la configuration qui
   produit des sorties corrompues sur plusieurs backends.

Si l'incident de juin était `q4_0` **seul**, il n'y a pas de contradiction et
c'est la doc qui est périmée.

**Comment décider (30 minutes)** : lancer CatDesk, `Réglages → KV-cache`, forcer
`q4_0`, poser trois questions longues au chat et lire la sortie. Puis forcer
`f16` et comparer la vitesse.

- Sortie lisible → **le code a raison**, corriger `CLAUDE.md:38` et
  `CAPACITES.md` §11 pour préciser « jamais en global, toujours avec flash
  attention ».
- Texte illisible → **la doc a raison**, faire renvoyer `f16` en toutes
  circonstances à `recommend_kv_cache`, adapter le test, retirer l'option de
  `KvCacheCard`.

**Statut : non tranché. Le code n'a volontairement pas été modifié.**

### 1.2 Supabase appelé directement depuis le webview

[`supabaseClient.ts`](../apps/desktop/src/features/news/supabaseClient.ts) et une
vingtaine d'appels font du HTTPS et du WebSocket **sans passer par Rust**, et la
CSP a été élargie pour ça (`tauri.conf.json`, `https://*.supabase.co
wss://*.supabase.co`). Les identifiants et le JWT admin vivent donc dans le
renderer.

C'est une **exception assumée à la règle d'architecture n°1** (« l'UI ne parle
jamais à un service, tout passe par Tauri »). Deux issues cohérentes :

- **L'assumer** : le documenter explicitement dans `SECURITE.md` comme une
  exception bornée (clé anon publique par construction, RLS côté serveur), et
  ajouter l'exemption dans la règle ESLint pour qu'elle soit visible.
- **La refermer** : router les appels Supabase par des commandes Tauri. Coût
  réel (~20 sites + le temps réel), bénéfice : plus aucun secret dans le webview.

Aujourd'hui l'exception n'est **ni documentée ni exemptée** — elle passe juste
sous le radar de la règle, qui ne couvre que `@tauri-apps/api/core`.

### 1.3 Thème Tailwind restauré

La directive `@config` manquante a été ajoutée : les 132 usages de `brand-*` et
les cinq animations custom produisent enfin du CSS. **L'apparence de l'app
change donc** — c'est le rendu qui était _prévu_, mais ce n'est pas celui que tu
avais sous les yeux ces derniers mois.

Si le rendu actuel te convenait mieux, l'inverse se fait proprement : retirer
`@config`, supprimer `tailwind.config.ts` (mort), et convertir les `brand-*` en
couleurs littérales pour ne pas garder 132 classes qui ne résolvent rien.

---

## 2. Dettes assumées — tests

Le socle est solide (640 tests agent sur 77 fichiers, 37 desktop, 23 Rust,
7 Python) mais **la couverture est inégale**, et les trous sont concentrés là où
ça compte.

### 2.1 Non testé et risqué

| Module                                         | Pourquoi c'est gênant                                                                                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/system/RunCommandTool`                  | L'outil d'exécution de commandes. `security/commandPolicy` est testé, mais pas l'outil qui l'**applique** — ni sa liste blanche d'environnement, ni son plafond de sortie. |
| `tools/filesystem/ReadFileTool`, `ListDirTool` | Aucun test de traversée de chemin côté lecture, alors que `WriteFileTool` en a.                                                                                            |
| `llm/OllamaClient` (290 l.)                    | Le parseur de flux NDJSON, le code le plus « parsing » du runtime, n'a aucun test.                                                                                         |
| `lib/ocrSidecar` (202 l.)                      | Cycle de vie d'un sous-processus + cadrage JSON à travers la frontière Python.                                                                                             |
| `AuditLogger`                                  | Sécurité-pertinent, non testé.                                                                                                                                             |
| Familles entières                              | `browser/` (6 outils), `automation/` (5), `market/` (5), `screen/` (3), `audio/` (1).                                                                                      |

### 2.2 Configuration de test fragile

**Il n'existe aucun `vitest.config.ts` dans le dépôt.** Vitest tourne sur ses
défauts, donc en environnement `node`. Les tests DOM ne passent que parce que
**chaque fichier** porte un `// @vitest-environment jsdom` en tête. Un nouveau
test qui l'oublie échoue sur un `document is not defined` incompréhensible.

Corollaire : `@testing-library/jest-dom` est installé mais **jamais chargé**
(pas de fichier de setup), d'où les `expect(...).toBeTruthy()` là où
`toBeInTheDocument()` serait juste.

À faire : un `vitest.config.ts` avec `environment: 'jsdom'`, un fichier de setup
important `@testing-library/jest-dom`, et retirer les cinq docblocks.

### 2.3 Python à ~5 %

`test_main.py` et `test_csv_parser.py` couvrent 2 modules sur 11. Le plus
rentable à couvrir est `files/calendar_reader.py` : ses helpers purs
(`_parse_window_date`, `_to_iso`, `_is_all_day`, `_text`) et l'expansion RRULE
sont testables trivialement et n'ont rien.

---

## 3. Incohérences mineures

- **`"qwen3:14b"` est codé en dur en 6 endroits** (`tuning.rs`, `chatStore.ts` ×3,
  `settingsStore.ts`, `stage-curated-models.ps1`) et **l'URL Ollama en 8**. Les
  deux devraient descendre dans `@catdesk/shared-types`. Le tri des modèles de
  0.1.3 a montré le coût : il a fallu les retrouver un par un.
- **Le préfixe `nd-`** (nom du projet _avant_ CatDesk) traîne dans 4 chemins de
  `scripts/` : `nd-target`, `nd-tessdata`, `nd-agent-deploy`, `nd-empty-<guid>`.
- **La version est dupliquée dans 4 fichiers** (`package.json` racine et desktop,
  `Cargo.toml`, `tauri.conf.json`) et `publish-update.ps1` n'en bump **qu'un**.
  Après une release, les trois autres sont périmés jusqu'à correction manuelle.
- **`tsconfig.node.json` n'étend pas `tsconfig.base.json`** : il recopie cinq
  options à la main et perd au passage `exactOptionalPropertyTypes` et
  `noUncheckedIndexedAccess`. `tailwind.config.ts` et `postcss.config.js` ne sont
  type-checkés par rien.
- **Les fichiers de config ne sont pas lintés** : `eslint.config.js` ignore
  `**/*.config.{js,mjs,ts}`, donc y compris lui-même.
- **`scripts/*.ps1` n'est vérifié par rien** — ni PSScriptAnalyzer, ni la CI.
  Deux des cinq défauts corrigés fin août étaient dans ces scripts.
- **Les stores Zustand divergent** : seul `dashboardStore` déclare un `version`
  de persistance ; `dailiesStore` et `newsStore` persistent sans, donc sans
  chemin de migration. `settingsStore` n'a pas de `partialize` et persiste ses
  actions avec son état. `chatStore` est le seul à utiliser `immer`.
- **Les sélecteurs Zustand sont mélangés** : la moitié des consommateurs
  déstructurent le store entier (`const { x } = useStore()`), ce qui re-rend à
  **chaque** changement, l'autre moitié utilise des sélecteurs atomiques.
- **`docs/projects/`** décrit l'état de juin 2026 et sert de mémoire des
  décisions ; les statuts ont été corrigés, mais ces documents ne sont pas
  maintenus. `SUIVI.md` fait foi.

---

## 4. Pistes produit

Reprises de l'ancienne section « Prochaines pistes » de `SUIVI.md`, qui n'avait
rien à faire au milieu d'un journal.

- **Entrée vocale dans le chat** — `transcribe_audio` existe déjà et fonctionne ;
  il manque le câblage UI (bouton micro, capture, envoi).
- **Annuaire d'uid pour les news ciblées** — cibler un poste précis passe encore
  par Supabase Studio (Authentication → Users). Chantier à part.
- **Système de plugins** — la voie est ouverte (`BaseTool` + `registerTools` +
  `DEFAULT_PERMISSION_CONFIG`), mais rien ne charge de tool tiers à l'exécution.
- **Friction de `browser_navigate`** — classé `high`, donc confirmation à chaque
  appel, ce qui casse un enchaînement navigateur en plusieurs étapes. Reclasser
  en `medium` (une fois par session) serait cohérent avec `browser_click` /
  `browser_type`… qui sont eux aussi `high`. À trancher ensemble.
- **Linux / macOS** — `sandbox.rs`, les scripts PowerShell et les outils
  presse-papiers/OpenApp sont écrits pour Windows.
