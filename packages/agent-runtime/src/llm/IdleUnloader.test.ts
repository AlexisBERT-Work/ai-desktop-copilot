import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IdleUnloader } from './IdleUnloader';

function fakeLlm() {
  const unload = vi.fn(async (_model: string) => {});
  return { unload };
}

describe('IdleUnloader', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('décharge le modèle après la fenêtre d\'inactivité', () => {
    const llm = fakeLlm();
    const u = new IdleUnloader(llm, { idleMs: 1000 });

    u.begin('devstral:24b');
    u.end();
    expect(llm.unload).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(llm.unload).toHaveBeenCalledWith('devstral:24b');
  });

  it('ne décharge pas tant qu\'un run est actif (relance reset le minuteur)', () => {
    const llm = fakeLlm();
    const u = new IdleUnloader(llm, { idleMs: 1000 });

    u.begin('m');
    u.end();
    vi.advanceTimersByTime(900);

    // Nouveau run avant l'échéance → annule le déchargement.
    u.begin('m');
    vi.advanceTimersByTime(900);
    expect(llm.unload).not.toHaveBeenCalled();

    u.end();
    vi.advanceTimersByTime(1000);
    expect(llm.unload).toHaveBeenCalledTimes(1);
  });

  it('ne décharge qu\'une fois le dernier run concurrent terminé', () => {
    const llm = fakeLlm();
    const u = new IdleUnloader(llm, { idleMs: 1000 });

    u.begin('m');
    u.begin('m'); // run imbriqué (sous-agent)
    u.end();
    vi.advanceTimersByTime(2000);
    expect(llm.unload).not.toHaveBeenCalled();

    u.end();
    vi.advanceTimersByTime(1000);
    expect(llm.unload).toHaveBeenCalledTimes(1);
  });

  it('respecte enabled=false (jamais de déchargement)', () => {
    const llm = fakeLlm();
    const u = new IdleUnloader(llm, { idleMs: 1000, enabled: false });

    u.begin('m');
    u.end();
    vi.advanceTimersByTime(10_000);
    expect(llm.unload).not.toHaveBeenCalled();
  });

  it('unloadNow décharge immédiatement et annule le minuteur', async () => {
    const llm = fakeLlm();
    const u = new IdleUnloader(llm, { idleMs: 1000 });

    u.begin('m');
    u.end();
    await u.unloadNow();
    expect(llm.unload).toHaveBeenCalledTimes(1);

    // Le minuteur a été annulé : pas de second appel.
    vi.advanceTimersByTime(1000);
    expect(llm.unload).toHaveBeenCalledTimes(1);
  });
});
