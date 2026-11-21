import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'path';
import { PermissionEngine, grantKey } from './PermissionEngine';
import { DEFAULT_PERMISSION_CONFIG, type GrantScope } from '@catdesk/shared-types';
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
    expect(sent[0]?.params).not.toHaveProperty('preview');
  });

  it('transmet au dialogue ce que le masquage des données personnelles a fait', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const engine = new PermissionEngine((_m, params) =>
      sent.push(params as Record<string, unknown>),
    );
    const pending = engine.check({
      tool: 'send_webhook_message',
      args: { message: 'IBAN [IBAN masqué]' },
      preview: 'Masqué avant envoi : 1 IBAN.',
    });
    await Promise.resolve();
    expect(sent[0]?.['preview']).toBe('Masqué avant envoi : 1 IBAN.');
    expect(sent[0]?.['args']).toEqual({ message: 'IBAN [IBAN masqué]' });
    engine.resolvePermissionRequest(String(sent[0]?.['requestId']), false);
    expect((await pending).granted).toBe(false);
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

// ─── Navigateur : lecture seule et accord par site ─────────────────────────

interface Answer {
  granted: boolean;
  scope?: GrantScope;
}

/**
 * Moteur dont la lecture seule se pilote, et qui répond lui-même au dialogue
 * (`answer`, modifiable entre deux appels). `asked` garde chaque demande
 * envoyée à l'UI.
 */
function browserEngine(readOnly: { on: boolean }, answer: Answer = { granted: true }) {
  const asked: Array<Record<string, unknown>> = [];
  const engine: PermissionEngine = new PermissionEngine(
    (_m, params) => {
      const p = params as Record<string, unknown>;
      asked.push(p);
      queueMicrotask(() =>
        engine.resolvePermissionRequest(String(p['requestId']), answer.granted, answer.scope),
      );
    },
    60_000,
    () => readOnly.on,
  );
  return { engine, asked, answer };
}

const navigateTo = (url: string) => ({ tool: 'browser_navigate', args: { url }, url });
const clickOn = (url: string) => ({ tool: 'browser_click', args: { selector: '#ok' }, url });
const typeOn = (url: string) => ({
  tool: 'browser_type',
  args: { selector: '#q', text: 'x' },
  url,
});

describe('PermissionEngine — navigateur en lecture seule', () => {
  it('lecture seule : browser_navigate passe à moyen, « session » le retient partout', async () => {
    const { engine, asked } = browserEngine({ on: true }, { granted: true, scope: 'session' });
    expect((await engine.check(navigateTo('https://exemple.fr'))).granted).toBe(true);
    expect(asked[0]).toMatchObject({ riskLevel: 'medium', scopes: ['once', 'site', 'session'] });
    const second = await engine.check(navigateTo('https://autre.fr'));
    expect(second).toEqual({ granted: true, reason: 'Autorisé (session)', scope: 'session' });
    expect(asked).toHaveLength(1);
  });

  it('lecture seule coupée : élevé, confirmation à chaque fois malgré la session', async () => {
    const readOnly = { on: true };
    const { engine, asked } = browserEngine(readOnly, { granted: true, scope: 'session' });
    await engine.check(navigateTo('https://exemple.fr')); // « session » en lecture seule
    readOnly.on = false;
    await engine.check(navigateTo('https://exemple.fr'));
    await engine.check(navigateTo('https://exemple.fr'));
    expect(asked.map(a => a['riskLevel'])).toEqual(['medium', 'high', 'high']);
    // Plus que « une fois » : ni site, ni session pour un risque élevé.
    expect(asked[1]?.['scopes']).toEqual(['once']);
    expect(asked[1]).not.toHaveProperty('site');
  });

  it('clic et saisie restent élevés, même en lecture seule ; pas de « session »', async () => {
    const { engine, asked } = browserEngine({ on: true }, { granted: true, scope: 'session' });
    await engine.check(clickOn('https://exemple.fr/'));
    await engine.check(clickOn('https://exemple.fr/'));
    expect(asked.map(a => a['riskLevel'])).toEqual(['high', 'high']);
    expect(asked[0]?.['scopes']).toEqual(['once', 'site']);
  });

  it('le mode sans danger bloque toujours browser_navigate (moyen n’est pas faible)', async () => {
    const { engine } = browserEngine({ on: true });
    engine.updateConfig({ safeMode: true });
    expect((await engine.check(navigateTo('https://exemple.fr'))).granted).toBe(false);
  });

  it('sans lecteur de lecture seule : le risque déclaré s’applique', () => {
    const engine = new PermissionEngine(() => {});
    const config = DEFAULT_PERMISSION_CONFIG.tools['browser_navigate'];
    expect(config?.riskLevelWhenReadOnly).toBe('medium');
    expect(config && engine.effectiveRisk(config)).toBe('high');
  });
});

describe('PermissionEngine — accord « pour ce site »', () => {
  it('trois étapes sur un même site : une confirmation par outil et par site', async () => {
    const { engine, asked } = browserEngine({ on: true }, { granted: true, scope: 'site' });
    const r1 = await engine.check(clickOn('https://www.exemple.fr/recherche'));
    expect(r1).toMatchObject({ granted: true, scope: 'site', site: 'exemple.fr' });
    expect(asked[0]).toMatchObject({ site: 'exemple.fr', scopes: ['once', 'site'] });

    // Sous-domaine : suit l'accord du domaine enregistrable.
    const r2 = await engine.check(clickOn('https://m.exemple.fr/resultat/2'));
    expect(r2).toEqual({
      granted: true,
      reason: 'Autorisé pour exemple.fr (session)',
      scope: 'site',
      site: 'exemple.fr',
    });
    expect(asked).toHaveLength(1);

    // Un autre outil ne profite pas de l'accord : la clé est outil + site.
    await engine.check(typeOn('https://exemple.fr/'));
    expect(asked).toHaveLength(2);
  });

  it('« une fois » ne retient rien', async () => {
    const { engine, asked } = browserEngine({ on: true }, { granted: true, scope: 'once' });
    const r = await engine.check(clickOn('https://exemple.fr/'));
    expect(r).toMatchObject({ granted: true, scope: 'once', site: 'exemple.fr' });
    await engine.check(clickOn('https://exemple.fr/'));
    expect(asked).toHaveLength(2);
  });

  it('un autre site (ou une redirection vers un autre domaine) redemande', async () => {
    const { engine, asked } = browserEngine({ on: true }, { granted: true, scope: 'site' });
    await engine.check(clickOn('https://exemple.fr/'));
    // Page redirigée : le clic suivant vise la page courante, sur un autre domaine.
    await engine.check(clickOn('https://exemple-paiement.com/'));
    expect(asked.map(a => a['site'])).toEqual(['exemple.fr', 'exemple-paiement.com']);
  });

  it('un suffixe partagé ne s’étend pas à ses voisins (github.io, co.uk)', async () => {
    const { engine, asked } = browserEngine({ on: true }, { granted: true, scope: 'site' });
    await engine.check(clickOn('https://alice.github.io/'));
    await engine.check(clickOn('https://bob.github.io/'));
    await engine.check(clickOn('https://exemple.co.uk/'));
    await engine.check(clickOn('https://autre.co.uk/'));
    expect(asked.map(a => a['site'])).toEqual([
      'alice.github.io',
      'bob.github.io',
      'exemple.co.uk',
      'autre.co.uk',
    ]);
  });

  it('lecture seule coupée : l’accord par site dort, puis revient avec elle', async () => {
    const readOnly = { on: true };
    const { engine, asked } = browserEngine(readOnly, { granted: true, scope: 'site' });
    await engine.check(clickOn('https://exemple.fr/'));
    readOnly.on = false;
    const r = await engine.check(clickOn('https://exemple.fr/'));
    expect(r.scope).toBe('once'); // « site » répondu mais plus proposé → une fois
    expect(asked[1]).toMatchObject({ riskLevel: 'high', scopes: ['once'] });
    readOnly.on = true;
    expect((await engine.check(clickOn('https://exemple.fr/'))).reason).toContain('exemple.fr');
    expect(asked).toHaveLength(2);
  });

  it('une portée non proposée vaut « une fois » (outil sans site, réponse forgée)', async () => {
    const { engine, asked } = browserEngine({ on: true }, { granted: true, scope: 'site' });
    const r = await engine.check({ tool: 'run_command', args: { command: 'dir' } });
    expect(r).toMatchObject({ granted: true, scope: 'once' });
    expect(r).not.toHaveProperty('site');
    expect(asked[0]?.['scopes']).toEqual(['once']);
    await engine.check({ tool: 'run_command', args: { command: 'dir' } });
    expect(asked).toHaveLength(2);
  });

  it('page sans site (about:blank, URL absente) : pas d’accord par site proposé', async () => {
    const { engine, asked } = browserEngine({ on: true }, { granted: true, scope: 'site' });
    await engine.check(clickOn('about:blank'));
    await engine.check({ tool: 'browser_click', args: { selector: '#ok' } });
    expect(asked.map(a => a['scopes'])).toEqual([['once'], ['once']]);
  });

  it('un refus ne retient rien, et dit qu’il vient de l’utilisateur', async () => {
    const { engine, asked, answer } = browserEngine(
      { on: true },
      { granted: false, scope: 'site' },
    );
    const r = await engine.check(clickOn('https://exemple.fr/'));
    expect(r).toMatchObject({ granted: false, reason: "Refusé par l'utilisateur" });
    answer.granted = true;
    await engine.check(clickOn('https://exemple.fr/'));
    expect(asked).toHaveLength(2);
  });

  it('le mode sans danger l’emporte sur un accord par site déjà donné', async () => {
    const { engine } = browserEngine({ on: true }, { granted: true, scope: 'site' });
    await engine.check(clickOn('https://exemple.fr/'));
    engine.updateConfig({ safeMode: true });
    expect((await engine.check(clickOn('https://exemple.fr/'))).granted).toBe(false);
  });

  it('clearSessionGrants oublie aussi les accords par site', async () => {
    const { engine, asked } = browserEngine({ on: true }, { granted: true, scope: 'site' });
    await engine.check(clickOn('https://exemple.fr/'));
    engine.clearSessionGrants();
    await engine.check(clickOn('https://exemple.fr/'));
    expect(asked).toHaveLength(2);
  });

  it('les clés outil et outil@site ne se recouvrent pas', () => {
    expect(grantKey('browser_navigate')).toBe('browser_navigate');
    expect(grantKey('browser_navigate', 'exemple.fr')).toBe('browser_navigate@exemple.fr');
  });
});
