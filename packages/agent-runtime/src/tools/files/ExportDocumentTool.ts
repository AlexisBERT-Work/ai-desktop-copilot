import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { extname } from 'path';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { OcrSidecarClient } from '../../lib/ocrSidecar';

export type ExportFormat = 'pdf' | 'docx' | 'html' | 'md';

const argsSchema = z.object({
  content: z.string().min(1).describe('Markdown or plain text to render into the document'),
  path: z
    .string()
    .min(1)
    .describe('Absolute output path. The extension picks the format unless "format" is set.'),
  format: z
    .enum(['pdf', 'docx', 'html', 'md'])
    .optional()
    .describe('Output format. Optional — inferred from the path extension otherwise.'),
  title: z.string().optional().describe('Optional document title rendered as a top heading'),
});
type Args = z.infer<typeof argsSchema>;

const EXT_TO_FORMAT: Record<string, ExportFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.html': 'html',
  '.htm': 'html',
  '.md': 'md',
  '.markdown': 'md',
  '.txt': 'md',
};

/** Resolve the output format from an explicit value or the path extension. */
export function resolveExportFormat(path: string, explicit?: ExportFormat): ExportFormat | null {
  if (explicit) return explicit;
  return EXT_TO_FORMAT[extname(path).toLowerCase()] ?? null;
}

interface ExportResult {
  path: string;
  format: string;
  bytes: number;
}

/**
 * Generate a document (PDF / DOCX / HTML / Markdown) from Markdown or plain
 * text via the Python sidecar. Fully local. The inverse of parse_document.
 * Writes a file to disk, so it is gated behind a confirmation.
 */
export class ExportDocumentTool extends BaseTool<Args> {
  readonly name = 'export_document';
  readonly description =
    "Génère un document local (PDF, Word .docx, HTML ou Markdown) à partir de texte/Markdown, via le sidecar Python. 100% local. Le format est déduit de l'extension du chemin (ou forcé via 'format'). Écrit un fichier sur le disque.";
  readonly category = 'filesystem' as const;
  readonly riskLevel = 'medium' as const;
  readonly requiresConfirmation = true;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { content, path, format, title } = rawArgs;

    if (typeof content !== 'string' || content.length === 0)
      return this.fail('content est requis.');
    if (!path?.trim()) return this.fail('path est requis.');

    const resolved = resolveExportFormat(path, format);
    if (!resolved) {
      return this.fail(
        'Format indéterminé. Donne une extension .pdf/.docx/.html/.md ou précise format.',
      );
    }

    try {
      const result = (await OcrSidecarClient.get().call(
        'files.export_document',
        { content, path, format: resolved, ...(title ? { title } : {}) },
        120_000,
      )) as ExportResult;

      return this.ok({
        path: result.path,
        format: result.format,
        bytes: result.bytes,
        bytesFormatted: formatBytes(result.bytes),
      });
    } catch (err) {
      const msg = String(err);
      if (msg.includes('not installed') || msg.includes('No module named')) {
        return this.fail(
          `Dépendance Python manquante pour ${resolved}. Dans le sidecar : pip install markdown xhtml2pdf python-docx`,
        );
      }
      if (msg.includes('Permission denied') || msg.includes('Errno 13')) {
        return this.fail(`Écriture refusée (permission) : ${path}`);
      }
      return this.fail(`Génération échouée (${resolved}) : ${msg}`);
    }
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
