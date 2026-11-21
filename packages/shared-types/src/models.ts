// ─── Modèles et serveur Ollama ─────────────────────────────────
//
// Une seule définition pour l'agent et l'UI : le tri « un seul modèle »
// (v0.1.3) a dû retrouver `qwen3:14b` codé en dur à six endroits, l'URL
// d'Ollama à huit. Le miroir Rust (`core/ollama.rs`) est vérifié contre CE
// fichier par un test cargo (`include_str!`), comme le contrat IPC.

/** Modèle de chat UNIQUE du bundle (chat + digests). `think:false` requis — voir CLAUDE.md. */
export const DEFAULT_CHAT_MODEL = 'qwen3:14b';

/** Modèle vision, chargé à la demande (describe_screen). minicpm-v, PAS llava. */
export const DEFAULT_VISION_MODEL = 'minicpm-v';

/** Modèle d'embeddings (mémoire sémantique, cache sémantique). */
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text';

/** Serveur Ollama local, embarqué ou externe. */
export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';
