import { readFile } from 'fs/promises';
import { stat } from 'fs/promises';
import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface Args {
  path: string;
  encoding?: 'utf-8' | 'base64';
  maxBytes?: number;
}

export class ReadFileTool extends BaseTool {
  name = 'read_file';
  description = 'Lit le contenu d\'un fichier texte ou binaire (base64) sur le système de fichiers';
  category = 'filesystem' as const;
  riskLevel = 'low' as const;
  requiresConfirmation = false;
  schema = TOOL_SCHEMAS.read_file;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as Args;
    if (!args.path) return this.fail('path est requis');

    const maxBytes = Math.min(args.maxBytes ?? 500_000, 5_000_000);

    try {
      const info = await stat(args.path);
      if (!info.isFile()) return this.fail(`${args.path} n'est pas un fichier`);
      if (info.size > maxBytes) {
        return this.fail(`Fichier trop grand: ${info.size} bytes (max: ${maxBytes})`);
      }

      const encoding = args.encoding ?? 'utf-8';
      const content = await readFile(args.path, { encoding: encoding === 'utf-8' ? 'utf-8' : undefined });

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
