# CE QUE CATDESK NE SAIT PAS (ENCORE) FAIRE

> Pendant de [CAPACITES.md](CAPACITES.md). À jour au **2026-08-31**.
> Liste honnête des bornes actuelles, pour ne pas survendre l'outil.

---

## 1. Actions que l'agent ne sait pas faire

Ces actions n'existent ni comme outil, ni comme fiche de permission — l'agent ne
peut pas les appeler, et rien n'est « à moitié câblé ».

| Action manquante                  | Contournement actuel                          |
| --------------------------------- | --------------------------------------------- |
| **Fermer une fenêtre**            | —                                             |
| **Gérer/déplacer les fenêtres**   | —                                             |
| **Envoyer des frappes clavier**   | `browser_type`, pour le navigateur uniquement |
| **Supprimer un fichier**          | volontairement absent                         |
| **Élever les privilèges (admin)** | volontairement absent                         |

Suppression de fichier et élévation de privilèges sont des **absences
délibérées**, pas des trous à combler : le niveau de risque `critical` existe
dans le moteur de permissions pour qu'un tel outil, s'il arrivait un jour, soit
désactivé par défaut plutôt que rajouté après coup. Aucun outil n'est
aujourd'hui classé `critical`.

> Note historique : cette section décrivait jusqu'en août 2026 quatre outils
> (`close_window`, `send_keys`, `delete_file`, `run_as_admin`) comme « ayant une
> fiche de permission mais pas d'implémentation ». Ces fiches n'existent nulle
> part dans `permissions.ts` — la section entière reposait sur une prémisse
> fausse.

## 2. Plateforme

