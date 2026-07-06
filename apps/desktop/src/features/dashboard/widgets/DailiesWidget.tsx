import { useMemo, useState } from 'react';
import { Cat, Search, X } from 'lucide-react';
import {
  DAILY_CATEGORIES,
  DAILY_CATEGORY_LABEL,
  isDailyCategory,
  type Daily,
  type DailyCategory,
  type DailyKindFilter,
} from '@catdesk/shared-types';
import { NewsMarkdown } from '../../news/NewsMarkdown';
import {
  computeActiveDailies,
  DAILY_PERIOD_LABEL,
  filterByFollowed,
  filterByKind,
  filterByPeriod,
  filterBySource,
  isDailyPeriod,
  listDailySources,
  searchDailies,
  useDailiesStore,
  type DailyPeriodFilter,
} from '../../dailies/dailiesStore';
import { useDashboardStore } from '../dashboardStore';
import type { WidgetProps } from './types';

/** Lit le genre (sujet/journal/tout) depuis la config du widget. */
function readKind(config: Record<string, unknown>): DailyKindFilter {
  const k = config['kind'];
  return k === 'journal' || k === 'topic' ? k : 'all';
}

/**
 * Lit les catégories suivies propres à CE widget depuis sa config.
 * `undefined` = jamais touché ⇒ on retombe sur la préférence globale héritée.
 */
function readFollowed(config: Record<string, unknown>): DailyCategory[] | undefined {
  const f = config['followed'];
  return Array.isArray(f) ? f.filter(isDailyCategory) : undefined;
}

/** Lit la fenêtre temporelle du widget ('all' par défaut). */
function readPeriod(config: Record<string, unknown>): DailyPeriodFilter {
  const p = config['period'];
  return isDailyPeriod(p) ? p : 'all';
}

/** Lit la source filtrée du widget ('' = toutes). */
function readSource(config: Record<string, unknown>): string {
  const s = config['source'];
  return typeof s === 'string' ? s : '';
}

const CHIP_BASE = 'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors';

const KIND_OPTIONS: readonly { value: DailyKindFilter; label: string }[] = [
  { value: 'all', label: 'Tout' },
  { value: 'topic', label: 'Sujets' },
  { value: 'journal', label: 'Journaux' },
];

const PERIOD_OPTIONS: readonly DailyPeriodFilter[] = ['today', 'week', 'all'];

const SEGMENT_GROUP = 'flex w-fit gap-0.5 rounded-lg bg-white/5 p-0.5';
const segmentClass = (on: boolean): string =>
  `rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
    on ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white/80'
  }`;

// Combo de dévoilement progressif : aperçu court → 20 → totalité.
const STEP_LIMITS = [20, Infinity] as const;

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, now)) return "Aujourd'hui";
  if (sameDay(d, yesterday)) return 'Hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

interface DayGroup {
  key: string;
  label: string;
  items: Daily[];
}

/** Regroupe des dailys (déjà triées récent→ancien) par jour local. Pur. */
function groupByDay(items: Daily[], now: Date): DayGroup[] {
  const order: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const d of items) {
    const dt = new Date(d.publishedAt);
    const key = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
    let g = byKey.get(key);
    if (g === undefined) {
      g = { key, label: dayLabel(d.publishedAt, now), items: [] };
      byKey.set(key, g);
      order.push(g);
    }
    g.items.push(d);
  }
  return order;
}

interface DailiesViewProps {
  /** Dailys actives (non expirées), déjà triées. */
  items: Daily[];
  /** Catégories suivies ; vide ⇒ toutes. */
  followed: DailyCategory[];
  onToggle: (c: DailyCategory) => void;
  /** Genre affiché par ce widget (par sujet / par journal / tout). */
  kindFilter?: DailyKindFilter;
  /** Si fourni, affiche le sélecteur de genre (Tout · Sujets · Journaux). */
  onKindChange?: (kind: DailyKindFilter) => void;
  /** Fenêtre temporelle ; sélecteur affiché si onPeriodChange est fourni. */
  period?: DailyPeriodFilter;
  onPeriodChange?: (period: DailyPeriodFilter) => void;
  /** Source (journal ou sujet) ; menu affiché si onSourceChange est fourni. '' = toutes. */
  source?: string;
  onSourceChange?: (source: string) => void;
  max?: number;
  /** Le serveur détient-il des dailys plus anciennes non encore chargées ? */
  serverHasMore?: boolean;
  /** Un chargement de page serveur est-il en cours ? */
  loadingMore?: boolean;
  /** Demande une page de plus au serveur (dailys plus anciennes). */
  onLoadMore?: () => void;
}

