import { writeFile, appendFile, mkdir, stat } from 'fs/promises';
import { dirname, resolve, win32 } from 'path';
import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';

const argsSchema = z.object({
  path: z.string().min(1).describe('Absolute path to write'),
  content: z.string().describe('Content to write'),
  append: z.boolean().default(false),
  encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
});
type Args = z.infer<typeof argsSchema>;

const MAX_BYTES = 5_000_000;

// Répertoires système où l'agent ne doit jamais écrire, même avec confirmation.
const BLOCKED_PREFIXES = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
];

/**
 * Le chemin vise-t-il un répertoire système Windows ? Exporté pour les tests.
 *
 * Résolution en sémantique **win32 explicite**, jamais celle de l'OS hôte : avec
 * `resolve()`, un runner Linux traite `C:\Windows\System32\x.dll` comme un simple
 * nom de fichier relatif, le préfixe ne correspond plus et le garde-fou laisse
 * passer l'écriture. C'est ce qui faisait échouer ces tests en CI (ubuntu) alors
 * qu'ils passaient en local (Windows) — le test avait raison, pas le code.
 * Sur Windows le comportement est inchangé (`resolve` y EST `win32.resolve`).
 */
export function isBlockedPath(path: string): boolean {
  const normalized = win32.resolve(path).toLowerCase();
  return BLOCKED_PREFIXES.some(p => normalized === p || normalized.startsWith(p + '\\'));
}

export class WriteFileTool extends BaseTool<Args> {
  name = 'write_file';
  description =
    'Écrit ou ajoute du contenu dans un fichier local (crée les dossiers parents si besoin). Refuse les répertoires système.';
  category = 'filesystem' as const;
  riskLevel = 'medium' as const;
  requiresConfirmation = true;
  override readonly argsSchema = argsSchema;
  schema = jsonSchemaFrom(argsSchema);

  async execute(args: Args): Promise<ToolResult> {
    if (isBlockedPath(args.path)) {
      return this.fail(`Écriture refusée dans un répertoire système: ${args.path}`);
    }

    let data: string | Buffer;
    if (args.encoding === 'base64') {
      try {
        data = Buffer.from(args.content, 'base64');
      } catch {
        return this.fail("content n'est pas du base64 valide");
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
      const existedBefore = await stat(target)
        .then(s => s.isFile())
        .catch(() => false);

      await mkdir(dirname(target), { recursive: true });
      if (args.append) {
        await appendFile(target, data);
      } else {
        await writeFile(target, data);
      }

      return this.ok({
        path: target,
        bytesWritten: size,
        mode: args.append ? 'append' : 'write',
        created: !existedBefore,
      });
    } catch (err) {
      return this.fail(`Impossible d'écrire ${args.path}: ${String(err)}`);
    }
  }
}
