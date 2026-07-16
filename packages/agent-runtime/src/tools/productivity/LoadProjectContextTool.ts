import { readdir, readFile } from 'fs/promises';
import { join, basename } from 'path';
import type { ToolResult } from '@catdesk/shared-types';
import { TOOL_SCHEMAS } from '@catdesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface LoadProjectContextArgs {
  workdir?: string;
}

// Detect stack/package-manager signals from a set of present filenames (pure).
export function detectStack(files: Set<string>): {
  stack: string[];
  packageManager: string | null;
} {
  const stack: string[] = [];
  if (files.has('package.json')) stack.push('Node.js/JS');
  if (files.has('tsconfig.json')) stack.push('TypeScript');
  if (files.has('Cargo.toml')) stack.push('Rust');
  if (files.has('requirements.txt') || files.has('pyproject.toml') || files.has('setup.py'))
    stack.push('Python');
  if (files.has('go.mod')) stack.push('Go');
  if (files.has('Dockerfile') || files.has('docker-compose.yml')) stack.push('Docker');
  if (files.has('tauri.conf.json')) stack.push('Tauri');

  let pm: string | null = null;
  if (files.has('pnpm-lock.yaml')) pm = 'pnpm';
  else if (files.has('yarn.lock')) pm = 'yarn';
  else if (files.has('package-lock.json')) pm = 'npm';
  else if (files.has('bun.lockb')) pm = 'bun';
  return { stack, packageManager: pm };
}

// Pull a short summary (title + first heading paragraph) out of a README.
export function summarizeReadme(content: string): string {
  const lines = content.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (t.length === 0) continue;
    if (t.startsWith('![') || t.startsWith('<') || /^\[!\[/.test(t)) continue; // badges/html
    out.push(t.replace(/^#+\s*/, ''));
    if (out.join(' ').length > 280) break;
  }
  return out.join(' ').slice(0, 300);
}

export class LoadProjectContextTool extends BaseTool {
  readonly name = 'load_project_context';
  readonly description =
    "Profile un projet à l'ouverture : stack détectée, gestionnaire de paquets, scripts disponibles, dépendances clés, structure des dossiers, points d'entrée, et résumé du README. À stocker en mémoire de projet pour charger le contexte au démarrage.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.load_project_context;

  async execute(args: unknown): Promise<ToolResult> {
    const { workdir } = args as LoadProjectContextArgs;
    const root = workdir ?? process.cwd();

    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      return this.fail(`Dossier introuvable: ${root}`);
    }

    const topLevelFiles = new Set(entries.filter(e => e.isFile()).map(e => e.name));
    const topLevelDirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map(e => e.name);

    const { stack, packageManager } = detectStack(topLevelFiles);

    // package.json details
    let scripts: string[] = [];
    let keyDeps: string[] = [];
    const entryPoints: string[] = [];
    let projectName = basename(root);
    if (topLevelFiles.has('package.json')) {
      try {
        const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf-8')) as {
          name?: string;
          scripts?: Record<string, string>;
          main?: string;
          bin?: unknown;
          dependencies?: Record<string, string>;
        };
        if (pkg.name) projectName = pkg.name;
        scripts = Object.keys(pkg.scripts ?? {});
        keyDeps = Object.keys(pkg.dependencies ?? {}).slice(0, 15);
        if (pkg.main) entryPoints.push(pkg.main);
        if (pkg.bin && typeof pkg.bin === 'object')
          entryPoints.push(...Object.values(pkg.bin as Record<string, string>));
      } catch {
        /* malformed */
      }
    }

    // README summary
    let readme: string | null = null;
    for (const name of ['README.md', 'readme.md', 'README.MD', 'Readme.md']) {
      if (topLevelFiles.has(name)) {
        try {
          readme = summarizeReadme(await readFile(join(root, name), 'utf-8'));
        } catch {
          /* skip */
        }
        break;
      }
    }

    const docs = ['CLAUDE.md', 'CONTRIBUTING.md', 'AGENTS.md', 'ARCHITECTURE.md'].filter(d =>
      topLevelFiles.has(d),
    );

    return this.ok({
      project: projectName,
      root,
      stack,
      packageManager,
      topLevelDirs,
      scripts,
      keyDependencies: keyDeps,
      entryPoints,
      docs,
      readmeSummary: readme,
      howToRun: scripts.includes('dev')
        ? `${packageManager ?? 'npm'} run dev`
        : scripts.includes('start')
          ? `${packageManager ?? 'npm'} start`
          : null,
      note: 'Contexte projet — à mémoriser pour les prochaines sessions (mémoire de projet).',
    });
  }
}
