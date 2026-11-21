// ─── Transformer le texte sélectionné ───────────────────────────
//
// Miroir des types Rust de `core/selection.rs` (vérifiés par test côté Rust).
// Parcours : texte sélectionné dans n'importe quelle application → raccourci
// (Ctrl+Alt+T) → consigne dans la bulle → avant/après → Entrée remplace la
// sélection dans l'application d'origine (Ctrl+V borné, presse-papiers
// restauré).

/** Limite de la sélection, en caractères (≈ 1 300 mots) : au-delà, refus net. */
export const SELECTION_MAX_CHARS = 8_000;
/** Limite de la consigne, en caractères. */
export const SELECTION_MAX_INSTRUCTION_CHARS = 300;

/** Issue d'une transformation — miroir de `selection::Outcome`. */
export type SelectionOutcome =
  /** Résultat collé à la place de la sélection. */
  | 'replaced'
  /** Ctrl+C n'a rien copié : rien de sélectionné, ou l'application refuse de copier. */
  | 'no_selection'
  /** Sélection au-delà de `SELECTION_MAX_CHARS`. */
  | 'too_long'
  /** La fenêtre au premier plan n'est plus celle de l'appui. */
  | 'focus_changed'
  /** Fenêtre d'un programme lancé en administrateur : Windows bloquerait les touches. */
  | 'elevated'
  /** Ctrl, Alt, Maj ou Windows encore tenus après 5 s. */
  | 'keys_held'
  /** Windows a refusé les touches envoyées. */
  | 'blocked'
  /** Presse-papiers verrouillé par une autre application. */
  | 'clipboard_busy'
  /** Plus de sélection en attente (annulée, trop ancienne, déjà remplacée). */
  | 'expired'
  /** L'agent n'a pas pu transformer le texte. */
  | 'agent_error';

/** Événement `selection:update` (Rust → bulle). */
export type SelectionEvent =
  /** Sélection copiée : la bulle demande la consigne. */
  | { phase: 'captured'; text: string }
  /** Texte transformé, à valider (avant/après) avant de remplacer. */
  | { phase: 'result'; text: string }
  /** Fin du parcours, ou échec à n'importe quelle étape. */
  | { phase: 'done'; outcome: SelectionOutcome; message?: string };
