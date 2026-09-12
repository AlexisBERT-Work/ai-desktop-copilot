import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Clock,
  FileDown,
  GripVertical,
  Keyboard,
  LayoutDashboard,
  Newspaper,
  Pencil,
  Search,
  Sigma,
  SlidersHorizontal,
  Target,
  X,
  type LucideIcon,
} from 'lucide-react';
import { BTN_GHOST, BTN_PRIMARY, FIELD_COMPACT } from '../../../shared/ui/tokens';
import { WIDGET_CATEGORIES, WIDGET_CATEGORY_LABEL } from '../widgets/widgetMeta';
import {
  FORMULA_EXAMPLES,
  FORMULA_FIELDS,
  GUIDE_ENTRIES,
  ORIGIN_COLUMNS,
  ORIGIN_ROWS,
  SHORTCUTS,
  STEPS,
  WANTS,
  type GuideEntry,
} from './guideContent';
import { useScrollSpy } from './useScrollSpy';

interface Props {
  onClose: () => void;
}

const SECTIONS = [
  { id: 'gestes', n: '01', label: 'Les 4 gestes', Icon: Pencil, meta: 'dans cet ordre' },
  { id: 'index', n: '02', label: 'Je veux…', Icon: Target, meta: "de l'intention au widget" },
  {
    id: 'widgets',
    n: '03',
    label: `Les ${GUIDE_ENTRIES.length} widgets`,
    Icon: LayoutDashboard,
    meta: 'ordre du menu Ajouter',
  },
  {
    id: 'formules',
    n: '04',
    label: 'Les formules',
    Icon: Sigma,
    meta: 'Bourse · KPI · Statistique',
  },
  {
    id: 'origines',
    n: '05',
    label: 'Qui écrit quoi',
    Icon: Newspaper,
    meta: '3 sources · 2 widgets',
  },
  { id: 'raccourcis', n: '06', label: 'Raccourcis', Icon: Keyboard, meta: 'fenêtre & édition' },
] as const;

/** Stable : dépendance de l'effet de scroll-spy. */
const SECTION_IDS: readonly string[] = SECTIONS.map(s => s.id);

const LABEL_MONO = 'font-mono text-[10px] uppercase tracking-[0.15em] text-white/35';

/** Accents et casse retirés : « Graphe » se trouve en tapant « graphe ». */
function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Rendu des deux marques légères du contenu : `**gras**` et `` `code` ``.
 * Le contenu reste du texte brut côté données, donc filtrable.
 */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} className="font-semibold text-white/85">
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={i}
              className="rounded border border-brand-400/20 bg-brand-400/10 px-1 py-px
                         font-mono text-[0.85em] text-brand-200"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return part;
      })}
    </>
  );
}

/** Titre de section : libellé en encoche sur un filet pleine largeur. */
function SectionHead({
  n,
  label,
  Icon,
  meta,
}: {
  n: string;
  label: string;
  Icon: LucideIcon;
  meta: string;
}) {
  return (
    <h2 className="mb-6 flex items-center gap-4">
      <span className="flex shrink-0 items-center gap-2.5 text-sm font-semibold uppercase tracking-[0.13em] text-white/90">
        <Icon className="h-4 w-4 text-brand-400" aria-hidden />
        {n} — {label}
      </span>
      <span className="h-px min-w-4 flex-1 bg-white/10" aria-hidden />
      <span className={`${LABEL_MONO} hidden shrink-0 sm:block`}>{meta}</span>
    </h2>
  );
}

/**
 * Cadre d'aperçu : reproduit la carte réelle du tableau de bord (mêmes fond,
 * bordure et barre de titre que DashboardWidgetCard) pour que l'aperçu se
 * reconnaisse au premier coup d'œil.
 */
function Frame({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className="print-exact rounded-xl border border-white/10 bg-gray-900 p-3 text-white">
      <div className="mb-2 flex items-center gap-1" aria-hidden>
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-white/20" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-white/50">{title}</span>
        <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-white/20" />
      </div>
      <div className={className ?? ''}>{children}</div>
    </div>
  );
}

