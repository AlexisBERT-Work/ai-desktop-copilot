import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFile } from 'fs/promises';
import { join, isAbsolute } from 'path';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

const exec = promisify(execFile);

interface ResolveConflictsArgs {
  workdir?: string;
  path?: string;
}

export interface ConflictHunk {
  startLine: number;   // 1-based line of the <<<<<<< marker
  oursLabel: string;
  theirsLabel: string;
  ours: string;
  theirs: string;
  base: string | null; // present only for diff3-style conflicts
}

// Parse conflict markers out of a file's content.
export function parseConflicts(content: string): ConflictHunk[] {
  const lines = content.split('\n');
  const hunks: ConflictHunk[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.startsWith('<<<<<<<')) { i++; continue; }

    const startLine = i + 1;
    const oursLabel = line.slice(7).trim();
    const ours: string[] = [];
    const base: string[] = [];
    const theirs: string[] = [];
    let theirsLabel = '';
    let phase: 'ours' | 'base' | 'theirs' = 'ours';
    let hasBase = false;
    let closed = false;

    i++;
    for (; i < lines.length; i++) {
      const l = lines[i] ?? '';
      if (l.startsWith('|||||||')) { phase = 'base'; hasBase = true; continue; }
      if (l.startsWith('=======')) { phase = 'theirs'; continue; }
      if (l.startsWith('>>>>>>>')) { theirsLabel = l.slice(7).trim(); closed = true; i++; break; }
      if (phase === 'ours') ours.push(l);
      else if (phase === 'base') base.push(l);
      else theirs.push(l);
    }

    if (closed) {
      hunks.push({
        startLine,
        oursLabel: oursLabel || 'HEAD',
        theirsLabel: theirsLabel || 'incoming',
        ours: ours.join('\n'),
        theirs: theirs.join('\n'),
        base: hasBase ? base.join('\n') : null,
      });
    }
  }

  return hunks;
}

export class ResolveConflictsTool extends BaseTool {
  readonly name = 'resolve_conflicts';
  readonly description =
    "Détecte les fichiers en conflit de merge et décompose chaque conflit en blocs ours/theirs (et base si diff3). Fournit au LLM le contexte structuré pour proposer une résolution. N'écrit rien : lecture seule.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.resolve_conflicts;

  async execute(args: unknown): Promise<ToolResult> {
    const { workdir, path } = args as ResolveConflictsArgs;
    const cwd = workdir ?? process.cwd();

    let files: string[];
    try {
      if (typeof path === 'string' && path.length > 0) {
        files = [path];
      } else {
        // List unmerged paths.
        const { stdout } = await exec('git', ['diff', '--name-only', '--diff-filter=U'], { cwd });
        files = stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not a git repository')) return this.fail('Ce répertoire n\'est pas un dépôt git.');
      return this.fail(`Erreur git: ${msg}`);
    }

    if (files.length === 0) {
      return this.ok({ conflictedFiles: 0, files: [], summary: 'Aucun conflit de merge en cours.' });
    }

    const results = [];
    let totalHunks = 0;
    for (const rel of files) {
      const abs = isAbsolute(rel) ? rel : join(cwd, rel);
      let content: string;
      try {
        content = await readFile(abs, 'utf-8');
      } catch (err) {
        results.push({ file: rel, error: `Lecture impossible: ${err instanceof Error ? err.message : String(err)}` });
        continue;
      }
      const hunks = parseConflicts(content);
      totalHunks += hunks.length;
      results.push({
        file: rel,
        conflictCount: hunks.length,
        diff3: hunks.some((h) => h.base !== null),
        hunks,
      });
    }

    return this.ok({
      conflictedFiles: files.length,
      totalConflicts: totalHunks,
      files: results,
      note:
        'Lecture seule. Pour chaque hunk, le LLM doit proposer le contenu fusionné (souvent garder les deux intentions), puis écrire via write_file et retirer les marqueurs.',
    });
  }
}
