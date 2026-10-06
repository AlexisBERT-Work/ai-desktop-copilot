import type {
  AgentConfig,
  JsonRpcRequest,
  JsonRpcResponse,
  PermissionResponsePayload,
  Daily,
  PressFeed,
  PressFeedInput,
  PressRunStatus,
} from '@catdesk/shared-types';
import { RPC_METHODS, RPC_NOTIFICATIONS } from '@catdesk/shared-types';
import type { AgentOrchestrator } from '../AgentOrchestrator';
import { stdoutNotifier, type NotifyFn } from './Notifier';
import { createLogger } from '../logger';

const log = createLogger('ipc:bridge');

/**
 * Construit la notification `agent.step` (pure, exportée pour les tests).
 * INVARIANT (corrélation UI) : chaque step porte conversationId + messageId —
 * le bridge Rust et chatStore routent les tokens uniquement avec ces ids,
 * sans heuristique de repli.
 */
export function buildStepNotification(
  requestId: string | number,
  step: Record<string, unknown>,
  conversationId: string,
  messageId: string | undefined,
): { id: string | number; step: Record<string, unknown> } {
  return {
    id: requestId,
    step: { ...step, conversationId, messageId: messageId ?? '' },
  };
}

/** Pilotage des journaux personnalisés LOCAUX (par poste, sans rôle admin). */
export interface LocalPressControl {
  listFeeds: () => PressFeed[];
  saveFeed: (input: PressFeedInput & { id?: string }) => PressFeed;
  deleteFeed: (id: string) => boolean;
  /** Dailys locales déjà générées (repoussées au sync de l'UI). */
  listDailies: () => Daily[];
  /** Génération immédiate (bouton « Générer maintenant »). Fire-and-forget. */
  runNow: () => void | Promise<unknown>;
  /** Dernier statut de génération (repoussé au sync — null si jamais couru). */
  getStatus: () => PressRunStatus | null;
}

export interface StdinBridgeDeps {
  orchestrator: AgentOrchestrator;
  /** Config bourse poussée par l'UI (symboles + formules des widgets `stocks`). */
  setMarketConfig?: (
    symbols: string[],
    formulas: { name: string; expression: string }[],
  ) => void | Promise<void>;
  /** Publication immédiate de la revue de presse partagée (bouton admin). */
  runPressDigest?: () => void | Promise<void>;
  /** Journaux personnalisés locaux — absent si non câblé (tests). */
  localPress?: LocalPressControl;
  /**
   * L'hôte a fermé stdin (CatDesk quitte, ou l'a tué). Défaut : sortie
   * immédiate ; le runtime y branche son arrêt propre (OCR, navigateur, VRAM).
   */
  onClose?: () => void;
  /** Émission des notifications (défaut : stdout). */
  notify?: NotifyFn;
}

interface AgentProcessParams {
  input: string;
  conversationId: string;
  messageId?: string;
  config: AgentConfig;
}

/** Valide les paramètres d'`agent.process` (ils viennent de l'extérieur). Pur. */
export function parseAgentProcessParams(params: unknown): AgentProcessParams | null {
  if (params === null || typeof params !== 'object') return null;
  const p = params as Record<string, unknown>;
  const config = p['config'];
  if (
    typeof p['input'] !== 'string' ||
    typeof p['conversationId'] !== 'string' ||
    config === null ||
    typeof config !== 'object' ||
    typeof (config as Record<string, unknown>)['model'] !== 'string'
  ) {
    return null;
  }
  return {
    input: p['input'],
    conversationId: p['conversationId'],
    ...(typeof p['messageId'] === 'string' ? { messageId: p['messageId'] } : {}),
    config: config as AgentConfig,
  };
}

/**
 * JSON-RPC 2.0 bridge over stdin/stdout
 * Handles communication between Tauri Rust core and Node.js agent runtime
 */
export class StdinBridge {
  private buffer = '';
  /** Abort controller for the run in progress, used by the Stop button. */
  private currentAbort: AbortController | null = null;
  private readonly notify: NotifyFn;

  constructor(private readonly deps: StdinBridgeDeps) {
    this.notify = deps.notify ?? stdoutNotifier;
  }

