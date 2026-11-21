/**
 * Opérations natives faites par l'hôte (le cœur Rust de CatDesk) pour le
 * compte d'un outil : lire les fenêtres par UI Automation, agir sur elles.
 *
 * L'agent ne touche pas aux API Windows : il émet `desktop.request`, le cœur
 * Rust valide, exécute, audite, et répond par `desktop.response` (voir
 * `core/desktop.rs`). Hors de CatDesk (tests, banc, agent lancé seul), personne
 * ne répond : l'appel échoue au bout du délai, proprement.
 */
import { randomUUID } from 'crypto';
import { RPC_NOTIFICATIONS } from '@catdesk/shared-types';
import { stdoutNotifier, type NotifyFn } from '../ipc/Notifier';
import { createLogger } from '../logger';

const log = createLogger('desktop:host');

export type DesktopAction = 'list_windows' | 'read_window' | 'window_action';

export type DesktopResult = { ok: true; data: unknown } | { ok: false; error: string };

/** La lecture s'arrête d'elle-même vers 3 s côté Rust, et l'hôte coupe à 10 s. */
const DEFAULT_TIMEOUT_MS = 12_000;

interface Pending {
  resolve: (result: DesktopResult) => void;
  timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class DesktopHost {
  private static instance: DesktopHost | null = null;
  private pending = new Map<string, Pending>();

  constructor(
    private readonly notify: NotifyFn = stdoutNotifier,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  static get(): DesktopHost {
    DesktopHost.instance ??= new DesktopHost();
    return DesktopHost.instance;
  }

  /** Ne rejette jamais : un échec, un refus ou un délai dépassé valent `ok: false`. */
  request(action: DesktopAction, params: Record<string, unknown>): Promise<DesktopResult> {
    const requestId = randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({
          ok: false,
          error:
            "CatDesk n'a pas répondu (lecture des fenêtres indisponible hors de l'application).",
        });
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, timer });
      this.notify(RPC_NOTIFICATIONS.desktopRequest, { requestId, action, params });
    });
  }

  /** Réponse de l'hôte (`desktop.response`), relayée par le bridge stdin. */
  resolve(payload: unknown): void {
    if (!isRecord(payload) || typeof payload['requestId'] !== 'string') {
      log.warn('desktop.response mal formée');
      return;
    }
    const pending = this.pending.get(payload['requestId']);
    if (!pending) return; // délai déjà dépassé
    this.pending.delete(payload['requestId']);
    clearTimeout(pending.timer);
    if (payload['ok'] === true) {
      pending.resolve({ ok: true, data: payload['data'] });
    } else {
      const error = typeof payload['error'] === 'string' ? payload['error'] : 'échec';
      pending.resolve({ ok: false, error });
    }
  }
}
