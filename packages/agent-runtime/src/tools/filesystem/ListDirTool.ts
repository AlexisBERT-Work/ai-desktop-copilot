import { readdir, stat } from 'fs/promises';
import { join, extname } from 'path';
import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

const argsSchema = z.object({
  path: z.string().min(1).describe('Directory path to list'),
  recursive: z.boolean().default(false),
  includeHidden: z.boolean().default(false),
  filter: z.string().optional().describe('Glob pattern filter'),
});
type Args = z.infer<typeof argsSchema>;

interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  extension?: string;
}

export class ListDirTool extends BaseTool<Args> {
  name = 'list_directory';
  description = "Liste le contenu d'un répertoire avec métadonnées";
  category = 'filesystem' as const;
  riskLevel = 'low' as const;
  requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  schema = jsonSchemaFrom(argsSchema);

  async execute(args: Args): Promise<ToolResult> {
    try {
      const entries = await this.list(args.path, args);
      return this.ok({
        path: args.path,
        entries,
        count: entries.length,
      });
    } catch (err) {
      return this.fail(`Impossible de lister ${args.path}: ${String(err)}`);
    }
  }

  private async list(dirPath: string, args: Args, depth = 0): Promise<DirEntry[]> {
    if (depth > 3) return []; // Max recursion depth

    const raw = await readdir(dirPath);
    const entries: DirEntry[] = [];

    for (const name of raw.slice(0, 500)) {
      if (!args.includeHidden && name.startsWith('.')) continue;

      const fullPath = join(dirPath, name);
      const info = await stat(fullPath).catch(() => null);
      if (!info) continue;

      const isDir = info.isDirectory();
      const entry: DirEntry = {
        name,
        path: fullPath,
        type: isDir ? 'directory' : 'file',
        ...(!isDir ? { size: info.size } : {}),
        ...(!isDir && extname(name).length > 1 ? { extension: extname(name).slice(1) } : {}),
      };

      entries.push(entry);

      if (args.recursive && isDir && depth < 3) {
        const children = await this.list(fullPath, args, depth + 1);
        entries.push(...children);
      }
    }

    return entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }
}
