import { describe, it, expect } from 'vitest';
import { KillProcessTool } from './KillProcessTool';

const tool = new KillProcessTool();

describe('KillProcessTool', () => {
  it('est high + confirmation', () => {
    expect(tool.riskLevel).toBe('high');
    expect(tool.requiresConfirmation).toBe(true);
  });

  it('rejette un pid invalide', async () => {
    expect((await tool.execute({ pid: 0 })).success).toBe(false);
    expect((await tool.execute({ pid: -5 })).success).toBe(false);
    expect((await tool.execute({ pid: 1.5 })).success).toBe(false);
  });

  it('refuse les PID système protégés', async () => {
    const res = await tool.execute({ pid: 4 });
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/protégé/);
  });

  it('refuse de se tuer lui-même', async () => {
    const res = await tool.execute({ pid: process.pid });
    expect(res.success).toBe(false);
  });
});
