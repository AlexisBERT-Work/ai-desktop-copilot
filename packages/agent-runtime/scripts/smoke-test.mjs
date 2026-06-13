/**
 * Smoke test: spawns the agent sidecar, sends a health check + agent.process,
 * waits for tokens to stream back, then exits.
 */
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const proc = spawn('npx tsx src/index.ts', [], {
  cwd: root,
  env: { ...process.env, CATDESK_DATA_DIR: join(root, 'data') },
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true,
});

let stepsSeen = [];
let done = false;

proc.stderr.on('data', d => process.stderr.write(d));

proc.stdout.on('data', d => {
const lines = d.toString().split('\n').filter(l => l.trim());
  for (const line of lines) {
    try {
      const msg = JSON.parse(line);
      process.stdout.write(line + '\n');
      if (msg.method === 'agent.step' && msg.params?.step) {
        stepsSeen.push(msg.params.step.type);
        const tokenCount = stepsSeen.filter(t => t === 'token').length;
        if (msg.params.step.type === 'done' || tokenCount >= 10) {
          done = true;
          finish();
        }
      }
      // Final JSON-RPC response after all steps
      if (msg.id === 2 && msg.result?.done === true) {
        done = true;
        finish();
      }
      if (msg.id === 1 && msg.result?.status === 'ok') {
        // Health check passed, send agent request
        proc.stdin.write(JSON.stringify({
          jsonrpc: '2.0', id: 2, method: 'agent.process',
          params: {
            input: 'Réponds en une phrase courte : quel est ton rôle ?',
            conversationId: 'smoke-test-' + Date.now(),
            config: { model: 'qwen2.5:7b', maxIterations: 2, maxTokens: 25 },
          },
        }) + '\n');
      }
    } catch { /* ignore */ }
  }
});

function finish() {
  const tokens = stepsSeen.filter(t => t === 'token').length;
  const hasDone = stepsSeen.includes('done');
  console.error(`\n✅ SMOKE TEST ${tokens > 0 && hasDone ? 'PASSED' : 'PARTIAL'} — steps: ${[...new Set(stepsSeen)].join(', ')}, token chunks: ${tokens}`);
  proc.kill();
  process.exit(tokens > 0 ? 0 : 1);
}

// Send health check immediately
proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'health.check', params: {} }) + '\n');

// Timeout
setTimeout(() => {
  if (!done) {
    const tokens = stepsSeen.filter(t => t === 'token').length;
    console.error(`\n⚠️  TIMEOUT — steps seen: ${[...new Set(stepsSeen)].join(', ')}, token chunks: ${tokens}`);
    proc.kill();
    process.exit(tokens > 0 ? 0 : 1);
  }
}, 60000);
