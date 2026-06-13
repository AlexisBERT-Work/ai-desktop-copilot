import { readFile } from 'fs/promises';
import { join } from 'path';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface AuditEnvArgs {
  workdir?: string;
  env_file?: string;
  example_file?: string;
}

// ─── Parsing (pure, exported for tests) ────────────────────────

export function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key.length > 0) out[key] = value;
  }
  return out;
}

// Heuristic: does a value look like a real secret (vs a placeholder)?
export function looksLikeSecret(key: string, value: string): boolean {
  if (value.length < 8) return false;
  // Common placeholders are not secrets.
  if (/^(?:your[-_ ]?|changeme|xxx+|placeholder|todo|example|<.*>|\.\.\.)/i.test(value)) return false;
  if (/^(?:true|false|localhost|127\.0\.0\.1|development|production|test)$/i.test(value)) return false;

  const sensitiveKey = /(?:secret|token|key|password|passwd|pwd|api|auth|credential|private|cert|dsn|url)/i.test(key);
  const highEntropy = value.length >= 16 && /[A-Za-z]/.test(value) && /[0-9]/.test(value);
  const knownPrefix = /^(?:sk-|pk_|ghp_|gho_|xox[baprs]-|AKIA|AIza|eyJ)/.test(value);
  return knownPrefix || (sensitiveKey && value.length >= 8) || highEntropy;
}

// ─── Tool ──────────────────────────────────────────────────────

export class AuditEnvTool extends BaseTool {
  readonly name = 'audit_env';
  readonly description =
    "Compare un fichier .env à son .env.example : clés non documentées, clés manquantes (déclarées mais non définies), valeurs vides, valeurs ressemblant à de vrais secrets, et alerte si .env n'est pas dans .gitignore. Lecture seule, ne révèle jamais les valeurs secrètes.";
  readonly category = 'system' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.audit_env;

  async execute(args: unknown): Promise<ToolResult> {
    const { workdir, env_file = '.env', example_file = '.env.example' } = args as AuditEnvArgs;
    const cwd = workdir ?? process.cwd();

    let envContent: string | null = null;
    let exampleContent: string | null = null;
    try { envContent = await readFile(join(cwd, env_file), 'utf-8'); } catch { /* missing */ }
    try { exampleContent = await readFile(join(cwd, example_file), 'utf-8'); } catch { /* missing */ }

    if (envContent === null && exampleContent === null) {
      return this.fail(`Ni ${env_file} ni ${example_file} trouvés dans ${cwd}.`);
    }

    const env = envContent !== null ? parseDotenv(envContent) : {};
    const example = exampleContent !== null ? parseDotenv(exampleContent) : {};
    const envKeys = new Set(Object.keys(env));
    const exampleKeys = new Set(Object.keys(example));

    const missingFromEnv = [...exampleKeys].filter((k) => !envKeys.has(k));       // declared but unset
    const undocumented = [...envKeys].filter((k) => !exampleKeys.has(k));          // set but not in template
    const emptyValues = [...envKeys].filter((k) => (env[k] ?? '').length === 0);
    const secretKeys = [...envKeys].filter((k) => looksLikeSecret(k, env[k] ?? ''));

    // Is .env gitignored?
    let gitignored: boolean | null = null;
    if (envContent !== null) {
      try {
        const gi = await readFile(join(cwd, '.gitignore'), 'utf-8');
        gitignored = gi.split('\n').map((l) => l.trim()).some((l) => l === env_file || l === `${env_file}` || l === '.env' || l === '*.env');
      } catch {
        gitignored = false;
      }
    }

    return this.ok({
      envFile: envContent !== null ? env_file : `${env_file} (absent)`,
      exampleFile: exampleContent !== null ? example_file : `${example_file} (absent)`,
      definedKeys: envKeys.size,
      missingFromEnv,
      undocumented,
      emptyValues,
      secretCount: secretKeys.length,
      secretKeys, // key names only — values never returned
      gitignored,
      warnings: [
        ...(gitignored === false ? [`⚠ ${env_file} n'est pas ignoré par git — risque de fuite de secrets.`] : []),
        ...(missingFromEnv.length > 0 ? [`${missingFromEnv.length} clé(s) déclarée(s) dans ${example_file} mais absente(s) de ${env_file}.`] : []),
        ...(undocumented.length > 0 ? [`${undocumented.length} clé(s) dans ${env_file} non documentée(s) dans ${example_file}.`] : []),
      ],
    });
  }
}
