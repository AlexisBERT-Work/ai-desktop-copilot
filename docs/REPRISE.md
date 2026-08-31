# REPRISE — refonte propreté & documentation (août 2026)

> Point de reprise écrit le **2026-08-31**, à la fin de la passe de refactoring.
> Il existe pour qu'on puisse reprendre le travail **sans relire les 13 commits** :
> ce qui a été fait, ce qui a été trouvé en chemin, ce qui reste ouvert, et où
> exactement s'arrêter de faire confiance à ce document.
>
> Journal complet : [SUIVI.md](SUIVI.md) · décisions ouvertes et dettes :
> [AMELIORATIONS.md](AMELIORATIONS.md) · capacités : [CAPACITES.md](CAPACITES.md).

---

## 0. Reprendre ici

Trois choses restent ouvertes, et **aucune ne peut être faite sans toi** :

| #   | Action                                                                                                      | Pourquoi c'est à toi                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Lancer `pnpm dev` et regarder l'app.**                                                                    | Le correctif Tailwind (§4.1) **change l'apparence**. C'est le rendu qui était prévu depuis le début, mais ce n'est pas celui que tu avais sous les yeux. Personne d'autre ne peut dire s'il te va. |
| 2   | **Trancher le KV-cache `q4_0`** — 30 min de test, protocole dans [AMELIORATIONS.md](AMELIORATIONS.md) §1.1. | La doc et le code se contredisent ; le code n'a **volontairement pas** été modifié. Il faut une mesure sur ta machine, pas un arbitrage sur pièces.                                                |
| 3   | **Décider du push et des tags.**                                                                            | 10 commits sur `refactor/etat-propre`, **rien n'est poussé**, **aucun tag créé**. Le CHANGELOG reconstruit 0.1.1 → 0.1.3 mais ne les tague pas : c'est une décision à part.                        |

Le reste (§3 à §6) est du contexte : à lire quand tu reprends, pas avant.

---

## 1. État du dépôt

- **Branche** : `refactor/etat-propre`, 13 commits d'avance sur `master`.
  Les **3 plus anciens** (`328fb64`, `9892bf8`, `f521fe6`, du 2026-08-20) sont
  antérieurs à cette passe — CI et garde-fou `write_file`. Les **10 suivants**
  sont le refactoring.
- **Arbre propre**, tout est commité. **Rien n'est poussé.** **Aucun tag.**
- Volume du refactoring seul (`f521fe6..HEAD`) : **161 fichiers, +6212 / −3773**.
- **Toutes les portes passent** au dernier état vérifié (§8) : type-check 3/3,
  lint 0, prettier no-op, **640 tests agent** (77 fichiers), **37 desktop**,
  **23 Rust**, **7 Python**, `cargo fmt --check`, `clippy -D warnings`,
  `vite build`, **0 lien markdown mort**.

---

## 2. Le cadrage (rappel des décisions prises ensemble)

| Sujet                               | Décision                                                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Langue                              | `README` / `CONTRIBUTING` / `CHANGELOG` en **anglais pur** ; `CLAUDE.md` + tout `docs/` en **français pur**. Plus de mélange dans un même fichier. |
| Ampleur                             | **Structurel, à comportement constant** (découper, factoriser, supprimer le mort) + les défauts réels trouvés. **Pas** de campagne de couverture.  |
| `docs/projects/` et `docs/archive/` | Conservés, avec bandeau « document historique » et statuts corrigés.                                                                               |
| CHANGELOG                           | Versions 0.1.1 / 0.1.2 / 0.1.3 **reconstruites depuis git**, sans créer de tag.                                                                    |
| 10 commandes Tauri mortes           | **Supprimées.**                                                                                                                                    |
| KV-cache `q4_0`                     | **Ne pas trancher dans le code** — le conflit part dans `AMELIORATIONS.md`.                                                                        |

---

## 3. Ce qui a été fait — commit par commit

Chaque message de commit porte le détail et le « pourquoi » ; ce tableau est
l'index.