  start(): void {
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.processBuffer();
    });
    process.stdin.on('end', () => {
      log.info('stdin closed — shutting down');
      if (this.deps.onClose) this.deps.onClose();
      else process.exit(0);
    });
    log.info('StdinBridge listening on stdin');
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const request = JSON.parse(trimmed) as JsonRpcRequest;
        this.handleRequest(request).catch(err => {
          log.error('Request handler failed', { error: String(err) });
        });
      } catch {
        log.warn('Invalid JSON received', { line: trimmed.slice(0, 100) });
      }
    }
  }

  /**
   * Dispatch unique de toutes les méthodes JSON-RPC hôte → agent.
   *
   * `request.method` est typé `AgentMethod` (= `RpcMethodName`, dérivé de
   * RPC_METHODS), mais la valeur vient de l'extérieur : le `default` est le
   * garde qui rejette proprement tout ce qui n'est pas au contrat. Toutes les
   * branches sont sous le même try/catch — une exception dans n'importe
   * laquelle répond -32603 au lieu de laisser l'appelant sans réponse.
   */
  private async handleRequest(request: JsonRpcRequest): Promise<void> {
    log.debug('Request received', { id: request.id, method: request.method });
    const { orchestrator, localPress } = this.deps;

    try {
      switch (request.method) {
        case RPC_METHODS.agentProcess:
          await this.handleAgentProcess(request);
          return;

        // Interruption : arrête le run en cours (bouton Stop).
        case RPC_METHODS.agentCancel:
          this.currentAbort?.abort();
          this.sendResponse(request.id, { ok: true });
          return;

        case RPC_METHODS.settingsUpdate: {
          const params = request.params as { safeMode?: unknown };
          orchestrator.updatePermissions({
            ...(typeof params.safeMode === 'boolean' ? { safeMode: params.safeMode } : {}),
          });
          this.sendResponse(request.id, { ok: true });
          return;
        }

        // Publication immédiate de la revue de presse (bouton « Publier
        // maintenant » de la console admin). No-op si le planificateur n'est pas
        // actif — on répond ok sans rien faire. Le run est lancé sans l'attendre
        // (~1 min) : les dailys arrivent via Realtime.
        case RPC_METHODS.pressRunNow: {
          if (this.deps.runPressDigest === undefined) {
            this.sendResponse(request.id, { ok: false, reason: 'press-digest-inactive' });
            return;
          }
          void this.deps.runPressDigest();
          this.sendResponse(request.id, { ok: true });
          return;
        }

        // Journaux personnalisés LOCAUX (panneau « Mes journaux », tout
        // utilisateur). L'état complet est repoussé en notification
        // `press.feeds` après chaque écriture — l'UI n'a pas de canal
        // requête/réponse, elle écoute les events.
        case RPC_METHODS.pressFeedsSave: {
          if (localPress === undefined) {
            this.sendResponse(request.id, { ok: false, reason: 'local-press-inactive' });
            return;
          }
          try {
            const feed = localPress.saveFeed(request.params as PressFeedInput & { id?: string });
            this.sendResponse(request.id, { ok: true, id: feed.id });
          } catch (err) {
            this.sendError(request.id, -32602, String(err));
          }
          this.notify(RPC_NOTIFICATIONS.pressFeeds, { feeds: localPress.listFeeds() });
          return;
        }

        case RPC_METHODS.pressFeedsDelete: {
          if (localPress === undefined) {
            this.sendResponse(request.id, { ok: false, reason: 'local-press-inactive' });
            return;
          }
          const { id } = request.params as { id?: unknown };
          const removed = typeof id === 'string' ? localPress.deleteFeed(id) : false;
          this.sendResponse(request.id, { ok: removed });
          this.notify(RPC_NOTIFICATIONS.pressFeeds, { feeds: localPress.listFeeds() });
          return;
        }

        case RPC_METHODS.pressLocalRunNow: {
          if (localPress === undefined) {
            this.sendResponse(request.id, { ok: false, reason: 'local-press-inactive' });
            return;
          }
          void localPress.runNow();
          this.sendResponse(request.id, { ok: true });
          return;
        }

        // Resynchronisation à la demande (montage de l'UI) : repousse l'état
        // complet des journaux locaux et de leurs dailys déjà générées.
        case RPC_METHODS.pressLocalSync: {
          if (localPress !== undefined) {
            this.notify(RPC_NOTIFICATIONS.pressFeeds, { feeds: localPress.listFeeds() });
            this.notify(RPC_NOTIFICATIONS.dailiesLocal, { dailies: localPress.listDailies() });
            // Un run peut être en cours au montage de l'UI : repousser son statut.
            const status = localPress.getStatus();
            if (status !== null) {
              this.notify(RPC_NOTIFICATIONS.pressLocalProgress, { status });
            }
          }
          this.sendResponse(request.id, { ok: localPress !== undefined });
          return;
        }

        // Config bourse pilotée par l'UI (symboles + formules des widgets `stocks`).
        case RPC_METHODS.marketSetWatchlist: {
          const params = request.params as { symbols?: unknown; formulas?: unknown };
          const symbols = Array.isArray(params.symbols)
            ? params.symbols.filter((s): s is string => typeof s === 'string')
            : [];
          const formulas = Array.isArray(params.formulas)
            ? params.formulas.flatMap(f => {
                if (f === null || typeof f !== 'object') return [];
                const o = f as { name?: unknown; expression?: unknown };
                return typeof o.name === 'string' && typeof o.expression === 'string'
                  ? [{ name: o.name, expression: o.expression }]
                  : [];
              })
            : [];
          await this.deps.setMarketConfig?.(symbols, formulas);
          this.sendResponse(request.id, { ok: true });
          return;
        }

        // Réponse de l'utilisateur au dialogue de permission. Envoyée par Rust
        // en NOTIFICATION (pas d'`id`, donc pas de réponse à renvoyer) —
        // `send_permission_response` dans bridge.rs.
        case RPC_METHODS.permissionResponse: {
          const p = request.params as Partial<PermissionResponsePayload>;
          if (typeof p.requestId !== 'string' || typeof p.granted !== 'boolean') {
            log.warn('permission.response mal formée', { params: request.params });
            return;
          }
          orchestrator.resolvePermission(
            p.requestId,
            p.granted,
            typeof p.remember === 'boolean' ? p.remember : undefined,
          );
          return;
        }

        default:
          // Une notification (sans `id`) n'attend aucune réponse : répondre
          // enverrait un message que personne ne corrèle.
          if (request.id === undefined) {
            log.warn('Notification inconnue ignorée', { method: request.method });
            return;
          }
          this.sendError(request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (err) {
      this.sendError(request.id, -32603, `Internal error: ${String(err)}`);
    }
  }

  private async handleAgentProcess(request: JsonRpcRequest): Promise<void> {
    // `agent.process` est toujours une REQUÊTE (rpc_request côté Rust) : son id
    // corrèle chaque `agent.step` au message affiché. Sans lui, l'UI ne saurait
    // pas où router les tokens — mieux vaut refuser que streamer dans le vide.
    const requestId = request.id;
    if (requestId === undefined) {
      log.warn('agent.process sans id — ignorée (notification malformée)');
      return;
    }

    const params = parseAgentProcessParams(request.params);
    if (params === null) {
      this.sendError(requestId, -32602, 'agent.process: paramètres invalides');
      return;
    }
    const emit = (step: Record<string, unknown>): void =>
      this.notify(
        RPC_NOTIFICATIONS.agentStep,
        buildStepNotification(requestId, step, params.conversationId, params.messageId),
      );

    // Fresh abort controller for this run so a later `agent.cancel` can stop it.
    const abort = new AbortController();
    this.currentAbort = abort;

    try {
      for await (const step of this.deps.orchestrator.process(
        params.input,
        params.conversationId,
        params.config,
        abort.signal,
      )) {
        // Inject conversation/message ids so Tauri can route the event to the
        // right message (the orchestrator steps don't carry them).
        emit(step);
      }
      this.sendResponse(requestId, { done: true });
    } catch (err) {
      // Dernier recours (l'orchestrateur convertit déjà ses erreurs en étape) :
      // le côté Rust ignore les RÉPONSES d'erreur JSON-RPC, seule une étape
      // `error` sort l'UI de son état « réfléchit… ».
      emit({
        type: 'error',
        content: `Erreur interne de l'agent : ${String(err)}`,
        code: 'INTERNAL',
      });
      this.sendError(requestId, -32603, String(err));
    } finally {
      if (this.currentAbort === abort) this.currentAbort = null;
    }
  }

  /**
   * Réponse JSON-RPC. `id` absent = le message entrant était une NOTIFICATION :
   * la spec interdit d'y répondre (personne ne corrèle la réponse), donc no-op.
   */
  private sendResponse<T>(id: string | number | undefined, result: T): void {
    if (id === undefined) return;
    const response: JsonRpcResponse<T> = { jsonrpc: '2.0', id, result };
    process.stdout.write(JSON.stringify(response) + '\n');
  }

  /** Erreur JSON-RPC — même règle que sendResponse pour les notifications. */
  private sendError(id: string | number | undefined, code: number, message: string): void {
    if (id === undefined) return;
    const response: JsonRpcResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
    process.stdout.write(JSON.stringify(response) + '\n');
  }
}
