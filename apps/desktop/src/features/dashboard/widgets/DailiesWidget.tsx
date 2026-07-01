import { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  DAILY_CATEGORIES,
  DAILY_CATEGORY_LABEL,
  type Daily,
  type DailyCategory,
  type DailyKindFilter,
} from '@catdesk/shared-types';
import { NewsMarkdown } from '../../news/NewsMarkdown';
import {
  computeActiveDailies,
  filterByFollowed,
  filterByKind,
  searchDailies,
  useDailiesStore,
} from '../../dailies/dailiesStore';
import type { WidgetProps } from './types';

/** Lit le genre (sujet/journal/tout) depuis la config du widget. */
function readKind(config: Record<string, unknown>): DailyKindFilter {
  const k = config['kind'];
  return k === 'journal' || k === 'topic' ? k : 'all';
}

const CHIP_BASE = 'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

interface DailiesViewProps {
  /** Dailys actives (non expirées), déjà triées. */
  items: Daily[];
  /** Catégories suivies ; vide ⇒ toutes. */
  followed: DailyCategory[];
  onToggle: (c: DailyCategory) => void;
  /** Genre affiché par ce widget (par sujet / par journal / tout). */
  kindFilter?: DailyKindFilter;
  max?: number;
}

/** Rendu pur du widget dailys : chips de filtre + liste — sans dépendance au store. */
export function DailiesView({
  items,
  followed,
  onToggle,
  kindFilter = 'all',
  max = 5,
}: DailiesViewProps) {
  const [query, setQuery] = useState('');
  const scoped = filterByFollowed(filterByKind(items, kindFilter), followed);
  const searching = query.trim().length > 0;
  const matched = searchDailies(scoped, query);
  // La recherche fouille toute la liste (titres + articles) et affiche davantage
  // de résultats ; hors recherche on garde un aperçu court.
  const visible = matched.slice(0, searching ? 30 : max);

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Filtres par centre d'intérêt */}
      <div className="flex flex-wrap gap-1">
        {DAILY_CATEGORIES.map((c) => {
          const on = followed.includes(c);
          return (
            <button
              key={c}
              onClick={() => onToggle(c)}
              aria-pressed={on}
              className={`${CHIP_BASE} ${
                on
                  ? 'bg-brand-600 text-white'
                  : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80'
              }`}
            >
              {DAILY_CATEGORY_LABEL[c]}
            </button>
          );
        })}
      </div>

      {/* Recherche approfondie (titres + articles) */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher dans les dailys…"
          className="w-full rounded-lg border border-white/10 bg-white/5 py-1.5 pl-7 pr-7 text-xs
                     text-white/85 outline-none placeholder-white/30 focus:border-brand-400/50"
        />
        {searching && (
          <button
            onClick={() => setQuery('')}
            aria-label="Effacer la recherche"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-white/30 hover:text-white/70"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Liste */}
      {visible.length === 0 ? (
        <p className="text-xs text-white/30">
          {searching
            ? `Aucun résultat pour « ${query.trim()} ».`
            : followed.length > 0
              ? 'Aucune daily dans ces catégories.'
              : 'Aucune daily pour l’instant.'}
        </p>
      ) : (
        <ul className="space-y-2 overflow-y-auto">
          {visible.map((d) => (
            <li key={d.id} className="border-t border-white/5 pt-2 first:border-0 first:pt-0">
              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded bg-brand-600/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-200">
                  {DAILY_CATEGORY_LABEL[d.category]}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/85">
                  {d.title}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-white/30">
                  {formatDate(d.publishedAt)}
                </span>
              </div>
              <div className="mt-0.5 text-xs text-white/60">
                <NewsMarkdown content={d.body} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Widget dailys — flux de briefings rédigés par l'admin (lecture seule), que
 * l'utilisateur filtre par catégorie. Données via Supabase (voir useDailies) ;
 * la sélection de catégories est une préférence locale persistée.
 */
export function DailiesWidget({ widget }: WidgetProps) {
  const items = useDailiesStore((s) => s.items);
  const status = useDailiesStore((s) => s.status);
  const followed = useDailiesStore((s) => s.followed);
  const toggle = useDailiesStore((s) => s.toggleCategory);
  const active = useMemo(() => computeActiveDailies(items), [items]);
  const kindFilter = readKind(widget.config);

  if (status === 'unconfigured') {
    return <p className="text-xs text-white/30">Dailys non configurées.</p>;
  }
  if (status === 'loading') {
    return <p className="text-xs text-white/30">Chargement…</p>;
  }
  if (status === 'error') {
    return <p className="text-xs text-red-400/70">Erreur de chargement.</p>;
  }

  return <DailiesView items={active} followed={followed} onToggle={toggle} kindFilter={kindFilter} />;
}
