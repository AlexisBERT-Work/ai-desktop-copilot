import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'path';
import { PermissionEngine } from './PermissionEngine';
import { ParseDocumentTool } from '../tools/files/ParseDocumentTool';
import { RunSqliteTool } from '../tools/infra/RunSqliteTool';
import { ObsidianNotesTool } from '../tools/connectors/ObsidianNotesTool';
import { SemanticSearchTool } from '../tools/search/SemanticSearchTool';
import { SummarizeGitLogTool } from '../tools/git/SummarizeGitLogTool';

const req = (path: string) => ({
  tool: 'read_file',
  args: { path },
  paths: [path],
  context: { conversationId: 'c' },
});

// Same env vars the engine expands, so the test is machine-independent.
const HOME = process.env['USERPROFILE'] ?? 'C:/Users/user';
const TEMP = process.env['TEMP'] ?? process.env['TMP'] ?? 'C:/Temp';

describe('PermissionEngine path whitelist', () => {
  let engine: PermissionEngine;
  beforeEach(() => {
    engine = new PermissionEngine();
  });

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
  // Les chemins viennent de l'OUTIL (pathArgs), exactement comme dans l'orchestrateur.
  const through = (
    tool: { name: string; filesystemTargets(a: Record<string, unknown>): string[] },
    args: Record<string, unknown>,
  ) =>
    engine.check({
      tool: tool.name,
      args,
      paths: tool.filesystemTargets(args),
      context: { conversationId: 'c' },
    });

  it('enforces the whitelist on a path-taking tool not named *file* (parse_document)', async () => {
    const r = await through(new ParseDocumentTool(), { path: 'C:/Windows/System32/config/SAM' });
    expect(r.granted).toBe(false);
    expect(r.reason).toContain('Chemin non autorisé');
  });

  it('enforces the whitelist on run_sqlite db_path (Chrome cookies DB)', async () => {
    const r = await through(new RunSqliteTool(), {
      db_path: 'C:/Users/other/AppData/Local/Google/Chrome/User Data/Default/Cookies',
      query: 'SELECT 1',
    });
    expect(r.granted).toBe(false);
  });

  it('enforces the whitelist on obsidian_notes `vault` (lisait tout le disque)', async () => {
    const r = await through(new ObsidianNotesTool(), { vault: 'C:/', query: 'mot de passe' });
    expect(r.granted).toBe(false);
  });

  it('enforces the whitelist on EVERY entry of semantic_search `paths`', async () => {
    const r = await through(new SemanticSearchTool(), {
      query: 'x',
      paths: [join(HOME, 'Documents'), 'C:/Users/other'],
    });
    expect(r.granted).toBe(false);
  });

  it('ne traite pas une pathspec git (relative au dépôt) comme un chemin disque', async () => {
    const r = await through(new SummarizeGitLogTool(), { workdir: 'D:/repo', path: 'src/' });
    expect(r.granted).toBe(true);
  });

  it('still allows a whitelisted path for a non-file tool', async () => {
    const r = await through(new ParseDocumentTool(), {
      path: join(HOME, 'Documents', 'rapport.pdf'),
    });
    expect(r.granted).toBe(true);
  });
});

