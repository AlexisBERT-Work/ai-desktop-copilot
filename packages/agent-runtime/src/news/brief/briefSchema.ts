import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Forme du brief quotidien « Actu IA » rédigé par Claude (sortie structurée de
// `claude -p --json-schema`). Ce schéma zod est la source UNIQUE : il produit
// le JSON Schema donné à Claude ET valide sa réponse avant le rendu. Les
// `describe()` font partie de la consigne — les soigner comme le prompt.
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

const SourceRef = z.object({
  name: z.string().describe('Nom du média ou de l’auteur, ex. « The Decoder »'),
  url: z.string().describe('URL exacte de l’article (http/https)'),
});

const Diagram = z.object({
  mermaid: z
    .string()
    .describe(
      'Code Mermaid `flowchart TD` (vertical), 6 nœuds au plus, libellés de 2 à 4 mots entre guillemets doubles (accents et apostrophes permis), sans style ni couleur',
    ),
  caption: z.string().describe('Légende d’une phrase'),
});

const Lead = z.object({
  title: z.string().describe('Titre informatif en français, 110 caractères max'),
  summary: z
    .string()
    .describe('Ce qui s’est passé : faits, chiffres, acteurs. 80 à 120 mots, sans spéculation'),
  whyItMatters: z
    .string()
    .describe(
      'Ce que ça change, concrètement, pour une organisation qui déploie l’IA. 50 à 80 mots',
    ),
  imageUrl: z
    .string()
    .nullable()
    .describe(
      'Le champ `image` d’un des articles cités, recopié tel quel ; null si aucun n’en a. Ne jamais inventer d’URL',
    ),
  diagram: Diagram.nullable().describe(
    'Schéma SEULEMENT s’il éclaire vraiment (architecture, chaîne d’acteurs, calendrier réglementaire) ; sinon null. 1 par jour au plus',
  ),
  sources: z.array(SourceRef).min(1).describe('1 à 3 sources, la principale en premier'),
});

const Item = z.object({
  title: z.string().describe('Titre court en français'),
  summary: z.string().describe('Le fait et sa portée, 45 mots au plus'),
  url: z.string().describe('URL de l’article'),
  source: z.string().describe('Nom du média'),
});

const Section = z.object({
  name: z.enum(BRIEF_SECTIONS),
  items: z.array(Item).describe('2 à 4 brèves, les plus importantes d’abord'),
});

export const BriefSchema = z.object({
  headline: z
    .string()
    .describe('Titre du jour, sert d’objet au mail : le fait le plus important, 90 caractères max'),
  essentials: z
    .array(z.string())
    .min(1)
    .describe(
      '« L’essentiel en 30 secondes » : 3 à 5 phrases autonomes de 30 mots au plus, une par fait majeur',
    ),
  leads: z
    .array(Lead)
    .min(1)
    .describe('« À la une » : les 2 ou 3 sujets les plus importants, développés'),
  sections: z
    .array(Section)
    .describe('Brèves par rubrique ; omettre une rubrique vide plutôt que la remplir'),
  forTheLead: z
    .array(z.string())
    .min(1)
    .describe(
      '« Pour le référent IA » : 2 à 4 actions concrètes (à tester, à communiquer en interne, risque à anticiper), chacune rattachée à un fait du jour, 45 mots au plus',
    ),
  toWatch: z
    .array(z.string())
    .describe('« À surveiller » : 0 à 3 échéances ou signaux faibles, datés si possible'),
});

export type Brief = z.infer<typeof BriefSchema>;
export type BriefLead = z.infer<typeof Lead>;

/** JSON Schema à passer à `claude --json-schema`. Pur. */
export function briefJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(BriefSchema, { $refStrategy: 'none' }) as Record<string, unknown>;
  delete schema['$schema'];
  return schema;
}
