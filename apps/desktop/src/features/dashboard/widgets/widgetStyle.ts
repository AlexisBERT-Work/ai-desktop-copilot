import type { Widget, WidgetAccent } from '@catdesk/shared-types';
import { WIDGET_ACCENTS } from '@catdesk/shared-types';

/**
 * Classes Tailwind par accent — écrites en toutes lettres (le JIT ne voit pas
 * les classes construites dynamiquement). `border`/`title` habillent la carte,
 * `swatch` colore la pastille du sélecteur.
 */
export const ACCENT_STYLES: Record<
  WidgetAccent,
  { border: string; title: string; swatch: string }
> = {
  default: { border: 'border-white/10', title: 'text-white/60', swatch: 'bg-white/30' },
  sky: { border: 'border-sky-400/40', title: 'text-sky-200', swatch: 'bg-sky-400' },
  emerald: { border: 'border-emerald-400/40', title: 'text-emerald-200', swatch: 'bg-emerald-400' },
  amber: { border: 'border-amber-400/40', title: 'text-amber-200', swatch: 'bg-amber-400' },
  rose: { border: 'border-rose-400/40', title: 'text-rose-200', swatch: 'bg-rose-400' },
  violet: { border: 'border-violet-400/40', title: 'text-violet-200', swatch: 'bg-violet-400' },
};

export const ACCENT_LABEL: Record<WidgetAccent, string> = {
  default: 'Neutre',
  sky: 'Bleu',
  emerald: 'Vert',
  amber: 'Ambre',
  rose: 'Rose',
  violet: 'Violet',
};

/** Paliers de taille du texte proposés dans l'éditeur. */
export const TEXT_SCALES: readonly { value: number; label: string }[] = [
  { value: 0.85, label: 'A⁻' },
  { value: 1, label: 'A' },
  { value: 1.15, label: 'A⁺' },
  { value: 1.3, label: 'A⁺⁺' },
];

/** Style effectif d'un widget, avec valeurs sûres (widget ancien sans style). */
export function readWidgetStyle(widget: Widget): { accent: WidgetAccent; textScale: number } {
  const accent =
    widget.style?.accent !== undefined && WIDGET_ACCENTS.includes(widget.style.accent)
      ? widget.style.accent
      : 'default';
  const raw = widget.style?.textScale;
  const textScale = typeof raw === 'number' ? Math.min(Math.max(raw, 0.7), 1.6) : 1;
  return { accent, textScale };
}
