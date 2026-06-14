import type { ToolCall } from '@catdesk/shared-types';

/**
 * Recover tool calls that a model emitted as TEXT instead of via Ollama's
 * native tool-calling. Small local models (e.g. qwen2.5:7b) frequently print
 * the call as raw JSON, inside `<tool_call>…</tool_call>` tags (Qwen/Hermes
 * style), or in a ```json fence — which would otherwise surface to the user as
 * a JSON blob and never actually run.
 *
 * Only objects whose `name` matches a known tool are recovered, to avoid
 * mistaking a legitimate JSON answer for a tool call.
 *
 * Returns the recovered calls plus the text with those snippets stripped out.
 */
export function recoverToolCalls(
  text: string,
  knownToolNames: ReadonlySet<string>,
): { calls: ToolCall[]; cleanedText: string } {
  if (!text || !text.includes('"name"')) {
    return { calls: [], cleanedText: text };
  }

  const calls: ToolCall[] = [];
  const seen = new Set<string>();
  let cleanedText = text;

  const consider = (jsonText: string, rawMatch: string): void => {
    const parsed = safeParse(jsonText);
    if (parsed === undefined) return;
    const objs = Array.isArray(parsed) ? parsed : [parsed];
    let matchedAny = false;
    for (const obj of objs) {
      const call = toToolCall(obj, knownToolNames);
      if (!call) continue;
      const dedupKey = `${call.name}:${JSON.stringify(call.args)}`;
      if (seen.has(dedupKey)) { matchedAny = true; continue; }
      seen.add(dedupKey);
      calls.push(call);
      matchedAny = true;
    }
    if (matchedAny) cleanedText = cleanedText.replace(rawMatch, '');
  };

  // 1. <tool_call>{…}</tool_call> tags.
  for (const m of text.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g)) {
    consider(m[1] ?? '', m[0]);
  }
  // 2. Fenced ```json … ``` (or plain ```) blocks.
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    consider(m[1] ?? '', m[0]);
  }
  // 3. Bare top-level JSON object/array spanning the (trimmed) message.
  if (calls.length === 0) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      consider(trimmed, trimmed);
    }
  }

  return { calls, cleanedText: cleanedText.trim() };
}

/**
 * Cheap early check: does this (partial) response open like a tool call emitted
 * as text? Used to withhold such content from the live UI stream until we know
 * whether it's a recoverable tool call or a genuine answer.
 */
export function looksLikeToolCallStart(text: string): boolean {
  return /^\s*(<tool_call>|\{|\[)/.test(text);
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s.trim());
  } catch {
    return undefined;
  }
}

/** Validate a parsed object as a tool call against the known tool names. */
function toToolCall(obj: unknown, knownToolNames: ReadonlySet<string>): ToolCall | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  // Accept {name, arguments} and the OpenAI-ish {function:{name, arguments}}.
  const fn = rec['function'] as Record<string, unknown> | undefined;
  const name = typeof rec['name'] === 'string'
    ? (rec['name'] as string)
    : typeof fn?.['name'] === 'string' ? (fn['name'] as string) : undefined;
  if (!name || !knownToolNames.has(name)) return null;

  let rawArgs: unknown = rec['arguments'] ?? rec['parameters'] ?? fn?.['arguments'] ?? {};
  if (typeof rawArgs === 'string') rawArgs = safeParse(rawArgs) ?? {};
  const args = rawArgs && typeof rawArgs === 'object' ? (rawArgs as Record<string, unknown>) : {};

  return { id: crypto.randomUUID(), name, args };
}
