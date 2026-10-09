import { describe, expect, it, vi } from 'vitest';
import { BackgroundAbortedError, LlmScheduler } from './LlmScheduler';

const QUIET = 40;
const tick = (ms: number) => new Promise(r => setTimeout(r, ms));

function scheduler(extra: ConstructorParameters<typeof LlmScheduler>[0] = {}) {
  return new LlmScheduler({ quietMs: QUIET, pollMs: 5, primeDelayMs: 5, ...extra });
}

/** Un « appel LLM » de fond : dure `ms`, lève si son signal est annulé. */
function slowCall(ms: number, log: string[], label: string) {
  return (signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      log.push(`start ${label}`);
      const t = setTimeout(() => resolve(label), ms);
      signal.addEventListener('abort', () => {
        clearTimeout(t);
        log.push(`aborted ${label}`);
        reject(new Error('aborted'));
      });
    });
}

describe('LlmScheduler', () => {
  it("exécute tout de suite si l'utilisateur n'a encore rien demandé", async () => {
    const s = scheduler();
    const started = Date.now();
    await expect(s.runPreemptible(async () => 'ok')).resolves.toBe('ok');
    expect(Date.now() - started).toBeLessThan(QUIET);
  });

  it('attend `quietMs` de silence après un run avant de prendre le GPU', async () => {
    const s = scheduler();
    s.beginForeground();
    s.endForeground();
    const started = Date.now();
    await s.runPreemptible(async () => 'ok');
    expect(Date.now() - started).toBeGreaterThanOrEqual(QUIET - 5);
  });

  it('un run interrompt l’appel de fond, qui est relancé ensuite et rend son résultat', async () => {
    const s = scheduler();
    const log: string[] = [];
    const pending = s.runPreemptible(slowCall(30, log, 'faits'));
    await tick(10);
    s.beginForeground(); // l'utilisateur pose une question
    await tick(5);
    expect(log).toEqual(['start faits', 'aborted faits']);
    s.endForeground();
    await expect(pending).resolves.toBe('faits');
    expect(log).toEqual(['start faits', 'aborted faits', 'start faits']);
  });

  it("un appel de fond lancé PENDANT un run (un outil) s'exécute sans attendre — pas d'interblocage", async () => {
    const s = scheduler();
    s.beginForeground();
    // Comme l'orchestrateur : le générateur du run est piloté sous inForeground.
    async function* run() {
      await tick(1);
      yield await s.runPreemptible(async () => 'résumé');
    }
    const steps = run();
    const first = await s.inForeground(() => steps.next());
    expect(first.value).toBe('résumé');
    s.endForeground();
  });

  it('une tâche planifiée DEPUIS un run reste du fond : interruptible par le run suivant', async () => {
    const s = scheduler();
    const log: string[] = [];
    // Comme finalizeAnswer : schedule() appelé dans le contexte premier plan.
    s.beginForeground();
    await s.inForeground(async () => {
      s.schedule('facts:c1', async () => {
        await s.runPreemptible(slowCall(60, log, 'faits'));
      });
    });
    s.endForeground();
    await tick(QUIET + 20); // le calme revient, l'extraction démarre
    expect(log).toEqual(['start faits']);
    s.beginForeground(); // question suivante
    await tick(5);
    expect(log).toEqual(['start faits', 'aborted faits']);
    s.endForeground();
    s.dispose();
  });

  it("annulé par l'appelant : lève sans relancer", async () => {
    const s = scheduler();
    const caller = new AbortController();
    const fn = vi.fn((signal: AbortSignal) => slowCall(50, [], 'x')(signal));
    const pending = s.runPreemptible(fn, caller.signal);
    await tick(5);
    caller.abort();
    await expect(pending).rejects.toThrow();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('schedule : par clé, seule la tâche la plus récente qui attend encore est exécutée', async () => {
    const s = scheduler();
    const ran: string[] = [];
    s.beginForeground();
    s.endForeground();
    s.schedule('facts:c1', async () => void ran.push('tour 1'));
    s.schedule('facts:c1', async () => void ran.push('tour 2'));
    s.schedule('facts:c2', async () => void ran.push('autre conversation'));
    expect(s.pendingCount).toBe(2);
    await tick(QUIET + 30);
    expect(ran).toEqual(['tour 2', 'autre conversation']);
  });

  it("re-préchauffe le cache après du travail de fond si l'utilisateur était là récemment", async () => {
    const s = scheduler();
    const primer = vi.fn(async () => {});
    s.setPrimer(primer);
    s.beginForeground();
    s.endForeground();
    await s.runPreemptible(async () => 'faits');
    await tick(20);
    expect(primer).toHaveBeenCalledOnce();
  });

  it("ne re-préchauffe pas sans activité récente de l'utilisateur (digest de 7 h)", async () => {
    const s = scheduler();
    const primer = vi.fn(async () => {});
    s.setPrimer(primer);
    await s.runPreemptible(async () => 'digest');
    await tick(20);
    expect(primer).not.toHaveBeenCalled();
  });

  it("l'arrêt abandonne les attentes en cours", async () => {
    const s = scheduler();
    s.beginForeground(); // run en cours : l'appel de fond attend
    const pending = s.runPreemptible(async () => 'jamais');
    await tick(10);
    s.dispose();
    await expect(pending).rejects.toBeInstanceOf(BackgroundAbortedError);
  });
});
