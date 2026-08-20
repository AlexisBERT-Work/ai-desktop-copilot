import type { ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  Bookmark,
  Compass,
  FileDown,
  Hash,
  HelpCircle,
  Keyboard,
  LayoutDashboard,
  LineChart,
  Megaphone,
  Newspaper,
  Pencil,
  Plus,
  Rocket,
  Settings2,
  Sigma,
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
  /** Ancre du sommaire. */
  id: string;
  Icon: LucideIcon;
  name: string;
  /** Une phrase, en langage courant : à quoi sert ce widget. */
  summary: string;
  /** Ce qu'il faut savoir, en points courts — jamais un pavé. */
  points: readonly string[];
  params: readonly Param[];
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

/** Nom d'un bouton de l'application, rendu comme dans l'interface. */
function Btn({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-md border border-slate-300 bg-white px-1.5 py-0.5 text-[0.85em] font-medium text-slate-700">
      {children}
    </span>
  );
}

/** Touche du clavier. */
function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-mono text-[0.8em] text-slate-700">
      {children}
    </kbd>
  );
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded bg-slate-200 px-1 text-[0.9em] text-slate-800">{children}</code>;
}

/** Bloc encadré avec titre et icône, utilisé pour toutes les sections du document. */
function Section({
  id,
  Icon,
  title,
  tone = 'plain',
  children,
}: {
  id?: string;
  Icon: LucideIcon;
  title: string;
  tone?: 'plain' | 'muted';
  children: ReactNode;
}) {
  return (
    <section
      {...(id === undefined ? {} : { id })}
      className={`print-break mt-6 scroll-mt-16 rounded-xl border p-5 ${
        tone === 'muted' ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'
      }`}
    >
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
        <Icon className="h-4 w-4 shrink-0 text-brand-600" />
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Liste à puces homogène (les puces natives s'impriment mal selon le moteur). */
function Bullets({ items }: { items: readonly ReactNode[] }) {
  return (
    <ul className="space-y-2 text-sm leading-relaxed text-slate-600">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-brand-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** Une étape du démarrage rapide, avec son gros numéro. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="print-break rounded-xl border border-slate-200 bg-white p-4">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white print-exact">
        {n}
      </span>
      <h3 className="mt-2 text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{children}</p>
    </div>
  );
}

const ENTRIES: readonly GuideEntry[] = [
  {
    id: 'kpi',
    Icon: Hash,
    name: 'KPI',
    summary: 'Un seul chiffre, affiché en très grand.',
    points: [
      "Pour garder un chiffre sous les yeux en permanence : le prix d'une action, son volume, ou le résultat d'un calcul.",
      "Choisissez le symbole (le code de l'action, ex. AAPL pour Apple) puis ce que vous voulez voir.",
    ],
    params: [
      { key: 'Symbole', desc: "Le code de l'action à suivre — ex. AAPL, MSFT, TSLA." },
      { key: 'Champ', desc: 'Le prix, la variation, la variation en %, ou le volume échangé.' },
      { key: 'Libellé', desc: 'Le petit texte affiché au-dessus du chiffre (facultatif).' },
      {
        key: 'Formule',
        desc: "Facultatif et réservé aux usages avancés — voir l'annexe en fin de guide.",
      },
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
    id: 'stat',
    Icon: Activity,
    name: 'Statistique',
    summary: 'Comme le KPI, mais coloré en vert ou en rouge.',
    points: [
      'Pensé pour les pourcentages : vert si ça monte, rouge si ça baisse.',
      "Le choix naturel pour la variation du jour d'une valeur que vous suivez.",
    ],
    params: [
      { key: 'Symbole', desc: "Le code de l'action à suivre." },
      { key: 'Champ', desc: 'En général « variation en % » (la performance du jour).' },
      { key: 'Libellé / Formule', desc: 'Mêmes options que le KPI.' },
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
    id: 'bourse',
    Icon: LineChart,
    name: 'Bourse',
    summary: 'Votre liste de valeurs suivies, avec prix et mini-courbes.',
    points: [
      "C'est le widget principal : une ligne par valeur, avec son prix, sa variation du jour et une petite courbe de tendance.",
      'Ajoutez autant de symboles que vous voulez, séparés par des virgules.',
      'Les données se mettent à jour toutes seules, en continu.',
    ],
    params: [
      { key: 'Symboles', desc: 'Séparés par des virgules — ex. AAPL, MSFT, TSLA.' },
      {
        key: 'Formules',
        desc: "Colonnes calculées supplémentaires (facultatif) — voir l'annexe.",
      },
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
    id: 'graphe',
    Icon: BarChart3,
    name: 'Graphe',
    summary: "La courbe d'une seule valeur, en grand.",
    points: [
      "Montre l'évolution récente du prix, avec le prix actuel et la variation du jour.",
      "La courbe se construit au fil du temps pendant que l'application tourne : elle est courte au début, puis s'étoffe.",
    ],
    params: [{ key: 'Symbole', desc: 'Le code de la valeur à tracer — ex. AAPL.' }],
    previewClass: 'h-40',
    preview: (
      <ChartView
        symbol="AAPL"
        quote={SAMPLE_QUOTES.AAPL ?? null}
        history={SAMPLE_HISTORY.AAPL ?? []}
      />
    ),
  },
  {
    id: 'table',
    Icon: Table2,
    name: 'Table',
    summary: 'Plusieurs valeurs comparées ligne par ligne.',
    points: [
      'Prix, variation et volume côte à côte, pour balayer un marché entier en un coup d’œil.',
      'Le format le plus dense : beaucoup d’informations dans peu de place.',
    ],
    params: [{ key: 'Symboles', desc: 'Séparés par des virgules — ex. AAPL, MSFT, TSLA, NVDA.' }],
    preview: <TableView symbols={['AAPL', 'MSFT', 'TSLA', 'NVDA']} quotes={SAMPLE_QUOTES} />,
  },
  {
    id: 'news',
    Icon: Megaphone,
    name: 'News',
    summary: 'Les annonces officielles de l’application.',
    points: [
      'Maintenance, nouveautés, alertes : ce que l’administrateur veut porter à votre connaissance.',
      'Rien à régler — le contenu vient du serveur, vous êtes en lecture seule.',
    ],
    params: [{ key: 'Aucun réglage', desc: 'Le contenu est piloté par l’administrateur.' }],
    preview: <NewsView items={SAMPLE_NEWS} />,
  },
  {
    id: 'dailys',
    Icon: Newspaper,
    name: 'Dailys',
    summary: 'Votre revue de presse du jour, résumée par l’IA.',
    points: [
      'Chaque jour, l’application lit de nombreux journaux, en résume les articles et publie trois formats : une revue par journal, les sujets importants regroupés par thème, et une synthèse générale.',
      'Deux origines cohabitent, reconnaissables à leur badge et à leur liseré coloré : « Partagée » (bleu) = publiée pour tout le monde ; « Perso » (vert) = produite sur votre poste à partir de vos propres journaux.',
      'Chaque article est un bloc séparé, avec le lien vers l’article d’origine.',
      'Quand la matière le permet, un bouton « En savoir plus » développe le sujet — les chiffres et les faits ajoutés sont vérifiés contre l’article source.',
      'Pour choisir vos journaux, passez par l’écran « Journaux » (voir plus bas).',
    ],
    params: [
      { key: 'Affichage', desc: '« Tout », « Par sujet » ou « Par journal ».' },
      {
        key: 'Origine',
        desc: '« Toutes · Partagées · Persos » — apparaît dès que les deux origines coexistent.',
      },
      { key: 'Période', desc: 'Aujourd’hui, 7 jours, ou tout l’historique.' },
      { key: 'Source', desc: 'Se limiter à un journal ou à un sujet précis.' },
      { key: 'Catégories', desc: 'Puces pour ne garder que vos centres d’intérêt.' },
      { key: 'Recherche', desc: 'Fouille les titres ET le contenu de toutes les dailys.' },
      {
        key: 'Historique',
        desc: 'Groupé par jour ; « Voir plus » puis « Charger plus d’articles » pour remonter le temps. Rien n’est jamais supprimé.',
      },
    ],
    preview: <DailiesView items={SAMPLE_DAILIES} followed={[]} onToggle={() => {}} />,
  },
  {
    id: 'action',
    Icon: Zap,
    name: 'Action rapide',
    summary: 'Un bouton qui envoie une demande toute prête à l’assistant.',
    points: [
      'Transforme une tâche que vous répétez souvent en un seul clic.',
      'Au clic, le chat s’ouvre et votre demande part automatiquement — ex. « capture mon écran et décris-le ».',
    ],
    params: [
      { key: 'Icône', desc: 'À choisir dans une petite liste.' },
      { key: 'Demande', desc: 'Le texte exact envoyé à l’assistant au clic.' },
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

/** Entrées du tableau « Je veux… » : la question de l'utilisateur, puis le geste. */
const RECIPES: readonly { want: string; how: ReactNode }[] = [
  {
    want: 'Suivre une action en particulier',
    how: (
      <>
        <Btn>Éditer</Btn> → <Btn>Ajouter</Btn> → widget <strong>Bourse</strong>, puis tapez son code
        (ex. AAPL) dans les réglages.
      </>
    ),
  },
  {
    want: 'Déplacer ou agrandir une carte',
    how: (
      <>
        <Btn>Éditer</Btn>, puis attrapez la carte pour la déplacer, ou tirez ses bords et son coin
        pour la redimensionner.
      </>
    ),
  },
  {
    want: 'Changer la couleur ou la taille du texte',
    how: <>Roue de réglages de la carte → section « Style ».</>,
  },
  {
    want: 'Retrouver une mise en page précédente',
    how: (
      <>
        <Btn>Éditer</Btn> → <Btn>Affichages</Btn> : enregistrez la disposition actuelle sous un nom,
        et rebasculez d’un clic.
      </>
    ),
  },
  {
    want: 'Choisir les journaux de ma revue de presse',
    how: (
      <>
        Bouton <Btn>Journaux</Btn> en haut de la fenêtre.
      </>
    ),
  },
  {
    want: 'Lire les articles d’hier ou d’avant',
    how: <>Dans le widget Dailys : « Voir plus », puis « Charger plus d’articles ».</>,
  },
  {
    want: 'Tout remettre à ma taille de lecture',
    how: (
      <>
        <Key>Ctrl</Key> + molette pour zoomer, <Key>Ctrl</Key> + <Key>0</Key> pour revenir à 100 %.
      </>
    ),
  },
  {
    want: 'Partager ce guide',
    how: (
      <>
        Bouton <Btn>Exporter en PDF</Btn> en haut de cette page.
      </>
    ),
  },
];

const FORMULA_EXAMPLES: readonly { expr: string; desc: string }[] = [
  { expr: 'AAPL.price / MSFT.price', desc: 'Comparer deux prix (ratio).' },
  { expr: '(AAPL.price + MSFT.price + TSLA.price) / 3', desc: 'Moyenne d’un panier de valeurs.' },
  { expr: 'TSLA.changePercent', desc: 'La variation du jour, en %.' },
  { expr: 'AAPL.price * 1.2', desc: 'Un objectif de cours à +20 %.' },
  {
    expr: 'AAPL.price - sma(AAPL.history, 50)',
    desc: 'Écart à la moyenne des 50 derniers points.',
  },
];

/**
 * Guide imprimable de l'application Marchés & News : démarrage rapide, réponses
 * aux besoins courants, puis référence widget par widget avec aperçu réaliste.
 * Export PDF via l'impression système (« Enregistrer en PDF »). Destiné au partage.
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
        <span className="ml-1 text-sm font-semibold text-slate-900">Guide</span>
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
          <span className="text-xs font-semibold uppercase tracking-wider">
            CatDesk · Marchés &amp; News
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Prendre en main votre tableau de bord
        </h1>
        <p className="mt-3 text-base leading-relaxed text-slate-600">
          Cette fenêtre affiche ce que vous voulez garder à l’œil : les marchés et l’actualité, sur
          des cartes que vous disposez librement. Les trois étapes ci-dessous suffisent pour
          démarrer — le reste du document sert de référence, à consulter au besoin.
        </p>

        {/* Démarrage rapide */}
        <Section Icon={Rocket} title="Démarrer en 3 étapes" tone="muted">
          <div className="grid gap-3 md:grid-cols-3">
            <Step n={1} title="Passez en mode édition">
              Cliquez sur <Btn>Éditer</Btn> en haut à droite. Le bandeau se teinte et affiche « Mode
              édition » : impossible de se tromper.
            </Step>
            <Step n={2} title="Ajoutez une carte">
              <Btn>Ajouter</Btn> ouvre la liste des cartes disponibles. Choisissez, elle apparaît
              sur le tableau.
            </Step>
            <Step n={3} title="Placez-la et réglez-la">
              Déplacez-la, tirez ses coins pour la dimensionner, puis ouvrez sa roue de réglages.
              <Btn>Terminé</Btn> pour figer le tout.
            </Step>
          </div>
          <p className="mt-3 text-sm text-slate-500">
            Rien n’est définitif : vous pouvez revenir en mode édition à tout moment, et{' '}
            <Key>Échap</Key> annule un déplacement en cours.
          </p>
        </Section>

        {/* Sommaire */}
        <Section Icon={Compass} title="Dans ce guide">
          <div className="grid gap-x-6 gap-y-1.5 text-sm text-slate-600 sm:grid-cols-2">
            <a href="#besoins" className="hover:text-brand-600 hover:underline">
              Je veux… (les gestes courants)
            </a>
            <a href="#widgets" className="hover:text-brand-600 hover:underline">
              Les cartes, une par une
            </a>
            <a href="#journaux" className="hover:text-brand-600 hover:underline">
              Journaux &amp; annonces : qui écrit quoi ?
            </a>
            <a href="#raccourcis" className="hover:text-brand-600 hover:underline">
              Astuces &amp; raccourcis
            </a>
            <a href="#depannage" className="hover:text-brand-600 hover:underline">
              Si quelque chose ne s’affiche pas
            </a>
            <a href="#formules" className="hover:text-brand-600 hover:underline">
              Annexe : les formules (avancé)
            </a>
          </div>
        </Section>

        {/* Je veux… */}
        <Section id="besoins" Icon={HelpCircle} title="Je veux…" tone="muted">
          <table className="w-full text-sm">
            <tbody>
              {RECIPES.map(r => (
                <tr key={r.want} className="border-t border-slate-200 first:border-t-0 align-top">
                  <td className="w-2/5 py-2 pr-4 font-medium text-slate-800">{r.want}</td>
                  <td className="py-2 leading-relaxed text-slate-600">{r.how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>

        {/* Widgets */}
        <h2 id="widgets" className="mt-10 scroll-mt-16 text-xl font-bold text-slate-900">
          Les cartes, une par une
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Huit types de cartes, à combiner comme vous voulez. Les chiffres des aperçus sont fictifs.
        </p>
        <div className="mt-4 space-y-5">
          {ENTRIES.map((e, i) => (
            <section
              key={e.id}
              id={e.id}
              className="print-break grid scroll-mt-16 grid-cols-1 gap-4 rounded-xl border border-slate-200 p-5 md:grid-cols-2"
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="print-exact flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <e.Icon className="h-4 w-4" />
                  </span>
                  <h3 className="text-base font-semibold text-slate-900">
                    <span className="text-slate-400">{i + 1}.</span> {e.name}
                  </h3>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-700">{e.summary}</p>
                <div className="mt-2">
                  <Bullets items={e.points} />
                </div>

                <h4 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Réglages
                </h4>
                <dl className="mt-1.5 space-y-1 text-sm">
                  {e.params.map(p => (
                    <div key={p.key} className="flex gap-2">
                      <dt className="shrink-0 font-medium text-slate-700">{p.key} :</dt>
                      <dd className="text-slate-600">{p.desc}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div>
                <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Aperçu
                </h4>
                <Frame className={e.previewClass ?? ''}>{e.preview}</Frame>
              </div>
            </section>
          ))}
        </div>

        {/* Journaux & annonces */}
        <Section id="journaux" Icon={Newspaper} title="Journaux & annonces : qui écrit quoi ?">
          <Bullets
            items={[
              <>
                <strong>Vos journaux à vous.</strong> Le bouton <Btn>Journaux</Btn> en haut de la
                fenêtre est le seul endroit où l’on choisit ses sources : adresses des flux, filtres
                par mots-clés, nombre d’articles.
              </>,
              <>
                <strong>Quand sont-ils produits ?</strong> Chaque matin vers 7 h (avec rattrapage si
                l’ordinateur était éteint), ou tout de suite avec « Générer maintenant ». Un bandeau
                affiche l’avancement (journal 2/3, collecte puis rédaction).
              </>,
              <>
                <strong>Les journaux partagés.</strong> Publiés pour tous les utilisateurs — vous
                les lisez, vous ne les modifiez pas.
              </>,
              <>
                <strong>
                  La console <Btn>Admin</Btn>.
                </strong>{' '}
                Réservée à l’administrateur, elle sert uniquement à écrire des annonces à la main.
              </>,
            ]}
          />
        </Section>

        {/* Astuces & raccourcis */}
        <Section id="raccourcis" Icon={Keyboard} title="Astuces & raccourcis" tone="muted">
          <Bullets
            items={[
              <>
                <strong>Zoom de la fenêtre :</strong> <Key>Ctrl</Key> + molette, ou <Key>Ctrl</Key>{' '}
                + <Key>+</Key> / <Key>−</Key>, et <Key>Ctrl</Key> + <Key>0</Key> pour revenir à 100
                %.
              </>,
              <>
                <strong>Le tableau est un canvas libre</strong> (façon PowerPoint) : posez les
                cartes où vous voulez, au pixel près. Si le contenu dépasse, il défile à l’intérieur
                de la carte.
              </>,
              <>
                <strong>Plusieurs tableaux de bord</strong> avec <Btn>Affichages</Btn> : enregistrez
                une mise en page « Bourse » et une « Presse », alternez d’un clic.
              </>,
              <>
                <strong>Les prix se rafraîchissent seuls</strong>, environ toutes les minutes. Aucun
                bouton à presser.
              </>,
              <>
                <strong>Chaque carte a son style :</strong> six couleurs d’accent et cinq tailles de
                texte, pour regrouper visuellement vos familles de cartes.
              </>,
            ]}
          />
        </Section>

        {/* Dépannage */}
        <Section id="depannage" Icon={Settings2} title="Si quelque chose ne s’affiche pas">
          <Bullets
            items={[
              <>
                <strong>« Dailys indisponibles »</strong> : le service d’actualité ne répond pas.
                Cliquez sur <Btn>Réessayer</Btn> ; l’application retente aussi toute seule chaque
                minute. Le motif exact est écrit sous le message.
              </>,
              <>
                <strong>Une courbe presque vide</strong> : c’est normal au démarrage. L’historique
                se construit pendant que l’application tourne.
              </>,
              <>
                <strong>Un prix qui ne bouge pas</strong> : la place boursière est peut-être fermée,
                ou le code de la valeur est mal orthographié.
              </>,
              <>
                <strong>Aucune carte sur le tableau</strong> : passez en <Btn>Éditer</Btn> puis{' '}
                <Btn>Ajouter</Btn>.
              </>,
            ]}
          />
        </Section>

        {/* Formules — annexe */}
        <Section id="formules" Icon={Sigma} title="Annexe : les formules (avancé)" tone="muted">
          <p className="text-sm leading-relaxed text-slate-600">
            Facultatif : à ignorer si vous n’en avez pas besoin. Les cartes <strong>Bourse</strong>,{' '}
            <strong>KPI</strong> et <strong>Statistique</strong> acceptent un calcul à la place d’un
            simple prix. On désigne une donnée par le code de la valeur, un point, puis le champ
            voulu : <Code>AAPL.price</Code>, <Code>AAPL.change</Code>,{' '}
            <Code>AAPL.changePercent</Code>, <Code>AAPL.volume</Code>.
          </p>
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-400">
                <th className="pb-1.5 font-semibold">À écrire</th>
                <th className="pb-1.5 font-semibold">Ce que ça donne</th>
              </tr>
            </thead>
            <tbody>
              {FORMULA_EXAMPLES.map(f => (
                <tr key={f.expr} className="border-t border-slate-200 align-top">
                  <td className="py-2 pr-3">
                    <Code>{f.expr}</Code>
                  </td>
                  <td className="py-2 text-slate-600">{f.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            Pour les moyennes mobiles, l’historique d’une valeur est accessible via{' '}
            <Code>AAPL.history</Code>, avec <Code>sma(…, 20)</Code> (moyenne simple) et{' '}
            <Code>ema(…, 20)</Code> (exponentielle).
          </p>
        </Section>

        <p className="mt-10 flex items-center gap-2 border-t border-slate-200 pt-4 text-xs text-slate-400">
          <Plus className="h-3 w-3" />
          <Bookmark className="h-3 w-3" />
          <Pencil className="h-3 w-3" />
          <span className="ml-1">
            CatDesk — Marchés &amp; News · Guide généré depuis l’application.
          </span>
        </p>
      </article>
    </div>
  );
}