describe('PermissionEngine — liste blanche à travers jonctions et liens', () => {
  // Vraies jonctions : `junction` sous Windows (sans droits d'administrateur),
  // lien symbolique ailleurs. Liste blanche propre au test : `autorise` et
  // `documents`, ce dernier étant lui-même une jonction vers `vrais-documents`.
  let base = '';
  let allowed = '';
  let engine: PermissionEngine;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'catdesk-perm-'));
    allowed = join(base, 'autorise');
    const outside = join(base, 'dehors');
    const realDocs = join(base, 'vrais-documents');
    const gone = join(base, 'disparu');
    for (const dir of [allowed, outside, realDocs, gone]) mkdirSync(dir);
    writeFileSync(join(allowed, 'doc.txt'), 'ok');
    writeFileSync(join(outside, 'secret.txt'), 'non');
    writeFileSync(join(realDocs, 'note.txt'), 'ok');
    symlinkSync(outside, join(allowed, 'lien'), 'junction');
    symlinkSync(realDocs, join(base, 'documents'), 'junction');
    // Lien pendant : sa cible a disparu après sa création.
    symlinkSync(gone, join(allowed, 'pendant'), 'junction');
    rmSync(gone, { recursive: true });
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  beforeEach(() => {
    // Approuve tout dialogue : un outil `medium` qui atteint la confirmation a
    // passé la liste blanche.
    engine = new PermissionEngine((_method, params) => {
      engine.resolvePermissionRequest(String((params as { requestId: string }).requestId), true);
    });
    engine.updateConfig({ pathWhitelist: [allowed, join(base, 'documents')] });
  });

  const check = (tool: string, path: string) =>
    engine.check({ tool, args: { path }, paths: [path], context: { conversationId: 'c' } });

  it('refuse la lecture au travers d’une jonction, par tous les outils', async () => {
    for (const tool of ['read_file', 'parse_document']) {
      const r = await check(tool, join(allowed, 'lien', 'secret.txt'));
      expect(r.granted).toBe(false);
      expect(r.reason).toContain('Chemin non autorisé');
      expect(r.reason).toContain('mène à');
    }
    // La jonction elle-même, listée comme un dossier.
    expect((await check('list_directory', join(allowed, 'lien'))).granted).toBe(false);
  });

  it('refuse l’écriture d’un nouveau fichier sous une jonction', async () => {
    for (const tool of ['write_file', 'export_document']) {
      const r = await check(tool, join(allowed, 'lien', 'nouveau', 'rapport.pdf'));
      expect(r.granted).toBe(false);
      expect(r.reason).toContain('mène à');
    }
  });

  it('refuse l’écriture au travers d’un lien dont la cible a disparu', async () => {
    const r = await check('write_file', join(allowed, 'pendant', 'x.txt'));
    expect(r.granted).toBe(false);
    expect(r.reason).toContain('cible est absente');
  });

  it('accepte toujours un chemin normal, existant ou à créer', async () => {
    expect((await check('read_file', join(allowed, 'doc.txt'))).granted).toBe(true);
    expect((await check('list_directory', allowed)).granted).toBe(true);
    expect((await check('write_file', join(allowed, 'neuf', 'sous', 'x.txt'))).granted).toBe(true);
  });

  it('une racine de la liste qui est une jonction reste autorisée, sous ses deux formes', async () => {
    expect((await check('read_file', join(base, 'documents', 'note.txt'))).granted).toBe(true);
    expect((await check('read_file', join(base, 'vrais-documents', 'note.txt'))).granted).toBe(
      true,
    );
  });

  it('garde le refus de `..` et la frontière de dossier', async () => {
    expect((await check('read_file', `${allowed}/../dehors/secret.txt`)).granted).toBe(false);
    expect((await check('read_file', `${allowed}-evil/x.txt`)).granted).toBe(false);
  });
});

describe('PermissionEngine — confirmation utilisateur', () => {
  const highRequest = {
    tool: 'run_command',
    args: { command: 'dir' },
    context: { conversationId: 'c' },
  };

  it("notifie l'UI avec la description de l'outil, puis applique sa réponse", async () => {
    const sent: Array<{ method: string; params: Record<string, unknown> }> = [];
    const engine = new PermissionEngine((method, params) =>
      sent.push({ method, params: params as Record<string, unknown> }),
    );
    const pending = engine.check(highRequest);
    await Promise.resolve();
    expect(sent[0]?.method).toBe('permission.request');
    expect(sent[0]?.params['description']).toBeTruthy();
    expect(sent[0]?.params['riskLevel']).toBe('high');

    engine.resolvePermissionRequest(String(sent[0]?.params['requestId']), true);
    expect((await pending).granted).toBe(true);
  });

  it('un délai dépassé vaut REFUS — il ne fait plus échouer le run', async () => {
    const engine = new PermissionEngine(() => {}, 10);
    const r = await engine.check(highRequest);
    expect(r.granted).toBe(false);
    expect(r.reason).toContain('Pas de réponse');
  });

  it("un run interrompu pendant l'attente vaut refus immédiat", async () => {
    const engine = new PermissionEngine(() => {}, 60_000);
    const controller = new AbortController();
    const pending = engine.check(highRequest, controller.signal);
    controller.abort();
    const r = await pending;
    expect(r.granted).toBe(false);
    expect(r.reason).toContain('interrompu');
  });

  it('une réponse tardive (après le délai) est ignorée sans erreur', async () => {
    let requestId = '';
    const engine = new PermissionEngine((_m, p) => {
      requestId = String((p as { requestId: string }).requestId);
    }, 10);
    const r = await engine.check(highRequest);
    expect(() => engine.resolvePermissionRequest(requestId, true)).not.toThrow();
    expect(r.granted).toBe(false);
  });
});
