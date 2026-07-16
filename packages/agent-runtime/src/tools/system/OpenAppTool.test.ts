import { describe, it, expect } from 'vitest';
import { OpenAppTool, validateAppName } from './OpenAppTool';

describe('validateAppName', () => {
  it('refuse vide / blancs', () => {
    expect(validateAppName('')).not.toBeNull();
    expect(validateAppName('   ')).not.toBeNull();
  });

  it('refuse les caractères de contrôle', () => {
    expect(validateAppName('notepad\r\ncalc')).not.toBeNull();
    expect(validateAppName('note\0pad')).not.toBeNull();
  });

  it('refuse les noms démesurés', () => {
    expect(validateAppName('a'.repeat(501))).not.toBeNull();
  });

  it('accepte noms simples et chemins', () => {
    expect(validateAppName('notepad')).toBeNull();
    expect(validateAppName('C:\\Program Files\\App\\app.exe')).toBeNull();
    // Une single quote est acceptée (échappée à l'exécution, pas ici)
    expect(validateAppName("l'app")).toBeNull();
  });

  // ─── Vuln 2 (docs/SECURITE.md): open_app ne doit pas lancer d'interpréteurs ───
  it('refuse les interpréteurs (contournement de run_command)', () => {
    for (const n of [
      'powershell',
      'PowerShell.exe',
      'cmd',
      'CMD.EXE',
      'pwsh',
      'wscript',
      'cscript',
      'mshta',
      'rundll32',
      'python',
      'node',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ]) {
      expect(validateAppName(n), n).not.toBeNull();
    }
  });
});

describe('OpenAppTool.execute — validation seulement (pas de vrai lancement)', () => {
  const tool = new OpenAppTool();

  it('refuse un name invalide sans rien lancer', async () => {
    const res = await tool.run({ name: 'evil\napp' });
    expect(res.success).toBe(false);
  });

  it('refuse des args avec caractères interdits', async () => {
    const res = await tool.run({ name: 'notepad', args: 'x\ny' });
    expect(res.success).toBe(false);
  });
});
