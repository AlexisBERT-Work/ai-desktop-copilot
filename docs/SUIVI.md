# SUIVI — où en est CatDesk

> **Ce document répond à une seule question : où en est le projet ?**
> Ce qui reste à faire et les choix non tranchés sont dans
> [AMELIORATIONS.md](AMELIORATIONS.md) · les capacités dans
> [CAPACITES.md](CAPACITES.md) · les bornes dans [LIMITES.md](LIMITES.md) ·
> l'historique versionné dans [CHANGELOG.md](../CHANGELOG.md).
>
> Journal **antéchronologique**. Le détail est gardé sur les deux derniers mois ;
> avant, une ligne par étape (`git log` a le reste).
> Dernière mise à jour : 2026-09-11.

---

## État actuel — 2026-09-11

Branche `refactor/etat-propre`, **13 commits d'avance sur `master` + le
chantier voix non commité**, rien n'est poussé, aucun tag.

**Portes** : type-check 3/3, lint 0, **47 tests desktop** (37 + 10 voix),
**36 Rust** (23 + 13 voix, dont 4 de fumée sur les vrais modèles, ignorés en
CI), `cargo clippy -D warnings`, `cargo fmt --check`. 640 tests agent
inchangés.

**Ce qui bloque sur toi** : les trois points de [AMELIORATIONS.md](AMELIORATIONS.md) § 0,
plus **un essai au micro** — tout a été vérifié sauf ta voix (voir ci-dessous).

## 2026-09-11 — CatDesk parle et écoute (mode « Jarvis », phase 1)

Demande : « l'utiliser comme un Jarvis ». Recherche d'abord (synthèse et
reconnaissance locales, 2026), puis un test d'écoute, puis l'implémentation.

**Ce que la recherche a fixé.** La RX 6700 n'a ni CUDA ni VRAM libre
(`qwen3:14b` prend ~9 Go) → toute la chaîne voix tourne sur **CPU**, ce qui
écarte d'office les modèles vedettes 2026 (Qwen3-TTS, Chatterbox, Kyutai TTS
1.6B/STT, Voxtral). Et WebView2 n'implémente pas `SpeechRecognition` → la
reconnaissance est native. Une seule dépendance Rust, **`sherpa-onnx`
1.13.8**, couvre VAD Silero, Parakeet TDT 0.6B v3 (WER fr 4,97 %, meilleur que
Whisper large-v3) et Piper ; `cpal` tient micro et sortie.

**Test d'écoute (Ryzen 5 5500, 4 threads)** — une surprise : **Pocket TTS
(Kyutai) et Kokoro sont plus lents que le temps réel en français** (RTF
1,24–1,44), quel que soit le réglage ; Piper est à 0,05 avec 64–83 ms au
premier son. Choix : **Piper `fr_FR-miro-high`** (« la plus rapide et la plus
efficace »), `siwis` en option.

**Livré** : module Rust `core/voice/` (deux threads dédiés, machine à états
pure testée : _l'assistant ne parle jamais par-dessus l'utilisateur_), 8
commandes `voice_*`, 3 événements, store React + découpeur de phrases (strip
Markdown, abréviations, décimales, blocs de code), bouton micro (bulle + chat),
onglet **Paramètres › Voix**, voix Windows en secours, packaging
(`fetch-voice-models.ps1`, `build-release.ps1 -SkipVoice`, Inno). Vérifié en
réel dans l'app : Piper prêt en 1,5 s, VAD + Parakeet en 3,1 s, 5 s de
français transcrits en 0,3 s (wav de test). **Non vérifié : ta voix dans ton
micro** — c'est le seul maillon que je ne peux pas tester.

Détail : [CAPACITES.md](CAPACITES.md) § 1 bis · suite (phases 2–3, Pocket TTS
en Rust) : [AMELIORATIONS.md](AMELIORATIONS.md) § 4 · sécurité :
[SECURITE.md](SECURITE.md) (mise à jour 2026-09-11).

---

## État au 2026-08-31 (archivé)

