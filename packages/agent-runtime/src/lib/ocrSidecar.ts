import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import { existsSync } from 'fs';
import { join, dirname, parse } from 'path';
import { createLogger } from '../logger';

const log = createLogger('ocr:client');

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

/**
 * Singleton client for the Python OCR/Vision sidecar.
 * Communicates via JSON-RPC 2.0 over stdin/stdout.
 * Process is lazily spawned on first call.
 */
export class OcrSidecarClient {
  private static _instance: OcrSidecarClient | null = null;

  private proc: ChildProcess | null = null;
  private pending = new Map<string, PendingRequest>();
  private startPromise: Promise<void> | null = null;
  private idCounter = 0;

  static get(): OcrSidecarClient {
    if (!OcrSidecarClient._instance) {
      OcrSidecarClient._instance = new OcrSidecarClient();
    }
    return OcrSidecarClient._instance;
  }

  private _repoRoot: string | null = null;

  /**
   * Locate the monorepo root that holds `packages/ocr-vision`. We can't rely on
   * `process.cwd()`: in dev the agent runs with its cwd set to
   * `packages/agent-runtime`, so `join(cwd, 'packages/ocr-vision/…')` doubled
   * the path (`…/agent-runtime/packages/ocr-vision`) and spawn ENOENT'd. Walk up
   * from cwd until we find the OCR sidecar; fall back to cwd if not found.
   */
  private repoRoot(): string {
    if (this._repoRoot) return this._repoRoot;
    let dir = process.cwd();
    const { root } = parse(dir);
    for (;;) {
      if (existsSync(join(dir, 'packages', 'ocr-vision', 'main.py'))) break;
      if (dir === root) { dir = process.cwd(); break; }
      dir = dirname(dir);
    }
    this._repoRoot = dir;
    return dir;
  }

  private pythonPath(): string {
    return (
      process.env['OCR_PYTHON'] ??
      join(this.repoRoot(), 'packages/ocr-vision/.venv/Scripts/python.exe')
    );
  }

  private scriptPath(): string {
    return (
      process.env['OCR_SCRIPT'] ??
      join(this.repoRoot(), 'packages/ocr-vision/main.py')
    );
  }

  private isRunning(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  async ensureRunning(): Promise<void> {
    if (this.isRunning()) return;
    this.startPromise ??= this._start().catch(err => {
      this.startPromise = null;
      throw err;
    });
    return this.startPromise;
  }

  private async _start(): Promise<void> {
    // In a packaged install the OCR sidecar ships as a self-contained
    // PyInstaller exe (no Python / venv on the target machine). When
    // OCR_SIDECAR_BIN is set we launch it directly; otherwise we fall back to
    // running main.py through the dev venv interpreter.
    const bundledBin = process.env['OCR_SIDECAR_BIN'];
    const command = bundledBin ?? this.pythonPath();
    const args = bundledBin ? [] : [this.scriptPath()];

    // Tesseract trouve ses données de langue via TESSDATA_PREFIX. On pointe vers
    // un dossier utilisateur (eng+fra+osd) car Program Files n'est pas accessible
    // en écriture sans admin. Surchargeable via l'env système.
    const tessdata =
      process.env['TESSDATA_PREFIX'] ??
      join(process.env['LOCALAPPDATA'] ?? '', 'nd-tessdata');

    log.info('Starting OCR sidecar', { command, args, tessdata });

    this.proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: { ...process.env, TESSDATA_PREFIX: tessdata },
    });

    this.proc.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      if (line) log.debug('OCR sidecar', { msg: line });
    });

    // spawn() emits 'error' (e.g. ENOENT when the venv/exe is missing) instead
    // of throwing. Without this handler the event is unhandled and crashes the
    // whole agent as an uncaught exception; here we fail the start gracefully so
    // the calling tool just reports the OCR sidecar is unavailable.
    this.proc.on('error', err => {
      log.error('OCR sidecar failed to start', { command, message: err.message });
      this.proc = null;
      this.startPromise = null;
      for (const [, handler] of this.pending) handler.reject(err);
      this.pending.clear();
    });

    this.proc.on('exit', code => {
      log.warn('OCR sidecar exited', { code });
      this.proc = null;
      this.startPromise = null;
      for (const [, handler] of this.pending) {
        handler.reject(new Error('OCR sidecar exited unexpectedly'));
      }
      this.pending.clear();
    });

    if (!this.proc.stdout) throw new Error('OCR sidecar stdout not available');

    const rl = createInterface({ input: this.proc.stdout });
    rl.on('line', line => {
      try {
        const msg = JSON.parse(line) as {
          id?: string | number;
          result?: unknown;
          error?: { message: string };
        };
        const id = String(msg.id ?? '');
        const handler = this.pending.get(id);
        if (!handler) return;
        this.pending.delete(id);
        if (msg.error) {
          handler.reject(new Error(msg.error.message));
        } else {
          handler.resolve(msg.result);
        }
      } catch {
        // non-JSON line — ignore
      }
    });

    // Health check to confirm startup
    await this._send('health.check', {}, 8_000);
    log.info('OCR sidecar ready');
  }

  async call(method: string, params: object, timeoutMs = 30_000): Promise<unknown> {
    await this.ensureRunning();
    return this._send(method, params, timeoutMs);
  }

  private _send(method: string, params: object, timeoutMs: number): Promise<unknown> {
    const id = String(++this.idCounter);
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      const proc = this.proc;
      if (!proc?.stdin) {
        reject(new Error('OCR sidecar not running'));
        return;
      }

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`OCR timeout: ${method} (>${timeoutMs}ms)`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: v => { clearTimeout(timer); resolve(v); },
        reject: e => { clearTimeout(timer); reject(e); },
      });

      proc.stdin.write(payload);
    });
  }

  shutdown(): void {
    if (this.proc) {
      this.proc.stdin?.end();
      this.proc.kill();
      this.proc = null;
    }
    this.startPromise = null;
  }
}
