/**
 * Jetons de style partagés (classes Tailwind).
 *
 * Ces cinq jetons étaient redéfinis à l'identique ou presque dans trois
 * fichiers (pressFeedsUi, DailiesAdminConsole, WidgetConfigEditor) : `OPTION`
 * y était byte-à-byte identique, `LABEL` et les boutons ne divergeaient que par
 * une transition ou un `mb-1` oubliés — de la dérive, pas une intention.
 *
 * Les variantes qui SONT intentionnelles (l'éditeur de widgets est compact, ses
 * contrôles sont plus petits) sont nommées explicitement plutôt que recopiées.
 */

/** Champ de saisie pleine largeur. */
export const FIELD =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 ' +
  'outline-none placeholder-white/30 transition-colors focus:border-brand-400/60 focus:bg-white/[0.07]';

/** Variante dense, pour les panneaux de configuration étroits. */
export const FIELD_COMPACT =
  'w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-white/90 ' +
  'outline-none placeholder-white/25 transition-colors focus:border-brand-400/60';

/**
 * Les <option> natives s'affichent sinon sur fond blanc — illisible en thème
 * sombre. À poser sur chaque <option>, pas sur le <select>.
 */
export const OPTION = 'bg-gray-900 text-white/90';

export const LABEL = 'block text-xs font-medium text-white/50 mb-1';
/** Sans marge basse, quand le libellé est déjà espacé par sa grille. */
export const LABEL_TIGHT = 'block text-xs font-medium text-white/50';

export const BTN_PRIMARY =
  'flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white ' +
  'transition-all hover:bg-brand-500 hover:shadow-md hover:shadow-brand-600/25 active:scale-[.97] ' +
  'disabled:opacity-50 disabled:hover:shadow-none';
export const BTN_PRIMARY_SM =
  'rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white ' +
  'transition-colors hover:bg-brand-500 disabled:opacity-50';

export const BTN_GHOST =
  'rounded-lg px-3 py-1.5 text-sm text-white/55 transition-all hover:bg-white/5 hover:text-white/85 active:scale-[.97]';
export const BTN_GHOST_SM =
  'rounded-lg px-3 py-1.5 text-xs text-white/50 transition-colors hover:text-white/80';