- **Windows uniquement** pour l'instant. Pas de build Linux/macOS (prévu V2).
- Dépend de **WebView2** (préinstallé sur Windows 11). WebView2 n'implémente
  pas `SpeechRecognition` (l'API existe mais ne renvoie jamais rien) — c'est
  pour ça que la reconnaissance vocale est native, en Rust.

## 3. Modèles & matériel

- **Pas de modèles cloud** par design (OpenAI/Anthropic optionnels = roadmap V2).
  Tout est local → la qualité plafonne au meilleur modèle qui tient en VRAM.
- Sur le **GPU cible (AMD RX 6700, 10 Go VRAM)** : éviter les modèles 20B+
  (ex. Devstral 24B) qui débordent sur la RAM et tournent 5-10× plus lentement.
- Le local **ne bat pas le cloud** sur les refactos multi-fichiers cross-repo les
  plus durs. Il couvre ~80 % du travail quotidien (édits, fixes, tests, explication).
- Les **poids du modèle sont figés** : il ne « s'améliore » pas seul. Seul le
  système autour apprend — mémoire warm, playbook et EvolutionDaemon sont
  **câblés** (voir [Concepts avancés](../CATDESK-CONCEPTS-AVANCES.md) §3, §8),
  mais les propositions d'évolution restent à valider par l'humain.
- **La voix tourne sur CPU, pas sur GPU** — par nécessité (pas de CUDA sur
  AMD, VRAM déjà prise par `qwen3:14b`). Conséquence mesurée le 2026-09-11 sur
  le Ryzen 5 5500 : les synthèses récentes de meilleure qualité (**Pocket TTS
  français 24 couches, Kokoro**) sont **plus lentes que le temps réel**
  (RTF 1,3–1,4) et bégaieraient ; seul Piper tient (RTF 0,05). Même verdict
  côté reconnaissance pour Kyutai STT / Voxtral (GPU obligatoire). Sur une
  machine à GPU NVIDIA, ces choix seraient à rouvrir.
- **La voix n'a pas de mot d'activation** : il faut `Ctrl+Espace` ou le bouton
  micro. Et CatDesk ne se laisse pas encore couper en parlant par-dessus
  (barge-in) — le haut-parleur repasserait dans le micro sans annulation
  d'écho. Voir [AMELIORATIONS.md](AMELIORATIONS.md) § 4.

## 4. Capacités partielles / à durcir

- **Pas de capture écran côté Rust** : tout passe par le sidecar Python
  (`vision/screenshot.py`, mss). Les deux commandes Tauri qui devaient s'en
  charger étaient restées des stubs renvoyant une chaîne vide depuis le MVP et
  ont été supprimées le 2026-08-31 — c'est le sidecar qui fait le travail, et
  ça marche.
- **Mémoire sémantique** : sans `nomic-embed-text`, retombe sur un repli mots-clés
  (moins précis). La mémoire hiérarchique **warm est implémentée** (WarmMemoryStore
  - FactExtractor + MemoryConsolidator, câblés dans `index.ts`) ; la couche
    _episodic_ structurée reste à faire.
- **Sélecteur HTML de `read_webpage`** : naïf (le sélecteur `#id` s'arrête au
  premier `</`). Suffisant pour du texte simple, pas pour du parsing fin.
- **Vision écran** : dépend de `minicpm-v` ; sans lui, `describe_screen` tombe en
  panne silencieuse.
- **Pas de boucle plan→exécute** robuste pour les recherches longues
  (planification opt-in basique seulement).
- **RAG hybride partiel** : la fusion dense + BM25 est implémentée dans
  `VectorStore.ts` ; **pas de reranking ni de GraphRAG** pour l'instant.

## 4 bis. Skills (`load_skill`)

- **L'agent ne découvre pas les skills seul : il faut les lui demander.** Les lister
  dans le prompt système est **mesuré nuisible** sur `qwen3:14b` (2026-08-16,
  `think:false`, quatre formulations) : le modèle produit un appel d'outil malformé
  qu'Ollama jette, et la réponse sort vide sur 2 à 5 requêtes sur 6, y compris sans
  rapport avec les skills. À réessayer seulement si le modèle du bundle change, et
  en mesurant.
- **La phrase doit dire « skill » ou « compétence ».** `load_skill` est hors du
  noyau, proposé sur ses mots-clés : c'est ce qui le rend gratuit pour les autres
  tours, mais « applique revue-comparee » seul ne le fait pas proposer.
- **Le texte seul.** Les fichiers voisins du `SKILL.md` (`scripts/`, `references/`)
  ne sont ni lus ni exécutés, et les autres clés du frontmatter (`allowed-tools`…)
  sont ignorées. Un skill conçu autour de ses scripts ne fonctionnera pas ici.
- **Taille bornée** par la fenêtre de contexte (8 192 tokens) : le corps est coupé à
  6 000 caractères (signalé par `truncated`), le catalogue à 30 skills, la
  description à 200 caractères. Un fichier de plus de 128 Ko est ignoré.
- **Un seul niveau de dossier** : `skills/<nom>/SKILL.md`. Un dépôt cloné tel quel
  dans `skills/` n'est pas exploré en profondeur. Un fichier sans `description`
  n'est pas un skill, et un lien qui sort du dossier est refusé (y compris une
  jonction posée exprès).
- **Pas d'outils nouveaux.** Un skill s'appuie sur ceux du profil courant : en
  profil `research`, une procédure qui cite `github_list_issues` échouera. Les
  outils proposés au modèle sont choisis sur la phrase de l'utilisateur, pas sur le
  skill : celui-ci peut citer un outil dont le modèle n'a pas le schéma sous les yeux.

---

## 5. Sécurité — défenses encore manquantes

Présent : sandbox Rust, permissions risk-gated, audit, safe mode, et
**post-execution scan des sorties d'outils** (`security/sanitizeToolOutput.ts`,
câblé dans l'orchestrateur) : redaction des **secrets/credentials** (clés API,
tokens, clés privées…) + détection d'injection avec cadrage « untrusted data »
(spotlighting).
**Manquent** (voir [Concepts avancés](../CATDESK-CONCEPTS-AVANCES.md) §7) :

