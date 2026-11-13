import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { createPathGuard, resolveTarget, withRealPaths, type PathProbe } from './realPath';

const ENV = { userProfile: '/home/moi', temp: '/tmp' };

const fsError = (code: string): Error => Object.assign(new Error(code), { code });

/**
 * Disque simulé : `entries` = ce qui existe (chemin → chemin réel), `links` =
 * liens pendants (présents pour `lstat`, absents pour `realpath`), `denied` =
 * accès refusé. Les appels sont notés, pour vérifier ce qui touche le disque.
 */
function fakeDisk(
  entries: Record<string, string>,
  opts: { links?: string[]; denied?: string[] } = {},
): PathProbe & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    realpath: async p => {
      calls.push(p);
      if (opts.denied?.includes(p)) throw fsError('EACCES');
      const real = entries[p];
      if (real === undefined) throw fsError('ENOENT');
      return real;
    },
    lstat: async p => {
      calls.push(p);
      if (entries[p] === undefined && !opts.links?.includes(p)) throw fsError('ENOENT');
      return {};
    },
  };
}

describe('resolveTarget', () => {
  it('rend le chemin réel de ce qui existe', async () => {
    const disk = fakeDisk({ '/home/moi/docs/a.txt': '/srv/docs/a.txt' });
    expect(await resolveTarget('/home/moi/docs/a.txt', disk)).toEqual({
      ok: true,
      path: '/srv/docs/a.txt',
    });
  });

  it('fichier à créer : plus proche parent existant, résolu, plus le reste', async () => {
    const disk = fakeDisk({ '/home/moi/docs': '/srv/docs' });
    expect(await resolveTarget('/home/moi/docs/neuf/x.txt', disk)).toEqual({
      ok: true,
      path: join('/srv/docs', 'neuf', 'x.txt'),
    });
  });

  it('rien n’existe, pas même la racine : le chemin écrit', async () => {
    expect(await resolveTarget('C:/Users/user/Documents/x.txt', fakeDisk({}))).toEqual({
      ok: true,
      path: 'C:/Users/user/Documents/x.txt',
    });
  });

  it('refuse un lien pendant et une destination illisible', async () => {
    const dangling = fakeDisk(
      { '/home/moi/docs': '/home/moi/docs' },
      {
        links: ['/home/moi/docs/lien'],
      },
    );
    const r1 = await resolveTarget('/home/moi/docs/lien/x.txt', dangling);
    expect(r1).toEqual({ ok: false, reason: 'lien dont la cible est absente' });

    const locked = fakeDisk({}, { denied: ['/home/moi/docs/a.txt'] });
    const r2 = await resolveTarget('/home/moi/docs/a.txt', locked);
    expect(r2.ok).toBe(false);
    expect(r2.ok ? '' : r2.reason).toContain('EACCES');
  });
});

describe('withRealPaths', () => {
  it('forme écrite, plus forme résolue quand elle existe', async () => {
    const disk = fakeDisk({ '/home/moi/docs': '/srv/docs' });
    expect(await withRealPaths(['/home/moi/docs', '/absent'], disk.realpath)).toEqual([
      '/home/moi/docs',
      '/absent',
      '/srv/docs',
    ]);
  });
});

describe('createPathGuard', () => {
  const whitelist = ['%USERPROFILE%/docs'];

  it('un chemin hors liste n’est jamais présenté au disque (UNC : connexion SMB)', async () => {
    const disk = fakeDisk({ '/home/moi/docs': '/home/moi/docs' });
    const guard = createPathGuard(whitelist, ENV, disk);
    const verdict = await guard('\\\\hote\\partage\\x.txt');
    expect(verdict.allowed).toBe(false);
    // Seule la racine de la liste a été résolue.
    expect(disk.calls).toEqual(['/home/moi/docs']);
  });

  it('liste vide : tout passe, sans accès disque', async () => {
    const disk = fakeDisk({});
    expect(await createPathGuard([], ENV, disk)('/etc/shadow')).toEqual({ allowed: true });
    expect(disk.calls).toEqual([]);
  });

  it('résout les racines une seule fois par garde', async () => {
    const disk = fakeDisk({
      '/home/moi/docs': '/home/moi/docs',
      '/home/moi/docs/a': '/home/moi/docs/a',
      '/home/moi/docs/b': '/home/moi/docs/b',
    });
    const guard = createPathGuard(whitelist, ENV, disk);
    await guard('/home/moi/docs/a');
    await guard('/home/moi/docs/b');
    expect(disk.calls.filter(c => c === '/home/moi/docs')).toHaveLength(1);
  });

  it('refuse ce qui mène dehors, et dit où', async () => {
    const disk = fakeDisk({
      '/home/moi/docs': '/home/moi/docs',
      '/home/moi/docs/lien': '/etc',
    });
    const verdict = await createPathGuard(whitelist, ENV, disk)('/home/moi/docs/lien/passwd');
    expect(verdict).toEqual({
      allowed: false,
      reason: `Chemin non autorisé: /home/moi/docs/lien/passwd (mène à ${join('/etc', 'passwd')})`,
    });
  });
});
