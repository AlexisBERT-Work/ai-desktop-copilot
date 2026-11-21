import { describe, expect, it } from 'vitest';
import { hasDotCommand, RunSqliteTool } from './RunSqliteTool';
import { expectFail } from '../base/testResult';

describe('run_sqlite — commandes point du CLI', () => {
  it('détecte une commande point, même après du SQL ou des espaces', () => {
    expect(hasDotCommand('.shell calc')).toBe(true);
    expect(hasDotCommand('SELECT 1;\n  .system whoami')).toBe(true);
    expect(hasDotCommand('SELECT 1;\r\n.output C:/x.txt')).toBe(true);
    expect(hasDotCommand("SELECT '.shell' AS texte")).toBe(false);
  });

  it('les refuse AVANT tout accès, même avec read_only=false', async () => {
    const res = await new RunSqliteTool().run({
      db_path: 'C:/inexistant.db',
      query: '.shell calc',
      read_only: false,
    });
    expect(expectFail(res).error).toContain('Commandes point');
  });

  it('refuse un db_path qui ressemble à une option du CLI', async () => {
    const res = await new RunSqliteTool().run({ db_path: '-cmd', query: 'SELECT 1' });
    expect(expectFail(res).error).toContain('db_path invalide');
  });
});
