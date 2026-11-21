import { describe, expect, it, vi, beforeEach } from 'vitest';

// Le vrai shell n'est pas lancé : on observe ce que l'outil DEMANDE à runProcess.
const runProcess = vi.fn();
vi.mock('../../lib/runProcess', () => ({ runProcess: (...a: unknown[]) => runProcess(...a) }));

import { RunCommandTool } from './RunCommandTool';
import { expectFail, expectOk } from '../base/testResult';

beforeEach(() => {
  runProcess.mockReset();
  runProcess.mockResolvedValue({ stdout: ' ok \n', stderr: '' });
});

describe('run_command', () => {
  const tool = new RunCommandTool();

  it('est à risque élevé, avec confirmation', () => {
    expect(tool.riskLevel).toBe('high');
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('refuse une commande bloquée par la politique, sans rien lancer', async () => {
    const res = await tool.run({ command: 'powershell -enc ZQBjAGgAbwA=' });
    expect(expectFail(res).error).toContain('politique de sécurité');
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('refuse une commande trop longue', async () => {
    const res = await tool.run({ command: 'echo ' + 'x'.repeat(3000) });
    expect(expectFail(res).error).toContain('trop longue');
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("ne transmet qu'une liste blanche d'environnement (aucun secret du .env)", async () => {
    process.env['GITHUB_TOKEN'] = 'ghp_secret';
    await tool.run({ command: 'echo %GITHUB_TOKEN%', shell: 'cmd' });
    const [program, args, opts] = runProcess.mock.calls[0] as [
      string,
      string[],
      { env: Record<string, string>; timeoutMs: number; maxBuffer: number },
    ];
    expect(program).toBe('cmd.exe');
    expect(args).toEqual(['/C', 'echo %GITHUB_TOKEN%']);
    expect(Object.keys(opts.env).sort()).toEqual(['PATH', 'TEMP', 'USERPROFILE']);
    expect(JSON.stringify(opts.env)).not.toContain('ghp_secret');
    expect(opts.maxBuffer).toBe(5 * 1024 * 1024);
    delete process.env['GITHUB_TOKEN'];
  });

  it('PowerShell par défaut ; sortie nettoyée et code 0', async () => {
    const data = expectOk(await tool.run({ command: 'Get-Date' })).data as {
      stdout: string;
      exitCode: number;
    };
    expect(runProcess.mock.calls[0]?.[0]).toBe('powershell.exe');
    expect(data).toMatchObject({ stdout: 'ok', exitCode: 0 });
  });

  it('un code de sortie non nul est un résultat (pas une erreur), avec stderr', async () => {
    runProcess.mockRejectedValueOnce(
      Object.assign(new Error('Command failed'), { code: 2, stdout: '', stderr: 'introuvable' }),
    );
    const data = expectOk(await tool.run({ command: 'dir Z:' })).data as {
      exitCode: number;
      stderr: string;
    };
    expect(data).toMatchObject({ exitCode: 2, stderr: 'introuvable' });
  });

  it('un dépassement de délai est un échec explicite', async () => {
    runProcess.mockRejectedValueOnce(Object.assign(new Error('killed'), { killed: true }));
    const res = await tool.run({ command: 'Start-Sleep 999', timeoutMs: 1000 });
    expect(expectFail(res).error).toContain('Timeout');
  });
});
