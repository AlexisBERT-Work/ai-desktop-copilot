# ADR-002 — Agent Loop Design (ReAct Pattern)

**Date:** 2026-05-27
**Status:** Accepted

---

## Context

The agent needs to process user requests, decide when to use tools, execute them safely, and iterate until reaching a final answer.

## Decision

**ReAct (Reason + Act) pattern** with a controlled iteration limit.

```
Input → Context → LLM → Parse → Text? → Done
                          ↓
                       Tool calls → Permission Gate → Execute → Back to LLM
```

Key design choices:

1. **Max 10 iterations** — prevents infinite loops and runaway token usage
2. **Permission gate on every tool call** — not at registration time
3. **Tool results go back to LLM** — not surfaced directly to user
4. **Streaming tokens forwarded immediately** — not buffered
5. **Each step emitted as AgentStep** — UI can react to partial progress

## Consequences

- Latency is proportional to number of tool calls × tool execution time
- User sees real-time progress (tool calls, results, streaming text)
- 10-iteration limit may truncate complex multi-step tasks → V2: configurable
