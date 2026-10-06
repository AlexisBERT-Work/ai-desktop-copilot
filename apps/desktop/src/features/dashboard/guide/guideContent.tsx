/* eslint-disable react-refresh/only-export-components -- Module de contenu : il
   n'exporte AUCUN composant, seulement des tables de données dont certaines
   portent du JSX (les aperçus). Le fast refresh n'a rien à préserver ici. */
import type { ReactNode } from 'react';
import { Layers, Plus, SlidersHorizontal, Target, type LucideIcon } from 'lucide-react';
import type { WidgetType } from '@catdesk/shared-types';
import { KpiView } from '../widgets/KpiWidget';
import { ChartView } from '../widgets/ChartWidget';
import { TableView } from '../widgets/TableWidget';
import { StocksView } from '../widgets/StocksWidget';
import { NewsView } from '../widgets/NewsWidget';
import { DailiesView } from '../widgets/DailiesWidget';
import { QuickActionView } from '../widgets/QuickActionWidget';
import { resolveMetric } from '../widgets/metric';
import { WIDGET_META, type WidgetCategory } from '../widgets/widgetMeta';
import {
  SAMPLE_COMPUTED,
  SAMPLE_DAILIES,
  SAMPLE_HISTORY,
  SAMPLE_NEWS,
  SAMPLE_QUOTES,
} from './sampleData';

// ─── Contenu du guide ──────────────────────────────────────────
// Le texte vit ici ; le libellé, l'icône, la famille et l'ORDRE d'un widget
// viennent de WIDGET_META. Le guide ne peut donc pas dériver du menu
// « Ajouter », et `Record<WidgetType, …>` force à décrire tout nouveau type.
//
// Les chaînes acceptent deux marques légères, rendues par `RichText` :
// `**gras**` et `` `code` ``. Elles restent du texte brut, donc filtrables.

export interface GuideParam {
  key: string;
  desc: string;
}

interface GuideBody {
  /** Une phrase : à quoi ça sert. Doit suffire seule. */
  summary: string;
  detail: string;
  /** Complément qui a besoin d'une vraie mise en forme (badges d'origine). */
  extra?: ReactNode;
  params: readonly GuideParam[];
  preview: ReactNode;
  /** Hauteur imposée quand le rendu est trop court pour tenir seul. */
  previewClass?: string;
}

export interface GuideEntry extends GuideBody {
  type: WidgetType;
  name: string;
  Icon: LucideIcon;
  family: WidgetCategory;
  /** Ancre DOM, cible des liens « Je veux… » et du sommaire. */
  anchor: string;
}

