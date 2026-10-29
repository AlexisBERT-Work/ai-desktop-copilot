import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Forme du brief quotidien « Veille IA » rédigé par Claude (sortie structurée
// de `claude -p --json-schema`). Ce schéma zod est la source UNIQUE : il produit
// le JSON Schema donné à Claude ET valide sa réponse avant le rendu. Les
// `describe()` font partie de la consigne — les soigner comme le prompt.
//
// v2 (2026-10-21) : « un fait, une place ». La v1 résumait chaque sujet dans
// plusieurs rubriques (essentiel, à la une, brèves, actions, à surveiller) : un
// même fait revenait jusqu'à six fois. Désormais l'action et les incertitudes
// vivent DANS la fiche du sujet, les brèves et l'agenda ne portent que ce qui
// n'est pas déjà développé.
//
// v3 (2026-10-28) : le lecteur trouvait la v2 trop maigre (2 sujets par jour)
// et n'utilisait pas « Pour nous » / « Action » : 4 à 6 sujets développés, un
// contexte factuel à la place de la recommandation, et une rubrique
// « Tendances » sur la compétition du secteur (rivalités, course, benchmarks).
//
// Pas de bornes de longueur dans le schéma (une sortie structurée trop
// contrainte échoue plutôt que de s'adapter) : les tailles sont demandées dans
// les descriptions et rabotées au rendu.

export const BRIEF_SECTIONS = [
  'Modèles & recherche',
  'Produits & outils',
  'Entreprises & marché',
  'Régulation & éthique',
  'Sécurité',
] as const;

export const SOURCE_KINDS = ['primaire', 'presse', 'analyse'] as const;

const SourceRef = z.object({
  name: z
    .string()
    .describe('Émetteur : organisme, entreprise, revue ou média (ex. « EMA », « The Decoder »)'),
  url: z.string().describe('URL exacte (http/https)'),
  kind: z
    .enum(SOURCE_KINDS)
    .describe(
      'primaire = l’émetteur lui-même (communiqué, texte officiel, article scientifique) ; presse = article de média ; analyse = newsletter ou blog d’analyste',
    ),
});

export const TREND_KINDS = ['Rivalités', 'Course', 'Benchmarks'] as const;

const Lead = z.object({
  title: z.string().describe('Titre informatif en français, 110 caractères au plus'),
  facts: z
    .string()
    .describe(
      'Les faits, développés : qui, quoi, quand, combien, comment ça marche, et ce qui est NOUVEAU par rapport à ce qui était connu. 150 à 250 mots en paragraphes courts de deux ou trois phrases, séparés par une ligne vide ; deux à quatre chiffres clés en **gras** ; chaque phrase vérifiable',
    ),
  context: z
    .string()
    .describe(
      'Le contexte, sans répéter les faits : ce qui précède (annonces antérieures, chiffres de comparaison, concurrents), les réactions d’acteurs ou d’experts citées par les sources, le débat s’il y en a un. 60 à 120 mots. Jamais de recommandation au lecteur',
    ),
  uncertain: z
    .string()
    .nullable()
    .describe(
      'Ce qui n’est pas confirmé, contesté, ou ne repose que sur une source secondaire, 30 mots au plus ; null si tout est établi',
    ),
  sources: z
    .array(SourceRef)
    .min(1)
    .describe('1 à 4 sources, la source primaire en premier si elle existe'),
});

const Trend = z.object({
  kind: z
    .enum(TREND_KINDS)
    .describe(
      'Rivalités = procès, débauchages, piques publiques, alliances qui se font ou se défont ; Course = sorties concurrentes, levées et valorisations, puces et centres de calcul, parts de marché ; Benchmarks = records, classements, évaluations indépendantes, contestations de mesure',
    ),
  title: z.string().describe('Titre informatif en français, 110 caractères au plus'),
  body: z
    .string()
    .describe(
      'Qui contre qui, les faits et les chiffres. Pour un benchmark : nom du test, score, écart avec le précédent record, qui a mesuré (le labo lui-même ou un évaluateur indépendant). 80 à 150 mots, chiffres clés en **gras**',
    ),
  sources: z
    .array(SourceRef)
    .min(1)
    .describe('1 à 3 sources, la source primaire en premier si elle existe'),
});

const Item = z.object({
  title: z.string().describe('Titre court en français'),
  summary: z.string().describe('Le fait précis, ses chiffres et sa portée, 30 à 50 mots'),
  url: z.string().describe('URL de la source'),
  source: z.string().describe('Nom de la source'),
});

const Section = z.object({
  name: z.enum(BRIEF_SECTIONS),
  items: z
    .array(Item)
    .describe(
      'Brèves sur des faits ABSENTS des sujets « À la une » et des tendances, les plus importantes d’abord ; 6 au plus',
    ),
});

const AgendaEntry = z.object({
  date: z.string().describe('Date de l’échéance, ex. « 2 décembre 2026 » ou « fin 2026 »'),
  event: z.string().describe('Ce qui se passe à cette date, 25 mots au plus'),
});

export const BriefSchema = z.object({
  headline: z
    .string()
    .describe('Objet du mail : le fait le plus important du jour, 90 caractères au plus'),
  leads: z
    .array(Lead)
    .min(1)
    .describe(
      '« À la une » : les 4 à 6 sujets les plus importants de la période, chacun développé ; moins seulement si la période est vraiment creuse',
    ),
  trends: z
    .array(Trend)
    .describe(
      '« Tendances » : 4 à 6 faits de la compétition du secteur pendant la période, absents des sujets « À la une » ; rendus en tête du brief',
    ),
  sections: z
    .array(Section)
    .describe(
      '« En bref » par rubrique : 10 à 20 brèves au total ; omettre une rubrique sans matière plutôt que la remplir',
    ),
  agenda: z
    .array(AgendaEntry)
    .describe(
      'Échéances datées à venir que le lecteur doit anticiper, absentes des sujets ci-dessus ; 0 à 4',
    ),
});

export type Brief = z.infer<typeof BriefSchema>;
export type BriefLead = z.infer<typeof Lead>;
export type BriefTrend = z.infer<typeof Trend>;

/** JSON Schema à passer à `claude --json-schema`. Pur. */
export function briefJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(BriefSchema, { $refStrategy: 'none' }) as Record<string, unknown>;
  delete schema['$schema'];
  return schema;
}
