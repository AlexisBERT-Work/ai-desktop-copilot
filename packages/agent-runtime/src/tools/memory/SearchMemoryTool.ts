import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import type { VectorStore } from '../../memory/VectorStore';

interface Args {
  query: string;
  limit?: number;
  minScore?: number;
}

export class SearchMemoryTool extends BaseTool {
  name = 'search_memory';
  description = 'Cherche dans la mémoire sémantique des informations pertinentes à la requête';
  category = 'memory' as const;
  riskLevel = 'low' as const;
  requiresConfirmation = false;
  schema = TOOL_SCHEMAS.search_memory;

  constructor(private vectorStore: VectorStore) {
    super();
  }

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as Args;
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
