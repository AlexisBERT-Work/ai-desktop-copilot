import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { nexusRequest, type NexusRequest } from '../../nexus/link';

const argsSchema = z.object({
  action: z
    .enum(['search', 'read', 'today', 'list', 'open'])
    .describe(
      'search: chercher dans les cours (query) · read: lire un document (document) · today: devoirs, évaluations et moyennes · list: les cours · open: montrer un cours ou un document dans Nexus',
    ),
  query: z.string().optional().describe('search : texte ou question à chercher'),
  course: z
    .string()
    .optional()
    .describe('slug du cours (voir list) : filtre de search, ou cours à ouvrir avec open'),
  document: z
    .string()
    .optional()
    .describe('read / open : le `path` d’un résultat de search (relatif au dossier du Master)'),
  days: z.number().int().min(1).max(120).optional().describe('today : horizon en jours (15)'),
  limit: z.number().int().min(1).max(20).optional().describe('search : nombre de passages (8)'),
});
type Args = z.infer<typeof argsSchema>;

/**
 * Nexus, l'application du Master : cours, notes, notebooks, documents des profs, devoirs.
 * Lecture seule (plus « ouvrir », qui ne modifie rien) ; la note rapide est `nexus_inbox`.
 * Nexus ne fait tourner aucun modèle pour CatDesk : `search` renvoie des passages, et c'est
 * le modèle de CatDesk qui rédige la réponse en citant le `path` des sources.
 */
export class NexusCoursesTool extends BaseTool<Args> {
  readonly name = 'nexus_courses';
  readonly description =
    "Interroge Nexus, l'application du Master de l'utilisateur : cherche dans ses cours (notes, notebooks, documents des profs), lit un document, donne ses devoirs à rendre, évaluations et moyennes, ou ouvre un cours dans Nexus. Cite le `path` des passages utilisés.";
  readonly category = 'web' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private readonly linkPath?: string) {
    super();
  }

  private call<T>(route: string, req: NexusRequest = {}) {
    return nexusRequest<T>(route, {
      ...req,
      ...(this.linkPath !== undefined ? { linkPath: this.linkPath } : {}),
    });
  }

  private result(res: { ok: true; data: unknown } | { ok: false; error: string }): ToolResult {
    return res.ok ? this.ok(res.data) : this.fail(res.error);
  }

  async execute(args: Args): Promise<ToolResult> {
    switch (args.action) {
      case 'list':
        return this.result(await this.call('info'));
      case 'today':
        return this.result(await this.call('today', { query: { days: args.days } }));
      case 'search': {
        const query = args.query?.trim() ?? '';
        if (query.length === 0) {
          return this.fail('search : donne `query` (ce qu’il faut chercher).');
        }
        return this.result(
          await this.call('search', {
            query: { q: query, course: args.course, limit: args.limit ?? 8 },
          }),
        );
      }
      case 'read': {
        if (args.document === undefined || args.document.length === 0) {
          return this.fail('read : donne `document`, le `path` d’un résultat de search.');
        }
        return this.result(await this.call('read', { query: { path: args.document } }));
      }
      case 'open': {
        const target =
          args.document !== undefined && args.document.length > 0
            ? { path: args.document }
            : args.course !== undefined && args.course.length > 0
              ? { course: args.course }
              : undefined;
        if (target === undefined) {
          return this.fail('open : donne `course` (slug, voir list) ou `document` (un path).');
        }
        return this.result(await this.call('open', { method: 'POST', body: target }));
      }
    }
  }
}
