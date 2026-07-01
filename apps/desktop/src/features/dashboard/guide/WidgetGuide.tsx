import type { ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  FileDown,
  Hash,
  LayoutDashboard,
  LineChart,
  Megaphone,
  Newspaper,
  Pencil,
  Settings2,
  Table2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { KpiView } from '../widgets/KpiWidget';
import { ChartView } from '../widgets/ChartWidget';
import { TableView } from '../widgets/TableWidget';
import { StocksView } from '../widgets/StocksWidget';
import { NewsView } from '../widgets/NewsWidget';
import { DailiesView } from '../widgets/DailiesWidget';
import { QuickActionView } from '../widgets/QuickActionWidget';
import { resolveMetric } from '../widgets/metric';
import {
  SAMPLE_COMPUTED,
  SAMPLE_DAILIES,
  SAMPLE_HISTORY,
  SAMPLE_NEWS,
  SAMPLE_QUOTES,
} from './sampleData';

interface Props {
  onClose: () => void;
}

interface Param {
  key: string;
  desc: string;
}

interface GuideEntry {
  Icon: LucideIcon;
  name: string;
  summary: string;
  detail: string;
  params: Param[];
  preview: ReactNode;
  previewClass?: string;
}

/** Cadre sombre reproduisant le rendu réel d'un widget sur le tableau de bord. */
function Frame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`print-exact rounded-xl border border-white/10 bg-gray-950 p-4 text-white ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

const ENTRIES: readonly GuideEntry[] = [
  {
    Icon: Hash,
    name: 'KPI',
    summary: 'Une valeur clé affichée en grand.',
    detail:
      "Met en avant un seul chiffre important : le prix d'une action, son volume, ou le résultat d'une formule. Idéal pour garder un indicateur sous les yeux en permanence.",
    params: [
      { key: 'Symbole', desc: 'Le ticker à suivre, ex. AAPL, MSFT, TSLA.' },
      { key: 'Champ', desc: 'price, change, changePercent ou volume.' },
      { key: 'Formule (prioritaire)', desc: 'Si renseignée, remplace le symbole/champ — ex. AAPL.price / MSFT.price.' },
      { key: 'Libellé', desc: 'Texte affiché au-dessus de la valeur (optionnel).' },
    ],
    previewClass: 'h-28',
    preview: (
      <KpiView
        metric={resolveMetric(
          { symbol: 'AAPL', field: 'price', label: 'AAPL · prix' },
          SAMPLE_QUOTES,
          SAMPLE_COMPUTED,
        )}
      />
    ),
  },
  {
    Icon: Activity,
    name: 'Statistique',
    summary: 'Une variation, colorée selon le sens.',
    detail:
      "Identique au KPI mais pensé pour les pourcentages : la valeur passe en vert si positive, en rouge si négative. Parfait pour la variation du jour.",
    params: [
      { key: 'Symbole', desc: 'Le ticker à suivre.' },
      { key: 'Champ', desc: 'Typiquement changePercent (variation du jour en %).' },
      { key: 'Formule / Libellé', desc: 'Mêmes options que le KPI.' },
    ],
    previewClass: 'h-28',
    preview: (
      <KpiView
        metric={resolveMetric(
          { symbol: 'TSLA', field: 'changePercent', label: 'TSLA · jour' },
          SAMPLE_QUOTES,
          SAMPLE_COMPUTED,
        )}
      />
    ),
  },
  {
    Icon: LineChart,
    name: 'Bourse',
    summary: 'Watchlist live + mini-courbes + formules.',
    detail:
      "Le widget central : plusieurs symboles avec prix, variation et sparkline, suivis de colonnes de formules recalculées à chaque rafraîchissement. Les symboles et formules sont synchronisés automatiquement avec le moteur de données.",
    params: [
      { key: 'Symboles', desc: 'Liste séparée par des virgules, ex. AAPL, MSFT, TSLA.' },
      { key: 'Formules', desc: 'Paires nom + expression (mathjs), ex. « AAPL/MSFT » = AAPL.price / MSFT.price.' },
    ],
    preview: (
      <StocksView
        symbols={['AAPL', 'MSFT', 'TSLA']}
        formulaNames={['AAPL/MSFT', 'Panier']}
        quotes={SAMPLE_QUOTES}
        computed={SAMPLE_COMPUTED}
        history={SAMPLE_HISTORY}
      />
    ),
  },
  {
    Icon: BarChart3,
    name: 'Graphe',
    summary: "Courbe du prix d'un symbole.",
    detail:
      "Affiche l'évolution récente du prix sous forme de courbe, avec le prix courant et la variation du jour. L'historique se construit au fil des rafraîchissements.",
    params: [{ key: 'Symbole', desc: 'Le ticker à tracer, ex. AAPL.' }],
    previewClass: 'h-40',
    preview: (
      <ChartView symbol="AAPL" quote={SAMPLE_QUOTES.AAPL ?? null} history={SAMPLE_HISTORY.AAPL ?? []} />
    ),
  },
  {
    Icon: Table2,
    name: 'Table',
    summary: 'Tableau multi-symboles.',
    detail:
      'Compare plusieurs valeurs côte à côte : prix, variation et volume sur une même ligne. Pratique pour une vue de marché dense.',
    params: [{ key: 'Symboles', desc: 'Liste séparée par des virgules, ex. AAPL, MSFT, TSLA, NVDA.' }],
    preview: <TableView symbols={['AAPL', 'MSFT', 'TSLA', 'NVDA']} quotes={SAMPLE_QUOTES} />,
  },
  {
    Icon: Megaphone,
    name: 'News',
    summary: 'Annonces poussées par l’administrateur.',
    detail:
      "Liste les annonces actives (maintenance, nouveautés, alertes). Le contenu est piloté par l'administrateur via le backend ; côté client, ce widget est en lecture seule.",
    params: [{ key: 'Aucun réglage', desc: 'Le contenu provient du backend Supabase, pas de la configuration locale.' }],
    preview: <NewsView items={SAMPLE_NEWS} />,
  },
  {
    Icon: Newspaper,
    name: 'Dailys',
    summary: 'Revue de presse quotidienne générée par IA, en lecture seule.',
    detail:
      "Chaque jour, le système agrège les articles de nombreux journaux (finance, généraliste FR, international, tech), en fait des résumés par IA, et publie des « dailys » : soit une revue PAR JOURNAL, soit les news importantes triées PAR SUJET (International, Économie & marchés, Politique, Société, Tech & sciences, Culture & sport), plus une synthèse du jour. Génération réservée à l'admin ; les clients ne font que consulter.",
    params: [
      { key: 'Affichage', desc: 'Trois widgets au choix : « Tout », « Par sujet », « Par journal » (réglable via la roue).' },
      { key: 'Catégories', desc: 'Puces pour ne suivre que certains centres d’intérêt. Préférence locale mémorisée.' },
      { key: 'Recherche', desc: 'Champ de recherche approfondie : fouille les titres ET les articles de toutes les dailys.' },
    ],
    preview: <DailiesView items={SAMPLE_DAILIES} followed={[]} onToggle={() => {}} />,
  },
  {
    Icon: Zap,
    name: 'Action rapide',
    summary: "Un bouton qui envoie une requête à l'agent.",
    detail:
      "Transforme une tâche récurrente en un clic : le bouton ouvre le chat et envoie une requête prédéfinie à l'assistant (ex. capturer puis décrire l'écran).",
    params: [
      { key: 'Icône', desc: 'Choisie dans une liste (zap, camera, clipboard, terminal, file, search).' },
      { key: "Requête envoyée à l'agent", desc: 'Le texte exact transmis à l’assistant au clic.' },
    ],
    preview: (
      <QuickActionView
        iconName="camera"
        query="Capture mon écran et décris ce que tu vois."
        disabled={false}
        onClick={() => {}}
      />
    ),
  },
];

const FORMULA_EXAMPLES: readonly { expr: string; desc: string }[] = [
  { expr: 'AAPL.price / MSFT.price', desc: 'Ratio de deux prix.' },
  { expr: '(AAPL.price + MSFT.price + TSLA.price) / 3', desc: "Moyenne d'un panier." },
  { expr: 'TSLA.changePercent', desc: 'Variation du jour (%) d’un symbole.' },
  { expr: 'AAPL.price * 1.2', desc: 'Objectif de cours (+20 %).' },
];

/**
 * Guide imprimable des widgets : explication + aperçu réaliste de chacun, avec
 * export PDF (impression système → « Enregistrer en PDF »). Destiné au partage.
 */
export function WidgetGuide({ onClose }: Props) {
  return (
    <div className="guide-scroll min-h-screen overflow-y-auto bg-white text-slate-800">
      {/* Barre d'actions — non imprimée */}
      <header className="no-print sticky top-0 z-10 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-5 py-3 backdrop-blur">
        <button
          onClick={onClose}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Retour
        </button>
        <span className="ml-1 text-sm font-semibold text-slate-900">Guide des widgets</span>
        <button
          onClick={() => window.print()}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-500"
        >
          <FileDown className="h-4 w-4" />
          Exporter en PDF
        </button>
      </header>

      {/* Document */}
      <article className="mx-auto max-w-3xl px-8 py-8">
        <div className="mb-2 flex items-center gap-2 text-brand-600">
          <LayoutDashboard className="h-5 w-5" />
          <span className="text-xs font-semibold uppercase tracking-wider">CatDesk · Marchés &amp; News</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Guide des widgets du tableau de bord</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Ce document présente chaque widget disponible, à quoi il sert, comment le paramétrer, et
          montre un exemple concret de rendu. Les valeurs affichées dans les aperçus sont fictives
          mais réalistes.
        </p>

        {/* Comment ça marche */}
        <section className="print-break mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Settings2 className="h-4 w-4 text-brand-600" />
            Principe général
          </h2>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
            <li>
              • Les cotations sont récupérées automatiquement et rafraîchies en continu (≈ toutes les
              minutes) — aucune action manuelle.
            </li>
            <li>
              • Pour modifier le tableau de bord, cliquez sur <strong>Éditer</strong>{' '}
              <Pencil className="inline h-3 w-3" /> : vous pouvez ajouter, déplacer, redimensionner,
              renommer ou configurer chaque widget.
            </li>
            <li>
              • Chaque widget a une roue de réglages où l’on saisit ses symboles, champs et formules.
            </li>
            <li>
              • Les formules utilisent la syntaxe <em>mathjs</em> et accèdent aux champs d’un symbole
              via un point (ex. <code className="rounded bg-slate-200 px-1">AAPL.price</code>).
            </li>
          </ul>
        </section>

        {/* Widgets */}
        <h2 className="mt-8 text-lg font-bold text-slate-900">Les widgets, un par un</h2>
        <div className="mt-3 space-y-5">
          {ENTRIES.map((e) => (
            <section
              key={e.name}
              className="print-break grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 md:grid-cols-2"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <e.Icon className="h-4 w-4" />
                  </span>
                  <h3 className="text-base font-semibold text-slate-900">{e.name}</h3>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-700">{e.summary}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{e.detail}</p>

                <h4 className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Paramètres
                </h4>
                <dl className="mt-1 space-y-1 text-sm">
                  {e.params.map((p) => (
                    <div key={p.key} className="flex gap-2">
                      <dt className="shrink-0 font-medium text-slate-700">{p.key} :</dt>
                      <dd className="text-slate-600">{p.desc}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Aperçu
                </h4>
                <Frame className={e.previewClass ?? ''}>{e.preview}</Frame>
              </div>
            </section>
          ))}
        </div>

        {/* Formules */}
        <section className="print-break mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-lg font-bold text-slate-900">Écrire des formules</h2>
          <p className="mt-1 text-sm text-slate-600">
            Disponibles dans les widgets <strong>Bourse</strong>, <strong>KPI</strong> et{' '}
            <strong>Statistique</strong>. Champs accessibles par symbole :{' '}
            <code className="rounded bg-slate-200 px-1">.price</code>,{' '}
            <code className="rounded bg-slate-200 px-1">.change</code>,{' '}
            <code className="rounded bg-slate-200 px-1">.changePercent</code>,{' '}
            <code className="rounded bg-slate-200 px-1">.volume</code>.
          </p>
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="pb-1 font-semibold">Exemple</th>
                <th className="pb-1 font-semibold">Effet</th>
              </tr>
            </thead>
            <tbody>
              {FORMULA_EXAMPLES.map((f) => (
                <tr key={f.expr} className="border-t border-slate-200">
                  <td className="py-1.5 pr-3">
                    <code className="rounded bg-slate-200 px-1 text-slate-800">{f.expr}</code>
                  </td>
                  <td className="py-1.5 text-slate-600">{f.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <p className="mt-8 border-t border-slate-200 pt-3 text-xs text-slate-400">
          CatDesk — Marchés &amp; News · Guide généré depuis l’application.
        </p>
      </article>
    </div>
  );
}
