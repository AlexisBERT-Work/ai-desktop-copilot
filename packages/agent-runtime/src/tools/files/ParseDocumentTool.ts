import { z } from 'zod';
import type { ToolResult } from '@catdesk/shared-types';
import { extname } from 'path';
import { BaseTool } from '../base/BaseTool';
import { jsonSchemaFrom } from '../base/zodSchema';
import { OcrSidecarClient } from '../../lib/ocrSidecar';

const argsSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      'Absolute path to a local .pdf, .docx or .csv file. The format is detected from the extension.',
    ),
  max_pages: z.number().default(50).describe('PDF only: maximum number of pages to extract'),
  max_rows: z.number().default(1000).describe('CSV only: maximum number of rows to parse'),
});
type Args = z.infer<typeof argsSchema>;

export type DocumentFormat = 'pdf' | 'docx' | 'csv';

const EXT_TO_FORMAT: Record<string, DocumentFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.csv': 'csv',
};

const FORMAT_TO_METHOD: Record<DocumentFormat, string> = {
  pdf: 'files.parse_pdf',
  docx: 'files.parse_docx',
  csv: 'files.parse_csv',
};

const DEP_HINT: Record<DocumentFormat, string> = {
  pdf: 'pip install pypdf',
  docx: 'pip install python-docx',
  csv: 'pip install chardet',
};

/** Map a file path to a supported document format by extension, or null. */
export function detectFormat(path: string): DocumentFormat | null {
  return EXT_TO_FORMAT[extname(path).toLowerCase()] ?? null;
}

/**
 * Extract text + metadata from a local document (PDF / Word .docx / CSV) by
 * delegating to the Python OCR sidecar, which already exposes `files.parse_*`
 * JSON-RPC methods. Fully local — nothing leaves the machine. The format is
 * picked from the file extension.
 */
export class ParseDocumentTool extends BaseTool<Args> {
  readonly name = 'parse_document';
  readonly description =
    "Extrait le texte et les métadonnées d'un document local (PDF, Word .docx ou CSV) via le sidecar Python. 100% local, aucune donnée envoyée dans le cloud. Le format est détecté par l'extension du fichier.";
  readonly category = 'filesystem' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { path, max_pages = 50, max_rows = 1000 } = rawArgs;

    if (!path?.trim()) return this.fail('path est requis');

    const format = detectFormat(path);
    if (!format) {
      return this.fail('Format non supporté. Extensions acceptées : .pdf, .docx, .csv');
    }

    const params =
      format === 'pdf'
        ? { path, maxPages: max_pages }
        : format === 'csv'
          ? { path, maxRows: max_rows }
          : { path };

    try {
      const result = (await OcrSidecarClient.get().call(
        FORMAT_TO_METHOD[format],
        params,
        120_000,
      )) as Record<string, unknown>;

      return this.ok({ format, ...result });
    } catch (err) {
      const msg = String(err);
      if (
        msg.includes('not installed') ||
        msg.includes('No module named') ||
        msg.includes('pypdf') ||
        msg.includes('python-docx')
      ) {
        return this.fail(
          `Dépendance Python manquante pour ${format}. Dans le sidecar : ${DEP_HINT[format]}`,
        );
      }
      if (msg.includes('No such file') || msg.includes('Errno 2') || msg.includes('cannot find')) {
        return this.fail(`Fichier introuvable : ${path}`);
      }
      return this.fail(`Extraction échouée (${format}) : ${msg}`);
    }
  }
}
