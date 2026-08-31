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
- Dépend de **WebView2** (préinstallé sur Windows 11).

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
  mais les propositions d'évolution restent à valider par l'humain et le
  système de _skills_ n'existe pas encore.

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
  [dashboard-p2.md](projects/dashboard-p2.md).
- **Local-first nuancé** : bourse et news ajoutent des **flux réseau sortants en
  lecture seule** (allow-listés). L'inférence, elle, reste 100 % locale.
- **Pas de partage de tableau de bord** : la disposition (canvas libre, tailles,
  styles, affichages enregistrés) vit dans le `localStorage` du poste. Rien ne
  l'exporte ni ne la synchronise entre machines.

---

_Quand une de ces bornes saute, déplace la ligne vers [CAPACITES.md](CAPACITES.md)._
