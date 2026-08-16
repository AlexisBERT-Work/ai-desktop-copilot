import { describe, it, expect } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from './CircuitBreaker';

/** Horloge manuelle : aucun minuteur réel, donc des tests instantanés. */
function clock(start = 0): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: ms => void (t += ms) };
}

const boom = (): Promise<never> => Promise.reject(new Error('source morte'));
const ok = (): Promise<string> => Promise.resolve('contenu');

async function failTimes(cb: CircuitBreaker, key: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await cb.run(key, boom).catch(() => undefined);
  }
}

describe('CircuitBreaker', () => {
  it('laisse tout passer tant que le seuil n’est pas atteint', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    await failTimes(cb, 'lemonde', 2);

    expect(cb.state('lemonde')).toBe('closed');
    await expect(cb.run('lemonde', ok)).resolves.toBe('contenu');
  });

  it('ouvre après N échecs consécutifs et refuse SANS appeler la source', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    await failTimes(cb, 'lemonde', 3);
    expect(cb.state('lemonde')).toBe('open');

    let called = false;
    const err = await cb
      .run('lemonde', async () => {
        called = true;
        return 'x';
      })
      .catch((e: unknown) => e);

    // Tout l'intérêt : on ne repaie pas le timeout d'une source connue morte.
    expect(called).toBe(false);
    expect(err).toBeInstanceOf(CircuitOpenError);
  });

  it('un succès remet le compteur à zéro (échecs non consécutifs)', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    await failTimes(cb, 'lemonde', 2);
    await cb.run('lemonde', ok);
    await failTimes(cb, 'lemonde', 2);

    expect(cb.state('lemonde')).toBe('closed');
  });

  it('isole les sources entre elles', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 2 });
    await failTimes(cb, 'lemonde', 2);

    expect(cb.state('lemonde')).toBe('open');
    expect(cb.state('lesechos')).toBe('closed');
    await expect(cb.run('lesechos', ok)).resolves.toBe('contenu');
  });

  it('passe en half-open après le cooldown et se referme sur un succès', async () => {
    const c = clock();
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000, now: c.now });
    await failTimes(cb, 'lemonde', 2);
    expect(cb.state('lemonde')).toBe('open');

    c.advance(60_000);
    expect(cb.state('lemonde')).toBe('half-open');

    await expect(cb.run('lemonde', ok)).resolves.toBe('contenu');
    expect(cb.state('lemonde')).toBe('closed');
  });

  it('un essai half-open raté rouvre pour un cooldown complet', async () => {
    const c = clock();
    const cb = new CircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000, now: c.now });
    await failTimes(cb, 'lemonde', 2);

    c.advance(60_000);
    await cb.run('lemonde', boom).catch(() => undefined);

    expect(cb.state('lemonde')).toBe('open');
    expect(cb.retryInMs('lemonde')).toBe(60_000);
  });

  it('en half-open, un seul essai passe à la fois', async () => {
    const c = clock();
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 1000, now: c.now });
    await failTimes(cb, 'lemonde', 1);
    c.advance(1000);

    // Sonde en vol (promesse non résolue) : les autres appels sont refusés.
    const inFlight = cb.run('lemonde', () => new Promise<string>(() => undefined));
    void inFlight;

    await expect(cb.run('lemonde', ok)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("propage l'erreur d'origine, pas une CircuitOpenError, tant qu'il appelle", async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3 });
    const err = await cb.run('lemonde', boom).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(CircuitOpenError);
    expect((err as Error).message).toBe('source morte');
  });

  it('annonce le délai restant avant nouvel essai', async () => {
    const c = clock();
    const cb = new CircuitBreaker({ failureThreshold: 1, cooldownMs: 300_000, now: c.now });
    await failTimes(cb, 'yahoo', 1);

    expect(cb.retryInMs('yahoo')).toBe(300_000);
    c.advance(120_000);
    expect(cb.retryInMs('yahoo')).toBe(180_000);
    expect(cb.retryInMs('jamais-vue')).toBe(0);
  });

  it('reset rouvre la voie (reprise manuelle après correction)', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 1 });
    await failTimes(cb, 'lemonde', 1);
    expect(cb.state('lemonde')).toBe('open');

    cb.reset('lemonde');
    expect(cb.state('lemonde')).toBe('closed');
  });
});
