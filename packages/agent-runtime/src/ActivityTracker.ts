import type { ActivityEvent } from './tools/productivity/DetectSpiralTool';

/**
 * Derive a stable "what is being worked on" signature from a tool call, so that
 * repeated work on the same file / error / command collapses together for the
 * spiral detector.
 */
export function deriveSignature(toolName: string, args: Record<string, unknown>): string {
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');

  const path = str(args['path']) || str(args['db_path']) || str(args['note']) || str(args['target']);
  if (path.length > 0) return `file:${path}`;

  const stack = str(args['stacktrace']);
  if (stack.length > 0) return `error:${stack.split('\n')[0]?.slice(0, 80) ?? ''}`;

  const url = str(args['url']);
  if (url.length > 0) return `url:${url}`;

  const command = str(args['command']);
  if (command.length > 0) return `cmd:${command.trim().split(/\s+/)[0] ?? ''}`;

  const query = str(args['query']);
  if (query.length > 0) return `query:${query.slice(0, 60)}`;

  return `tool:${toolName}`;
}

// Tools whose use signals active debugging (counts toward "failure" pressure).
const DEBUG_TOOLS = new Set(['analyze_stacktrace', 'review_diff', 'bisect_guided', 'resolve_conflicts']);

export function deriveKind(toolName: string, success: boolean): string | undefined {
  if (!success) return 'error';
  if (DEBUG_TOOLS.has(toolName)) return 'error';
  return undefined;
}

/**
 * In-memory rolling window of recent activity events. Feeds the SpiralMonitor.
 * Bounded by both a time window and a hard cap so it never grows unbounded.
 */
export class ActivityTracker {
  private events: ActivityEvent[] = [];

  constructor(
    private windowMs = 2 * 60 * 60 * 1000, // 2 hours
    private cap = 500,
    private now: () => number = () => Date.now(),
  ) {}

  record(signature: string, kind?: string): void {
    if (signature.length === 0) return;
    this.events.push({ at: String(this.now()), signature, ...(kind !== undefined ? { kind } : {}) });
    this.prune();
  }

  recordToolCall(toolName: string, args: Record<string, unknown>, success: boolean): void {
    this.record(deriveSignature(toolName, args), deriveKind(toolName, success));
  }

  recent(): ActivityEvent[] {
    this.prune();
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }

  private prune(): void {
    const cutoff = this.now() - this.windowMs;
    this.events = this.events.filter((e) => Number(e.at) >= cutoff);
    if (this.events.length > this.cap) this.events = this.events.slice(-this.cap);
  }
}
