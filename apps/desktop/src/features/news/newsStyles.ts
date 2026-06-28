import type { NewsSeverity } from '@catdesk/shared-types';

/** Couleurs du bandeau d'annonce par niveau de gravité. */
export const NEWS_BANNER_STYLE: Record<NewsSeverity, string> = {
  info: 'border-brand-400/40 bg-brand-950/90',
  success: 'border-green-400/40 bg-green-950/90',
  warning: 'border-amber-400/40 bg-amber-950/90',
  critical: 'border-red-400/50 bg-red-950/90',
};

/** Pictogramme par niveau de gravité. */
export const NEWS_ICON: Record<NewsSeverity, string> = {
  info: '📣',
  success: '✅',
  warning: '⚠️',
  critical: '🚨',
};