/** Rendu pur du widget dailys : chips de filtre + liste — sans dépendance au store. */
export function DailiesView({
  items,
  followed,
  onToggle,
  kindFilter = 'all',
  onKindChange,
  period = 'all',
  onPeriodChange,
  source = '',
  onSourceChange,
  max = 5,
  serverHasMore = false,
  loadingMore = false,
  onLoadMore,
}: DailiesViewProps) {
  const [query, setQuery] = useState('');
  const [step, setStep] = useState(0);
  const searching = query.trim().length > 0;

  // Filtres genre → source → période → catégories → recherche, puis dévoilement
  // progressif (5 → 20 → tout).
  const byKind = filterByKind(items, kindFilter);
  const sources = useMemo(() => listDailySources(byKind), [byKind]);
  // Une source qui n'existe plus dans la vue courante (changement de genre,
  // données rafraîchies) est ignorée plutôt que de vider silencieusement la liste.
  const effectiveSource = source !== '' && sources.includes(source) ? source : '';
  const list = searchDailies(
    filterByFollowed(filterByPeriod(filterBySource(byKind, effectiveSource), period), followed),
    query,
  );
  const limit = step === 0 ? max : (STEP_LIMITS[step - 1] ?? Infinity);
  const visible = list.slice(0, limit);
  const groups = groupByDay(visible, new Date());
  // Reste-t-il des dailys DÉJÀ chargées à dévoiler ? (pagination client, 5→20→tout)
  const canRevealMore = visible.length < list.length;
  // Toutes les dailys chargées sont visibles mais le serveur en a d'autres ⇒ page suivante.
  const canLoadServer = !canRevealMore && serverHasMore && onLoadMore !== undefined;

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Sélecteurs de genre et de période : un seul widget, plusieurs vues */}
      {(onKindChange !== undefined || onPeriodChange !== undefined) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {onKindChange !== undefined && (
            <div role="tablist" aria-label="Genre de dailys" className={SEGMENT_GROUP}>
              {KIND_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  role="tab"
                  aria-selected={kindFilter === o.value}
                  onClick={() => onKindChange(o.value)}
                  className={segmentClass(kindFilter === o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {onPeriodChange !== undefined && (
            <div role="tablist" aria-label="Période" className={SEGMENT_GROUP}>
              {PERIOD_OPTIONS.map((p) => (
                <button
                  key={p}
                  role="tab"
                  aria-selected={period === p}
                  onClick={() => onPeriodChange(p)}
                  className={segmentClass(period === p)}
                >
                  {DAILY_PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

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

      {/* Recherche approfondie (titres + articles) + filtre par source */}
      <div className="flex gap-1.5">
        <div className="relative min-w-0 flex-1">
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
        {onSourceChange !== undefined && sources.length > 1 && (
          <select
            value={effectiveSource}
            onChange={(e) => onSourceChange(e.target.value)}
            aria-label="Filtrer par source"
            className="max-w-[45%] shrink-0 rounded-lg border border-white/10 bg-white/5 px-2 py-1.5
                       text-xs text-white/85 outline-none focus:border-brand-400/50
                       [&>option]:bg-gray-900 [&>option]:text-white/85"
          >
            <option value="">Toutes les sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Liste groupée par jour + dévoilement progressif */}
      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-4 text-center">
          <Cat className="h-5 w-5 text-white/15" aria-hidden />
          <p className="text-xs text-white/30">
            {searching
              ? `Aucun résultat pour « ${query.trim()} ».`
              : followed.length > 0 || effectiveSource !== '' || period !== 'all'
                ? 'Aucune daily avec ces filtres.'
                : 'Aucune daily pour l’instant.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 space-y-3 overflow-y-auto">
          {groups.map((g) => (
            <div key={g.key}>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                {g.label}
              </p>
              <ul className="space-y-2">
                {g.items.map((d) => (
                  <li key={d.id} className="border-t border-white/5 pt-2 first:border-0 first:pt-0">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 rounded bg-brand-600/20 px-1.5 py-0.5 text-[10px] font-medium text-brand-200">
                        {DAILY_CATEGORY_LABEL[d.category]}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/85">
                        {d.title}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-white/60">
                      <NewsMarkdown content={d.body} />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {(canRevealMore || canLoadServer || step > 0) && (
            <div className="flex items-center gap-3 pt-1 text-xs">
              {canRevealMore && (
                <button
                  onClick={() => setStep((s) => s + 1)}
                  className="font-medium text-brand-300 hover:text-brand-200"
                >
                  {step === 0 ? 'Voir plus' : 'Voir tout'} ({list.length})
                </button>
              )}
              {canLoadServer && (
                <button
                  onClick={onLoadMore}
                  disabled={loadingMore}
                  className="font-medium text-brand-300 hover:text-brand-200 disabled:opacity-50"
                >
                  {loadingMore ? 'Chargement…' : 'Charger plus d’articles'}
                </button>
              )}
              {step > 0 && (
                <button onClick={() => setStep(0)} className="text-white/40 hover:text-white/70">
                  Réduire
                </button>
              )}
            </div>
          )}
        </div>
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
  const globalFollowed = useDailiesStore((s) => s.followed);
  const hasMore = useDailiesStore((s) => s.hasMore);
  const loadingMore = useDailiesStore((s) => s.loadingMore);
  const loadMore = useDailiesStore((s) => s.loadMore);
  const updateWidgetConfig = useDashboardStore((s) => s.updateWidgetConfig);
  const renameWidget = useDashboardStore((s) => s.renameWidget);
  const active = useMemo(() => computeActiveDailies(items), [items]);
  const kindFilter = readKind(widget.config);

  // Bascule de genre en place ; on ne renomme que les titres auto (jamais un
  // titre personnalisé par l'utilisateur).
  const AUTO_TITLES: Record<DailyKindFilter, string> = {
    all: 'Dailys',
    topic: 'Dailys — par sujet',
    journal: 'Dailys — par journal',
  };
  const setKind = (k: DailyKindFilter) => {
    updateWidgetConfig(widget.id, { kind: k });
    if (Object.values(AUTO_TITLES).includes(widget.title)) renameWidget(widget.id, AUTO_TITLES[k]);
  };
  const period = readPeriod(widget.config);
  const source = readSource(widget.config);

  // Chaque widget a sa propre sélection de catégories (persistée dans sa
  // config) ; un widget jamais filtré hérite de l'ancienne préférence globale.
  const followed = readFollowed(widget.config) ?? globalFollowed;
  const toggle = (c: DailyCategory) => {
    const next = followed.includes(c) ? followed.filter((x) => x !== c) : [...followed, c];
    updateWidgetConfig(widget.id, { followed: next });
  };

  if (status === 'unconfigured') {
    return <p className="text-xs text-white/30">Dailys non configurées.</p>;
  }
  if (status === 'loading') {
    return <p className="text-xs text-white/30">Chargement…</p>;
  }
  if (status === 'error') {
    return <p className="text-xs text-red-400/70">Erreur de chargement.</p>;
  }

  return (
    <DailiesView
      items={active}
      followed={followed}
      onToggle={toggle}
      kindFilter={kindFilter}
      onKindChange={setKind}
      period={period}
      onPeriodChange={(p) => updateWidgetConfig(widget.id, { period: p })}
      source={source}
      onSourceChange={(s) => updateWidgetConfig(widget.id, { source: s })}
      serverHasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={loadMore}
    />
  );
}
