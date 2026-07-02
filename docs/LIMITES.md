# CE QUE CATDESK NE SAIT PAS (ENCORE) FAIRE

> Pendant de [CAPACITES.md](CAPACITES.md). À jour au **2026-07-02**.
> Liste honnête des bornes actuelles, pour ne pas survendre l'outil.

---

## 1. Outils prévus mais **pas encore câblés**

Ces actions ont une **fiche de permission** dans
[permissions.ts](../packages/shared-types/src/permissions.ts) mais **aucun outil
correspondant n'est enregistré** dans
[index.ts](../packages/agent-runtime/src/index.ts) — l'agent **ne peut donc pas
les appeler aujourd'hui** :

> **Câblés le 2026-07-03** : `write_file`, `write_clipboard`, `open_app`,
> `store_memory` — ils ne manquent plus (voir [CAPACITES.md](CAPACITES.md)).

| Action manquante | Permission déclarée | Contournement actuel |
|---|---|---|
| **Fermer une fenêtre** | `close_window` (🟠) | — |
| **Envoyer des frappes clavier** | `send_keys` (🟠) | `browser_type` pour le navigateur uniquement |
| **Supprimer un fichier** | `delete_file` (🔴) | désactivé par design |
| **Élever les privilèges (admin)** | `run_as_admin` (🔴) | désactivé par design |

> Les deux 🔴 (`delete_file`, `run_as_admin`) sont **volontairement désactivés**
> (`enabled: false`) : ce n'est pas un manque, c'est un garde-fou.

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
  système de *skills* n'existe pas encore.

## 4. Capacités partielles / à durcir

- **Capture écran côté Rust** : [screen.rs](../apps/desktop/src-tauri/src/commands/screen.rs)
  est un **stub** — tout passe par le sidecar Python.
- **Mémoire sémantique** : sans `nomic-embed-text`, retombe sur un repli mots-clés
  (moins précis). La mémoire hiérarchique **warm est implémentée** (WarmMemoryStore
  + FactExtractor + MemoryConsolidator, câblés dans `index.ts`) ; la couche
  *episodic* structurée reste à faire.
- **Sélecteur HTML de `read_webpage`** : naïf (le sélecteur `#id` s'arrête au
  premier `</`). Suffisant pour du texte simple, pas pour du parsing fin.
- **Vision écran** : dépend de `llava:7b` ; sans lui, `describe_screen` tombe en
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

- Couverture de tests **partielle** : socle vitest (~67 tests verts) sur la
  mémoire, l'analyse, le cron, git et le web — mais pas d'e2e ni de tests Rust.

## 7. Distribution

- **Installeur lourd** (~19 Go avec modèles) → impossible par mail ; clé USB ou
  Drive/OneDrive obligatoire. (Les mises à jour, elles, sont légères.)
- **SmartScreen « éditeur inconnu »** : pas de certificat de signature de code
  (payant ~100–300 €/an). La signature *updater* (gratuite) sécurise les mises à
  jour, pas l'avertissement UAC.
- Machines **8 Go de RAM / faible VRAM** : le plancher est désormais `qwen2.5:7b`
  (le `qwen2.5:3b` a été abandonné — français cassé). Il déborde en RAM (lent mais
  cohérent) ; pour de la vitesse pure, pull manuellement un modèle plus petit et
  mets-le en `CATDESK_MODEL`.

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
- **Câblage Rust** (bras `market.update`, commande `set_market_watchlist`) : effectif
  après recompilation (`pnpm dev` / `cargo build`).
- **Placement libre des widgets** (drag x/y façon Grafana) : non — ordre + tailles
  par pas seulement (react-grid-layout en suivi).

---

_Quand une de ces bornes saute, déplace la ligne vers [CAPACITES.md](CAPACITES.md)._
