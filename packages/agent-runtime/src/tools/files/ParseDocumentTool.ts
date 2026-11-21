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
    .describe('Chemin absolu : .pdf, .docx, .pptx, .xlsx, .odt, .ods, .odp ou .csv'),
  max_pages: z.number().default(50).describe('PDF : pages lues au plus'),
  max_rows: z.number().default(1000).describe('CSV, tableurs : lignes lues au plus par feuille'),
});
type Args = z.infer<typeof argsSchema>;

export type DocumentFormat = 'pdf' | 'docx' | 'csv' | 'pptx' | 'xlsx' | 'odf';

const EXT_TO_FORMAT: Record<string, DocumentFormat> = {
  '.pdf': 'pdf',
  '.docx': 'docx',
  '.csv': 'csv',
  '.pptx': 'pptx',
  '.xlsx': 'xlsx',
  '.xlsm': 'xlsx',
  '.odt': 'odf',
  '.ods': 'odf',
  '.odp': 'odf',
};

const FORMAT_TO_METHOD: Record<DocumentFormat, string> = {
  pdf: 'files.parse_pdf',
  docx: 'files.parse_docx',
  csv: 'files.parse_csv',
  pptx: 'files.parse_pptx',
  xlsx: 'files.parse_xlsx',
  odf: 'files.parse_odf',
};

/** PPTX et ODF n'ont besoin que de la bibliothèque standard de Python. */
const DEP_HINT: Partial<Record<DocumentFormat, string>> = {
  pdf: 'pip install pypdf',
  docx: 'pip install python-docx',
  csv: 'pip install chardet',
  xlsx: 'pip install openpyxl',
};

/**
 * Texte rendu au plus pour PowerPoint, Excel et OpenDocument : l'extraction
 * s'ARRÊTE à ce plafond (veille du 17/11), ~4 000 tokens relus par le modèle.
 */
const OFFICE_MAX_CHARS = 12_000;
/** Lignes par feuille de tableur : `max_rows` vaut 1 000 pour un CSV, c'est trop ici. */
const OFFICE_MAX_ROWS = 200;

function sidecarParams(
  format: DocumentFormat,
  path: string,
  maxPages: number,
  maxRows: number,
): Record<string, unknown> {
  switch (format) {
    case 'pdf':
      return { path, maxPages };
    case 'csv':
      return { path, maxRows };
    case 'xlsx':
    case 'odf':
      return { path, maxChars: OFFICE_MAX_CHARS, maxRows: Math.min(maxRows, OFFICE_MAX_ROWS) };
    case 'pptx':
      return { path, maxChars: OFFICE_MAX_CHARS };
    case 'docx':
      return { path };
  }
}

/** Map a file path to a supported document format by extension, or null. */
export function detectFormat(path: string): DocumentFormat | null {
  return EXT_TO_FORMAT[extname(path).toLowerCase()] ?? null;
}

/**
 * Extract text + metadata from a local document by delegating to the Python
 * sidecar (`files.parse_*`). Fully local — nothing leaves the machine. The
 * format is picked from the file extension. PowerPoint, Excel and
 * OpenDocument (Plan E, 2026-11-21) : `files/office_parser.py`, one marker
 * per slide or sheet (« ## Diapo 3 ») so the model can cite.
 */
export class ParseDocumentTool extends BaseTool<Args> {
  readonly name = 'parse_document';
  readonly description =
    "Extrait le texte et les métadonnées d'un document local : PDF, Word, PowerPoint, Excel, OpenDocument (ODT, ODS, ODP) ou CSV. 100 % local.";
  readonly category = 'filesystem' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  override readonly argsSchema = argsSchema;
  override readonly pathArgs = ['path'] as const;
  readonly schema = jsonSchemaFrom(argsSchema);

  async execute(rawArgs: Args): Promise<ToolResult> {
    const { path, max_pages = 50, max_rows = 1000 } = rawArgs;

    if (!path?.trim()) return this.fail('path est requis');

    const format = detectFormat(path);
    if (!format) {
      return this.fail(
        `Format non supporté. Extensions acceptées : ${Object.keys(EXT_TO_FORMAT).join(', ')}`,
      );
    }

    const params = sidecarParams(format, path, max_pages, max_rows);

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
        const hint = DEP_HINT[format];
        return this.fail(
          `Dépendance Python manquante pour ${format}.${hint === undefined ? '' : ` Dans le sidecar : ${hint}`}`,
        );
      }
      if (msg.includes('No such file') || msg.includes('Errno 2') || msg.includes('cannot find')) {
        return this.fail(`Fichier introuvable : ${path}`);
      }
      return this.fail(`Extraction échouée (${format}) : ${msg}`);
    }
  }
}
