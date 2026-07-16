import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseDotenv, looksLikeSecret, AuditEnvTool } from './AuditEnvTool';

describe('parseDotenv', () => {
  it('parse les paires, ignore commentaires et enlève les guillemets', () => {
    const env = parseDotenv(`# comment
FOO=bar
export BAZ="quoted value"
EMPTY=
QUX='single'
nonsense line
`);
    expect(env['FOO']).toBe('bar');
    expect(env['BAZ']).toBe('quoted value');
    expect(env['EMPTY']).toBe('');
    expect(env['QUX']).toBe('single');
    expect(Object.keys(env)).not.toContain('nonsense line');
  });
});

describe('looksLikeSecret', () => {
  it('détecte les vrais secrets', () => {
    expect(looksLikeSecret('API_KEY', 'sk-abc123def456ghi789')).toBe(true);
    expect(looksLikeSecret('GITHUB_TOKEN', 'ghp_1234567890abcdef')).toBe(true);
    expect(looksLikeSecret('DB_PASSWORD', 'sup3rSecretValue99')).toBe(true);
  });

  it('ignore les placeholders et valeurs banales', () => {
    expect(looksLikeSecret('API_KEY', 'your-api-key-here')).toBe(false);
    expect(looksLikeSecret('NODE_ENV', 'production')).toBe(false);
    expect(looksLikeSecret('DEBUG', 'true')).toBe(false);
    expect(looksLikeSecret('PORT', '3000')).toBe(false);
  });
});

describe('AuditEnvTool', () => {
  const tool = new AuditEnvTool();
  let dir = '';

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ndenv-'));
    await writeFile(join(dir, '.env'), 'API_KEY=sk-realsecret1234567\nUNDOCUMENTED=x\nEMPTY=\n');
    await writeFile(join(dir, '.env.example'), 'API_KEY=your-key-here\nMISSING_ONE=\n');
    await writeFile(join(dir, '.gitignore'), 'node_modules\n.env\n');
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('compare .env et .env.example', async () => {
    const res: any = await tool.run({ workdir: dir });
    expect(res.success).toBe(true);
    const d = res.data;
    expect(d.missingFromEnv).toContain('MISSING_ONE');
    expect(d.undocumented).toContain('UNDOCUMENTED');
    expect(d.emptyValues).toContain('EMPTY');
    expect(d.secretKeys).toContain('API_KEY');
    expect(d.gitignored).toBe(true);
    // valeurs jamais renvoyées
    expect(JSON.stringify(d)).not.toContain('sk-realsecret');
  });

  it('échoue si aucun fichier', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'ndenv-empty-'));
    const res = await tool.run({ workdir: empty });
    expect(res.success).toBe(false);
    await rm(empty, { recursive: true, force: true });
  });
});
