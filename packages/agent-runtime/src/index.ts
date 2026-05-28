/**
 * NeuroDesk — Agent Runtime Sidecar
 * Communicates with Tauri Rust core via JSON-RPC 2.0 over stdin/stdout.
 */

import { StdinBridge } from './ipc/StdinBridge';
import { AgentOrchestrator } from './AgentOrchestrator';
import { ToolRegistry } from './ToolRegistry';
import { PermissionEngine } from './permissions/PermissionEngine';
import { ContextManager } from './ContextManager';
import { AuditLogger } from './AuditLogger';
import { OllamaClient } from './llm/OllamaClient';
import { ConversationStore } from './memory/ConversationStore';
import { VectorStore } from './memory/VectorStore';
import { createLogger } from './logger';

// ─── Tools ────────────────────────────────────────────────────
import { ReadFileTool } from './tools/filesystem/ReadFileTool';
import { ListDirTool } from './tools/filesystem/ListDirTool';
import { RunCommandTool } from './tools/system/RunCommandTool';
import { ReadClipboardTool } from './tools/clipboard/ReadClipboardTool';
import { SearchMemoryTool } from './tools/memory/SearchMemoryTool';

const log = createLogger('runtime:main');

async function main() {
  log.info('NeuroDesk Agent Runtime starting', { pid: process.pid, node: process.version });

  // ─── Services ──────────────────────────────────────────────
  const db = new ConversationStore();
  await db.initialize();

  const vectorStore = new VectorStore();
  await vectorStore.initialize();

  const llm = new OllamaClient({ baseUrl: process.env['OLLAMA_URL'] ?? 'http://127.0.0.1:11434' });
  const ollamaOk = await llm.isAvailable();
  log.info('Ollama status', { available: ollamaOk });

  const audit = new AuditLogger();
  const permissions = new PermissionEngine();
  const context = new ContextManager(db, vectorStore);

  // ─── Tool Registry ─────────────────────────────────────────
  const tools = new ToolRegistry();
  tools.register(new ReadFileTool());
  tools.register(new ListDirTool());
  tools.register(new RunCommandTool());
  tools.register(new ReadClipboardTool());
  tools.register(new SearchMemoryTool(vectorStore));

  log.info('Tools registered', { tools: tools.listNames() });

  // ─── Agent ─────────────────────────────────────────────────
  const orchestrator = new AgentOrchestrator(llm, tools, permissions, context, audit);

  // ─── IPC Bridge ────────────────────────────────────────────
  const bridge = new StdinBridge(orchestrator);
  bridge.start();

  log.info('Agent Runtime ready and listening on stdin');

  // ─── Graceful shutdown ─────────────────────────────────────
  process.on('SIGTERM', () => {
    log.info('SIGTERM received — shutting down');
    db.close();
    process.exit(0);
  });

  process.on('uncaughtException', err => {
    log.error('Uncaught exception', { message: err.message, stack: err.stack });
  });

  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled rejection', { reason: String(reason) });
  });
}

main().catch(err => {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level: 'FATAL', msg: String(err) }) + '\n');
  process.exit(1);
});
