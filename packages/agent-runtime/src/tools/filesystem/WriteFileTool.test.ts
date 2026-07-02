import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { WriteFileTool, isBlockedPath } from './WriteFileTool';

const tool = new WriteFileTool();
const dirs: string[] = [];

async function tmpDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'catdesk-wf-'));
  dirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })));
});

describe('isBlockedPath', () => {
  it('bloque les répertoires système Windows', () => {
    expect(isBlockedPath('C:\\Windows\\System32\\evil.dll')).toBe(true);
    expect(isBlockedPath('c:\\program files\\app\\x.txt')).toBe(true);
    expect(isBlockedPath('C:\\Program Files (x86)\\a.txt')).toBe(true);
    expect(isBlockedPath('C:\\ProgramData\\x.ini')).toBe(true);
  });

  it('autorise les chemins utilisateur', () => {
    expect(isBlockedPath('C:\\Users\\alexi\\doc.txt')).toBe(false);
    expect(isBlockedPath('C:\\projets\\readme.md')).toBe(false);
    // Préfixe proche mais différent : ne doit pas matcher
    expect(isBlockedPath('C:\\WindowsBackup\\x.txt')).toBe(false);
  });
});

describe('WriteFileTool', () => {
  it('refuse path/content manquants', async () => {
    expect((await tool.execute({ content: 'x' })).success).toBe(false);
    expect((await tool.execute({ path: 'C:\\tmp\\x.txt' })).success).toBe(false);
  });

  it('refuse les répertoires système', async () => {
    const res = await tool.execute({ path: 'C:\\Windows\\x.txt', content: 'x' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('système');
  });

  it('écrit un fichier UTF-8 et crée les dossiers parents', async () => {
    const dir = await tmpDir();
    const target = join(dir, 'sub', 'deep', 'note.txt');
    const res = await tool.execute({ path: target, content: 'héllo wörld' });
    expect(res.success).toBe(true);
    expect((res.data as { created: boolean }).created).toBe(true);
    expect(await readFile(target, 'utf-8')).toBe('héllo wörld');
  });

  it('append ajoute à la fin', async () => {
    const dir = await tmpDir();
    const target = join(dir, 'log.txt');
    await tool.execute({ path: target, content: 'ligne1\n' });
    const res = await tool.execute({ path: target, content: 'ligne2\n', append: true });
    expect(res.success).toBe(true);
    expect((res.data as { created: boolean; mode: string }).mode).toBe('append');
    expect(await readFile(target, 'utf-8')).toBe('ligne1\nligne2\n');
  });

  it('écrase par défaut et signale created=false', async () => {
    const dir = await tmpDir();
    const target = join(dir, 'x.txt');
    await tool.execute({ path: target, content: 'v1' });
    const res = await tool.execute({ path: target, content: 'v2' });
    expect(res.success).toBe(true);
    expect((res.data as { created: boolean }).created).toBe(false);
    expect(await readFile(target, 'utf-8')).toBe('v2');
  });

  it('décode le base64', async () => {
    const dir = await tmpDir();
    const target = join(dir, 'bin.txt');
    const res = await tool.execute({
      path: target,
      content: Buffer.from('contenu binaire').toString('base64'),
      encoding: 'base64',
    });
    expect(res.success).toBe(true);
    expect(await readFile(target, 'utf-8')).toBe('contenu binaire');
  });

  it('refuse un contenu trop grand', async () => {
    const dir = await tmpDir();
    const res = await tool.execute({ path: join(dir, 'big.txt'), content: 'a'.repeat(5_000_001) });
    expect(res.success).toBe(false);
    expect(res.error).toContain('trop grand');
  });
});