- **Pre-check déterministe** des inputs (patterns d'injection connus) — seule la
  sortie des outils est scannée, pas l'entrée utilisateur/fichier.
- **Redaction PII** (emails, téléphones, noms) — seuls les secrets techniques
  sont redactés aujourd'hui.
- **Injection reformulée** : les motifs de `sanitizeToolOutput` couvrent l'anglais
  et le français, mais ils reconnaissent des tournures, pas une intention. Sur
  30 attaques françaises écrites sans les regarder (2026-11-06), **9 sont cadrées** :
  une paraphrase passe (« fais fi de tes consignes », « garde cette action secrète »),
  comme toute autre langue. Les motifs sont réglés pour ne pas cadrer un mode d'emploi
  (aucun déclenchement sur 650 Ko de presse et 600 Ko d'aide et de tutoriels :
  Ubuntu-fr, Framasoft, aide Google, Wikilivres), et ce choix coûte du rappel. Le cadre
  n'est donc pas une garantie : ce qui protège reste le `PermissionEngine`, et les
  skills gardent leur propre cadre systématique (voir [SECURITE.md](SECURITE.md)).
- **Isolation réseau** pour l'exécution de code généré.

## 6. Tests & qualité

- Couverture **inégale** plutôt que faible : 640 tests agent (77 fichiers),
  37 tests desktop, 23 tests Rust (sandbox, contrat IPC, auto-tune, audit,
  erreurs) et 7 tests Python. Il n'y a **pas d'e2e**.
- Les trous sont concentrés là où ça compte : `RunCommandTool`, `ReadFileTool` /
  `ListDirTool`, le parseur NDJSON d'`OllamaClient`, `lib/ocrSidecar`,
  `AuditLogger`, et les familles `browser/`, `automation/`, `market/`,
  `screen/`, `audio/`. Détail et priorités dans
  [AMELIORATIONS.md](AMELIORATIONS.md) §2.
- **Aucun `vitest.config.ts`** : les tests DOM ne passent que grâce à un
  `// @vitest-environment jsdom` répété en tête de chaque fichier.

## 7. Distribution

- **Installeur lourd** (~18 Go avec modèles, v0.1.3) → à distribuer via le
  **bootstrap** (petit `.exe` qui télécharge tout seul, cf. DISTRIBUTION.md §3bis)
  ou clé USB / Drive. (Les mises à jour, elles, sont légères.)
- **SmartScreen « éditeur inconnu »** : pas de certificat de signature de code
  (payant ~100–300 €/an). La signature _updater_ (gratuite) sécurise les mises à
  jour, pas l'avertissement UAC.
- Machines **faible VRAM** : depuis la v0.1.3 le bundle ne contient plus que
  `qwen3:14b` (~9 Go). Sous ~10 Go de VRAM il déborde en RAM (lent mais cohérent).
  Pour de la vitesse sur une machine contrainte, pull manuellement un modèle plus
  petit et impose-le via **`CATDESK_MODEL_SMALL`** (opt-in prévu pour ça ;
  `CATDESK_MODEL` remplacerait le modèle principal, y compris pour les digests).

## 8. Tableau de bord & Bourse

- **Pas de temps réel tick par tick** : la bourse rafraîchit à ~30 s (volontaire —
  le tick exige des données d'échange payantes). OK pour le suivi, pas le scalping.
- **Source Yahoo non officielle** : endpoint public sans garantie ; s'il change, la
  cotation peut tomber (le symbole passe `stale`). Pas de batch (1 requête/symbole).
- **Cotations possiblement différées** selon la place ; l'horodatage est affiché.
- **News** : nécessite un **projet Supabase configuré** (URL + clé anon + migration +
  rôle admin) ; sans config, la news est simplement masquée. Voir
  [dashboard.md](projects/dashboard.md) §5.
- **Local-first nuancé** : bourse et news ajoutent des **flux réseau sortants en
  lecture seule** (allow-listés). L'inférence, elle, reste 100 % locale.
- **Pas de partage de tableau de bord** : la disposition (canvas libre, tailles,
  styles, affichages enregistrés) vit dans le `localStorage` du poste. Rien ne
  l'exporte ni ne la synchronise entre machines.

---

_Quand une de ces bornes saute, déplace la ligne vers [CAPACITES.md](CAPACITES.md)._
