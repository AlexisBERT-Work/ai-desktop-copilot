import { readFile, stat } from 'fs/promises';
import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

const argsSchema = z.object({
  path: z.string().min(1).describe('Absolute path to the file'),
  encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
  maxBytes: z.number().max(1_000_000).optional().describe('Max bytes to read'),
});
type Args = z.infer<typeof argsSchema>;

export class ReadFileTool extends BaseTool<Args> {
  name = 'read_file';
  description = "Lit le contenu d'un fichier texte ou binaire (base64) sur le système de fichiers";
  category = 'filesystem' as const;
  riskLevel = 'low' as const;
  requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  schema = jsonSchemaFrom(argsSchema);

  async execute(args: Args): Promise<ToolResult> {
    const maxBytes = Math.min(args.maxBytes ?? 500_000, 5_000_000);

    try {
      const info = await stat(args.path);
      if (!info.isFile()) return this.fail(`${args.path} n'est pas un fichier`);
      if (info.size > maxBytes) {
        return this.fail(`Fichier trop grand: ${info.size} bytes (max: ${maxBytes})`);
      }

      const encoding = args.encoding;
      const content = await readFile(args.path, {
        encoding: encoding === 'utf-8' ? 'utf-8' : undefined,
      });

      if (encoding === 'base64' && Buffer.isBuffer(content)) {
        return this.ok({
          content: (content as Buffer).toString('base64'),
          encoding: 'base64',
          size: info.size,
        });
      }

      return this.ok({
        content: content as string,
        encoding: 'utf-8',
        size: info.size,
        path: args.path,
      });
    } catch (err) {
      return this.fail(`Impossible de lire ${args.path}: ${String(err)}`);
    }
  }
}
