import { describe, it, expect } from 'vitest';
import { parseDockerPs } from './DockerPsTool';
import { buildDockerArgs } from './DockerControlTool';
import { isReadOnlyQuery } from './RunSqliteTool';

describe('parseDockerPs', () => {
  it('parse les lignes JSON de docker ps', () => {
    const out = [
      JSON.stringify({ ID: 'abc123456789xyz', Names: 'web', Image: 'nginx', Status: 'Up 2 hours', State: 'running', Ports: '0.0.0.0:80->80/tcp' }),
      JSON.stringify({ ID: 'def987654321', Names: 'db', Image: 'postgres:16', Status: 'Exited (0)', State: 'exited', Ports: '' }),
      'garbage line',
    ].join('\n');
    const c = parseDockerPs(out);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ id: 'abc123456789', name: 'web', image: 'nginx', state: 'running' });
    expect(c[1]?.name).toBe('db');
  });
});

describe('buildDockerArgs', () => {
  it('construit start/stop/restart avec une cible', () => {
    expect(buildDockerArgs('start', 'web')).toEqual({ ok: true, args: ['start', 'web'] });
    expect(buildDockerArgs('restart', 'db')).toEqual({ ok: true, args: ['restart', 'db'] });
  });

  it('exige une cible pour start', () => {
    expect(buildDockerArgs('start', undefined).ok).toBe(false);
  });

  it('compose up/down avec fichier par défaut', () => {
    expect(buildDockerArgs('up', undefined)).toEqual({ ok: true, args: ['compose', '-f', 'docker-compose.yml', 'up', '-d'] });
    expect(buildDockerArgs('down', 'custom.yml')).toEqual({ ok: true, args: ['compose', '-f', 'custom.yml', 'down'] });
  });
});

describe('isReadOnlyQuery', () => {
  it('accepte SELECT / WITH / EXPLAIN / PRAGMA(read)', () => {
    expect(isReadOnlyQuery('SELECT * FROM users')).toBe(true);
    expect(isReadOnlyQuery('  with t as (select 1) select * from t')).toBe(true);
    expect(isReadOnlyQuery('EXPLAIN QUERY PLAN SELECT 1')).toBe(true);
    expect(isReadOnlyQuery('PRAGMA table_info(users)')).toBe(true);
  });

  it('refuse les écritures et le multi-statement', () => {
    expect(isReadOnlyQuery('DELETE FROM users')).toBe(false);
    expect(isReadOnlyQuery('UPDATE x SET a=1')).toBe(false);
    expect(isReadOnlyQuery('PRAGMA journal_mode = WAL')).toBe(false);
    expect(isReadOnlyQuery('SELECT 1; DROP TABLE users')).toBe(false);
  });

  it('ignore les commentaires', () => {
    expect(isReadOnlyQuery('-- comment\nSELECT 1')).toBe(true);
  });
});
