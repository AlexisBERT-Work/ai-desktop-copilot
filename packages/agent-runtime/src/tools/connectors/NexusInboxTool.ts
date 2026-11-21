import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { nexusRequest } from '../../nexus/link';

const argsSchema = z.object({
  text: z.string().min(1).max(10_000).describe('Le texte de la note, en Markdown'),
});
type Args = z.infer<typeof argsSchema>;

/**
 * Ajoute une note rapide dans Nexus (`notes/inbox.md` du dossier du Master), datée et marquée
 * « via CatDesk ». Seule écriture permise par la liaison, et Nexus peut la refuser (réglage
 * « Autoriser les notes rapides » de son extension CatDesk).
 */
export class NexusInboxTool extends BaseTool<Args> {
  readonly name = 'nexus_inbox';
  readonly description =
    "Ajoute une note rapide dans Nexus, l'application du Master (notes/inbox.md), à trier plus tard.";
  readonly category = 'web' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = true; // demandé une fois, puis retenu pour la session
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  constructor(private readonly linkPath?: string) {
    super();
  }

  async execute(args: Args): Promise<ToolResult> {
    const res = await nexusRequest<{ path: string }>('inbox', {
      method: 'POST',
      body: { text: args.text },
      ...(this.linkPath !== undefined ? { linkPath: this.linkPath } : {}),
    });
    if (!res.ok) return this.fail(res.error);
    return this.ok({ added: true, path: res.data.path, note: 'Note ajoutée dans Nexus.' });
  }
}
