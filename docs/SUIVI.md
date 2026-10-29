# SUIVI — où en est CatDesk

> **Ce document répond à une seule question : où en est le projet ?**
> Ce qui reste à faire et les choix non tranchés sont dans
> [AMELIORATIONS.md](AMELIORATIONS.md) · les capacités dans
> [CAPACITES.md](CAPACITES.md) · les bornes dans [LIMITES.md](LIMITES.md) ·
> l'historique versionné dans [CHANGELOG.md](../CHANGELOG.md).
>
> Journal **antéchronologique**. Le détail est gardé sur les deux derniers mois ;
> avant, une ligne par étape (`git log` a le reste).
> Dernière mise à jour : 2026-10-16.

---

## État actuel — 2026-10-12

**Branche de travail : `refactor/audit-complet`** (depuis `dev`, tout est
poussé) — audit complet du 2026-10-07, latence du 2026-10-08, tests dans l'app
réelle du 2026-10-09. [PR #26](https://github.com/AlexisBERT-Work/ai-desktop-copilot/pull/26)
vers `dev`, à relire et fusionner ([AMELIORATIONS.md](AMELIORATIONS.md) § 0).
Pour reprendre sur un autre poste : `git switch refactor/audit-complet`, puis
la liste de ce que git ne transporte pas dans
[CONTRIBUTING.md](../CONTRIBUTING.md#a-second-machine).

**Supabase est rétabli** (coupé le 2026-10-08, vérifié le 2026-10-09 :
session anonyme, tables, RPC `publish_daily_if_missing`). Dernière daily
publiée avant la coupure : 2026-08-31 ; la revue reprend au prochain lancement.

**`master` = 0.2.0, pas encore publiée** (refonte d'août, voix, deux lignes de
distribution, cycle de version). **On travaille sur `dev`**, qui ne bouge
`master` qu'à une sortie. Aucun exe 0.2.x n'existe : la 0.1.x installée reste
figée à 0.1.3 sur `catdesk-releases`, et rien n'est publié tant que
`publish-update.ps1` n'est pas lancé à la main.

**Ce qui vient** : la feuille de route 0.2.0 → 0.6.0 dans
[AMELIORATIONS.md](AMELIORATIONS.md) § 0 bis, une issue par ligne dans les
[Milestones GitHub](https://github.com/AlexisBERT-Work/ai-desktop-copilot/milestones).
La prochaine est la **0.2.0 elle-même** : rien à coder, tout bloque sur toi
(§ 0).

**Portes** (branche) : type-check 3/3, lint 0, `format:check`, 752 tests agent,
54 desktop, 38 Rust (+ 4 de fumée ignorés en CI), 14 Python, `clippy -D
warnings`, `fmt --check`. Sur `master` : **CI verte** depuis la PR #24 (elle était rouge sur `master`
depuis juillet), sauf **Security Audit** : 68 alertes `pnpm audit`
antérieures, suivies dans #25 (jalon 0.2.1). Sur la PR #26, le job Rust
échouait sur un cache sherpa-onnx incomplet : corrigé le 2026-10-12.

## 2026-10-16 — Récap « Actu IA » par e-mail (branche `feat/recap-ia-email`)

Besoin : recevoir chaque matin, sur une adresse pro, un récap de l'actualité de
l'IA (rôle de référent IA). Branche coupée de `refactor/audit-complet`, à
proposer vers `dev` après la PR #26.

- **Groupe de sources « IA »** : 12 flux vérifiés en direct (ActuIA, JDN IA,
  The Verge / TechCrunch / Ars Technica / MIT Tech Review rubriques IA, The
  Decoder, OpenAI, Google DeepMind, Google IA, Hugging Face, Simon Willison) —
  ~70 articles sur 48 h. Écartés : Le Big Data et L'Usine Digitale (403),
  VentureBeat (429), Anthropic (pas de flux).
- **Envoi par e-mail** d'un journal local : champ « Envoi par e-mail » dans
  Journaux → Ce poste ; après chaque génération, les dailys neuves partent par
  SMTP (un message HTML + texte par destinataire). Compte expéditeur :
  `SMTP_*` (`.env.example`). Un échec d'envoi garde les dailys et s'affiche
  dans le bandeau de statut, accueil compris.
- Portes : type-check 3/3, lint 0, 784 tests agent (+32), 58 desktop (+4).
  **Pas encore vérifié de bout en bout** : il faut le mot de passe
  d'application Gmail de l'utilisateur. L'exe installé (0.1.3) n'a pas la
  fonctionnalité : `pnpm dev` d'ici la prochaine version.
- **Brief sans PC allumé** (contrainte : pas de PC qui tourne la nuit) :
  workflow GitHub Actions `ai-recap.yml`, chaque matin vers 6 h 23 (été) /
  5 h 23 (hiver), fenêtre « depuis le dernier envoi planifié réussi ».
  Premier essai avec un petit modèle sur le processeur du serveur
  (`qwen3:4b-instruct-2507`, ~7 tokens/s, 14 min) : lisible mais **pas au
  niveau d'une veille de référent** (erreurs d'attribution, aucun jugement
  éditorial). Remplacé le 2026-10-17 par **Claude Code sur l'abonnement**
  (`claude setup-token`) : collecte sans IA (`recap:collect`), rédaction
  `claude -p` en sortie JSON contrainte par `BriefSchema`, mise en page et
  envoi (`recap:send`). En production depuis le 18/10 (secrets en place,
  workflow sur `master`, code via `RECAP_CODE_REF`, profil pharma par
  `RECAP_AUDIENCE` et `RECAP_EXTRA_SOURCES`).
- **Brief v2 (2026-10-21)**, retour du lecteur : plus aucun visuel (les
  illustrations, souvent générées par IA, n'apportaient rien), et **« un fait,
  une place »** — le 17/10, un même sujet revenait six fois (objet,
  essentiel, à la une, brèves, actions, à surveiller). Nouveau format :
  sommaire cliquable, 1 à 3 sujets (faits, « pour nous », action, « à
  confirmer », sources typées primaire / presse / analyse), brèves sans
  redite, agenda daté. Consigne : remonter à la source primaire, vérifier
  les statuts réglementaires du jour, priorités du lecteur par
  `RECAP_FOCUS`. Sources revues en direct (analyse, primaires, pharma).
- **Brief v3 (2026-10-28)**, retour après une semaine : trop maigre (2
  sujets et 2 à 6 brèves par jour d'après les logs), « Pour nous » et
  « Action » jamais utiles. Nouveau format : rubrique **« Tendances du
  secteur »** en tête (rivalités, course, benchmarks avec qui a mesuré,
  cherchés activement sur le web), puis **4 à 6 sujets développés**
  (paragraphes courts, chiffres clés en gras, contexte factuel, « à
  confirmer », jusqu'à 4 sources), **10 à 20 brèves**, aucune
  recommandation au lecteur ; sommaire détaillé (chaque tendance, chaque
  sujet, chaque rubrique de brèves avec son nombre). Sources
  « pouls du secteur » ajoutées et vérifiées : Hacker News IA (≥ 100
  points), Techmeme, TLDR AI, Zvi Mowshowitz (miroir WordPress), Guardian
  IA, Wired IA, METR, L'Usine Digitale ; 160 candidats par défaut (148 sur
  24 h). Essai local du 2026-10-29 (Opus, réglages pharma) : 6 tendances
  (2 par nature), 6 sujets de 195 à 260 mots en 4-5 paragraphes, 20
  brèves, 4 échéances ; 41 tours (< 60 de `--max-turns`), ~12 min.

## 2026-10-09 — Dans l'app réelle : VRAM, mémoire, préchauffage

Tests pilotés dans la vraie fenêtre (WebView2 en débogage distant), avec les
données réelles : chat, palette, bulle, et dialogue de permission (« Refuser »
→ l'outil n'est pas lancé). Les mesures du 2026-10-08 ne tenaient pas avec un
vrai historique : la **première question d'une session** relisait 4 588 tokens
(61-71 s).

| Premier token, app réelle | Avant   | Après |
| ------------------------- | ------- | ----- |
| Première question         | 61-71 s | 3,5 s |
| Questions suivantes       | ~10 s   | ~3 s  |

Corrigé : le **préchauffage relit aussi la conversation ouverte** (l'UI passe
son identifiant à `chat_warmup`) ; la mémoire resservait des **réponses
corrompues** de l'incident KV-cache de juin (`lib/readableText.looksGarbled`
les écarte) et des faits de confiance 0,1 comme des vérités (seuil 0,5) ;
souvenirs bornés à 3 × 400 caractères. **Fuite de VRAM** : arrêter Ollama
laissait ses runners `llama-server` tenir jusqu'à 9 Go jusqu'au redémarrage du
PC — Ollama vit maintenant dans un _Job Object_ Windows. Dialogue de permission,
bulle et palette en français.

Qualité (12 questions enchaînées — capitales, calcul, auteurs, rappel d'une
question passée — température 0,7) : 10/12 et 9/12. Les ratés sont surtout de
forme : « Victor. » / « Émile. » quand on demande le nom de l'auteur. Pas de
comparaison avec l'ancien code.

## 2026-10-08 — Latence : premier token en 1-2 s

Demande : « la latence et la vitesse seront toujours le plus gros problème,
corrige-la ». Mesuré par le protocole réel de l'agent, derrière un proxy qui
journalise chaque appel à Ollama, avec les réglages de prod (`q4_0` + flash
attention) et les mêmes trois questions enchaînées :

| Premier token | Avant  | Après                                                 |
| ------------- | ------ | ----------------------------------------------------- |
| Question 1    | 34,4 s | 1,2 s (chargement fait pendant la saisie)             |
| Question 2    | 19,4 s | 1,4 s                                                 |
| Question 3    | 47,1 s | 1,9 s                                                 |
| Après pause   | —      | 2,3-2,5 s (travail de fond, puis cache re-préchauffé) |

Cinq causes, toutes corrigées : modèle **rechargé deux fois par message**
(num_ctx absent des appels de fond) ; **heure à la seconde** dans le prompt
système (cache d'Ollama jamais réutilisable) ; **tâches de fond** lancées juste
après la réponse (la question suivante attendait) ; **outils parasites**
(« quelle est la capitale… » tirait describe_screen, read_email…) ; **aucun
préchauffage**. Nouveaux : `llm/LlmScheduler` (le fond attend 90 s de calme et
cède le GPU dès qu'un run démarre), commande `chat_warmup` (focus du champ,
bulle), embeddings sur CPU.

Trouvé au passage : le projet Supabase ne résout plus, et dans ce cas l'agent
**regénérait toute la revue de presse à chaque lancement** (plusieurs minutes
de GPU) pour échouer à la publier ; il attend désormais que Supabase revienne.
Et un arrêt de CatDesk pendant une génération pouvait publier un lot dégradé
(replis « extraits bruts ») : bloqué. Ce qui coûte encore :
[AMELIORATIONS.md](AMELIORATIONS.md) § 3 bis.

## 2026-10-07 — Audit complet et refonte (branche `refactor/audit-complet`)

Demande : « refacto, analyser et corriger tout le code ». 15 commits sur
`refactor/audit-complet` (depuis `dev`, non poussée). Portes : type-check
3/3, lint 0, `format:check` (nouveau, en CI), **≈ 700 tests agent**,
54 desktop, 34 Rust, 14 Python, clippy `-D warnings`.

- **Bugs corrigés** : dailys partagées invisibles de l'agent sur un poste
  installé ; contexte qui gardait les 40 PLUS ANCIENS messages ; délai de
  permission qui faisait échouer le run ; erreur interne → UI bloquée en
  « réfléchit… » ; réponse tronquée par Stop mise en cache ; Ollama géré
  jamais arrêté (et pris pour « externe » ensuite) ; agent jamais relancé ;
  safe mode perdu si l'agent démarrait lentement ; Réglages › Modèle sans
  effet ; embeddings coupés à vie après un échec ; démons 6 h/24 h jamais
  exécutés ; tâche cron annulée ressuscitée.
- **Sécurité** : chemins déclarés par outil (`pathArgs` — `vault`/`paths`
  lisaient tout le disque) ; audit expurgé (mots de passe, tokens) ;
  dot-commands `sqlite3` refusées ; mathjs bridé ; webhook Discord borné ;
  CSP et capacités réduites.
- **Architecture** : un client HTTP (`lib/http`), une persistance atomique
  (`lib/persistence`), `news/supabaseRest`, `memory/embedding`,
  `lifecycle.ts`, orchestrateur à dépendances nommées, superviseur Rust.

Docs à jour (CAPACITES, SECURITE, AMELIORATIONS, CHANGELOG `[Unreleased]`,
CLAUDE.md, CONTRIBUTING) ; `@tauri-apps/plugin-notification` retiré du
desktop. Ce qui n'a pas été fait est listé dans
[AMELIORATIONS.md](AMELIORATIONS.md) § 3 (« Restes de l'audit »).

**Reste à faire** : pousser la branche et ouvrir la PR vers `dev`, puis
décider du numéro de version (le contenu correspond au jalon 0.2.1).

## 2026-10-06 — Nettoyage, branche `dev` et jalons de version

Demande : « tout rendre propre, puis une nouvelle branche, et des points pour
sortir les prochaines mises à jour ».

- **`refactor/etat-propre` fusionnée dans `master`** (PR #24, merge commit).
  La CI n'y avait **jamais tourné** — elle ne surveille que `master`/`dev` — et
  sa première exécution a trouvé un vrai défaut : `autoprefixer` retiré de
  `package.json` sans régénérer `pnpm-lock.yaml`, donc `--frozen-lockfile`
  refusait d'installer. Corrigé.
- **Deux PR d'août oubliées** par ce suivi, en conflit avec la refonte sur ~10
  fichiers chacune : #5 (apparence) et #3 (skills, coupe-circuit,
  trafilatura). Fermées, code conservé sous `archive/feat-apparence` et
  `archive/feat-veille`, reportées par morceaux dans les jalons 0.2.1, 0.3.0 et
  0.4.0. #4 marquée fusionnée.
- **Branches** : il ne reste que `master` et `dev` (remise à niveau en avance
  rapide). Supprimées : `refactor/etat-propre`, `fix/ci-pnpm-version`,
  `securite/durcissement`, `feat/apparence`, `feat/veille-…`.
- **La version s'écrit en un geste** : elle vit à 9 endroits et le
  `package.json` racine disait encore 0.1.3. `scripts/bump-version.ps1` les
  écrit tous ; `publish-update.ps1` ne bumpe plus et **refuse** de publier un
  dépôt qui n'est pas déjà à la bonne version, avant tout build.
- **Jalons** : 6 Milestones GitHub et 19 issues (#6 à #23, #25). Cycle de
  sortie dans [DISTRIBUTION.md](DISTRIBUTION.md) § 4.

Constaté, non modifié : le dépôt source est **public**, alors que
DISTRIBUTION § 3bis le présente comme privé.

## 2026-09-12 — Deux lignes d'installeur, l'ancienne figée

Demande : « un .exe avec l'option de voix et un ancien qui ne contient pas
les dernières mises à jour ». Le piège était l'auto-update : chaque exe
installé lit `releases/latest/download/latest.json` **du dépôt cuit dans son
binaire**, donc publier 0.2.0 en « latest » sur `catdesk-releases` aurait
migré tous les anciens postes en silence. Réponse : un dépôt de releases par
ligne (`catdesk-releases` figé à 0.1.3, `catdesk-releases-voice` pour 0.2.x),
l'endpoint de `tauri.release.conf.json` repointé, et `publish-update.ps1` qui
**déduit** le dépôt de cet endpoint et refuse tout autre `-Repo`. Versions
0.2.0 partout (`tauri.conf.json`, `package.json`, `Cargo.toml`, les deux
`.iss`) ; `build-release.ps1` crée désormais `resources/voice/` même vide
(`-SkipVoice`, `-Update`), sinon le bundler NSIS échouait sur la ressource
déclarée. Tag `v0.1.3` sur `master` pour reconstruire l'ancien exe à
l'identique.

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
