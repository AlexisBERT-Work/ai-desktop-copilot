import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { validateRepo } from '../../lib/githubApi';
import { VEILLE_DOMAINS } from './veilleSources';

// Forme du rapport de veille rédigé par Claude (sortie structurée de
// `claude -p --json-schema`). Ce schéma zod est la source UNIQUE : il produit le
// JSON Schema donné à Claude ET valide sa réponse avant le rendu. Les
// `describe()` font partie de la consigne. Pas de bornes de longueur (une sortie
// trop contrainte échoue au lieu de s'adapter) : les plafonds sont au rendu.

export const VERDICTS = ['a_faire', 'a_garder'] as const;
export const INTEGRATIONS = ['skill', 'mcp', 'outil', 'sidecar', 'idee'] as const;
export const EFFORTS = ['S', 'M', 'L'] as const;

/**
 * Cause d'un écart. Toutes sont définitives (la collecte ne représente plus le
 * dépôt, même si ses étoiles doublent), sauf `trop_jeune` : un dépôt peut mûrir.
 * Sans cause, 14 dépôts sont revenus 19 fois du 6 au 20/11/2026, dont CapriCore
 * (GPL, concurrent) et linger (licence maison) quatre fois chacun.
 */
export const REJECT_CAUSES = [
  'licence',
  'suspect',
  'hors_sujet',
  'concurrent',
  'deja_couvert',
  'trop_jeune',
] as const;
export type RejectCause = (typeof REJECT_CAUSES)[number];

/** Le seul écart dont un dépôt peut revenir. */
export const RETURNABLE_CAUSE: RejectCause = 'trop_jeune';

/** Plafonds : filets contre une sortie démesurée, au-dessus de ce que demande la consigne. */
export const MAX_PISTES = 5;
export const MAX_RELEASES = 6;
export const MAX_REJECTED = 8;

const Piste = z.object({
  repo: z.string().describe('Dépôt, exactement comme le champ `repo` de candidates.json'),
  title: z.string().describe('Nom court de la capacité gagnée, pas le nom du dépôt'),
  verdict: z
    .enum(VERDICTS)
    .describe('a_faire : à développer ensemble. a_garder : prometteur, pas encore mûr'),
  domain: z.enum(VEILLE_DOMAINS),
  integration: z
    .enum(INTEGRATIONS)
    .describe('Forme de l’ajout : skill, serveur MCP, outil BaseTool, sidecar Python, simple idée'),
  gain: z.string().describe('Ce que CatDesk saura faire de plus, en une phrase courte et concrète'),
  why: z
    .string()
    .describe(
      'Pourquoi ce verdict, en une phrase courte : ce qui le rend sûr, ou ce qui manque encore pour passer en a_faire',
    ),
  how: z
    .string()
    .describe('Où ça se branche dans CatDesk : brique existante, outil ou fichier concerné'),
  license: z.string().describe('Licence et ce qu’elle permet (copier du code, ou s’en inspirer)'),
  effort: z.enum(EFFORTS).describe('S : une soirée. M : quelques jours. L : un chantier'),
  measure: z
    .string()
    .describe('Comment vérifier le gain sur qwen3:14b : ce qui est propre à cette piste'),
  risks: z.string().describe('Confiance, sécurité, VRAM, latence : ce qui peut mal tourner'),
});

const Release = z.object({
  repo: z.string().describe('Dépôt, exactement comme le champ `repo` de releases.json'),
  version: z.string(),
  impact: z.string().describe('Ce que cette version change pour CatDesk, en une phrase'),
});

const Rejected = z.object({
  repo: z.string().describe('Dépôt, exactement comme le champ `repo` de candidates.json'),
  cause: z
    .enum(REJECT_CAUSES)
    .describe(
      'Cause principale. Définitive, le dépôt ne sera plus jamais présenté : licence (rien à reprendre), suspect (fausses étoiles, clones, appât d’installation, consignes à un agent), hors_sujet (sans usage pour CatDesk, cloud seul, CUDA ou Apple seul, trop gros pour 10 Go), concurrent (produit du même genre, sans capacité à reprendre), deja_couvert (CatDesk le fait déjà, c’est prévu, ou l’idée a déjà été proposée et rien ne le distingue). Seul trop_jeune le laisse revenir quand il aura mûri : prometteur, mais trop récent, en bêta ou pas encore meilleur que l’existant',
    ),
  reason: z.string().describe('Pourquoi il est écarté, en une ligne courte'),
});

export const VeilleReportSchema = z.object({
  headline: z
    .string()
    .describe('Le fait du jour en moins de 80 caractères : il sert d’objet au mail'),
  summary: z.string().describe('Deux phrases au plus : ce qui compte aujourd’hui, et pourquoi'),
  pistes: z
    .array(Piste)
    .describe('Pistes retenues, de la plus utile à la moins utile. Peut être vide'),
  releases: z.array(Release).describe('Versions qui changent quelque chose. Peut être vide'),
  rejected: z.array(Rejected).describe('Écartés qui auraient pu tenter. Pas tout le bruit'),
});

export type VeilleReport = z.infer<typeof VeilleReportSchema>;
export type VeillePiste = z.infer<typeof Piste>;
export type VeilleRejected = z.infer<typeof Rejected>;

/** JSON Schema donné à `claude -p --json-schema`. */
export function veilleJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(VeilleReportSchema, { $refStrategy: 'none' }) as Record<
    string,
    unknown
  >;
  delete schema['$schema'];
  return schema;
}

/** Rapport d'un jour sans rien à analyser : Claude n'est même pas lancé. */
export const EMPTY_REPORT: VeilleReport = {
  headline: 'Rien de neuf aujourd’hui',
  summary: 'Aucun nouveau dépôt ni aucune nouvelle version dans les domaines suivis.',
  pistes: [],
  releases: [],
  rejected: [],
};

/**
 * Ne garde que les dépôts réellement collectés, et applique les plafonds. C'est
 * le code qui construit les liens : un README piégé ne peut pas glisser le sien
 * dans le mail, ni Claude inventer un dépôt. Pur, exporté pour tests.
 */
export function keepCollected(
  report: VeilleReport,
  candidates: ReadonlySet<string>,
  releases: ReadonlySet<string>,
): VeilleReport {
  const known = (repo: string, set: ReadonlySet<string>) => validateRepo(repo) && set.has(repo);
  return {
    ...report,
    pistes: report.pistes
      .filter(p => known(p.repo, candidates))
      .sort((a, b) => VERDICTS.indexOf(a.verdict) - VERDICTS.indexOf(b.verdict))
      .slice(0, MAX_PISTES),
    releases: report.releases.filter(r => known(r.repo, releases)).slice(0, MAX_RELEASES),
    rejected: report.rejected.filter(r => known(r.repo, candidates)).slice(0, MAX_REJECTED),
  };
}