| Commit    | Sujet                                         | Contenu                                                                                                                                                                                                                                              |
| --------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `40b5980` | 5 défauts silencieux                          | Tailwind `@config`, `publish-update.ps1`, `setup.ps1`, `dev.ps1`, BOM UTF-8. Voir §4.                                                                                                                                                                |
| `3bc8e8f` | Code mort + contrat IPC + **bug permissions** | 10 commandes Tauri supprimées (`screen.rs`, `clipboard.rs`, `system.rs`, `filesystem.rs` disparaissent), `AgentMethod` dérivé de `RPC_METHODS`, dispatch unifié, `permission.response` enfin câblée (§4.2).                                          |
| `b08466e` | `lib/runProcess`                              | 15 outils cessent de redéclarer `promisify(execFile)` ; ils y reperdaient `windowsHide` (console qui clignote) et le timeout. 6 tests écrits **avant** la migration.                                                                                 |
| `bb63c4f` | Le domaine « presse » sort des outils         | `FetchTechNewsTool` 737 → **85** lignes. Nouveaux modules `news/` et `lib/` (§5). Plus aucun import domaine → `tools/`.                                                                                                                              |
| `1bba102` | Rust : erreurs FR, relais unique, audit       | `core/error.rs` (`CatdeskError`, `thiserror`), `commands::forward_to_agent` remplace 9 corps dupliqués, audit ajouté aux commandes à effet de bord.                                                                                                  |
| `739438a` | Extraction JSON + gardes Python               | `llm/completion.ts` (5 copies supprimées), `ocr-vision/deps.py` (7 gardes en 3 variantes → une), codes JSON-RPC `-32601` / `-32602` corrigés côté Python.                                                                                            |
| `9ee17b6` | Front : factorisation                         | `shared/ui/tokens.ts`, `features/news/supabaseCrud.ts`, `features/dailies/useCrudConsole.ts`. `DailiesAdminConsole` 685 → 611.                                                                                                                       |
| `69c36e9` | `ToolResult` en union discriminée             | `if (result.success)` narrow enfin. Helpers de test `tools/base/testResult.ts`.                                                                                                                                                                      |
| `b58d725` | `lib/dataDir.ts`                              | 8 stores recalculaient le répertoire de données. **Attention** : la résolution de `CATDESK_DATA_DIR` est **paresseuse** (à l'appel), pas figée à l'import — les tests réaffectent la variable par cas. Un commentaire le dit ; ne pas « optimiser ». |
| `4cb9a97` | Documentation                                 | README, CONTRIBUTING, CHANGELOG (EN) ; CLAUDE.md, CAPACITES, LIMITES, SECURITE, DISTRIBUTION, SUIVI, ADR-001, CONCEPTS-AVANCES, 6 `docs/projects/` (FR). Création d'`AMELIORATIONS.md`.                                                              |

---

## 4. Les défauts trouvés — et pourquoi ils avaient survécu

C'est la partie qui vaut d'être relue : rien de tout ça ne faisait échouer quoi
que ce soit.

### 4.1 Tailwind ne chargeait jamais son thème

`globals.css` utilise la syntaxe **v4** (`@import 'tailwindcss'`), mais
`tailwind.config.ts` est un config **v3** — et v4 ne l'auto-découvre plus sans
directive `@config`. Il n'y en avait aucune dans le dépôt. Conséquence : les
**132 usages de `brand-*`** sur 32 fichiers et les cinq animations custom
(`animate-widget-enter`, `animate-value-tick`…) ne produisaient **aucun CSS**.

**Preuve** : build avant/après — `0` occurrence de `#7a2fd4` dans le bundle
avant, `36` après. ⚠️ **C'est le seul changement de cette passe qui se voit à
l'œil.** Si le rendu actuel te convenait mieux, l'inverse est décrit dans
[AMELIORATIONS.md](AMELIORATIONS.md) §1.3.

### 4.2 Les dialogues de permission ne fonctionnaient pas

Trouvé **par accident**, en unifiant le contrat IPC. `permission.response`,
émise par Rust (`bridge.rs::send_permission_response`), n'avait **aucun `case`**
dans le dispatch de l'agent : elle tombait dans `default` → `-32601`.
`PermissionEngine.resolvePermissionRequest` existait, documentée
« called from IPC bridge »… et n'était appelée par personne.

Effet réel : **tout outil `high`** (`run_command`, `open_app`, `schedule_task`)
restait bloqué 60 s puis échouait sur « Permission request timed out »,
**quelle que soit ta réponse**. Le dispatch n'avait aucun test — d'où la survie
du bug. Câblé, avec 4 tests de non-régression.

### 4.3 Le chemin d'auto-update ne pouvait pas aboutir

`publish-update.ps1` cherchait un installeur NSIS et sa `.sig` sous
`target/release/bundle/nsis`, alors que `build-release.ps1` construisait
**toujours** avec `--no-bundle`, ce qui saute le bundler. Le chemin de
publication documenté était donc mort de bout en bout.

### 4.4 Les deux autres

- **`setup.ps1` installait les mauvais modèles** : il proposait `qwen2.5:7b`
  (retiré du bundle en 0.1.3) et ne récupérait **jamais** `qwen3:14b` ni
  `minicpm-v`. Un poste neuf suivant la doc ne démarrait pas.
- **`open_application` lançait `Command::new(nom_fourni)` sans
  `sandbox::check_command()`**, contournant la blocklist. La commande n'avait
  aucun appelant : **le trou s'est refermé par suppression**, pas par colmatage.

### 4.5 Les petits, réparés au passage

`AuditLogger` écrivait `"error": undefined` sur **chaque** ligne d'audit
réussie · le sidecar Python répondait `-32603` là où JSON-RPC impose `-32601` /
`-32602`, donc les deux moitiés d'un même protocole n'étaient pas d'accord ·
`csv_parser` importait `chardet` sans garde (crash à l'import au lieu d'un
message actionnable) · `Ctrl+N` faisait `preventDefault()` puis rien, ce qui
**désactivait** le raccourci.

### 4.6 Une affirmation d'audit que j'ai rejetée

Il m'a été rapporté que `model_mode` / `light_model` / `code_model` dans
`chat.rs` étaient de la surface de protocole morte. **C'est faux** :
`AgentOrchestrator.pickModel` les consomme toujours. Vérifié, rien touché.
Si quelqu'un repropose de les supprimer, c'est le même piège.

### 4.7 Ce que la documentation affirmait de faux

Tout était vérifiable, et tout était faux : **67 outils au lieu de 68** · cinq
outils donnés en exemple dans le tableau des permissions qui **n'existent
nulle part** (`close_window`, `send_keys`, `delete_file`, `run_as_admin`,
`registry`) · `LIMITES.md` §1 bâtie **entièrement** sur quatre de ces fantômes ·
**cinq outils réels documentés nulle part** (`read_email`, `parse_document`,
`analyze_data`, `export_document`, `read_calendar`) · deux chemins inexistants
dans CONTRIBUTING · URL de clone et branche par défaut fausses · trois
répertoires décrits qui n'existent pas · prérequis qui ne buildaient pas.

---

## 5. Les helpers introduits — à réutiliser, pas à re-rouler

C'est la raison d'être du refactoring : la prochaine fois, **importer** au lieu
de recopier. `CLAUDE.md` et `CONTRIBUTING.md` le rappellent aussi.

| Module                                                    | Remplace                                                                                                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-runtime/src/lib/runProcess.ts`                     | Tout `promisify(execFile)`. Option `env` disponible. **Jamais** de wrapper `child_process` local.                                                  |
| `agent-runtime/src/lib/dataDir.ts`                        | Les 3 lignes de résolution du répertoire de données copiées dans 8 stores.                                                                         |
| `agent-runtime/src/lib/httpGet.ts`                        | Les fetch maison à timeout.                                                                                                                        |
| `agent-runtime/src/llm/completion.ts`                     | `complete`, `extractJsonObject`, `extractJsonArray` — le préambule `indexOf('{')` / `lastIndexOf('}')` / `try JSON.parse`, en 5 exemplaires.       |
| `agent-runtime/src/lib/readableText.ts`, `lib/discord.ts` | L'extraction de prose et la publication Discord, jusque-là enfermées dans des fichiers d'outils.                                                   |
| `agent-runtime/src/news/*`                                | Le vocabulaire métier « presse » (`NewsItem`, sources, parsing, agrégation, enrichissement). **Le domaine n'importe plus jamais depuis `tools/`.** |
| `agent-runtime/src/tools/base/testResult.ts`              | `expectOk` / `expectFail` — à utiliser dans les tests d'outils depuis que `ToolResult` narrow.                                                     |
| `src-tauri/src/core/error.rs`                             | Les 27 `map_err` qui laissaient fuiter du texte OS anglais dans une UI française.                                                                  |
| `src-tauri/src/commands/mod.rs::forward_to_agent`         | Les 9 corps de commandes identiques qui relaient vers l'agent.                                                                                     |
| `desktop/src/shared/ui/tokens.ts`                         | Les 3 définitions de `FIELD` / `OPTION` / `LABEL` / `BTN_*`.                                                                                       |
| `desktop/src/features/news/supabaseCrud.ts`               | Le CRUD Supabase recopié 3 fois (`makeTableCrud`).                                                                                                 |
| `desktop/src/features/dailies/useCrudConsole.ts`          | La machine à états des consoles admin, en double.                                                                                                  |
| `ocr-vision/deps.py::require`                             | Les 7 gardes de dépendances, qui avaient 3 comportements différents.                                                                               |

---

## 6. Ce qui n'a **pas** été touché, volontairement

À relire avant de « nettoyer » : ces choses sont justes telles quelles.

- **`core/sandbox.rs`** — devenu sans appelant après la suppression des 10
  commandes. **Conservé** avec `#![allow(dead_code)]` et un commentaire de
  module : c'est le garde-fou obligatoire de toute commande future, et ses
  11 tests documentent des contournements réels. Ne pas le supprimer « parce
  qu'il est mort ».
- **Le KV-cache `q4_0`** — voir §0, ligne 2. Le code fait ce qu'il faisait.
- **`shared-types/src/permissions.ts`** (554 l., dont ~510 de données),
  le patron View/Widget des 11 widgets, `PressFeedsManager` (c'est le modèle à
  imiter, pas à refactorer), le barrel `news/pressDigest.ts`, le test miroir
  Rust↔TS `ipc/protocol.rs` (`include_str!`), les 19 `!` de production (tous
  précédés d'un garde), et `build-release.ps1` (le contournement robocopy des
  chemins > 260 caractères est documenté et justifié).
- **Aucun tag git, aucun push.**

---

## 7. La suite, par ordre de rentabilité

Tout est détaillé dans [AMELIORATIONS.md](AMELIORATIONS.md) ; voici l'ordre que
je recommanderais si tu reprends.

1. **Trancher `q4_0`** (§1.1) — 30 min, et ça résout une contradiction qui
   traîne depuis juin.
2. **`vitest.config.ts`** (§2.2) — il n'en existe **aucun**. Les tests DOM ne
   passent que parce que chaque fichier porte un `// @vitest-environment jsdom` ;
   un oubli donne un `document is not defined` incompréhensible. Coût : 20 min.
3. **Tester `RunCommandTool`** (§2.1) — l'outil d'exécution de commandes n'a
   aucun test, alors que la politique qu'il applique en a.
4. **Remonter `qwen3:14b` (6 endroits) et l'URL Ollama (8) dans
   `@catdesk/shared-types`** (§3) — le tri des modèles de 0.1.3 a déjà montré ce
   que coûte de les chercher un par un.
5. **Décider pour Supabase depuis le webview** (§1.2) — soit documenter
   l'exception dans `SECURITE.md` et l'exempter explicitement de la règle ESLint,
   soit router par Rust. Aujourd'hui elle passe juste sous le radar.

---

## 8. La porte de vérification

```powershell
pnpm type-check
pnpm lint
pnpm test
pnpm format                                   # doit être un no-op
cargo test   --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml --lib --tests -- -D warnings
cargo fmt --check --manifest-path apps/desktop/src-tauri/Cargo.toml
cd packages/ocr-vision; python -m pytest -q
```

Plus le **grep de non-régression documentaire**, qui doit ne rien renvoyer :
`67 outils` · `qwen2.5` · `LanceDB` · `close_window` · `send_keys` ·
`run_as_admin` · `docs/tools/` · `shared-types/src/tools.ts` · `shadcn` ·
`src-tauri/src/platform`.

Et les contrôles que les tests ne couvrent pas : **regarder l'app** (§0),
vérifier qu'aucune fenêtre ne casse après la suppression des 10 commandes
(overlay, chat, dashboard, réglages, console admin), et lancer un outil git
depuis le chat (`review_diff`) pour confirmer qu'aucune console ne clignote.

---

## 9. Pièges rencontrés (pour la prochaine session)

- **`node_modules/.bin/` est vide** (pnpm isolé) : passer par
  `pnpm --filter <package> exec <binaire>`, pas par le chemin direct.
- **`Glob` ne respecte pas `.gitignore`** et ressort `node_modules/` et
  `.venv/` — préférer `Grep` (ripgrep) ou `git ls-files`. Déjà noté dans
  `CLAUDE.md`, mais ça se re-paie à chaque fois.
- **Les remplacements regex de masse sur du code sont dangereux** : trois dégâts
  sur cette passe (une virgule mangée dans `DockerControlTool`, une ligne
  d'import entière effacée dans `PlaybookStore`, un découpage de fichier calé
  sur une mauvaise frontière). À chaque fois, `git checkout --` puis reprise
  ligne à ligne. **Toujours relire le diff d'un remplacement automatisé.**
- **La console Windows est en cp1252** : un `print` contenant une flèche
  Unicode fait planter un script Python de maintenance.
