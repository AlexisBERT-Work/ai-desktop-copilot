import { readFile, access } from 'fs/promises';
import { join, basename } from 'path';
import type { ToolResult } from '@neurodesk/shared-types';
import { TOOL_SCHEMAS } from '@neurodesk/shared-types';
import { BaseTool } from '../base/BaseTool';

interface AnalyzeDependenciesArgs {
  workdir?: string;
  manifest?: string;
}

type Ecosystem = 'npm' | 'cargo' | 'pip';

export interface Dependency {
  name: string;
  version: string;
  dev: boolean;
  flags: string[];
}

// ─── Version-spec flagging (shared across ecosystems) ──────────

function flagVersion(version: string): string[] {
  const flags: string[] = [];
  const v = version.trim();

  if (v === '' || v === '*' || /^latest$/i.test(v) || /^x(\.x)*$/i.test(v)) {
    flags.push('wildcard'); // unbounded — non-reproducible builds
  }
  if (/^(?:git\+|git:|path:|https?:\/\/|file:|github:|link:|workspace:)/i.test(v) || v.includes('://')) {
    flags.push('non-registry');
  }
  // 0.x — pre-1.0, semver allows breaking changes on minor bumps
  if (/^[\^~]?0\./.test(v)) {
    flags.push('pre-1.0');
  }
  if (/-(?:alpha|beta|rc|next|canary|dev)/i.test(v)) {
    flags.push('prerelease');
  }
  return flags;
}

// ─── Parsers (pure, exported for tests) ────────────────────────

export function parsePackageJson(content: string): Dependency[] {
  const pkg = JSON.parse(content) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const out: Dependency[] = [];
  const add = (deps: Record<string, string> | undefined, dev: boolean) => {
    for (const [name, version] of Object.entries(deps ?? {})) {
      out.push({ name, version, dev, flags: flagVersion(version) });
    }
  };
  add(pkg.dependencies, false);
  add(pkg.optionalDependencies, false);
  add(pkg.peerDependencies, false);
  add(pkg.devDependencies, true);
  return out;
}

export function parseCargoToml(content: string): Dependency[] {
  const out: Dependency[] = [];
  let section: 'dependencies' | 'dev-dependencies' | 'build-dependencies' | null = null;

  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line.length === 0) continue;

    const sec = line.match(/^\[(.+?)\]$/);
    if (sec) {
      const name = sec[1] ?? '';
      if (name === 'dependencies' || name === 'dev-dependencies' || name === 'build-dependencies') {
        section = name;
      } else if (name.startsWith('dependencies.')) {
        section = 'dependencies';
      } else {
        section = null;
      }
      continue;
    }
    if (section === null) continue;

    // name = "1.2.3"  OR  name = { version = "1.2.3", features = [...] }  OR  name = { git = "..." }
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (kv === null) continue;
    const name = kv[1] ?? '';
    const rhs = (kv[2] ?? '').trim();

    let version = '';
    if (rhs.startsWith('{')) {
      const vm = rhs.match(/version\s*=\s*"([^"]*)"/);
      const gm = rhs.match(/\b(git|path)\s*=\s*"([^"]*)"/);
      version = vm?.[1] ?? (gm ? `${gm[1]}:${gm[2]}` : '');
    } else {
      version = rhs.replace(/^"|"$/g, '');
    }

    out.push({
      name,
      version,
      dev: section === 'dev-dependencies' || section === 'build-dependencies',
      flags: flagVersion(version),
    });
  }
  return out;
}

export function parseRequirements(content: string): Dependency[] {
  const out: Dependency[] = [];
  for (const rawLine of content.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line.length === 0 || line.startsWith('-')) continue; // skip pip flags like -r, --hash

    // package[extra]==1.2.3 / package>=1.0 / package~=1.0 / package (unpinned)
    const m = line.match(/^([A-Za-z0-9._-]+)\s*(?:\[[^\]]*\])?\s*(.*)$/);
    if (m === null) continue;
    const name = m[1] ?? '';
    const spec = (m[2] ?? '').trim();

    const flags = flagVersion(spec.replace(/^[=~><!]+/, ''));
    if (spec === '') flags.push('unpinned');
    else if (/^[><]/.test(spec) && !spec.includes('==')) flags.push('floating');

    out.push({ name, version: spec || '*', dev: false, flags });
  }
  return out;
}