function WidgetCard({ entry, flashed }: { entry: GuideEntry; flashed: boolean }) {
  return (
    <article
      id={entry.anchor}
      className={`print-break scroll-mt-20 rounded-xl border-t border-white/10 py-7 transition-shadow
                  duration-500 first:border-t-0 ${flashed ? 'ring-2 ring-brand-400/60' : ''}`}
    >
      <header className="flex flex-wrap items-center gap-3">
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border
                     border-white/10 bg-white/5 text-brand-300"
        >
          <entry.Icon className="h-4 w-4" aria-hidden />
        </span>
        <h3 className="text-lg font-semibold tracking-tight text-white">{entry.name}</h3>
        <p className="w-full text-base leading-snug text-white/85">{entry.summary}</p>
      </header>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(270px,0.85fr)]">
        <div className="min-w-0">
          <p className="max-w-[54ch] text-sm leading-relaxed text-white/55">
            <RichText text={entry.detail} />
          </p>
          {entry.extra}

          <p className={`${LABEL_MONO} mt-5`}>Paramètres</p>
          <dl className="mt-1">
            {entry.params.map(p => (
              <div
                key={p.key}
                className="grid grid-cols-1 gap-x-4 border-t border-white/5 py-2
                           sm:grid-cols-[7rem_minmax(0,1fr)]"
              >
                <dt className="font-mono text-xs text-white/80">{p.key}</dt>
                <dd className="text-sm leading-snug text-white/45">
                  <RichText text={p.desc} />
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <p className={`${LABEL_MONO} mb-2 flex items-center gap-2`}>
            Aperçu
            <span className="h-px flex-1 bg-white/10" aria-hidden />
          </p>
          <Frame title={entry.name} className={entry.previewClass ?? ''}>
            {entry.preview}
          </Frame>
        </div>
      </div>
    </article>
  );
}

/**
 * Guide des widgets — écran plein de la fenêtre « Marchés & News ».
 *
 * Pensé pour être lu dans l'application : sommaire collant qui suit la
 * lecture, index « Je veux… » qui part de l'intention, filtre sur les widgets,
 * et aperçus rendus par les VRAIS composants (données d'exemple). Reste
 * imprimable (`.no-print` / `.print-break` / `.print-exact`).
 */
export function WidgetGuide({ onClose }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [flashed, setFlashed] = useState<string | null>(null);
  const active = useScrollSpy(SECTION_IDS, scrollRef);

  // Un seul texte par widget, prénormalisé : le filtre ne recalcule rien.
  const haystacks = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of GUIDE_ENTRIES) {
      const parts = [e.name, e.summary, e.detail, ...e.params.map(p => `${p.key} ${p.desc}`)];
      map.set(e.type, norm(parts.join(' ')));
    }
    return map;
  }, []);

  const needle = norm(query.trim());
  const groups = useMemo(() => {
    const kept = GUIDE_ENTRIES.filter(
      e => needle === '' || (haystacks.get(e.type) ?? '').includes(needle),
    );
    return WIDGET_CATEGORIES.map(family => ({
      family,
      entries: kept.filter(e => e.family === family),
    })).filter(g => g.entries.length > 0);
  }, [needle, haystacks]);

  const shown = groups.reduce((n, g) => n + g.entries.length, 0);

  const jumpTo = useCallback((anchor: string, flash: boolean) => {
    const el = document.getElementById(anchor);
    if (el === null) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    if (!flash) return;
    setFlashed(anchor);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlashed(null), 1400);
  }, []);

  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  // Échap : vide le filtre s'il est actif, sinon revient au tableau de bord.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (query !== '') setQuery('');
      else onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query, onClose]);

  return (
    <div ref={scrollRef} className="guide-scroll h-screen overflow-y-auto bg-gray-950 text-white">
      {/* Barre d'actions — non imprimée */}
      <header
        className="no-print sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b
                   border-white/10 bg-gray-950/95 px-4 py-2.5 backdrop-blur sm:px-6"
      >
        <button onClick={onClose} className={`${BTN_GHOST} flex items-center gap-1.5`}>
          <ArrowLeft className="h-4 w-4" />
          Retour
        </button>
        <span className="flex items-center gap-2 text-sm font-semibold text-white/90">
          <BookOpen className="h-4 w-4 text-brand-400" aria-hidden />
          Guide des widgets
        </span>

        <div className="relative ml-auto w-full min-w-0 sm:w-56">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30"
            aria-hidden
          />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filtrer les widgets…"
            aria-label="Filtrer les widgets"
            className={`${FIELD_COMPACT} pl-8 pr-7`}
          />
          {query !== '' && (
            <button
              onClick={() => setQuery('')}
              aria-label="Effacer le filtre"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-white/30 hover:text-white/70"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button onClick={() => window.print()} className={BTN_PRIMARY}>
          <FileDown className="h-4 w-4" />
          <span className="hidden sm:inline">Exporter en PDF</span>
          <span className="sm:hidden">PDF</span>
        </button>
      </header>

      <div className="mx-auto flex w-full max-w-[1200px] gap-10 px-4 pb-24 sm:px-6 lg:gap-14">
        {/* Sommaire collant — suit la lecture */}
        <nav
          aria-label="Sommaire"
          className="no-print sticky top-14 hidden h-fit w-44 shrink-0 self-start pt-10 lg:block"
        >
          <p className={`${LABEL_MONO} border-b border-white/10 pb-2`}>Sommaire</p>
          <ul className="mt-1">
            {SECTIONS.map(s => (
              <li key={s.id}>
                <button
                  onClick={() => jumpTo(s.id, false)}
                  className={`flex w-full items-baseline gap-2 py-1.5 text-left text-[13px] transition-colors ${
                    active === s.id ? 'text-brand-300' : 'text-white/40 hover:text-white/75'
                  }`}
                >
                  <span className={`font-mono text-[10px] ${active === s.id ? '' : 'opacity-60'}`}>
                    {s.n}
                  </span>
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 pt-10">
          {/* En-tête du document */}
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3 font-mono text-[10px] uppercase tracking-[0.13em] text-white/35">
            <span className="flex items-center gap-1.5 text-brand-300">
              <LayoutDashboard className="h-3 w-3" aria-hidden />
              CatDesk
            </span>
            <span className="text-white/15">/</span>
            <span>Marchés &amp; News</span>
            <span className="text-white/15">/</span>
            <span>Guide du tableau de bord</span>
          </div>

          <h1 className="mt-6 text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl">
            Le tableau de bord,
            <br />
            widget par widget.
          </h1>
          <p className="mt-4 max-w-[56ch] text-base leading-relaxed text-white/60">
            Huit briques à poser où vous voulez sur un canvas libre. Chacune est expliquée ici avec
            son aperçu exact : ce que vous voyez à droite est ce que l'application affiche.
          </p>

          <dl className="mt-8">
            {[
              { k: 'Widgets', v: `${GUIDE_ENTRIES.length}, répartis en 3 familles` },
              { k: 'Cotations', v: 'rafraîchies toutes les minutes, sans rien demander' },
              { k: 'Disposition', v: 'libre au pixel, plusieurs affichages enregistrés' },
              { k: 'Aperçus', v: 'chiffres fictifs, mise en page réelle' },
            ].map(row => (
              <div
                key={row.k}
                className="flex items-baseline gap-3 border-t border-white/10 py-2 last:border-b"
              >
                <dt className={`${LABEL_MONO} shrink-0`}>{row.k}</dt>
                <span
                  className="min-w-4 flex-1 border-b border-dotted border-white/15"
                  aria-hidden
                />
                <dd className="text-right text-sm text-white/60">{row.v}</dd>
              </div>
            ))}
          </dl>

          {/* ═══ 01 — Les 4 gestes ═══ */}
          <section id="gestes" className="print-break mt-16 scroll-mt-20">
            <SectionHead n="01" label="Les 4 gestes" Icon={Pencil} meta="dans cet ordre" />
            <p className="max-w-[62ch] text-sm leading-relaxed text-white/55">
              Tout le tableau de bord tient dans quatre boutons de la barre du haut. Rien n'est
              définitif : un widget se déplace, se règle ou se supprime à tout moment.
            </p>
            <ol className="mt-6 grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-2">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4 bg-gray-950 p-5">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded border
                               border-brand-400/30 bg-brand-400/10 font-mono text-[11px] text-brand-300"
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold tracking-tight text-white">
                      <step.Icon className="h-3.5 w-3.5 text-brand-400" aria-hidden />
                      {step.title}
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-white/55">
                      <RichText text={step.body} />
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-5 flex items-start gap-3 rounded-lg border border-white/10 border-l-2 border-l-brand-500 bg-white/[0.03] p-4 text-sm text-white/60">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" aria-hidden />
              Si un contenu dépasse sa carte, il défile à l'intérieur : agrandir n'est jamais
              obligatoire.
            </p>
          </section>

          {/* ═══ 02 — Je veux… ═══ */}
          <section id="index" className="print-break mt-16 scroll-mt-20">
            <SectionHead n="02" label="Je veux…" Icon={Target} meta="de l'intention au widget" />
            <p className="mb-5 max-w-[62ch] text-sm leading-relaxed text-white/55">
              Vous savez ce que vous voulez voir, pas comment ça s'appelle. Partez de là.
            </p>
            <div className="grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-2">
              {WANTS.map(w => {
                const target = GUIDE_ENTRIES.find(e => e.type === w.type);
                if (target === undefined) return null;
                return (
                  <button
                    key={w.type}
                    onClick={() => jumpTo(target.anchor, true)}
                    className="flex items-baseline gap-3 bg-gray-950 px-4 py-3 text-left text-sm
                               text-white/60 transition-colors hover:bg-white/[0.04] hover:text-white/90"
                  >
                    <span className="min-w-0 truncate">{w.want}</span>
                    <span
                      className="min-w-3 flex-1 border-b border-dotted border-white/15"
                      aria-hidden
                    />
                    <span className="shrink-0 font-mono text-xs text-brand-300">{target.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ═══ 03 — Les widgets ═══ */}
          <section id="widgets" className="mt-16 scroll-mt-20">
            <SectionHead
              n="03"
              label={`Les ${GUIDE_ENTRIES.length} widgets`}
              Icon={LayoutDashboard}
              meta={
                needle === '' ? 'ordre du menu Ajouter' : `${shown} sur ${GUIDE_ENTRIES.length}`
              }
            />

            {groups.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-5 py-10 text-center">
                <p className="text-sm text-white/45">
                  Aucun widget ne correspond à « {query.trim()} ».
                </p>
                <button
                  onClick={() => setQuery('')}
                  className="mt-3 text-sm font-medium text-brand-300 hover:text-brand-200"
                >
                  Effacer le filtre
                </button>
              </div>
            ) : (
              groups.map(group => (
                <div key={group.family}>
                  <div className="mt-10 flex items-baseline gap-3 border-b border-white/15 pb-2 first:mt-6">
                    <span className="text-base font-semibold tracking-tight text-white">
                      {WIDGET_CATEGORY_LABEL[group.family]}
                    </span>
                    <span className={LABEL_MONO}>
                      {group.entries.length} widget{group.entries.length > 1 ? 's' : ''}
                    </span>
                  </div>
                  {group.entries.map(entry => (
                    <WidgetCard key={entry.type} entry={entry} flashed={flashed === entry.anchor} />
                  ))}
                </div>
              ))
            )}
          </section>

          {/* ═══ 04 — Les formules ═══ */}
          <section id="formules" className="print-break mt-16 scroll-mt-20">
            <SectionHead
              n="04"
              label="Les formules"
              Icon={Sigma}
              meta="Bourse · KPI · Statistique"
            />
            <p className="max-w-[62ch] text-sm leading-relaxed text-white/55">
              Une formule est une expression mathématique qui lit les cours en direct. On accède au
              champ d'un symbole avec un point : <RichText text="`AAPL.price`" />. Le résultat se
              recalcule à chaque rafraîchissement.
            </p>

            <FormulaTable
              rows={FORMULA_FIELDS}
              head={['Ce que vous écrivez', 'Ce que vous obtenez']}
            />

            <p className="mt-8 text-sm font-semibold text-white/85">
              Quatre recettes qui marchent :
            </p>
            <FormulaTable rows={FORMULA_EXAMPLES} head={['Formule', 'Effet']} />

            <p className="mt-5 flex items-start gap-3 rounded-lg border border-white/10 border-l-2 border-l-brand-500 bg-white/[0.03] p-4 text-sm text-white/60">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" aria-hidden />
              L'historique se remplit pendant que l'application tourne. Une moyenne sur 50 points a
              besoin de 50 rafraîchissements avant de donner un résultat.
            </p>
          </section>

          {/* ═══ 05 — Qui écrit quoi ═══ */}
          <section id="origines" className="print-break mt-16 scroll-mt-20">
            <SectionHead
              n="05"
              label="Qui écrit quoi"
              Icon={Newspaper}
              meta="3 sources · 2 widgets"
            />
            <p className="max-w-[62ch] text-sm leading-relaxed text-white/55">
              Trois choses différentes finissent dans votre tableau de bord, et on les confond
              facilement. Voici qui produit quoi, et où ça atterrit.
            </p>

            <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full min-w-[640px] border-collapse text-sm">
                <thead>
                  <tr className="bg-white/[0.04]">
                    <th className="w-28 border-b border-white/10 px-4 py-3" />
                    {ORIGIN_COLUMNS.map(col => (
                      <th
                        key={col.label}
                        className="border-b border-white/10 px-4 py-3 text-left font-semibold text-white/90"
                      >
                        <span className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-sm ${col.dot}`} aria-hidden />
                          {col.label}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ORIGIN_ROWS.map((row, i) => (
                    <tr key={row} className="border-t border-white/5 first:border-t-0">
                      <th scope="row" className={`${LABEL_MONO} px-4 py-3 text-left align-top`}>
                        {row}
                      </th>
                      {ORIGIN_COLUMNS.map(col => (
                        <td
                          key={col.label}
                          className="px-4 py-3 align-top leading-snug text-white/55"
                        >
                          <RichText text={col.cells[i] ?? ''} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-5 flex items-start gap-3 rounded-lg border border-white/10 border-l-2 border-l-brand-500 bg-white/[0.03] p-4 text-sm text-white/60">
              <SlidersHorizontal className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" aria-hidden />
              <span>
                L'écran <strong className="font-semibold text-white/85">Journaux</strong> est le
                seul endroit où l'on définit une revue de presse : sources, URL de flux, filtres par
                mots-clés ou expressions régulières, nombre d'articles. Pendant une génération, la
                progression s'affiche en bandeau — journal 2/3, collecte puis rédaction.
              </span>
            </p>
          </section>

          {/* ═══ 06 — Raccourcis ═══ */}
          <section id="raccourcis" className="print-break mt-16 scroll-mt-20">
            <SectionHead n="06" label="Raccourcis" Icon={Keyboard} meta="fenêtre & édition" />
            <div className="grid gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 sm:grid-cols-2">
              {SHORTCUTS.map(s => (
                <div key={s.keys} className="flex items-baseline gap-3 bg-gray-950 px-4 py-3.5">
                  <kbd
                    className="shrink-0 rounded border border-white/15 border-b-2 bg-white/5 px-1.5
                               py-0.5 font-mono text-[11px] text-white/80"
                  >
                    {s.keys}
                  </kbd>
                  <span className="text-sm text-white/55">{s.what}</span>
                </div>
              ))}
            </div>
          </section>

          <footer className="mt-20 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-white/10 pt-4 font-mono text-[10px] uppercase tracking-[0.13em] text-white/30">
            <span>CatDesk — Marchés &amp; News</span>
            <span>Guide du tableau de bord</span>
            <span>{GUIDE_ENTRIES.length} widgets · 3 familles</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

/** Table à deux colonnes des formules — même rendu pour les champs et les recettes. */
function FormulaTable({
  rows,
  head,
}: {
  rows: readonly { expr: string; desc: string }[];
  head: readonly [string, string];
}) {
  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[420px] border-collapse text-sm">
        <thead>
          <tr className="bg-white/[0.04]">
            {head.map(h => (
              <th key={h} className={`${LABEL_MONO} border-b border-white/10 px-4 py-3 text-left`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.expr} className="border-t border-white/5 first:border-t-0">
              <td className="px-4 py-2.5 align-top">
                <code className="whitespace-nowrap rounded border border-brand-400/20 bg-brand-400/10 px-1.5 py-0.5 font-mono text-xs text-brand-200">
                  {row.expr}
                </code>
              </td>
              <td className="px-4 py-2.5 align-top leading-snug text-white/55">{row.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
