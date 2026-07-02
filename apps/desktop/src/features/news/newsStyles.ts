import type { NewsSeverity } from '@catdesk/shared-types';
import {
  Megaphone,
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  type LucideIcon,
} from 'lucide-react';

/** Couleurs du bandeau d'annonce par niveau de gravité. */
export const NEWS_BANNER_STYLE: Record<NewsSeverity, string> = {
  info: 'border-brand-400/40 bg-brand-950/90',
  success: 'border-green-400/40 bg-green-950/90',
  warning: 'border-amber-400/40 bg-amber-950/90',
  critical: 'border-red-400/50 bg-red-950/90',
};

/** Icône (lucide) par niveau de gravité. */
export const NEWS_ICON: Record<NewsSeverity, LucideIcon> = {
  info: Megaphone,
  success: CheckCircle2,
  warning: AlertTriangle,
  critical: AlertOctagon,
};

/** Teinte de l'icône par gravité. */
export const NEWS_ICON_COLOR: Record<NewsSeverity, string> = {
  info: 'text-brand-300',
  success: 'text-green-400',
  warning: 'text-amber-400',
  critical: 'text-red-400',
};
