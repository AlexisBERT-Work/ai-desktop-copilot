import { describe, expect, it } from 'vitest';
import { InspectFileLeaksTool } from './InspectFileLeaksTool';
import { expectFail, expectOk } from '../base/testResult';

describe('inspect_file_leaks', () => {
  it('passe le chemin au sidecar et rend ses constats tels quels', async () => {
    const calls: unknown[] = [];
    const report = { resume: '1 point(s) à vérifier, dont 1 élevé(s).', constats: [] };
    const tool = new InspectFileLeaksTool(async (method, params) => {
      calls.push({ method, params });
      return report;
    });
    expect(expectOk(await tool.run({ path: ' C:/docs/Devis.DOCX ' })).data).toEqual(report);
    expect(calls).toEqual([
      { method: 'files.inspect_leaks', params: { path: 'C:/docs/Devis.DOCX' } },
    ]);
  });

  it('refuse un format non inspecté sans appeler le sidecar', async () => {
    let called = false;
    const tool = new InspectFileLeaksTool(async () => {
      called = true;
      return {};
    });
    expect(expectFail(await tool.run({ path: 'notes.txt' })).error).toMatch(/Format non inspecté/);
    expect(called).toBe(false);
  });

  it('traduit un fichier introuvable', async () => {
    const tool = new InspectFileLeaksTool(async () => {
      throw new Error('[Errno 2] No such file: x.pdf');
    });
    expect(expectFail(await tool.run({ path: 'x.pdf' })).error).toMatch(/introuvable/);
  });

  it('lecture seule : risque faible, chemin vérifié par la liste blanche', () => {
    const tool = new InspectFileLeaksTool();
    expect(tool.riskLevel).toBe('low');
    expect(tool.pathArgs).toEqual(['path']);
  });
});
