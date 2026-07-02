import { useMemo } from 'react';
import type { NewsItem } from '@catdesk/shared-types';
import { computeActiveNews, useNewsStore } from '../../news/newsStore';
import { NEWS_ICON, NEWS_ICON_COLOR } from '../../news/newsStyles';

/** Rendu pur d'une liste compacte d'annonces — sans dépendance au store. */
export function NewsView({ items }: { items: NewsItem[] }) {
  return (
    <ul className="space-y-1.5">
      {items.slice(0, 6).map((n) => {
        const Icon = NEWS_ICON[n.severity];
        return (
          <li key={n.id} className="flex items-start gap-2 text-sm">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${NEWS_ICON_COLOR[n.severity]}`} aria-hidden />
            <span className="min-w-0 truncate font-medium text-white/80">{n.title}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Widget tableau de bord : liste compacte des news actives. */
export function NewsWidget() {
  const items = useNewsStore((s) => s.items);
  const dismissedIds = useNewsStore((s) => s.dismissedIds);
  const status = useNewsStore((s) => s.status);
  const active = useMemo(() => computeActiveNews(items, dismissedIds), [items, dismissedIds]);

  if (status === 'unconfigured') {
    return <p className="text-xs text-white/30">News non configurée.</p>;
  }
  if (status === 'loading') {
    return <p className="text-xs text-white/30">Chargement…</p>;
  }
  if (active.length === 0) {
    return <p className="text-xs text-white/30">Aucune annonce.</p>;
  }

  return <NewsView items={active} />;
}
