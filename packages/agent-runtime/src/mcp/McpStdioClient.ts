/**
 * Client MCP minimal sur stdio : JSON-RPC 2.0, un message par ligne.
 *
 * Écrit à la main plutôt que tiré du SDK officiel : il ne faut ici que quatre
 * messages (`initialize`, `notifications/initialized`, `tools/list`,
 * `tools/call`), et le SDK embarque un serveur HTTP complet (express…) que
 * CatDesk n'utiliserait pas. Surtout, chaque borne est visible ici :
 * - taille d'un message (`MAX_MESSAGE_CHARS`) : au-delà, le serveur est arrêté ;
 * - durée de chaque requête, et `notifications/cancelled` envoyé au serveur ;
 * - pas de relance en boucle d'un serveur qui ne démarre pas (`RESTART_COOLDOWN_MS`) ;
 * - environnement minimal : le serveur ne voit pas les secrets du .env de CatDesk.
 *
 * Aucune capacité client n'est annoncée (ni sampling, ni roots, ni elicitation) :
 * le serveur ne peut rien demander au modèle ni au disque à travers CatDesk.
 */
import { spawn, type ChildProcess } from 'child_process';
import { createLogger } from '../logger';

const log = createLogger('mcp:client');

/** Versions du protocole dont `tools/list` et `tools/call` ont la forme attendue ici. */
const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);

/** Un message plus long fait arrêter le serveur (borne mémoire, ~1 Mo). */
export const MAX_MESSAGE_CHARS = 1_000_000;
const START_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 10_000;
const MAX_LIST_PAGES = 5;
/** Après un démarrage raté, pas de nouvel essai avant ce délai. */
const RESTART_COOLDOWN_MS = 30_000;
const KILL_GRACE_MS = 2_000;

/**
 * Variables transmises au serveur, en plus de celles de sa déclaration : de
 * quoi trouver ses exécutables et ses dossiers, rien de plus. Les jetons des
 * connecteurs chargés depuis le .env (GITHUB_TOKEN, NOTION_TOKEN…) n'y sont pas.
 */
const INHERITED_ENV = [
  'PATH',
  'PATHEXT',
  'SYSTEMROOT',
  'SYSTEMDRIVE',
  'WINDIR',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'COMSPEC',
];

export interface McpServerProcess {
  id: string;
  command: string;
  args: readonly string[];
  cwd?: string | undefined;
  env: Readonly<Record<string, string>>;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpCallResult {
  content: readonly unknown[];
  isError: boolean;
  structuredContent?: unknown;
}

/** Ce dont un outil MCP a besoin : de quoi appeler (un double en test). */
export interface McpCaller {
  callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<McpCallResult>;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function childEnv(extra: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of INHERITED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}

export class McpStdioClient implements McpCaller {
  private proc: ChildProcess | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private starting: Promise<void> | null = null;
  private lastFailure = 0;
  private partial = '';
  private closed = false;

  constructor(private readonly server: McpServerProcess) {}

  get id(): string {
    return this.server.id;
  }

  /** Démarre le serveur et fait la poignée de main, une seule fois à la fois. */
  async start(): Promise<void> {
    if (this.closed) throw new Error('client MCP fermé');
    if (this.proc) return;
    const sinceFailure = Date.now() - this.lastFailure;
    if (this.lastFailure > 0 && sinceFailure < RESTART_COOLDOWN_MS) {
      throw new Error(
        `serveur indisponible (échec il y a ${Math.round(sinceFailure / 1000)} s, nouvel essai dans ${Math.ceil((RESTART_COOLDOWN_MS - sinceFailure) / 1000)} s)`,
      );
    }
    this.starting ??= this.spawnAndInitialize().catch((err: unknown) => {
      this.lastFailure = Date.now();
      this.stopProcess();
      throw err;
    });
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async listTools(): Promise<McpToolInfo[]> {
    await this.start();
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const result = await this.request(
        'tools/list',
        cursor !== undefined ? { cursor } : {},
        LIST_TIMEOUT_MS,
      );
      const list = isRecord(result) && Array.isArray(result['tools']) ? result['tools'] : [];
      for (const item of list) {
        if (!isRecord(item) || typeof item['name'] !== 'string') continue;
        tools.push({
          name: item['name'],
          ...(typeof item['description'] === 'string' ? { description: item['description'] } : {}),
          ...(item['inputSchema'] !== undefined ? { inputSchema: item['inputSchema'] } : {}),
        });
      }
      const next = isRecord(result) ? result['nextCursor'] : undefined;
      if (typeof next !== 'string' || next.length === 0) break;
      cursor = next;
    }
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<McpCallResult> {
    await this.start();
    const result = await this.request('tools/call', { name, arguments: args }, timeoutMs);
    if (!isRecord(result)) throw new Error('réponse tools/call illisible');
    return {
      content: Array.isArray(result['content']) ? result['content'] : [],
      isError: result['isError'] === true,
      ...(result['structuredContent'] !== undefined
        ? { structuredContent: result['structuredContent'] }
        : {}),
    };
  }

  /** Arrêt définitif (fermeture de CatDesk) : plus aucun redémarrage. */
  close(): void {
    this.closed = true;
    this.failAll('client MCP fermé');
    this.stopProcess();
  }

  private async spawnAndInitialize(): Promise<void> {
    const { id, command, args, cwd, env } = this.server;
    log.info('Starting MCP server', { id, command, args });
    const proc = spawn(command, [...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      env: childEnv(env),
      ...(cwd !== undefined ? { cwd } : {}),
    });
    this.proc = proc;
    this.partial = '';

    const spawnFailed = new Promise<never>((_, reject) => {
      proc.once('error', err => reject(new Error(`lancement impossible : ${err.message}`)));
    });
    // Chaque gestionnaire vérifie qu'il parle encore du processus COURANT : un
    // ancien processus qui finit de mourir ne doit pas toucher à son successeur.
    proc.on('error', err => {
      log.warn('MCP server process error', { id, message: err.message });
      this.onExit(proc, `lancement impossible : ${err.message}`);
    });
    proc.on('exit', code => {
      log.warn('MCP server exited', { id, code });
      this.onExit(proc, `serveur arrêté (code ${String(code)})`);
    });
    proc.stderr?.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim().slice(0, 500);
      if (line) log.debug('MCP server stderr', { id, line });
    });
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      if (this.proc === proc) this.onData(chunk);
    });

