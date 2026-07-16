import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { VectorStore } from '../../memory/VectorStore';

const argsSchema = z.object({
  query: z.string().min(1).describe('Search query'),
  limit: z.number().max(20).default(5),
  minScore: z.number().min(0).max(1).default(0.6),
});
type Args = z.infer<typeof argsSchema>;

export class SearchMemoryTool extends BaseTool<Args> {
  name = 'search_memory';
  description = 'Cherche dans la mémoire sémantique des informations pertinentes à la requête';
  category = 'memory' as const;
  riskLevel = 'low' as const;
  requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private vectorStore: VectorStore) {
    super();
  }

  async execute(rawArgs: Args): Promise<ToolResult> {
    const args = rawArgs;
    if (!args.query) return this.fail('query est requis');

    try {
      const results = await this.vectorStore.search(args.query, {
        limit: args.limit ?? 5,
        minScore: args.minScore ?? 0.6,
      });

      return this.ok({
        results,
        count: results.length,
        query: args.query,
      });
    } catch (err) {
      return this.fail(`Erreur recherche mémoire: ${String(err)}`);
    }
  }
}
