import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SkillStore } from '../../skills/SkillStore';
import { LoadSkillTool } from './LoadSkillTool';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'loadskill-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeSkill(sub: string, file: string, content: string): void {
  const full = join(dir, sub);
  mkdirSync(full, { recursive: true });
  writeFileSync(join(full, file), content, 'utf-8');
}

function tool(): LoadSkillTool {
  return new LoadSkillTool(new SkillStore(dir));
}

const SKILL = `---
name: revue-presse
description: Répondre à une question couvrant plusieurs journaux.
---

1. search_dailies
2. Cite le journal et la date.
`;

describe('LoadSkillTool', () => {
  it('renvoie la procédure complète du skill demandé', async () => {
    writeSkill('skills', 'revue-presse.md', SKILL);
    const res = await tool().run({ name: 'revue-presse' });

    expect(res.success).toBe(true);
    const data = res.data as { name: string; instructions: string; draft?: boolean };
    expect(data.name).toBe('revue-presse');
    expect(data.instructions).toContain('search_dailies');
    expect(data.draft).toBeUndefined();
  });

  it('marque explicitement un brouillon comme non validé', async () => {
    writeSkill('skill-drafts', 'auto-x.md', '---\nname: auto-x\n---\nprocédure auto');
    const res = await tool().run({ name: 'auto-x' });

    expect(res.success).toBe(true);
    const data = res.data as { draft?: boolean; warning?: string };
    expect(data.draft).toBe(true);
    expect(data.warning).toContain('non validé');
  });

  it('sur nom inconnu, liste les skills disponibles (évite les relances à l’aveugle)', async () => {
    writeSkill('skills', 'revue-presse.md', SKILL);
    const res = await tool().run({ name: 'inventé' });

    expect(res.success).toBe(false);
    expect(res.error).toContain('revue-presse');
  });

  it('le dit clairement quand aucun skill n’est installé', async () => {
    const res = await tool().run({ name: 'quoi-que-ce-soit' });

    expect(res.success).toBe(false);
    expect(res.error).toContain('aucun skill');
  });

  it('refuse des arguments invalides via le schéma zod', async () => {
    const res = await tool().run({});
    expect(res.success).toBe(false);
    expect(res.error).toContain('Arguments invalides');
  });

  it('est en risque faible et sans confirmation (lecture locale seule)', () => {
    const t = tool();
    expect(t.riskLevel).toBe('low');
    expect(t.requiresConfirmation).toBe(false);
  });
});
