import { RPC_NOTIFICATIONS } from '@catdesk/shared-types';
import type { ActivityTracker } from './ActivityTracker';
import { detectSpiral, type SpiralVerdict } from './tools/productivity/DetectSpiralTool';
import { createLogger } from './logger';

const log = createLogger('runtime:spiral');

export type NotifyFn = (method: string, params: unknown) => void;

export interface SpiralMonitorOptions {
  thresholdMinutes?: number; // minutes on the same signature before flagging
  intervalMs?: number; // how often to evaluate
  cooldownMs?: number; // minimum gap between notifications for the same signature
  now?: () => number;
}

/**
 * Periodically inspects recent activity and, when the user is looping on the
 * same problem, emits a one-shot proactive suggestion. Debounced so it never
 * nags: it won't re-fire for the same signature within the cooldown.
 */
export class SpiralMonitor {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastSignature: string | null = null;
  private lastNotifiedAt = 0;

  private readonly thresholdMinutes: number;
  private readonly intervalMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(
    private tracker: ActivityTracker,
    private notify: NotifyFn,
    opts: SpiralMonitorOptions = {},
  ) {
    this.thresholdMinutes = opts.thresholdMinutes ?? 45;
    this.intervalMs = opts.intervalMs ?? 5 * 60 * 1000; // every 5 min
    this.cooldownMs = opts.cooldownMs ?? 30 * 60 * 1000; // at most once / 30 min per topic
    this.now = opts.now ?? (() => Date.now());
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    // Don't keep the process alive just for the monitor.
    (this.timer as { unref?: () => void }).unref?.();
    log.info('SpiralMonitor started', {
      thresholdMinutes: this.thresholdMinutes,
      intervalMs: this.intervalMs,
    });
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Evaluate once. Returns the verdict and whether a notification was emitted. */
  tick(): { verdict: SpiralVerdict; notified: boolean } {
    const verdict = detectSpiral(this.tracker.recent(), this.thresholdMinutes);
    let notified = false;

    if (verdict.spiraling && this.shouldNotify(verdict.dominantSignature)) {
      this.notify(RPC_NOTIFICATIONS.proactiveSuggestion, {
        kind: 'spiral',
        signature: verdict.dominantSignature,
        minutesOnTopic: verdict.minutesOnTopic,
        repetitions: verdict.repetitions,
        failureCount: verdict.failureCount,
        reason: verdict.reason,
        suggestion: verdict.suggestion,
      });
      this.lastSignature = verdict.dominantSignature;
      this.lastNotifiedAt = this.now();
      notified = true;
      log.info('Spiral detected — suggestion emitted', {
        signature: verdict.dominantSignature,
        minutes: verdict.minutesOnTopic,
      });
    }

    return { verdict, notified };
  }

  private shouldNotify(signature: string | null): boolean {
    if (signature === null) return false;
    // New topic → always allowed.
    if (signature !== this.lastSignature) return true;
    // Same topic → only after the cooldown elapses.
    return this.now() - this.lastNotifiedAt >= this.cooldownMs;
  }
}
