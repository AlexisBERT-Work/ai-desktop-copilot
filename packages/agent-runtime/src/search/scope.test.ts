import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScopeCheck, defaultSearchRoots, keepInScope } from './scope';

const ENV = { userProfile: 'C:\\Users\\Moi', temp: 'C:\\Users\\Moi\\AppData\\Local\\Temp' };

describe('defaultSearchRoots', () => {
  it('les dossiers de la liste blanche, sans le dossier temporaire', () => {
    expect(
      defaultSearchRoots(
        [
          '%USERPROFILE%\\Documents',
          '%USERPROFILE%\\Desktop',
          '%USERPROFILE%\\Downloads',
          '%TEMP%',
        ],
        ENV,
      ),
    ).toEqual([
      'C:\\Users\\Moi\\Documents',
      'C:\\Users\\Moi\\Desktop',
      'C:\\Users\\Moi\\Downloads',
    ]);
  });

  it('jamais le dossier courant ; liste vide (tout autorisé) : le dossier personnel', () => {
    expect(defaultSearchRoots([], ENV, 'C:\\Users\\Moi')).toEqual(['C:\\Users\\Moi']);
    expect(defaultSearchRoots(['%TEMP%'], ENV)).toEqual([ENV.temp]);
  });
});

describe('createScopeCheck (résolution simulée)', () => {
  // Une « jonction » : C:/Users/Moi/Documents/lien → C:/Windows.
  const resolve = async (p: string): Promise<string> => {
    const n = p.replace(/\\/g, '/');
    if (n.includes('/absent')) throw new Error('ENOENT');
    return n.replace('C:/Users/Moi/Documents/lien', 'C:/Windows');
  };
  const whitelist = ['%USERPROFILE%\\Documents', '%TEMP%'];

  it('garde un chemin sous une racine et sous la liste blanche, et rend sa forme résolue', async () => {
    const check = await createScopeCheck(['C:\\Users\\Moi\\Documents'], whitelist, resolve, ENV);
    expect(await check('C:\\Users\\Moi\\Documents\\devis.pdf')).toBe(
      'C:/Users/Moi/Documents/devis.pdf',
    );
  });

  it('écarte ce qui passe par une jonction vers l’extérieur', async () => {
    const check = await createScopeCheck(['C:\\Users\\Moi\\Documents'], whitelist, resolve, ENV);
    expect(await check('C:\\Users\\Moi\\Documents\\lien\\System32\\config\\SAM')).toBeNull();
  });

  it('une racine demandée qui est elle-même une jonction ne sort pas de la liste blanche', async () => {
    const check = await createScopeCheck(
      ['C:\\Users\\Moi\\Documents\\lien'],
      whitelist,
      resolve,
      ENV,
    );
    expect(await check('C:\\Users\\Moi\\Documents\\lien\\win.ini')).toBeNull();
  });

  it('écarte hors racine (même autorisé ailleurs), hors liste, et l’introuvable', async () => {
    const check = await createScopeCheck(['C:\\Users\\Moi\\Documents'], whitelist, resolve, ENV);
    expect(await check(`${ENV.temp}\\note.txt`)).toBeNull();
    expect(await check('C:\\Users\\Moi\\.ssh\\id_rsa')).toBeNull();
    expect(await check('C:\\Users\\Moi\\Documents\\absent.pdf')).toBeNull();
    expect(await check('C:\\Users\\Moi\\Documents-evil\\x.pdf')).toBeNull();
  });

  it('aucune racine : rien ne passe', async () => {
    const check = await createScopeCheck([], whitelist, resolve, ENV);
    expect(await check('C:\\Users\\Moi\\Documents\\devis.pdf')).toBeNull();
  });
});

describe('createScopeCheck (vraie jonction)', () => {
  let base = '';
  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'catdesk-scope-'));
    mkdirSync(join(base, 'autorise'));
    mkdirSync(join(base, 'dehors'));
    writeFileSync(join(base, 'autorise', 'doc.txt'), 'ok');
    writeFileSync(join(base, 'dehors', 'secret.txt'), 'non');
    // `junction` sous Windows (sans droits d'administrateur), lien ailleurs.
    symlinkSync(join(base, 'dehors'), join(base, 'autorise', 'lien'), 'junction');
  });
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it('suit la jonction et écarte sa cible', async () => {
    const root = join(base, 'autorise');
    const check = await createScopeCheck([root], [root]);
    expect(await check(join(root, 'doc.txt'))).toBe(realpathSync(join(root, 'doc.txt')));
    expect(await check(join(root, 'lien', 'secret.txt'))).toBeNull();
  });
});

describe('keepInScope', () => {
  it('garde l’ordre, s’arrête à la limite, compte les écartés examinés', async () => {
    const seen: string[] = [];
    const check = async (p: string): Promise<string | null> => {
      seen.push(p);
      return p.startsWith('in') ? p.toUpperCase() : null;
    };
    const { kept, dropped } = await keepInScope(
      ['in1', 'out1', 'in2', 'in3', 'out2'],
      p => p,
      check,
      2,
    );
    expect(kept).toEqual([
      { item: 'in1', realPath: 'IN1' },
      { item: 'in2', realPath: 'IN2' },
    ]);
    expect(dropped).toBe(1);
    expect(seen).toEqual(['in1', 'out1', 'in2']);
  });
});
