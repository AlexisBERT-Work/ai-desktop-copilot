import { describe, expect, it } from 'vitest';
import { runProcess } from './runProcess';

/**
 * Ces tests gardent les défauts sûrs de runProcess : c'est parce qu'ils
 * n'existaient pas que 13 outils avaient pu repartir sur leur propre
 * `promisify(execFile)` en reperdant timeout et windowsHide.
 *
 * On pilote `node` lui-même : disponible partout où les tests tournent, et
 * indépendant du shell de la plateforme.
 */
const NODE = process.execPath;

describe('runProcess', () => {
  it('retourne stdout et stderr séparément', async () => {
    const { stdout, stderr } = await runProcess(NODE, [
      '-e',
      'process.stdout.write("sortie"); process.stderr.write("erreur")',
    ]);
    expect(stdout).toBe('sortie');
    expect(stderr).toBe('erreur');
  });

  it('rejette avec le code de sortie quand le process échoue', async () => {
    await expect(runProcess(NODE, ['-e', 'process.exit(3)'])).rejects.toMatchObject({ code: 3 });
  });

  it('tue le process au-delà de timeoutMs et signale killed', async () => {
    await expect(
      runProcess(NODE, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 300 }),
    ).rejects.toMatchObject({ killed: true });
  });

  it('applique cwd', async () => {
    const { stdout } = await runProcess(NODE, ['-e', 'process.stdout.write(process.cwd())'], {
      cwd: __dirname,
    });
    expect(stdout.toLowerCase()).toBe(__dirname.toLowerCase());
  });

  it('env REMPLACE l’environnement hérité (liste blanche de run_command)', async () => {
    process.env['CATDESK_RUNPROCESS_FUITE'] = 'ne-doit-pas-passer';
    try {
      const { stdout } = await runProcess(
        NODE,
        ['-e', 'process.stdout.write(String(process.env.CATDESK_RUNPROCESS_FUITE))'],
        { env: { AUTORISEE: '1' } },
      );
      expect(stdout).toBe('undefined');
    } finally {
      delete process.env['CATDESK_RUNPROCESS_FUITE'];
    }
  });

  it('rejette quand la sortie dépasse maxBuffer au lieu de la tronquer en silence', async () => {
    await expect(
      runProcess(NODE, ['-e', 'process.stdout.write("x".repeat(50000))'], { maxBuffer: 1024 }),
    ).rejects.toThrow();
  });
});
