import { writeFile, appendFile, mkdir, stat } from 'fs/promises';
import { dirname, resolve } from 'path';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface Args {
  path: string;
  content: string;
  append?: boolean;
  encoding?: 'utf-8' | 'base64';
}

const MAX_BYTES = 5_000_000;

// Répertoires système où l'agent ne doit jamais écrire, même avec confirmation.
const BLOCKED_PREFIXES = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
];

/** Exporté pour les tests. */
export function isBlockedPath(path: string): boolean {
  const normalized = resolve(path).toLowerCase();
  return BLOCKED_PREFIXES.some(p => normalized === p || normalized.startsWith(p + '\\'));
}

export class WriteFileTool extends BaseTool {
  name = 'write_file';
  description =
    "Écrit ou ajoute du contenu dans un fichier local (crée les dossiers parents si besoin). Refuse les répertoires système.";
  category = 'filesystem' as const;
  riskLevel = 'medium' as const;
  requiresConfirmation = true;
  schema = TOOL_SCHEMAS.write_file;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as Args;
    if (!args.path) return this.fail('path est requis');
    if (typeof args.content !== 'string') return this.fail('content est requis');
    if (isBlockedPath(args.path)) {
      return this.fail(`Écriture refusée dans un répertoire système: ${args.path}`);
    }

    const encoding = args.encoding ?? 'utf-8';
    let data: string | Buffer;
    if (encoding === 'base64') {
      try {
        data = Buffer.from(args.content, 'base64');
      } catch {
        return this.fail('content n\'est pas du base64 valide');
      }
    } else {
      data = args.content;
    }

    const size = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data, 'utf-8');
    if (size > MAX_BYTES) {
      return this.fail(`Contenu trop grand: ${size} bytes (max: ${MAX_BYTES})`);
    }

    try {
      const target = resolve(args.path);
      const existedBefore = await stat(target).then(s => s.isFile()).catch(() => false);

      await mkdir(dirname(target), { recursive: true });
      if (args.append === true) {
        await appendFile(target, data);
      } else {
        await writeFile(target, data);
      }

      return this.ok({
        path: target,
        bytesWritten: size,
        mode: args.append === true ? 'append' : 'write',
        created: !existedBefore,
      });
    } catch (err) {
      return this.fail(`Impossible d'écrire ${args.path}: ${String(err)}`);
    }
  }
}
