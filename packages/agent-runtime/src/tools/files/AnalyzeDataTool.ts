import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { extname } from 'path';
import { BaseTool } from '../base/BaseTool';
import { OcrSidecarClient } from '../../lib/ocrSidecar';

export type DataOperation = 'profile' | 'aggregate';
export type AggFunc = 'sum' | 'mean' | 'median' | 'min' | 'max' | 'count' | 'std' | 'nunique';

interface AnalyzeDataArgs {
  path: string;
  operation?: DataOperation;
  group_by?: string[];
  value_column?: string;
  agg?: AggFunc;
  sheet?: string;
  max_rows?: number;
}

const SUPPORTED_EXT = new Set(['.csv', '.xlsx', '.xlsm', '.xls']);

/** True when the path points at a tabular file pandas can load. */
export function isSupportedDataFile(path: string): boolean {
  return SUPPORTED_EXT.has(extname(path).toLowerCase());
}

/** Validate args before touching the sidecar. Pure — unit-testable. */
export function validateAnalyzeArgs(
  args: AnalyzeDataArgs,
): { ok: true } | { ok: false; error: string } {
  if (!args.path?.trim()) return { ok: false, error: 'path est requis' };
  if (!isSupportedDataFile(args.path)) {
    return { ok: false, error: 'Format non supporté. Extensions acceptées : .csv, .xlsx, .xls' };
  }
  const op = args.operation ?? 'profile';
  if (op !== 'profile' && op !== 'aggregate') {
    return { ok: false, error: `operation inconnue : ${op} (attendu 'profile' ou 'aggregate')` };
  }
  if (op === 'aggregate') {
    if (!args.group_by || args.group_by.length === 0) {
      return { ok: false, error: 'aggregate nécessite group_by (au moins une colonne)' };
    }
    const agg = args.agg ?? 'sum';
    if (agg !== 'count' && !args.value_column?.trim()) {
      return { ok: false, error: "aggregate nécessite value_column (sauf si agg='count')" };
    }
  }
  return { ok: true };
}

/**
 * Analyze a local tabular file (CSV / Excel) via the Python sidecar's pandas
 * backend. Fully local. Declarative — no arbitrary code/query execution:
 * - profile (default): structure, dtypes, null counts, numeric stats, top
 *   categorical values and a row preview.
 * - aggregate: group_by one or more columns and apply an aggregation
 *   (sum/mean/median/min/max/count/std/nunique) to a value column.
 */
export class AnalyzeDataTool extends BaseTool {
  readonly name = 'analyze_data';
  readonly description =
    "Analyse un tableau local (CSV ou Excel) via pandas dans le sidecar Python. 100% local. operation='profile' (structure + stats + aperçu) ou 'aggregate' (group_by + somme/moyenne/min/max/count…). Aucune exécution de code arbitraire.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.analyze_data;

  async execute(rawArgs: unknown): Promise<ToolResult> {
    const args = rawArgs as AnalyzeDataArgs;

    const valid = validateAnalyzeArgs(args);
    if (!valid.ok) return this.fail(valid.error);

    const params: Record<string, unknown> = {
      path: args.path,
      operation: args.operation ?? 'profile',
      maxRows: args.max_rows ?? 100_000,
    };
    if (args.sheet) params['sheet'] = args.sheet;
    if (args.group_by) params['groupBy'] = args.group_by;
    if (args.value_column) params['valueColumn'] = args.value_column;
    if (args.agg) params['agg'] = args.agg;

    try {
      const result = (await OcrSidecarClient.get().call(
        'files.analyze_data',
        params,
        120_000,
      )) as Record<string, unknown>;

      return this.ok(result);
    } catch (err) {
      const msg = String(err);
      if (msg.includes('not installed') || msg.includes('No module named')) {
        return this.fail('Dépendance Python manquante. Dans le sidecar : pip install pandas openpyxl');
      }
      if (msg.includes('No such file') || msg.includes('Errno 2') || msg.includes('cannot find')) {
        return this.fail(`Fichier introuvable : ${args.path}`);
      }
      // Sidecar surfaces helpful column-not-found / bad-arg messages verbatim.
      return this.fail(`Analyse échouée : ${msg}`);
    }
  }
}
