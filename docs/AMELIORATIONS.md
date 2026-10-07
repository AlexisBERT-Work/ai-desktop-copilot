# AMÉLIORATIONS POSSIBLES & CHOIX OUVERTS

> **Ce document répond à une seule question : que reste-t-il à faire ?**
> Il existe pour que les contradictions et les manques **cessent d'être
> implicites**. Rien ici n'est un bug bloquant : ce sont des décisions que
> quelqu'un doit prendre, et des dettes assumées. À jour au 2026-10-07.
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

Ces cinq points forment le jalon **0.2.0** ci-dessous.

---

## 0 bis. Feuille de route — les prochaines versions

Chaque version est un **jalon** : un objectif, un contenu, un critère de sortie.
Les cases à cocher vivent dans les
[Milestones GitHub](https://github.com/AlexisBERT-Work/ai-desktop-copilot/milestones)
(une issue par ligne) ; ce document garde le **pourquoi** et l'**ordre**. Si les
deux divergent, c'est ici qu'on corrige l'ordre, là-bas qu'on coche. Comment
sortir une version : [DISTRIBUTION.md](DISTRIBUTION.md) § 4.

L'ordre suit la rentabilité : d'abord sortir ce qui est déjà fait, puis rendre
les mises à jour légères (chaque update 0.2.x pèse ~800 Mo tant que les modèles
voix ne sont pas semés), puis reporter le travail d'août mis de côté, puis la
voix.

| Version                                                                        | Objectif                         | Contenu (issues)                                                                                                                                                                                                                                                                                                                                                              | Sort quand                                                                                       |
| ------------------------------------------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **[0.2.0](https://github.com/AlexisBERT-Work/ai-desktop-copilot/milestone/1)** | Première sortie de la ligne voix | Dépôt `catdesk-releases-voice` (#6) · essai au micro (#7) · rendu post-Tailwind (#8) · KV-cache `q4_0`, § 1.1 (#9, recommandé avant) · installeur + publication + tag (#10). **Rien à coder** : tout est sur `master`.                                                                                                                                                        | L'installeur est publié et un poste neuf s'installe puis se met à jour                           |
| **[0.2.1](https://github.com/AlexisBERT-Work/ai-desktop-copilot/milestone/2)** | Mises à jour légères, fiabilité  | Semer les modèles voix, § 4 (#11) · retry des dailys, `a7ffebb` (#12) · ✅ `vitest.config.ts`, § 2.2 (#13) · ✅ tests `RunCommandTool`/`ReadFileTool`/`ListDirTool`, § 2.1 (#14) · ✅ constantes modèle et URL Ollama, § 3 (#15) · dépendances vulnérables, `pnpm audit` (#25) · ✅ audit complet du 2026-10-07 (branche `refactor/audit-complet`, voir [SUIVI.md](SUIVI.md)) | L'artefact de mise à jour **suivant** (0.2.2) ne contient plus `voice/` et `pnpm audit` est vert |
| **[0.3.0](https://github.com/AlexisBERT-Work/ai-desktop-copilot/milestone/3)** | Apparence                        | Thème, palettes, réglages d'affichage — report de `515abec` (#16)                                                                                                                                                                                                                                                                                                             | Le rendu est validé à l'œil                                                                      |
| **[0.4.0](https://github.com/AlexisBERT-Work/ai-desktop-copilot/milestone/4)** | Skills et veille                 | `load_skill`, 69ᵉ outil (#17) · coupe-circuit par source (#18) · extraction trafilatura (#19)                                                                                                                                                                                                                                                                                 | `registerTools.test.ts` vert, `CAPACITES.md` et `LIMITES.md` à jour                              |
| **[0.5.0](https://github.com/AlexisBERT-Work/ai-desktop-copilot/milestone/5)** | Voix phase 2 : « sonner Jarvis » | Mode oral côté agent (#20) · phrases de transition (#21) · barge-in (#22) — § 4                                                                                                                                                                                                                                                                                               | Une question orale obtient une réponse courte, sans Markdown, sans silence                       |
| **[0.6.0](https://github.com/AlexisBERT-Work/ai-desktop-copilot/milestone/6)** | Mains libres                     | Wake word « Hey Jarvis », désactivé par défaut (#23) — § 4                                                                                                                                                                                                                                                                                                                    | Détection fiable au calme, indicateur visible quand le micro écoute                              |

**Le travail d'août mis de côté.** Les PR #5 (apparence) et #3 (skills,
veille) ont été écrites avant la refonte et le correctif Tailwind ; les fusionner
telles quelles touchait ~10 fichiers en conflit chacune. Elles sont fermées, leur
code est conservé sous les tags `archive/feat-apparence` et `archive/feat-veille`,
et chaque morceau est reporté dans le jalon ci-dessus. `git show <commit>` suffit
à le retrouver.

**Hors jalon, à trancher d'abord** : Supabase depuis le webview (§ 1.2),
friction `browser_navigate`, système de plugins, Linux/macOS, Pocket TTS (§ 4).

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

- Sortie lisible → **le code a raison**, corriger le paragraphe KV-cache de `CLAUDE.md` et
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

Le socle est solide (≈ 700 tests agent, 54 desktop, 34 Rust, 14 Python au
2026-10-07) mais **la couverture reste inégale**.

### 2.1 Non testé et risqué

Fait le 2026-10-07 : `RunCommandTool` (politique appliquée, liste blanche
d'environnement, délai), `ReadFileTool` / `ListDirTool` (plafond, cas d'erreur,
chemin déclaré — la traversée est testée dans `PermissionEngine` à travers les
outils réels), le parseur NDJSON d'`OllamaClient` (`parseChatLine`, pur), `AuditLogger`
(expurgation, fichier du jour), `run_sqlite`, `semantic_search`. Reste :

| Module                    | Pourquoi c'est gênant                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------- |
| `lib/ocrSidecar` (202 l.) | Cycle de vie d'un sous-processus + cadrage JSON à travers la frontière Python.        |
| Familles entières         | `browser/` (6 outils), `automation/` (5), `market/` (5), `screen/` (3), `audio/` (1). |
| `ipc/bridge.rs`           | Le superviseur (relance, délais, run perdu) n'est vérifié qu'à la lecture.            |

### 2.2 Configuration de test fragile — ✅ fait (2026-10-07)

`apps/desktop/vitest.config.ts` (jsdom, fusionné avec la config Vite) et
`src/test/setup.ts` (`@testing-library/jest-dom` + nettoyage) ; les docblocks
`@vitest-environment` sont retirés et les assertions passent à
`toBeInTheDocument()`.

### 2.3 Python — `calendar_reader` couvert (2026-10-07)

`test_calendar_reader.py` couvre les helpers purs et l'expansion RRULE ;
`test_main.py` vérifie que les logs restent du JSON valide. Trois modules sur
onze ont des tests ; les parseurs PDF/DOCX et l'exporteur sont les suivants.

---

## 3. Incohérences mineures

- ✅ **Modèle et URL Ollama codés en dur** (2026-10-07) : ils vivent dans
  `shared-types/src/models.ts` ; Rust les recopie dans `core/ollama.rs` sous un
  test miroir qui lit ce fichier. Restent en dur, faute de pouvoir importer du
  TS : `scripts/setup.ps1`, `stage-curated-models.ps1` et `dev.ps1`.
- **Le préfixe `nd-`** (nom du projet _avant_ CatDesk) traîne dans 4 chemins de
  `scripts/` : `nd-target`, `nd-tessdata`, `nd-agent-deploy`, `nd-empty-<guid>`.
  Laissé tel quel volontairement : `nd-tessdata` et `nd-voice-models` sont des
  caches dans `%LOCALAPPDATA%` (~800 Mo pour la voix, que l'app en dev lit
  directement) — les renommer obligerait à tout re-télécharger, pour un gain
  purement cosmétique.
- ✅ **`tsconfig.node.json`** étend `tsconfig.base.json` (2026-10-07) et couvre
  `vite.config.ts`, `vitest.config.ts` et `tailwind.config.ts`, type-checkés par
  `pnpm type-check`.
- **Les fichiers de config ne sont pas lintés** : `eslint.config.js` ignore
  `**/*.config.{js,mjs,ts}`, donc y compris lui-même.
- **`scripts/*.ps1` n'est vérifié par rien** — ni PSScriptAnalyzer, ni la CI.
  Deux des cinq défauts corrigés fin août étaient dans ces scripts.
- **Les stores Zustand divergent encore** : `settingsStore` a désormais un
  `version`, un `partialize` et une migration testée (2026-10-07), comme
  `dashboardStore` ; `dailiesStore` et `newsStore` persistent toujours sans
  `version`, et `newsStore.dismissedIds` grossit sans jamais être purgé.
  `chatStore` est le seul à utiliser `immer`.
- ✅ **Sélecteurs Zustand** (2026-10-07) : les 21 consommateurs qui
  déstructuraient le store entier passent à des sélecteurs atomiques.
- **Restes de l'audit du 2026-10-07**, notés pour plus tard :
  - un **crash** de CatDesk (pas une fermeture) laisse encore l'agent et
    l'Ollama géré orphelins — il faudrait un _Job Object_ Windows ;
  - un run interrompu (Stop) n'interrompt pas les **sous-agents** déjà lancés :
    `run_subagent` / `run_parallel_agents` ne reçoivent pas le signal ;
  - plusieurs outils revérifient à la main ce que leur schéma zod garantit déjà
    (code mort, sans danger).
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