Branche `refactor/etat-propre`, **13 commits d'avance sur `master`, rien n'est
poussé, aucun tag**. Arbre propre.

**Toutes les portes passent** : type-check 3/3, lint 0, prettier no-op,
**640 tests agent** (77 fichiers), **37 desktop**, **23 Rust**, **7 Python**,
`cargo fmt --check`, `clippy -D warnings`, `vite build`, 0 lien markdown mort.

**Ce qui a changé** — passe de refactoring à comportement constant sur les trois
couches, plus la remise à niveau de la documentation. Volume : 161 fichiers,
+6 212 / −3 773.

- **Cinq défauts silencieux réparés**, dont deux invisibles jusque-là. Tailwind v4
  ne chargeait **jamais** `tailwind.config.ts` (directive `@config` absente) : les
  132 usages de `brand-*` et les 5 animations custom ne produisaient aucun CSS —
  prouvé par un build avant/après (0 → 36 occurrences de `#7a2fd4` dans le
  bundle). **C'est le seul changement qui se voit à l'œil.** Et
  `publish-update.ps1` cherchait un installeur NSIS que `--no-bundle` ne
  produisait jamais : le chemin d'auto-update était mort de bout en bout.
- **Bug de permissions** : `permission.response` n'avait **aucun handler** dans le
  dispatch de l'agent. `PermissionEngine.resolvePermissionRequest` existait,
  documentée « called from IPC bridge », appelée par personne. Tout outil `high`
  restait bloqué 60 s puis échouait, **quoi que réponde l'utilisateur**. Câblé,
  avec 4 tests de non-régression sur un dispatch qui n'en avait aucun.
- **Surface morte retirée** : 10 des 25 commandes Tauri (40 % de la surface IPC)
  n'avaient aucun appelant — dont `open_application`, qui lançait un processus
  arbitraire **sans `sandbox::check_command()`**. Le trou s'est refermé par
  suppression, pas par colmatage.
- **Le domaine « presse » sort des fichiers d'outils** : `FetchTechNewsTool`
  passe de 737 à 85 lignes ; le vocabulaire métier vit dans
  `news/{newsItem,sources,parseFeed,newsText,aggregate,enrich,discordEmbeds}` +
  `lib/{httpGet,readableText,discord}`. Plus aucune dépendance domaine → outils.
- **Duplications supprimées** : 15 outils passés sur `lib/runProcess` (ils
  reperdaient `windowsHide` — une console clignotait à chaque appel git — et le
  timeout) ; 5 copies de l'extraction JSON des réponses LLM ; 8 stores
  recalculant le répertoire de données ; 7 gardes de dépendances Python en
  3 variantes ; 3 blocs de jetons de style et 3 modules CRUD Supabase côté front.
- **`ToolResult` devient une union discriminée** — `if (result.success)` narrow
  enfin. Un seul site de production en dépendait à tort (`AuditLogger` écrivait
  `"error": undefined` sur chaque succès).
- **Erreurs Rust en français** via `CatdeskError` (27 `map_err` laissaient fuiter
  du texte OS anglais), audit ajouté aux 5 commandes à effet de bord qui n'en
  avaient pas — dont `update_settings`, qui bascule `safeMode`.
- **Documentation** : README, CONTRIBUTING, CHANGELOG réécrits (anglais) ;
  CAPACITES, LIMITES, SECURITE, DISTRIBUTION, CLAUDE.md corrigés (français).
  Tout ce que la doc affirmait de faux était vérifiable : compte d'outils
  (67 → **68**), **cinq outils inexistants** cités dans le tableau des
  permissions, `LIMITES` §1 bâtie entièrement sur quatre de ces fantômes, cinq
  outils réels documentés nulle part, deux chemins morts dans CONTRIBUTING, URL
  de clone et branche par défaut fausses.

> **Une affirmation d'audit rejetée** : `model_mode` / `light_model` /
> `code_model` dans `chat.rs` m'ont été rapportés comme de la surface de
> protocole morte. **C'est faux** — `AgentOrchestrator.pickModel` les consomme.
> Si quelqu'un repropose de les supprimer, c'est le même piège.

