import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { notionFetch, resolveNotionToken, notionTitle, blockToText } from '../../lib/notionApi';

interface NotionSearchArgs {
  query?: string;
  token?: string;
  page_id?: string;
  filter?: 'page' | 'database' | 'all';
  limit?: number;
}

interface NotionSearchResponse {
  object?: string;
  results?: Array<Record<string, unknown>>;
  message?: string;
  status?: number;
}

interface NotionBlocksResponse {
  results?: Array<Record<string, unknown>>;
  message?: string;
  has_more?: boolean;
}

export class NotionSearchTool extends BaseTool {
  readonly name = 'notion_search';
  readonly description =
    "Recherche dans les pages et bases Notion partagées avec l'intégration, ou lit le contenu texte d'une page (page_id). Nécessite un token d'intégration Notion (arg `token` ou NOTION_TOKEN).";
  readonly category = 'web' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.notion_search;

  async execute(args: unknown): Promise<ToolResult> {
    const { query, page_id, filter = 'all', limit = 15 } = args as NotionSearchArgs;
    const token = resolveNotionToken((args as NotionSearchArgs).token);

    if (token.length === 0) {
      return this.fail('Token Notion manquant. Passe `token` ou définis NOTION_TOKEN.');
    }

    // ── Read a specific page's text ──
    if (typeof page_id === 'string' && page_id.length > 0) {
      let data: NotionBlocksResponse;
      try {
        data = (await notionFetch(`/v1/blocks/${page_id}/children?page_size=100`, token)) as NotionBlocksResponse;
      } catch (err) {
        return this.fail(`Impossible de contacter Notion: ${String(err)}`);
      }
      if (data.message) return this.fail(`Notion API: ${data.message}`);

      const blocks = data.results ?? [];
      const text = blocks.map(blockToText).filter((t) => t.length > 0).join('\n');
      return this.ok({
        pageId: page_id,
        blockCount: blocks.length,
        hasMore: data.has_more === true,
        content: text.slice(0, 20000),
        truncated: text.length > 20000,
      });
    }

    // ── Search ──
    const body: Record<string, unknown> = { page_size: Math.min(Math.max(1, limit), 100) };
    if (typeof query === 'string' && query.length > 0) body['query'] = query;
    if (filter !== 'all') body['filter'] = { value: filter, property: 'object' };

    let data: NotionSearchResponse;
    try {
      data = (await notionFetch('/v1/search', token, 'POST', body)) as NotionSearchResponse;
    } catch (err) {
      return this.fail(`Impossible de contacter Notion: ${String(err)}`);
    }
    if (data.message) return this.fail(`Notion API: ${data.message}`);

    const results = (data.results ?? []).map((obj) => ({
      id: obj['id'] as string | undefined,
      object: obj['object'] as string | undefined,
      title: notionTitle(obj),
      url: obj['url'] as string | undefined,
      lastEdited: obj['last_edited_time'] as string | undefined,
    }));

    return this.ok({
      ...(query ? { query } : {}),
      filter,
      count: results.length,
      results,
      note: 'Utilise `page_id` avec l\'id d\'un résultat pour en lire le contenu texte.',
    });
  }
}