    const init = await Promise.race([
      this.request(
        'initialize',
        {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'catdesk', version: '1' },
        },
        START_TIMEOUT_MS,
      ),
      spawnFailed,
    ]);
    const version = isRecord(init) ? init['protocolVersion'] : undefined;
    if (typeof version !== 'string' || !SUPPORTED_VERSIONS.has(version)) {
      throw new Error(`version du protocole non prise en charge : ${String(version)}`);
    }
    const capabilities = isRecord(init) ? init['capabilities'] : undefined;
    if (!isRecord(capabilities) || !isRecord(capabilities['tools'])) {
      throw new Error("le serveur n'annonce aucun outil");
    }
    this.notify('notifications/initialized');
    log.info('MCP server ready', { id, version });
  }

  private onData(text: string): void {
    this.partial += text;
    let newline = this.partial.indexOf('\n');
    while (newline >= 0) {
      const line = this.partial.slice(0, newline).trim();
      this.partial = this.partial.slice(newline + 1);
      if (line.length > 0) this.onMessage(line);
      newline = this.partial.indexOf('\n');
    }
    if (this.partial.length > MAX_MESSAGE_CHARS) {
      log.warn('MCP message too large, stopping server', { id: this.server.id });
      this.failAll(`message de plus de ${MAX_MESSAGE_CHARS} caractères : serveur arrêté`);
      this.stopProcess();
    }
  }

  private onMessage(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      log.debug('MCP non-JSON line ignored', { id: this.server.id, line: line.slice(0, 200) });
      return;
    }
    if (!isRecord(msg)) return;
    const { id, method } = msg;

    // Requête du serveur : on n'a annoncé aucune capacité, seul `ping` reçoit une réponse utile.
    if (typeof method === 'string' && (typeof id === 'number' || typeof id === 'string')) {
      if (method === 'ping') this.send({ jsonrpc: '2.0', id, result: {} });
      else this.send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
      return;
    }
    if (typeof method === 'string') return; // notification du serveur : rien à faire

    if (typeof id !== 'number') return;
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    const error = msg['error'];
    if (isRecord(error)) {
      const message = typeof error['message'] === 'string' ? error['message'] : 'erreur';
      pending.reject(new Error(message.slice(0, 500)));
    } else {
      pending.resolve(msg['result']);
    }
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs: number) {
    return new Promise<unknown>((resolve, reject) => {
      if (!this.proc?.stdin?.writable) {
        reject(new Error('serveur non démarré'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.notify('notifications/cancelled', { requestId: id, reason: 'délai dépassé' });
        reject(new Error(`pas de réponse à ${method} en ${Math.round(timeoutMs / 1000)} s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }

  private notify(method: string, params?: Record<string, unknown>): void {
    this.send({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) });
  }

  private send(message: Record<string, unknown>): void {
    const stdin = this.proc?.stdin;
    if (!stdin?.writable) return;
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private onExit(proc: ChildProcess, reason: string): void {
    if (this.proc !== proc) return;
    this.proc = null;
    this.failAll(reason);
  }

  private failAll(reason: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private stopProcess(): void {
    const proc = this.proc;
    this.proc = null;
    if (!proc) return;
    proc.stdin?.end();
    const killer = setTimeout(() => proc.kill(), KILL_GRACE_MS);
    killer.unref();
    proc.once('exit', () => clearTimeout(killer));
  }
}