const BODIES: Record<WidgetType, GuideBody> = {
  quick_action: {
    summary: "Un bouton qui parle à l'assistant à votre place.",
    detail:
      'Une tâche répétitive devient un clic : le bouton ouvre le chat et y envoie la requête que vous avez écrite une fois pour toutes.',
    params: [
      {
        key: 'Icône',
        desc: 'Éclair, appareil photo, presse-papiers, terminal, fichier ou loupe.',
      },
      { key: 'Requête', desc: "Le texte exact transmis à l'assistant au clic." },
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

  stocks: {
    summary: 'La watchlist : cours, mini-courbes et formules.',
    detail:
      'Le widget central. Plusieurs symboles avec prix, variation et sparkline, puis les formules recalculées à chaque rafraîchissement. Symboles et formules sont synchronisés automatiquement avec le moteur de données — rien à relancer.',
    params: [
      { key: 'Symboles', desc: 'Liste séparée par des virgules — `AAPL, MSFT, TSLA`.' },
      {
        key: 'Formules',
        desc: "Un nom et une expression. Le nom sert d'étiquette dans la liste.",
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

  kpi: {
    summary: 'Une valeur clé, affichée en grand.',
    detail:
      "Un seul chiffre qui compte : le prix d'une action, son volume, ou le résultat d'une formule. Pour garder un indicateur sous les yeux en permanence.",
    params: [
      { key: 'Symbole', desc: 'Le ticker à suivre — `AAPL`, `MSFT`, `TSLA`.' },
      { key: 'Champ', desc: '`price`, `change`, `changePercent` ou `volume`.' },
      {
        key: 'Formule',
        desc: '**Prioritaire** : si elle est renseignée, elle remplace symbole et champ.',
      },
      { key: 'Libellé', desc: 'Texte au-dessus de la valeur. Facultatif.' },
    ],
    previewClass: 'h-24',
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

  stat: {
    summary: 'Une variation, colorée selon son sens.',
    detail:
      'Identique au KPI, pensé pour les pourcentages : la valeur passe en vert si elle est positive, en rouge si elle est négative. Le bon choix pour la variation du jour.',
    params: [
      { key: 'Symbole', desc: 'Le ticker à suivre.' },
      { key: 'Champ', desc: 'En général `changePercent`, la variation du jour en %.' },
      { key: 'Formule', desc: 'Mêmes options que le KPI.' },
    ],
    previewClass: 'h-24',
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

  chart: {
    summary: "La courbe du prix d'un symbole.",
    detail:
      "L'évolution récente du prix, avec le cours courant et la variation du jour. L'historique se construit au fil des rafraîchissements : un widget tout juste ajouté affiche « historique en cours de constitution ».",
    params: [{ key: 'Symbole', desc: 'Le ticker à tracer. Un seul par graphe.' }],
    previewClass: 'h-36',
    preview: (
      <ChartView
        symbol="AAPL"
        quote={SAMPLE_QUOTES.AAPL ?? null}
        history={SAMPLE_HISTORY.AAPL ?? []}
      />
    ),
  },

  table: {
    summary: 'Plusieurs symboles comparés ligne à ligne.',
    detail:
      "Prix, variation et volume sur une même ligne. Pas de courbe : c'est le format le plus compact pour surveiller beaucoup de valeurs d'un coup d'œil.",
    params: [
      { key: 'Symboles', desc: 'Liste séparée par des virgules — `AAPL, MSFT, TSLA, NVDA`.' },
    ],
    preview: <TableView symbols={['AAPL', 'MSFT', 'TSLA', 'NVDA']} quotes={SAMPLE_QUOTES} />,
  },

  news: {
    summary: "Les annonces écrites par l'administrateur.",
    detail:
      "Maintenance, nouveautés, alertes. Le contenu vient du backend, pas de votre poste : ce widget est en lecture seule, et l'icône dit le niveau de gravité.",
    params: [{ key: 'Aucun', desc: 'Rien à configurer localement — voir « Qui écrit quoi ».' }],
    preview: <NewsView items={SAMPLE_NEWS} />,
  },

  dailies: {
    summary: "La revue de presse du jour, écrite par l'IA.",
    detail:
      "Chaque jour, le système agrège les articles de vos journaux, les résume, et publie trois vues : une revue **par journal**, les news importantes **par sujet**, et une synthèse. Chaque article garde son lien vers la source ; quand la matière le permet, un « En savoir plus » développe le sujet, chiffres et faits recontrôlés contre l'article d'origine.",
    extra: (
      <p className="mt-2.5 text-sm leading-relaxed text-white/55">
        Deux origines cohabitent dans la même liste, séparées par un badge et un liseré :{' '}
        <span className="font-medium text-sky-200">Partagée</span> — publiée pour tout le monde — et{' '}
        <span className="font-medium text-emerald-200">Perso</span> — générée sur votre poste.
      </p>
    ),
    params: [
      { key: 'Affichage', desc: 'Tout, Par sujet, ou Par journal.' },
      {
        key: 'Origine',
        desc: "Toutes, Partagées, Persos. Le sélecteur n'apparaît que si les deux cohabitent.",
      },
      { key: 'Période', desc: "Aujourd'hui, 7 jours, ou Tout." },
      { key: 'Source', desc: 'Filtre sur un journal ou un sujet précis.' },
      {
        key: 'Catégories',
        desc: "Puces de centres d'intérêt. La préférence est mémorisée par widget.",
      },
      { key: 'Recherche', desc: 'Fouille les titres **et** le corps de toutes les dailys.' },
      {
        key: 'Historique',
        desc: "Groupé par jour. « Voir plus » puis « Charger plus d'articles » remontent le temps — rien n'est jamais supprimé.",
      },
    ],
    preview: <DailiesView items={SAMPLE_DAILIES} followed={[]} onToggle={() => {}} />,
  },
};

/** Les 8 widgets, dans l'ordre exact du menu « Ajouter ». */
export const GUIDE_ENTRIES: readonly GuideEntry[] = WIDGET_META.map(meta => ({
  ...BODIES[meta.type],
  type: meta.type,
  name: meta.label,
  Icon: meta.Icon,
  family: meta.category,
  anchor: `w-${meta.type}`,
}));

// ─── Les 4 gestes ──────────────────────────────────────────────

export interface GuideStep {
  Icon: LucideIcon;
  title: string;
  body: string;
}

export const STEPS: readonly GuideStep[] = [
  {
    Icon: Plus,
    title: 'Ajouter',
    body: 'Bouton **Ajouter**. Le menu range les widgets en trois familles — les mêmes qu’ici.',
  },
  {
    Icon: Target,
    title: 'Placer',
    body: 'Bouton **Éditer** : le bandeau affiche « Mode édition » et le tableau devient un canvas libre. Attrapez une carte n’importe où, tirez ses poignées pour la dimensionner. **Échap** annule le déplacement en cours.',
  },
  {
    Icon: SlidersHorizontal,
    title: 'Régler',
    body: 'La roue de chaque widget ouvre ses paramètres et une section **Style** : couleur d’accent — 6 teintes, pour distinguer vos familles de widgets — et taille du texte, appliquées immédiatement.',
  },
  {
    Icon: Layers,
    title: 'Enregistrer',
    body: 'Bouton **Affichages** : nommez la disposition actuelle, rebasculez d’un clic. Gardez-en plusieurs — « Bourse », « Presse » — et alternez selon le moment.',
  },
];

// ─── Index « Je veux… » ────────────────────────────────────────

/** De l'intention au widget : on part de ce qu'on veut voir, pas du nom. */
export const WANTS: readonly { want: string; type: WidgetType }[] = [
  { want: 'Garder un chiffre sous les yeux', type: 'kpi' },
  { want: 'Voir une variation, en vert ou en rouge', type: 'stat' },
  { want: 'Suivre une liste de valeurs', type: 'stocks' },
  { want: 'Voir une courbe de prix', type: 'chart' },
  { want: 'Comparer beaucoup de valeurs', type: 'table' },
  { want: 'Lancer une tâche en un clic', type: 'quick_action' },
  { want: 'Lire la revue de presse du jour', type: 'dailies' },
  { want: "Lire les annonces de l'admin", type: 'news' },
];

// ─── Formules ──────────────────────────────────────────────────

export const FORMULA_FIELDS: readonly { expr: string; desc: string }[] = [
  { expr: 'AAPL.price', desc: 'Le dernier prix connu.' },
  { expr: 'AAPL.change', desc: 'La variation du jour, en devise.' },
  { expr: 'AAPL.changePercent', desc: 'La variation du jour, en pourcentage.' },
  { expr: 'AAPL.volume', desc: 'Le volume échangé.' },
  {
    expr: 'AAPL.history',
    desc: 'La série des prix récents — à passer aux deux fonctions ci-dessous.',
  },
  { expr: 'sma(AAPL.history, 20)', desc: 'Moyenne mobile simple sur 20 points.' },
  { expr: 'ema(AAPL.history, 20)', desc: 'Moyenne mobile exponentielle sur 20 points.' },
];

export const FORMULA_EXAMPLES: readonly { expr: string; desc: string }[] = [
  { expr: 'AAPL.price / MSFT.price', desc: 'Le ratio de deux prix.' },
  { expr: '(AAPL.price + MSFT.price + TSLA.price) / 3', desc: "La moyenne d'un panier." },
  { expr: 'AAPL.price * 1.2', desc: 'Un objectif de cours à +20 %.' },
  { expr: 'AAPL.price - sma(AAPL.history, 50)', desc: "L'écart à la moyenne mobile 50." },
];

// ─── Qui écrit quoi ────────────────────────────────────────────

export const ORIGIN_ROWS = ['Écrit par', 'Configuré dans', 'Quand', 'Apparaît dans'] as const;

export interface OriginColumn {
  label: string;
  /** Couleur du repère, alignée sur le liseré du widget Dailys. */
  dot: string;
  /** Une cellule par entrée de ORIGIN_ROWS, dans le même ordre. */
  cells: readonly [string, string, string, string];
}

export const ORIGIN_COLUMNS: readonly OriginColumn[] = [
  {
    label: 'Vos journaux',
    dot: 'bg-emerald-400',
    cells: [
      'Votre agent local, sur votre poste.',
      'Écran **Journaux**, portée « Ce poste ».',
      "Chaque jour à 7 h, avec rattrapage à l'allumage. Ou tout de suite via « Générer maintenant ».",
      'Widget **Dailys**, badge vert « Perso ».',
    ],
  },
  {
    label: 'Journaux partagés',
    dot: 'bg-sky-400',
    cells: [
      'Le poste de référence, pour tout le monde.',
      "Écran **Journaux**, portée « Partagés » — réservée à l'administrateur.",
      'À la publication par le poste de référence.',
      'Widget **Dailys**, badge bleu « Partagée ».',
    ],
  },
  {
    label: 'Annonces',
    dot: 'bg-brand-400',
    cells: [
      'Un administrateur, à la main.',
      'Console **Admin**.',
      "À la publication, avec une date d'expiration.",
      'Widget **News**.',
    ],
  },
];

// ─── Raccourcis ────────────────────────────────────────────────

export const SHORTCUTS: readonly { keys: string; what: string }[] = [
  { keys: 'Ctrl + molette', what: 'Zoom de la fenêtre' },
  { keys: 'Ctrl + / Ctrl −', what: 'Zoom par paliers' },
  { keys: 'Ctrl 0', what: 'Retour à 100 %' },
  { keys: 'Échap', what: 'Ferme le guide, ou vide le filtre' },
];