// ─── Tool ──────────────────────────────────────────────────────

const MANIFESTS: Array<{ file: string; eco: Ecosystem; check: string }> = [
  { file: 'package.json', eco: 'npm', check: 'npm outdated' },
  { file: 'Cargo.toml', eco: 'cargo', check: 'cargo outdated' },
  { file: 'requirements.txt', eco: 'pip', check: 'pip list --outdated' },
];

async function fileExists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

export class AnalyzeDependenciesTool extends BaseTool {
  readonly name = 'analyze_dependencies';
  readonly description =
    "Parse les manifestes de dépendances (package.json, Cargo.toml, requirements.txt) et signale les specs de version à risque : wildcard, pré-1.0, prerelease, source non-registry, non épinglé. Suggère la commande pour vérifier les versions obsolètes en live.";
  readonly category = 'analysis' as const;
  readonly riskLevel = 'low' as const;
  readonly requiresConfirmation = false;
  readonly schema = TOOL_SCHEMAS.analyze_dependencies;

  async execute(args: unknown): Promise<ToolResult> {
    const { workdir, manifest } = args as AnalyzeDependenciesArgs;
    const cwd = workdir ?? process.cwd();

    // Resolve which manifest(s) to analyze.
    let targets: Array<{ path: string; eco: Ecosystem; check: string }> = [];
    if (typeof manifest === 'string' && manifest.length > 0) {
      const known = MANIFESTS.find((m) => basename(manifest) === m.file);
      if (known === undefined) {
        return this.fail(`Manifeste non supporté: ${manifest}. Supporté: package.json, Cargo.toml, requirements.txt`);
      }
      targets = [{ path: manifest, eco: known.eco, check: known.check }];
    } else {
      for (const m of MANIFESTS) {
        const p = join(cwd, m.file);
        if (await fileExists(p)) targets.push({ path: p, eco: m.eco, check: m.check });
      }
      if (targets.length === 0) {
        return this.fail(`Aucun manifeste trouvé dans ${cwd} (package.json / Cargo.toml / requirements.txt).`);
      }
    }

    const manifests = [];
    for (const t of targets) {
      let content: string;
      try {
        content = await readFile(t.path, 'utf-8');
      } catch (err) {
        return this.fail(`Impossible de lire ${t.path}: ${err instanceof Error ? err.message : String(err)}`);
      }

      let deps: Dependency[];
      try {
        deps = t.eco === 'npm' ? parsePackageJson(content)
          : t.eco === 'cargo' ? parseCargoToml(content)
          : parseRequirements(content);
      } catch (err) {
        return this.fail(`Erreur de parsing ${basename(t.path)}: ${err instanceof Error ? err.message : String(err)}`);
      }

      const flagged = deps.filter((d) => d.flags.length > 0);
      const byFlag: Record<string, number> = {};
      for (const d of flagged) for (const f of d.flags) byFlag[f] = (byFlag[f] ?? 0) + 1;

      manifests.push({
        manifest: basename(t.path),
        ecosystem: t.eco,
        total: deps.length,
        prod: deps.filter((d) => !d.dev).length,
        dev: deps.filter((d) => d.dev).length,
        flaggedCount: flagged.length,
        byFlag,
        flagged: flagged.map((d) => ({ name: d.name, version: d.version, dev: d.dev, flags: d.flags })),
        liveCheckCommand: t.check,
      });
    }

    return this.ok({
      manifests,
      note:
        'Analyse statique des specs de version. Pour les vraies versions obsolètes/vulnérables, lance la commande `liveCheckCommand` (ex. `npm outdated`, `npm audit`, `cargo audit`, `pip-audit`) via run_command.',
    });
  }
}
