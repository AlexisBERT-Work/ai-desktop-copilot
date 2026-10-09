import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJsonFile, SqliteFile, writeFileAtomic, writeJsonFile } from './persistence';
import type { Logger } from '../logger';

const log: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

let dir = '';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'catdesk-persist-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('writeFileAtomic', () => {
  it('crée les dossiers parents et ne laisse aucun fichier temporaire', () => {
    const target = join(dir, 'a', 'b', 'x.json');
    writeFileAtomic(target, '{"v":1}');
    writeFileAtomic(target, '{"v":2}');
    expect(readFileSync(target, 'utf8')).toBe('{"v":2}');
    expect(readdirSync(join(dir, 'a', 'b'))).toEqual(['x.json']);
  });
});

describe('readJsonFile / writeJsonFile', () => {
  it('relit ce qui a été écrit', () => {
    const target = join(dir, 'x.json');
    writeJsonFile(target, [1, 2], log);
    expect(readJsonFile(target, log)).toEqual([1, 2]);
  });

  it('absent → undefined ; illisible → undefined + alerte, sans lever', () => {
    expect(readJsonFile(join(dir, 'absent.json'), log)).toBeUndefined();
    const broken = join(dir, 'broken.json');
    writeFileSync(broken, '{pas du json');
    expect(readJsonFile(broken, log)).toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('SqliteFile', () => {
  const SCHEMA = 'CREATE TABLE IF NOT EXISTS t (v INTEGER NOT NULL);';

  it('persiste et rouvre les données', async () => {
    const path = join(dir, 'x.db');
    const first = await SqliteFile.open(path, SCHEMA, log);
    first.db.run('INSERT INTO t (v) VALUES (42)');
    first.close();

    const again = await SqliteFile.open(path, SCHEMA, log);
    const row = again.db.exec('SELECT v FROM t')[0]?.values[0]?.[0];
    expect(row).toBe(42);
    again.close();
  });

  it('une base corrompue est mise de côté au lieu de bloquer le démarrage', async () => {
    const path = join(dir, 'x.db');
    writeFileSync(path, 'ceci n’est pas une base SQLite, mais un fichier tronqué');

    const file = await SqliteFile.open(path, SCHEMA, log);
    file.db.run('INSERT INTO t (v) VALUES (1)');
    file.close();

    expect(log.error).toHaveBeenCalled();
    expect(readdirSync(dir).some(name => name.startsWith('x.db.corrupt-'))).toBe(true);
    expect(existsSync(path)).toBe(true);
  });
});
