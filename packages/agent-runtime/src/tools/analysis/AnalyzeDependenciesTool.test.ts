import { describe, it, expect } from 'vitest';
import { parsePackageJson, parseCargoToml, parseRequirements } from './AnalyzeDependenciesTool';

describe('parsePackageJson', () => {
  it('sépare prod et dev et marque les flags', () => {
    const deps = parsePackageJson(
      JSON.stringify({
        dependencies: { react: '^19.0.0', leftpad: '*', exp: '^0.3.0' },
        devDependencies: { vitest: '~2.1.9', beta: '1.0.0-beta.1' },
      }),
    );
    const byName = Object.fromEntries(deps.map((d) => [d.name, d]));
    expect(byName['react']?.dev).toBe(false);
    expect(byName['vitest']?.dev).toBe(true);
    expect(byName['leftpad']?.flags).toContain('wildcard');
    expect(byName['exp']?.flags).toContain('pre-1.0');
    expect(byName['beta']?.flags).toContain('prerelease');
    expect(byName['react']?.flags).toHaveLength(0);
  });

  it('détecte une source non-registry', () => {
    const deps = parsePackageJson(JSON.stringify({ dependencies: { lib: 'github:foo/bar' } }));
    expect(deps[0]?.flags).toContain('non-registry');
  });
});

describe('parseCargoToml', () => {
  it('parse les dépendances simples et detaillées', () => {
    const toml = `[package]
name = "x"

[dependencies]
serde = "1.0"
tokio = { version = "0.2", features = ["full"] }
local = { path = "../local" }

[dev-dependencies]
proptest = "1.4"
`;
    const deps = parseCargoToml(toml);
    const byName = Object.fromEntries(deps.map((d) => [d.name, d]));
    expect(byName['serde']?.version).toBe('1.0');
    expect(byName['tokio']?.version).toBe('0.2');
    expect(byName['tokio']?.flags).toContain('pre-1.0');
    expect(byName['local']?.flags).toContain('non-registry');
    expect(byName['proptest']?.dev).toBe(true);
    // [package] section keys must not leak in as deps
    expect(byName['name']).toBeUndefined();
  });
});

describe('parseRequirements', () => {
  it('gère épinglage, floating et unpinned', () => {
    const reqs = `# comment
django==4.2.1
requests>=2.0
flask
numpy~=1.26
-r other.txt
pkg[extra]==1.0.0
`;
    const deps = parseRequirements(reqs);
    const byName = Object.fromEntries(deps.map((d) => [d.name, d]));
    expect(byName['django']?.version).toBe('==4.2.1');
    expect(byName['requests']?.flags).toContain('floating');
    expect(byName['flask']?.flags).toContain('unpinned');
    expect(byName['pkg']?.version).toBe('==1.0.0');
    // pip flag lines are skipped
    expect(deps.find((d) => d.name.startsWith('-'))).toBeUndefined();
  });
});
