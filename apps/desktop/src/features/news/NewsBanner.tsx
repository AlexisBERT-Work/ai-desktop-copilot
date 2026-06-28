import { useMemo } from 'react';
import { X } from 'lucide-react';
import { computeActiveNews, useNewsStore } from './newsStore';
import { NewsMarkdown } from './NewsMarkdown';
import { NEWS_BANNER_STYLE, NEWS_ICON } from './newsStyles';

/**
 * Bandeau d'annonce affiché en haut à l'ouverture : la news active la plus
 * récente, masquable. Les suivantes apparaissent une fois la première ignorée.
 */
export function NewsBanner() {
  const items = useNewsStore((s) => s.items);
  const dismissedIds = useNewsStore((s) => s.dismissedIds);
  const dismiss = useNewsStore((s) => s.dismiss);

  const active = useMemo(() => computeActiveNews(items, dismissedIds), [items, dismissedIds]);
  const top = active[0];
  if (top === undefined) return null;
  const extra = active.length - 1;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4">
      <div
        className={`pointer-events-auto flex max-w-xl items-start gap-3 rounded-xl border
                    px-4 py-3 shadow-lg backdrop-blur ${NEWS_BANNER_STYLE[top.severity]}`}
        role="status"
      >
        <span className="mt-0.5 text-lg" aria-hidden>
          {NEWS_ICON[top.severity]}
        </span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-white/90">{top.title}</p>
          <div className="mt-0.5 text-white/70">
            <NewsMarkdown content={top.body} />
          </div>
          {extra > 0 && (
            <p className="mt-1 text-xs text-white/40">
              +{extra} autre{extra > 1 ? 's' : ''} annonce{extra > 1 ? 's' : ''}
            </p>
          )}
        </div>
        <button
          onClick={() => dismiss(top.id)}
          className="ml-1 rounded-md p-1 text-white/40 transition hover:bg-white/10 hover:text-white/80"
          aria-label="Ignorer cette annonce"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
