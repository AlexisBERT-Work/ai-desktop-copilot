import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'path';
import { PermissionEngine } from './PermissionEngine';

const req = (path: string) => ({
  tool: 'read_file',
  args: { path },
  context: { conversationId: 'c' },
});

// Same env vars the engine expands, so the test is machine-independent.
const HOME = process.env['USERPROFILE'] ?? 'C:/Users/user';
const TEMP = process.env['TEMP'] ?? process.env['TMP'] ?? 'C:/Temp';

describe('PermissionEngine path whitelist', () => {
  let engine: PermissionEngine;
  beforeEach(() => { engine = new PermissionEngine(); });

  it('allows a path under %USERPROFILE%\\Documents (backslashes)', async () => {
    const r = await engine.check(req(join(HOME, 'Documents', 'notes.txt')));
    expect(r.granted).toBe(true);
  });

  it('allows the same path written with forward slashes and lowercased', async () => {
    // This is exactly the shape the whitelist failed to match before the fix:
    // the candidate is normalized to lowercase/forward-slash, the whitelist was not.
    const lower = join(HOME, 'Documents', 'notes.txt').replace(/\\/g, '/').toLowerCase();
    const r = await engine.check(req(lower));
    expect(r.granted).toBe(true);
  });

  it('allows a path under %TEMP%', async () => {
    const r = await engine.check(req(join(TEMP, 'catdesk', 'x.txt')));
    expect(r.granted).toBe(true);
  });

  it('denies a path outside the whitelist', async () => {
    const r = await engine.check(req('C:/Windows/System32/drivers/etc/hosts'));
    expect(r.granted).toBe(false);
    expect(r.reason).toContain('Chemin non autorisé');
  });

  it('allows everything when the whitelist is empty', async () => {
    engine.updateConfig({ pathWhitelist: [] });
    const r = await engine.check(req('C:/Windows/System32/config/SAM'));
    expect(r.granted).toBe(true);
  });

  // ─── Vuln 1 (docs/SECURITE.md): traversal out of a whitelisted root ───
  it('denies `..` traversal that escapes a whitelisted root', async () => {
    // Starts with the whitelisted …\Downloads prefix, then walks back to ~/.ssh.
    const evil = join(HOME, 'Downloads', '..', '.ssh', 'id_rsa');
    const r = await engine.check(req(evil));
    expect(r.granted).toBe(false);
    expect(r.reason).toContain('Chemin non autorisé');
  });

  it('denies `..` traversal written with forward slashes', async () => {
    const lower = join(HOME, 'Documents', '..', '..', 'secret.txt')
      .replace(/\\/g, '/')
      .toLowerCase();
    const r = await engine.check(req(lower));
    expect(r.granted).toBe(false);
  });

  it('denies a sibling dir sharing a whitelisted prefix (boundary match)', async () => {
    // `…\Documents-evil` must NOT be authorized by the `…\Documents` root.
    const r = await engine.check(req(`${join(HOME, 'Documents')}-evil\\x.txt`));
    expect(r.granted).toBe(false);
  });

  // ─── Vuln 3 (docs/SECURITE.md): path check must cover non-"file" tools ───
  it('enforces the whitelist on a path-taking tool not named *file* (parse_document)', async () => {
    const r = await engine.check({
      tool: 'parse_document',
      args: { path: 'C:/Windows/System32/config/SAM' },
      context: { conversationId: 'c' },
    });
    expect(r.granted).toBe(false);
    expect(r.reason).toContain('Chemin non autorisé');
  });

  it('enforces the whitelist on run_sqlite db_path (Chrome cookies DB)', async () => {
    const r = await engine.check({
      tool: 'run_sqlite',
      args: { db_path: 'C:/Users/other/AppData/Local/Google/Chrome/User Data/Default/Cookies', query: 'SELECT 1' },
      context: { conversationId: 'c' },
    });
    expect(r.granted).toBe(false);
  });

  it('still allows a whitelisted path for a non-file tool', async () => {
    const r = await engine.check({
      tool: 'parse_document',
      args: { path: join(HOME, 'Documents', 'rapport.pdf') },
      context: { conversationId: 'c' },
    });
    expect(r.granted).toBe(true);
  });
});
