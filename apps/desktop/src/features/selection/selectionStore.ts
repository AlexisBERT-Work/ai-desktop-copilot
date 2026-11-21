import { create } from 'zustand';
import type { SelectionEvent, SelectionOutcome } from '@catdesk/shared-types';
import { SELECTION_MAX_CHARS } from '@catdesk/shared-types';
import { selectionCancel, selectionReplace, selectionTransform } from '../../shared/api/selection';

/**
 * Où en est la transformation du texte sélectionné, vue de la bulle :
 * - `instruction` : sélection copiée, on attend la consigne ;
 * - `working` : l'agent transforme ;
 * - `review` : avant/après, Entrée remplace ;
 * - `replacing` : collage en cours dans l'application d'origine ;
 * - `done` : remplacé (la bulle se referme) ;
 * - `failed` : rien à faire de plus (rien de sélectionné, sélection oubliée…).
 */
export type SelectionPhase =
  | 'idle'
  | 'instruction'
  | 'working'
  | 'review'
  | 'replacing'
  | 'done'
  | 'failed';

/** Consignes prêtes à l'emploi (un clic) ; le champ libre reste là pour le reste. */
export const SELECTION_PRESETS: ReadonlyArray<{ label: string; instruction: string }> = [
  {
    label: 'Corriger',
    instruction: "Corrige l'orthographe, la grammaire et la ponctuation, sans changer le style.",
  },
  { label: 'Reformuler', instruction: 'Reformule plus clairement, même sens et même ton.' },
  { label: 'Raccourcir', instruction: "Raccourcis d'environ moitié en gardant l'essentiel." },
  { label: 'Plus formel', instruction: 'Rends le ton plus formel et professionnel.' },
  { label: 'En anglais', instruction: 'Traduis en anglais.' },
];

const MAX = SELECTION_MAX_CHARS.toLocaleString('fr-FR');

/** Phrase affichée pour une issue — en français, sans jargon. Pure. */
export function outcomeMessage(outcome: SelectionOutcome, message?: string): string {
  switch (outcome) {
    case 'replaced':
      return "Texte remplacé. Ctrl+Z dans l'application pour revenir en arrière.";
    case 'no_selection':
      return 'Aucun texte sélectionné (ou cette application refuse la copie).';
    case 'too_long':
      return `Sélection trop longue : ${MAX} caractères au plus.`;
    case 'focus_changed':
      return "La fenêtre d'origine n'est plus disponible : copiez le résultat.";
    case 'elevated':
      return 'Application lancée en administrateur : Windows bloque les touches envoyées.';
    case 'keys_held':
      return "Des touches sont restées enfoncées (Ctrl, Alt, Maj ou Entrée) : rien n'a été envoyé.";
    case 'blocked':
      return 'Windows a refusé les touches envoyées.';
    case 'clipboard_busy':
      return 'Presse-papiers occupé par une autre application : réessayez.';
    case 'expired':
      return 'Plus de sélection en attente : refaites Ctrl+Alt+T.';
    case 'agent_error':
      return message ?? 'Transformation impossible.';
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface SelectionStoreState {
  phase: SelectionPhase;
  /** Texte sélectionné (copié par le cœur). */
  original: string;
  /** Texte transformé, à valider. */
  result: string;
  /** Dernière consigne envoyée. */
  instruction: string;
  /** Message à afficher (échec, ou confirmation du remplacement). */
  notice: string | null;

  /**
   * Événement `selection:update` venu du cœur. Renvoie `false` s'il est
   * ignoré (réponse tardive d'une transformation abandonnée) : la bulle ne
   * doit pas se rouvrir pour rien.
   */
  apply: (event: SelectionEvent) => boolean;
  transform: (instruction: string, model: string) => Promise<void>;
  replace: () => Promise<void>;
  /** Revient à la consigne, même sélection (« autre consigne »). */
  editInstruction: () => void;
  /** Abandonne tout (Échap, bulle refermée). */
  cancel: () => void;
}

const IDLE = {
  phase: 'idle' as SelectionPhase,
  original: '',
  result: '',
  instruction: '',
  notice: null,
};

export const useSelectionStore = create<SelectionStoreState>((set, get) => ({
  ...IDLE,

  apply: event => {
    switch (event.phase) {
      case 'captured':
        set({ ...IDLE, phase: 'instruction', original: event.text });
        return true;
      case 'result':
        if (get().phase !== 'working') return false;
        set({ phase: 'review', result: event.text, notice: null });
        return true;
      case 'done': {
        const notice = outcomeMessage(event.outcome, event.message);
        // L'agent a échoué : on garde la sélection, l'utilisateur peut réessayer.
        if (event.outcome === 'agent_error') {
          if (get().phase !== 'working') return false;
          set({ phase: 'instruction', notice });
          return true;
        }
        set({ ...IDLE, phase: 'failed', notice });
        return true;
      }
    }
  },

  transform: async (instruction, model) => {
    const text = instruction.trim();
    if (text === '' || get().phase === 'working') return;
    set({ phase: 'working', instruction: text, result: '', notice: null });
    try {
      await selectionTransform(text, model);
    } catch (err) {
      set({ phase: 'instruction', notice: errorText(err) });
    }
  },

  replace: async () => {
    if (get().phase !== 'review') return;
    set({ phase: 'replacing', notice: null });
    let outcome: SelectionOutcome;
    try {
      outcome = await selectionReplace();
    } catch (err) {
      set({ phase: 'review', notice: errorText(err) });
      return;
    }
    if (outcome === 'replaced') {
      set({ phase: 'done', notice: outcomeMessage(outcome) });
    } else if (outcome === 'expired') {
      set({ ...IDLE, phase: 'failed', notice: outcomeMessage(outcome) });
    } else {
      // Le résultat reste affiché : on peut le copier, ou réessayer.
      set({ phase: 'review', notice: outcomeMessage(outcome) });
    }
  },

  editInstruction: () => {
    if (get().phase === 'review') set({ phase: 'instruction', result: '', notice: null });
  },

  cancel: () => {
    if (get().phase === 'idle') return;
    set({ ...IDLE });
    void selectionCancel().catch(() => {
      // Agent absent : le cœur a déjà oublié la sélection, rien d'autre à faire.
    });
  },
}));