**Ce qui bloque sur toi** : voir [AMELIORATIONS.md](AMELIORATIONS.md) § 0.

---

## 2026-08-05 — modèle unique et release 0.1.3

Passage à **un seul modèle de chat**, le plus fort tenant sur 10 Go de VRAM :
`qwen3:14b` (le palier `qwen2.5:7b` sort du bundle). `recommend_default_model`
renvoie toujours le 14b ; `chatStore` et `stage-curated-models.ps1` alignés.
Chat interactif en `think:false` — fin du raisonnement caché de qwen3, latence au
premier token nettement réduite. Installeur hors-ligne **~18 Go** (contre 22),
bootstrap auto-téléchargeur réécrit en `curl.exe` (reprise `-C -`). Endpoint
d'auto-update repointé sur le repo **public** `catdesk-releases` — l'ancien
visait un repo privé, donc 404 anonyme. Publié : `catdesk-releases` v0.1.3.

## 2026-07-20 — news administrable depuis l'app

La news (annonces admin) n'avait **jamais servi** : table vide, rédaction
possible uniquement à la main dans Supabase Studio. Plutôt que retirer la
fonctionnalité, elle devient utilisable — onglet **« Annonces »** dans la console
admin, CRUD complet (titre, gravité, corps Markdown, portée, expiration), module
`newsAdmin.ts` calqué sur `dailiesAdmin.ts`, `model.ts` extrait de `useNews.ts`.

Le piège vécu en testant l'API à la main est corrigé dans le code : omettre
`audience_client_id` bascule l'annonce en **global**, silencieusement. Il est
désormais **toujours** envoyé explicitement, et la portée est une case à cocher
visible. Pas d'annuaire d'uid : cibler un poste précis reste manuel (Studio).

## 2026-07-20 — dailys publiables depuis tout poste

Diagnostic à l'origine : lecture directe de Supabase montrant que le lot standard
n'avait été publié **qu'une fois**, le 19 juillet, faute d'un poste admin allumé
en continu. Le lot standard (7 journaux + 6 sujets + synthèse) se publie
désormais depuis n'importe quel poste, sans identifiants admin : session anonyme
et fonction Postgres `publish_daily_if_missing` (`SECURITY DEFINER`), qui
**valide elle-même** ce qu'elle accepte et reste idempotente en base. Un
pré-check en lecture anonyme évite de lancer une génération LLM si un autre poste
a déjà publié. Détail : [projects/dashboard.md](projects/dashboard.md) § 6.3.

## 2026-07-20 — bot recentré sur les articles et la recherche

Demande : « principalement répondre aux questions sur les articles, thème
recherche, pas de codage ».

- **Nouvel outil `search_dailies`** (68ᵉ du catalogue) : fusion des dailys locales
  et partagées, filtres mots-clés (accents/pluriel tolérés, titre pondéré ×3),
  catégorie, fenêtre en jours ; zéro correspondance → liste des titres
  disponibles, pour que le LLM reformule au lieu d'halluciner.
- **Profil d'outils `research` par défaut** : 25 outils dev/infra ne sont plus
  enregistrés pour le chat → 43 outils exposés, prompt plus court, meilleure
  précision de choix d'outil sur qwen3:14b.
- **Correctif de latence après test réel** (2 min sur « quelles news concernent
  Claude ? ») : les questions d'actualité ne sont plus rétrogradées vers le petit
  modèle, `search_dailies` passe en mode extraits (~10× moins de tokens), et
  `CATDESK_TOOL_LIMIT` descend de 14 à 10 schémas par appel.

## 2026-07-18/19 — dashboard en canvas libre

Retour utilisateur : « les placer littéralement où je veux, de la taille exacte
que je veux ». La grille à réordonnancement laisse place à un **canvas en
pixels** — `layout {x,y,w,h}` en px (v2), drag aux pointer events, snap 8 px,
poignées de resize, migration douce des dispositions v1 dans `sanitizeConfig`.
Avec, dans la même session : **affichages enregistrés** (presets de disposition),
**style par widget** (accent + zoom local), **origine des dailys visible**
(badge Perso / Partagée), **statut de génération** en bandeau, et une **seule**
interface de gestion des journaux (les deux portées au même endroit).

