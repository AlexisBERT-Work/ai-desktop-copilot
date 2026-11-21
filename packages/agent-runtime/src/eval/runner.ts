import type { AgentConfig, PermissionRequest, PermissionResult } from '@catdesk/shared-types';
import { AgentOrchestrator } from '../AgentOrchestrator';
import { AuditLogger } from '../AuditLogger';
import { CONFIG } from '../config';
import { ContextManager, type AgentContext } from '../ContextManager';
import { OllamaClient } from '../llm/OllamaClient';
import { selectTools } from '../llm/selectTools';
import type { ConversationStore } from '../memory/ConversationStore';
import type { VectorStore } from '../memory/VectorStore';
import { PermissionEngine } from '../permissions/PermissionEngine';
import type { EvalTask } from './evalTasks';
import type { EvalAttempt, ScoredAttempt } from './scoring';
import { scoreAttempt } from './scoring';
import { buildSimulatedRegistry, type SimulatedToolRegistry } from './SimulatedToolRegistry';
import { simulatedWorld } from './simulatedWorld';

/** Un run qui s'enlise ne doit pas bloquer le banc : c'est un échec comme un autre. */
const ATTEMPT_TIMEOUT_MS = 240_000;

/** L'utilisateur simulé accepte tout : aucun outil ne s'exécute pour de vrai. */
class AllowAllPermissions extends PermissionEngine {
  override async check(_request: PermissionRequest): Promise<PermissionResult> {
    return { granted: true, reason: 'banc de qualité' };
  }
}

/**
 * Aucune mémoire : ni historique, ni souvenirs, ni faits. Sinon la réponse d'une
 * tâche fuit dans la suivante par les « souvenirs pertinents », et le score
 * dépendrait de l'ordre des tâches.
 */
class BlankContext extends ContextManager {
  constructor() {
    // Jamais lus : toutes les méthodes qui s'en servent sont remplacées ici.
    super({} as ConversationStore, {} as VectorStore);
  }

  override getWarmFacts(): string[] {
    return [];
  }

  override history(): ReturnType<ContextManager['history']> {
    return { messages: [] };
  }

  override async buildContext(): Promise<AgentContext> {
    return { messages: [] };
  }

  override recordTurn(): void {}

  override async rememberExchange(): Promise<void> {}
}

export interface EvalHarness {
  orchestrator: AgentOrchestrator;
  registry: SimulatedToolRegistry;
}

/**
 * Le vrai orchestrateur, le vrai client Ollama, le vrai prompt et la vraie
 * sélection ; seuls les outils, les permissions et la mémoire sont simulés. Les
 * dépendances optionnelles (cache, playbook, compaction…) sont absentes exprès :
 * elles rendraient un run dépendant du précédent.
 */
export function createHarness(baseUrl: string): EvalHarness {
  const registry = buildSimulatedRegistry(simulatedWorld(new Date()));
  const llm = new OllamaClient({
    baseUrl,
    keepAlive: CONFIG.ollamaKeepAlive,
    numCtx: CONFIG.numCtx,
  });
  const orchestrator = new AgentOrchestrator({
    llm,
    tools: registry,
    permissions: new AllowAllPermissions(),
    context: new BlankContext(),
    audit: new AuditLogger(),
  });
  return { orchestrator, registry };
}

/** Joue une tâche une fois, dans une conversation neuve, et note le résultat. */
/**
 * Trois erreurs d'affilée : le serveur est tombé ou ne répond plus. La suite ne
 * mesurerait rien, et le score aurait l'air vrai : Ollama arrêté en plein banc
 * a donné 34/90, sans le moindre avertissement.
 */
const ERRORS_IN_A_ROW = 3;

export function serverLooksDown(attempts: readonly { error?: string }[]): boolean {
  const last = attempts.slice(-ERRORS_IN_A_ROW);
  return last.length === ERRORS_IN_A_ROW && last.every(a => a.error !== undefined);
}

export async function runAttempt(
  harness: EvalHarness,
  task: EvalTask,
  config: AgentConfig,
  attempt: number,
): Promise<ScoredAttempt> {
  const { orchestrator, registry } = harness;
  registry.takeCalls();

  const selected = selectTools(registry.getEnabled(), task.input, CONFIG.toolLimit).map(
    t => t.name,
  );
  const signal = AbortSignal.timeout(ATTEMPT_TIMEOUT_MS);
  const start = Date.now();
  let firstTokenMs: number | null = null;
  let answer = '';
  let error: string | undefined;

  const steps = orchestrator.process(task.input, `eval-${task.id}-${attempt}`, config, signal);
  for await (const step of steps) {
    if (step.type === 'token') firstTokenMs ??= Date.now() - start;
    else if (step.type === 'done') answer = step.content;
    else if (step.type === 'error') error = step.content;
  }
  if (signal.aborted) error ??= `Délai dépassé (${ATTEMPT_TIMEOUT_MS / 1000} s)`;

  const result: EvalAttempt = {
    taskId: task.id,
    selected,
    calls: registry.takeCalls(),
    answer,
    ...(error !== undefined ? { error } : {}),
    firstTokenMs,
    totalMs: Date.now() - start,
  };
  return { ...result, score: scoreAttempt(task, result) };
}
