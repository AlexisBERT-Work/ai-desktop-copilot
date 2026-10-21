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

const Lead = z.object({
  title: z.string().describe('Titre informatif en français, 110 caractères au plus'),
  facts: z
    .string()
    .describe(
      'Les faits : qui, quoi, quand, combien, et ce qui est NOUVEAU par rapport à ce qui était connu. 80 à 120 mots, chaque phrase vérifiable',
    ),
  forUs: z
    .string()
    .describe(
      'Ce que ça change pour l’organisation du lecteur, sans répéter les faits. 40 à 70 mots',
    ),
  action: z
    .string()
    .nullable()
    .describe(
      'Une action concrète et réaliste pour le lecteur, 30 mots au plus ; null s’il n’y en a pas',
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
    .describe('1 à 3 sources, la source primaire en premier si elle existe'),
});

const Item = z.object({
  title: z.string().describe('Titre court en français'),
  summary: z.string().describe('Le fait précis et sa portée, 35 mots au plus'),
  url: z.string().describe('URL de la source'),
  source: z.string().describe('Nom de la source'),
});

const Section = z.object({
  name: z.enum(BRIEF_SECTIONS),
  items: z
    .array(Item)
    .describe(
      'Brèves sur des faits ABSENTS des sujets « À la une », les plus importantes d’abord ; 4 au plus',
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
    .describe('« À la une » : les 1 à 3 sujets les plus importants pour le lecteur, développés'),
  sections: z
    .array(Section)
    .describe('« En bref » par rubrique ; omettre une rubrique sans matière plutôt que la remplir'),
  agenda: z
    .array(AgendaEntry)
    .describe(
      'Échéances datées à venir que le lecteur doit anticiper, absentes des sujets ci-dessus ; 0 à 4',
    ),
});

export type Brief = z.infer<typeof BriefSchema>;
export type BriefLead = z.infer<typeof Lead>;

/** JSON Schema à passer à `claude --json-schema`. Pur. */
export function briefJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(BriefSchema, { $refStrategy: 'none' }) as Record<string, unknown>;
  delete schema['$schema'];
  return schema;
}
