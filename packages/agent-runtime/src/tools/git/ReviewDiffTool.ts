import { execFile } from 'child_process';
import { promisify } from 'util';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

const exec = promisify(execFile);

interface ReviewDiffArgs {
  workdir?: string;
  base_branch?: string;
  staged_only?: boolean;
}

type Severity = 'critical' | 'warning' | 'info';

export interface DiffFinding {
  file: string;
  line: number; // new-file line number
  severity: Severity;
  rule: string;
  message: string;
  excerpt: string;
}

interface PatternRule {
  rule: string;
  severity: Severity;
  re: RegExp;
  message: string;
}

// Rules run against ADDED lines only (content after the leading '+').
const RULES: PatternRule[] = [
  {
    rule: 'secret',
    severity: 'critical',
    re: /(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token|client[_-]?secret)\s*[:=]\s*['"][^'"\s]{8,}['"]/i,
    message: 'Secret potentiellement codé en dur. Déplacer vers une variable d\'environnement.',
  },
  {
    rule: 'aws-key',
    severity: 'critical',
    re: /\bAKIA[0-9A-Z]{16}\b/,
    message: 'Clé d\'accès AWS détectée. À révoquer et sortir du code immédiatement.',
  },
  {
    rule: 'private-key',
    severity: 'critical',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    message: 'Clé privée commitée. À retirer et faire tourner.',
  },
  {
    rule: 'conflict-marker',
    severity: 'critical',
    re: /^(?:<{7}|={7}|>{7})(?:\s|$)/,
    message: 'Marqueur de conflit de merge laissé dans le code.',
  },
  {
    rule: 'eval',
    severity: 'warning',
    re: /\beval\s*\(|new Function\s*\(/,
    message: 'Usage de eval/new Function — risque d\'injection, à éviter.',
  },
  {
    rule: 'debugger',
    severity: 'warning',
    re: /\bdebugger\b/,
    message: 'Instruction debugger laissée dans le code.',
  },
  {
    rule: 'test-only',
    severity: 'warning',
    re: /\b(?:describe|it|test)\.only\s*\(|\bfdescribe\s*\(|\bfit\s*\(/,
    message: 'Test focalisé (.only/fit/fdescribe) — désactive les autres tests en CI.',
  },
  {
    rule: 'console-log',
    severity: 'info',
    re: /\bconsole\.(?:log|debug)\s*\(/,
    message: 'console.log/debug laissé — à retirer ou remplacer par un logger.',
  },
  {
    rule: 'ts-any',
    severity: 'info',
    re: /:\s*any\b|<any>|as any\b/,
    message: 'Type `any` — préférer `unknown` et narrowing (convention du projet).',
  },
  {
    rule: 'todo',
    severity: 'info',
    re: /\b(?:TODO|FIXME|XXX|HACK)\b/,
    message: 'TODO/FIXME ajouté — tracer en ticket plutôt que dans le code.',
  },
];

// ─── Diff scanner (pure, exported for tests) ───────────────────

export function scanDiff(diff: string): { findings: DiffFinding[]; filesChanged: string[]; added: number; removed: number } {
  const findings: DiffFinding[] = [];
  const filesChanged: string[] = [];
  let added = 0;
  let removed = 0;

  let currentFile = '';
  let newLineNo = 0;

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ ')) {
      // "+++ b/path/to/file" -> "path/to/file"
      const p = raw.slice(4).replace(/^b\//, '').trim();
      if (p !== '/dev/null') {
        currentFile = p;
        filesChanged.push(p);
      }
      continue;
    }
    if (raw.startsWith('--- ')) continue;
    if (raw.startsWith('diff --git') || raw.startsWith('index ') || raw.startsWith('rename ') || raw.startsWith('similarity ')) continue;

    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLineNo = parseInt(hunk[1] ?? '0', 10);
      continue;
    }

    if (raw.startsWith('+')) {
      added++;
      const content = raw.slice(1);
      for (const rule of RULES) {
        if (rule.re.test(content)) {
          findings.push({
            file: currentFile,
            line: newLineNo,
            severity: rule.severity,
            rule: rule.rule,
            message: rule.message,
            excerpt: content.trim().slice(0, 200),
          });
        }
      }
      newLineNo++;
    } else if (raw.startsWith('-')) {
      removed++;
      // removed lines don't advance the new-file counter
    } else {
      // context line
      newLineNo++;
    }
  }

  return { findings, filesChanged: [...new Set(filesChanged)], added, removed };
}

// ─── Tool ──────────────────────────────────────────────────────

export class ReviewDiffTool extends BaseTool {
  readonly name = 'review_diff';
  readonly description =
    "Joue le rôle de reviewer sur un git diff : repère secrets codés en dur, code de debug oublié, marqueurs de conflit, eval, tests focalisés, `any`, TODO. Compare au working tree (par défaut), au staged, ou à une branche de base.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.review_diff;

  async execute(args: unknown): Promise<ToolResult> {
    const { workdir, base_branch, staged_only = false } = args as ReviewDiffArgs;
    const cwd = workdir ?? process.cwd();

    const diffArgs =
      typeof base_branch === 'string' && base_branch.length > 0
        ? ['diff', `${base_branch}...HEAD`, '--unified=3']
        : staged_only
          ? ['diff', '--staged', '--unified=3']
          : ['diff', 'HEAD', '--unified=3'];

    try {
      const { stdout: diff } = await exec('git', diffArgs, { cwd, maxBuffer: 5_000_000 });

      if (diff.trim().length === 0) {
        return this.ok({
          findings: [],
          findingCount: 0,
          filesChanged: [],
          summary: 'Aucun changement à examiner.',
        });
      }

      const { findings, filesChanged, added, removed } = scanDiff(diff);

      const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
      findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file) || a.line - b.line);

      const counts = { critical: 0, warning: 0, info: 0 };
      for (const f of findings) counts[f.severity]++;

      return this.ok({
        scope:
          typeof base_branch === 'string' && base_branch.length > 0
            ? `vs ${base_branch}`
            : staged_only
              ? 'staged'
              : 'working tree',
        filesChanged,
        linesAdded: added,
        linesRemoved: removed,
        findingCount: findings.length,
        counts,
        findings,
        diffPreview: diff.slice(0, 3000),
        note:
          findings.length === 0
            ? 'Aucun pattern à risque détecté. Le LLM peut tout de même relire la logique pour la correction/lisibilité.'
            : 'Findings de pré-review (heuristiques) — le LLM doit confirmer et ajouter une review de logique sur les fichiers listés.',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not a git repository')) return this.fail('Ce répertoire n\'est pas un dépôt git.');
      if (/unknown revision|bad revision|ambiguous argument/i.test(msg)) {
        return this.fail(`Branche de base introuvable: "${base_branch}". Vérifie le nom.`);
      }
      return this.fail(`Erreur git: ${msg}`);
    }
  }
}
