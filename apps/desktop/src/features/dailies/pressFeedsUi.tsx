import { ChevronRight, type Filter } from 'lucide-react';

/**
 * Primitives visuelles partagées du gestionnaire de journaux personnalisés
 * (éditeur, liste, sélecteur de sources). Purement présentationnel.
 */

export const FIELD =
  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/90 ' +
  'outline-none placeholder-white/30 transition-colors focus:border-brand-400/60 focus:bg-white/[0.07]';
export const OPTION = 'bg-gray-900 text-white/90';
export const LABEL = 'block text-xs font-medium text-white/50 mb-1';
export const BTN_PRIMARY =
  'flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white ' +
  'transition-all hover:bg-brand-500 hover:shadow-md hover:shadow-brand-600/25 active:scale-[.97] ' +
  'disabled:opacity-50 disabled:hover:shadow-none';
export const BTN_GHOST =
  'rounded-lg px-3 py-1.5 text-sm text-white/55 transition-all hover:bg-white/5 hover:text-white/85 active:scale-[.97]';

/** Pastille « optionnel » accolée aux titres de sections non requises. */
function OptBadge() {
  return (
    <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-white/40">
      optionnel
    </span>
  );
}

/** Astérisque des champs requis. */
export function Req() {
  return (
    <span className="ml-0.5 text-brand-300" aria-hidden>
      *
    </span>
  );
}

/** Section repliable pour les réglages optionnels, avec compteur d'actifs. */
export function OptSection({
  title,
  Icon,
  activeCount,
  children,
}: {
  title: string;
  Icon: typeof Filter;
  activeCount: number;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-white/10 bg-white/[0.02] transition-colors open:border-white/15 open:bg-white/[0.04]">
      <summary
        className="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2 text-xs
                   font-medium text-white/55 transition-colors hover:text-white/90
                   [&::-webkit-details-marker]:hidden"
      >
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-open:rotate-90" />
        <Icon className="h-3.5 w-3.5 shrink-0 text-brand-300" />
        {title}
        <OptBadge />
        {activeCount > 0 && (
          <span className="ml-auto rounded-full bg-brand-600/25 px-1.5 py-0.5 text-[10px] font-semibold text-brand-200">
            {activeCount} actif{activeCount > 1 ? 's' : ''}
          </span>
        )}
      </summary>
      <div className="space-y-3 px-3 pb-3 pt-1">{children}</div>
    </details>
  );
}
