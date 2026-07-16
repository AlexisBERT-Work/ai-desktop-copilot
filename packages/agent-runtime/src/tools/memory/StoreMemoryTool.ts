import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import type { VectorStore } from '../../memory/VectorStore';

const argsSchema = z.object({
  content: z.string().min(1).describe('Information to store in memory'),
  tags: z.array(z.string()).optional().describe('Tags for retrieval'),
});
type Args = z.infer<typeof argsSchema>;

const MAX_CHARS = 10_000;

export class StoreMemoryTool extends BaseTool<Args> {
  name = 'store_memory';
  description =
    'Stocke une information en mémoire sémantique persistante (préférences, faits, contexte projet) pour les sessions futures';
  category = 'memory' as const;
  riskLevel = 'medium' as const;
  requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private vectorStore: VectorStore) {
    super();
  }

  async execute(rawArgs: Args): Promise<ToolResult> {
    const args = rawArgs;
    if (typeof args.content !== 'string' || args.content.trim().length === 0) {
      return this.fail('content est requis');
    }
    if (args.content.length > MAX_CHARS) {
      return this.fail(`Contenu trop long: ${args.content.length} caractères (max: ${MAX_CHARS})`);
    }
    if (args.tags !== undefined && !Array.isArray(args.tags)) {
      return this.fail('tags doit être un tableau de chaînes');
    }

    try {
      const tags = (args.tags ?? []).filter(t => typeof t === 'string' && t.length > 0);
      const id = await this.vectorStore.store(args.content.trim(), {
        source: 'store_memory',
        ...(tags.length > 0 ? { tags } : {}),
        storedAt: new Date().toISOString(),
      });

      return this.ok({ id, stored: true, ...(tags.length > 0 ? { tags } : {}) });
    } catch (err) {
      return this.fail(`Erreur stockage mémoire: ${String(err)}`);
    }
  }
}
