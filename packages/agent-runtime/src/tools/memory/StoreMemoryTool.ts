import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import type { VectorStore } from '../../memory/VectorStore';

interface Args {
  content: string;
  tags?: string[];
}

const MAX_CHARS = 10_000;

export class StoreMemoryTool extends BaseTool {
  name = 'store_memory';
  description =
    'Stocke une information en mémoire sémantique persistante (préférences, faits, contexte projet) pour les sessions futures';
  category = 'memory' as const;
  riskLevel = 'medium' as const;
  requiresConfirmation = false;
  schema = TOOL_SCHEMAS.store_memory;

  constructor(private vectorStore: VectorStore) {
    super();
  }

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as Args;
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
