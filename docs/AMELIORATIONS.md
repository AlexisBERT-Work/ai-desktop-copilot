# AMÉLIORATIONS POSSIBLES & CHOIX OUVERTS

> **Ce document répond à une seule question : que reste-t-il à faire ?**
> Il existe pour que les contradictions et les manques **cessent d'être
> implicites**. Rien ici n'est un bug bloquant : ce sont des décisions que
> quelqu'un doit prendre, et des dettes assumées. À jour au 2026-09-11.
>
> Où en est le projet : [SUIVI.md](SUIVI.md) · ce que l'agent sait faire :
> [CAPACITES.md](CAPACITES.md) · ce qu'il ne sait pas faire :
> [LIMITES.md](LIMITES.md).

---

## 0. Ce qui bloque sur toi

Cinq choses restent ouvertes, et **aucune ne peut être faite sans toi** :

| #   | Action                                                                                                                                          | Pourquoi c'est à toi                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Créer le dépôt public `catdesk-releases-voice`** — une commande, dans [DISTRIBUTION.md](DISTRIBUTION.md) § 0 bis.                             | C'est le canal d'auto-update de la ligne 0.2.x (voix), cuit dans `tauri.release.conf.json`. Tant qu'il n'existe pas, un exe 0.2.x logue un 404 au lancement. La ligne 0.1.x reste sur `catdesk-releases`, **figée** — un push là-bas mettrait à jour tous les anciens exe. |
| 2   | **Construire l'installeur 0.2.0** — `build-release.ps1` puis `build-inno.ps1` ; si bootstrap, ajuster `PartCount` dans `catdesk-bootstrap.iss`. | ~800 Mo de modèles voix en plus : le nombre de tranches de 2 Go peut changer, et seul un build réel le dit.                                                                                                                                                                |
| 3   | **Un essai au micro** — `Ctrl+Espace`, parler, puis « Tester la voix » dans Paramètres › Voix.                                                  | Toute la chaîne est vérifiée (modèles chargés, VAD, transcription d'un wav, audit) sauf **ta** voix et **ton** micro.                                                                                                                                                      |
| 4   | **Lancer `pnpm dev` et regarder l'app.**                                                                                                        | Le correctif Tailwind (§1.3) **change l'apparence**. C'est le rendu prévu depuis le début, mais pas celui que tu avais sous les yeux. Personne d'autre ne peut dire s'il te va.                                                                                            |
| 5   | **Trancher le KV-cache `q4_0`** — 30 min, § 1.1.                                                                                                | La doc et le code se contredisent ; le code n'a **volontairement pas** été modifié. Il faut une mesure sur ta machine, pas un arbitrage sur pièces.                                                                                                                        |

Ensuite, par ordre de rentabilité : **§ 1.1** (tranche une contradiction qui
traîne depuis juin) → **§ 2.2** (`vitest.config.ts`, 20 min) → **§ 2.1**
(tester `RunCommandTool`) → **§ 3** (remonter `qwen3:14b` et l'URL Ollama dans
`shared-types`) → **§ 1.2** (décider pour Supabase depuis le webview).

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
- **[`projects/dashboard.md`](projects/dashboard.md)** est une mémoire de
  décisions, **pas un état** : il fige le « pourquoi » de juin-juillet 2026 et
  n'est pas maintenu. `SUIVI.md` fait foi.

---

## 4. Pistes produit

Reprises de l'ancienne section « Prochaines pistes » de `SUIVI.md`, qui n'avait
rien à faire au milieu d'un journal.

- **Voix — phases 2 et 3** (la phase 1, parler/écouter par `Ctrl+Espace`, est
  livrée le 2026-09-11 ; voir [CAPACITES.md](CAPACITES.md) § 1 bis). Ce qui
  reste pour que ça « sonne » Jarvis :
  - **Mode oral côté agent** : `chat.send` gagnerait un `voiceMode` →
    instruction système « 1 à 3 phrases, pas de Markdown, chiffres en toutes
    lettres ». Aujourd'hui le modèle répond comme à l'écrit, et la voix lit
    des listes.
  - **Phrases de transition** pendant les outils (« Je regarde… ») sur
    `agent:tool_call`, pour couvrir les secondes de silence.
  - **Semer les modèles voix** dans le dossier persistant, comme
    `seed_models` le fait pour Ollama : aujourd'hui `build-release.ps1
-Update` embarque les ~800 Mo de `voice/` dans **chaque** artefact de
    mise à jour, faute de garantie que `{app}\voice` survive à une
    réinstallation NSIS. Les copier une fois dans `%APPDATA%\CatDesk\data\voice`
    (déjà sondé par `models.rs`) ramènerait les updates à 50–300 Mo.
  - **Barge-in** (couper CatDesk en parlant) : le VAD est prêt, mais sans
    annulation d'écho le haut-parleur se réentend dans le micro. Piste : seuil
    VAD plus haut pendant `speaking`, ou un casque comme prérequis affiché.
  - **Mains libres** : `sherpa_onnx::KeywordSpotter` (zipformer 3,3M, anglais,
    mots-clés par tokens, « HEY JARVIS » convient) — micro permanent ~1 % CPU,
    STT lancé seulement après détection. Repli : openWakeWord `hey_jarvis`
    (Python). **Off par défaut**, indicateur visible obligatoire.
  - **Choix ouvert — Pocket TTS** (Kyutai, meilleure voix française
    entendue au test d'écoute) est **plus lent que le temps réel sur le
    Ryzen 5 5500** (RTF 1,24–1,31, 24 couches obligatoires en français, ni
    int8 ni 6 threads n'y changent rien : autorégressif). Deux issues non
    testées : le crate Rust/Candle `pocket-tts` (annonce ×3,1 vs Python →
    RTF ~0,4) et `PocketTTS.cpp`. Support français à confirmer avant tout.
  - Sur une machine à GPU NVIDIA : Kyutai STT (VAD sémantique, sait quand
    l'utilisateur a fini) remplacerait avantageusement VAD + Parakeet.
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

---

## 5. À ne pas « nettoyer »

Ces choses **ont l'air** d'être du code mort ou de la duplication. Elles sont
justes telles quelles ; à lire avant d'y toucher.

- **`core/sandbox.rs`** est sans appelant depuis la suppression des 10 commandes
  Tauri, et **conservé exprès** (`#![allow(dead_code)]` + commentaire de module) :
  c'est le garde-fou obligatoire de toute commande future touchant au disque ou
  au shell, et ses 11 tests documentent des contournements réels déjà corrigés.
- **`lib/dataDir.ts` résout `CATDESK_DATA_DIR` à l'appel, pas à l'import.** La
  paresse est voulue — les tests réaffectent la variable par cas. Un commentaire
  le dit ; ne pas « optimiser » en figeant la valeur.
- **`model_mode` / `light_model` / `code_model`** (`chat.rs`) ne sont pas de la
  surface de protocole morte : `AgentOrchestrator.pickModel` les consomme. Un
  audit a déjà affirmé le contraire, à tort.
- **`shared-types/src/permissions.ts`** (554 l.) est à ~510 lignes de données,
  pas de logique. Le patron View/Widget des 11 widgets, `PressFeedsManager` (le
  modèle à imiter), le barrel `news/pressDigest.ts`, le test miroir Rust↔TS
  `ipc/protocol.rs` (`include_str!`) et les 19 `!` de production (tous précédés
  d'un garde) sont dans le même cas.
- **`build-release.ps1`** : le contournement robocopy des chemins > 260
  caractères est documenté et justifié.
