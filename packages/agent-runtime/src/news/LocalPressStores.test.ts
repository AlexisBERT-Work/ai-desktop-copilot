import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalPressFeedStore, sanitizeFeed } from './LocalPressFeedStore';
import { LocalDailyStore } from './LocalDailyStore';
import type { JournalDraft } from './pressDigest';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ndlp-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const INPUT = {
  name: 'Veille IA',
  category: 'tech' as const,
  sourceIds: ['theverge'],
  feedUrls: [],
  includeKeywords: [],
  includeRegex: '\\bIA\\b',
  excludeRegex: null,
  sinceHours: 24,
  articleLimit: 8,
  enabled: true,
};

describe('sanitizeFeed', () => {
  it('rejette une entrée sans id ou sans nom', () => {
    expect(sanitizeFeed({ name: 'x' })).toBeNull();
    expect(sanitizeFeed({ id: 'a', name: '  ' })).toBeNull();
  });

  it('répare les champs invalides avec des valeurs sûres', () => {
    const f = sanitizeFeed({
      id: 'a',
      name: 'X',
      category: 'nope',
      sinceHours: -3,
      articleLimit: 'x',
    });
    expect(f).toMatchObject({ category: 'misc', sinceHours: 24, articleLimit: 12, enabled: true });
  });
});

describe('LocalPressFeedStore', () => {
  it('crée, met à jour et supprime avec persistance', () => {
    const store = new LocalPressFeedStore(dir);
    const created = store.save(INPUT);
    expect(created.id).toBeTruthy();
    expect(store.list()).toHaveLength(1);

    store.save({ ...INPUT, id: created.id, name: 'Veille IA v2' });
    expect(store.list()[0]?.name).toBe('Veille IA v2');
    expect(store.list()).toHaveLength(1);

    // Relecture depuis le disque par une nouvelle instance.
    const reread = new LocalPressFeedStore(dir);
    expect(reread.list()[0]?.name).toBe('Veille IA v2');

    expect(reread.delete(created.id)).toBe(true);
    expect(reread.delete(created.id)).toBe(false);
    expect(new LocalPressFeedStore(dir).list()).toHaveLength(0);
  });

  it('refuse un journal sans nom', () => {
    const store = new LocalPressFeedStore(dir);
    expect(() => store.save({ ...INPUT, name: '  ' })).toThrow();
  });

  it('démarre vide sur un fichier corrompu', () => {
    writeFileSync(join(dir, 'press-feeds.json'), '{pas du json', 'utf8');
    expect(new LocalPressFeedStore(dir).list()).toHaveLength(0);
  });
});

const draft = (title: string): JournalDraft => ({
  journal: 'Veille IA',
  category: 'tech',
  title,
  body: 'corps',
});

describe('LocalDailyStore', () => {
  it('ajoute les nouveaux titres, ignore les doublons, persiste', () => {
    const store = new LocalDailyStore(dir);
    const added = store.addNew([draft('Veille IA — revue du 6 juillet')]);
    expect(added).toHaveLength(1);
    expect(added[0]?.id.startsWith('local-')).toBe(true);

    // Même titre ⇒ idempotent.
    expect(store.addNew([draft('Veille IA — revue du 6 juillet')])).toHaveLength(0);

    const reread = new LocalDailyStore(dir);
    expect(reread.list()).toHaveLength(1);
    expect(reread.has('Veille IA — revue du 6 juillet')).toBe(true);
  });

  it('upsert remplace une daily existante (même id) et ajoute les nouvelles', () => {
    const store = new LocalDailyStore(dir);
    const [first] = store.addNew([draft('Veille IA — revue du 6 juillet')]);
    expect(first?.body).toBe('corps');

    // Régénération manuelle : même titre ⇒ remplacé (id stable, corps neuf).
    const changed = store.upsert([
      { ...draft('Veille IA — revue du 6 juillet'), body: 'corps régénéré' },
      draft('Autre journal — revue du 6 juillet'),
    ]);
    expect(changed).toHaveLength(2);
    expect(changed[0]?.id).toBe(first?.id);
    expect(store.list()).toHaveLength(2);

    const reread = new LocalDailyStore(dir);
    const regen = reread.list().find(d => d.title.startsWith('Veille IA'));
    expect(regen?.body).toBe('corps régénéré');
  });

  it('purge les dailys plus vieilles que 30 jours', () => {
    const store = new LocalDailyStore(dir);
    const old = new Date();
    old.setDate(old.getDate() - 40);
    store.addNew([draft('Vieille revue')], old);
    // L'ajout suivant déclenche la purge de l'ancienne.
    store.addNew([draft('Revue récente')]);
    const titles = store.list().map(d => d.title);
    expect(titles).toEqual(['Revue récente']);
  });
});
