import { describe, it, expect } from 'vitest';
import { isReadOnlyDbQuery, detectDialect, QueryDatabaseTool } from './QueryDatabaseTool';

describe('isReadOnlyDbQuery', () => {
  it('accepte select/with/explain/show', () => {
    expect(isReadOnlyDbQuery('SELECT * FROM users')).toBe(true);
    expect(isReadOnlyDbQuery('  with t as (select 1) select * from t')).toBe(true);
    expect(isReadOnlyDbQuery('EXPLAIN SELECT 1')).toBe(true);
    expect(isReadOnlyDbQuery('SHOW TABLES')).toBe(true);
    expect(isReadOnlyDbQuery('SELECT 1;')).toBe(true); // trailing ; ok
  });

  it('refuse les écritures et le multi-statement', () => {
    expect(isReadOnlyDbQuery('UPDATE users SET x=1')).toBe(false);
    expect(isReadOnlyDbQuery('DELETE FROM users')).toBe(false);
    expect(isReadOnlyDbQuery('DROP TABLE users')).toBe(false);
    expect(isReadOnlyDbQuery('SELECT 1; DROP TABLE users')).toBe(false);
    expect(isReadOnlyDbQuery('')).toBe(false);
  });

  it('ignore les commentaires en tête', () => {
    expect(isReadOnlyDbQuery('-- note\nSELECT 1')).toBe(true);
    expect(isReadOnlyDbQuery('/* x */ DELETE FROM t')).toBe(false);
  });
});

describe('detectDialect', () => {
  it('priorise le dialect explicite', () => {
    expect(detectDialect(undefined, 'postgres')).toBe('postgres');
    expect(detectDialect('mysql://x', 'postgres')).toBe('postgres');
  });

  it('déduit depuis le schéma de la connection string', () => {
    expect(detectDialect('postgres://u:p@h/db')).toBe('postgres');
    expect(detectDialect('postgresql://u:p@h/db')).toBe('postgres');
    expect(detectDialect('mysql://u:p@h/db')).toBe('mysql');
    expect(detectDialect('mariadb://u:p@h/db')).toBe('mysql');
  });

  it('renvoie null si indéterminable', () => {
    expect(detectDialect(undefined)).toBeNull();
    expect(detectDialect('redis://x')).toBeNull();
  });
});

describe('QueryDatabaseTool', () => {
  const tool = new QueryDatabaseTool();

  it('est medium, sans confirmation (lecture seule par défaut)', () => {
    expect(tool.riskLevel).toBe('medium');
    expect(tool.requiresConfirmation).toBe(false);
  });

  it('rejette une query vide', async () => {
    expect((await tool.run({ query: '  ' })).success).toBe(false);
  });

  it('échoue sans dialect ni connection string déterminables', async () => {
    const r = await tool.run({ query: 'SELECT 1' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('dialect');
  });

  it('bloque une écriture en lecture seule avant toute connexion', async () => {
    const r = await tool.run({
      query: 'DELETE FROM t',
      connection_string: 'postgres://u:p@127.0.0.1:1/db',
    });
    expect(r.success).toBe(false);
    expect(r.error).toContain('lecture seule');
  });
});
