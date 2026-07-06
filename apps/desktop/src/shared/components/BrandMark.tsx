import { Cat } from 'lucide-react';

/**
 * Marque CatDesk — silhouette de chat dans une pastille teintée + wordmark.
 * Volontairement discrète (usage en en-tête) : la touche féline reste subtile,
 * l'ensemble doit rester professionnel.
 */
export function BrandMark({ subtitle }: { subtitle?: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-brand-600/20">
        <Cat className="h-4 w-4 text-brand-300" aria-hidden />
      </span>
      <span className="text-sm font-semibold tracking-[-0.01em] text-white/90">CatDesk</span>
      {subtitle !== undefined && (
        <>
          <span className="text-white/25" aria-hidden>
            ·
          </span>
          <span className="text-sm font-medium text-white/60">{subtitle}</span>
        </>
      )}
    </span>
  );
}