Deux bugs de fond réparés là : la fenêtre Marchés & News devenait
**irrécupérable** après fermeture (la garde « fermer = masquer » vivait dans un
`useEffect` dont le cleanup la débranchait — elle est désormais posée au
chargement du module, hors React) ; et les extraits d'articles étaient **hachés
en milieu de phrase** parce que `htmlToText` traitait les retours à la ligne du
fichier HTML comme des fins de ligne.

## 2026-07-15/17 — refactoring de fond

Audit noté 12/20, puis six phases à comportement produit constant, terminées le
17 (575 tests agent, lint 0) :

- **Outillage** : `tsconfig.base.json` partagé, ESLint 9 flat config couvrant les
  3 packages, hook pre-commit réel, CI corrigée — **elle visait `main`/`dev` et
  ne tournait donc jamais**.
- **Sécurité Rust** : `sandbox::check_path` canonicalise et compare par
  composants — le contournement par préfixe voisin (`c:\users\alexiX`) et les
  symlinks sont fermés. Audit systématique après les commandes à effet de bord.
- **Validation zod sur les 67 outils** : plus aucun `rawArgs as Args` ; les
  709 lignes de schémas runtime de `shared-types/tools.ts` sont **supprimées**,
  le schéma zod de chaque outil devient la source unique.
- **Contrat IPC** : `ipc-contract.ts` + miroir Rust vérifié par un test cargo
  `include_str!`. Bug trouvé au passage : `permission_respond` attendait
  `{args:{…}}` et le front envoyait à plat — la réponse aux prompts échouait.
- **God components découpés** (SettingsWindow 570 → 75 l., PressFeedsManager
  555 → 140 l.), `AgentOrchestrator.process()` décomposé en phases et **testé
  pour la première fois** (14 tests), 12 warnings clippy purgés + `-D warnings`
  en CI, socle pytest côté Python.

---

## Avant juillet 2026 — une ligne par étape

`git log` porte le détail ; ce tableau ne sert qu'à situer une date.

| Date       | Étape                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-07 | Dailys : corps d'article téléchargé, paragraphe détaillé par article, **garde-fou anti-invention** (vérificateur LLM à T=0 + repli verbatim). 458 tests.                                                                                    |
| 2026-07-03 | B1 formules glissantes (`sma`/`ema` sur `X.history`) + B6 historique bourse en SQLite. Premiers **tests Rust de `sandbox.rs`** (la barrière n'en avait aucun).                                                                              |
| 2026-07-03 | Phase 1 — les 4 outils qui avaient une fiche de permission sans code : `write_file`, `write_clipboard`, `open_app`, `store_memory`. 67 outils.                                                                                              |
| 2026-07-03 | **Sécurité** : les 4 vulnérabilités du diagnostic corrigées (traversal, `open_app`, gate de chemins, blocklist de commandes) — voir [SECURITE.md](SECURITE.md).                                                                             |
| 2026-07-02 | Hygiène du repo : PR #1 dashboard (32 commits) mergée, outil orphelin `analyze_logs` rapatrié, branches mortes supprimées, docs resynchronisées.                                                                                            |
| 2026-06-29 | **Dailys** : flux éditorial filtrable par catégorie + console admin.                                                                                                                                                                        |
| 2026-06-28 | **Plateforme dashboard** cadrée et livrée : widgets configurables (P1), news Supabase (P2), module Bourse live (P3) — [projects/dashboard.md](projects/dashboard.md).                                                                       |
| 2026-06-11 | Session 2 : vector store maison (cosinus/JSON), routeur de modèles, boucle plan→exécute opt-in et plan visible dans l'UI, vision/OCR (Tesseract FR+EN testé en réel), navigateur Playwright pour les SPA. Premier socle de tests (30 → 67). |
| 2026-05-28 | Setup initial : monorepo, sidecars, premier smoke test JSON-RPC de bout en bout.                                                                                                                                                            |
