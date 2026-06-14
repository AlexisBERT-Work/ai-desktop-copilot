import type { StrategyRow } from './PlaybookStore';

/**
 * Skill auto-generation (CATDESK-CONCEPTS-AVANCES §8-D).
 *
 * When a tool-based approach proves itself a strong, repeatable winner for a
 * task type, codify it as a *draft* SKILL.md so the skill library grows from
 * lived experience. Deterministic (no LLM): the draft is a template filled from
 * the proven approach + stats. Human-in-the-loop (§8 guardrail): drafts are
 * proposed, never installed/applied automatically.
 */

export interface SkillDraft {
  taskType: string;
  /** Proven tool sequence, '>'-joined (see approachSignature). */
  approach: string;
  successRate: number;
  attempts: number;
  /** Kebab-case file slug, e.g. "auto-tests". */
  slug: string;
  /** Rendered SKILL.md markdown (French, user-facing). */
  markdown: string;
}

export interface ProposeSkillsOptions {
  /** Min attempts before an approach is trustworthy enough to codify. Default 4. */
  minAttempts?: number;
  /** Success rate at/above which an approach is a strong winner. Default 0.75. */
  strongRate?: number;
}

/** Pseudo-approach recorded when a run answered directly without tools. */
const DIRECT_ANSWER = '(réponse directe)';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Find generalizable winning strategies and render a draft skill for each.
 *
 * A strategy qualifies when it has enough attempts, a high success rate, and
 * actually uses tools (a direct answer is no reusable procedure). At most one
 * draft per task type — the best-performing qualifying approach.
 */
export function proposeSkills(rows: StrategyRow[], opts: ProposeSkillsOptions = {}): SkillDraft[] {
  const minAttempts = opts.minAttempts ?? 4;
  const strongRate = opts.strongRate ?? 0.75;

  // Best qualifying approach per task type.
  const bestByType = new Map<string, { approach: string; attempts: number; successRate: number }>();
  for (const r of rows) {
    const attempts = r.successes + r.failures;
    if (attempts < minAttempts) continue;
    if (r.approach === DIRECT_ANSWER) continue; // not a reusable procedure
    const successRate = r.successes / attempts;
    if (successRate < strongRate) continue;

    const cur = bestByType.get(r.taskType);
    if (!cur || successRate > cur.successRate || (successRate === cur.successRate && attempts > cur.attempts)) {
      bestByType.set(r.taskType, { approach: r.approach, attempts, successRate });
    }
  }

  const drafts: SkillDraft[] = [];
  for (const taskType of [...bestByType.keys()].sort()) {
    const w = bestByType.get(taskType)!;
    const slug = `auto-${slugify(taskType)}`;
    drafts.push({
      taskType,
      approach: w.approach,
      successRate: w.successRate,
      attempts: w.attempts,
      slug,
      markdown: renderSkillDraft({ taskType, approach: w.approach, successRate: w.successRate, attempts: w.attempts, slug }),
    });
  }
  return drafts;
}

/** Render a draft SKILL.md from a proven strategy. Pure/deterministic. */
export function renderSkillDraft(d: Omit<SkillDraft, 'markdown'>): string {
  const tools = d.approach.split('>').map(t => t.trim()).filter(Boolean);
  const steps = tools.map((t, i) => `${i + 1}. \`${t}\``).join('\n');
  const pctRate = Math.round(d.successRate * 100);

  return `---
name: ${d.slug}
description: Procédure éprouvée pour les tâches de type « ${d.taskType} » (brouillon auto-généré).
status: draft
---

# Skill : ${d.taskType}

> ⚠️ **Brouillon généré automatiquement** à partir des traces d'exécution
> (${pctRate}% de succès sur ${d.attempts} essais). Relis, ajuste et valide
> avant de l'intégrer — rien n'est appliqué automatiquement.

## Quand l'utiliser
Pour les tâches classées « ${d.taskType} ».

## Approche éprouvée
Cette séquence d'outils a le meilleur taux de succès observé pour ce type de tâche :

${steps}

## Pourquoi
Apprise des exécutions passées : ${pctRate}% de réussite sur ${d.attempts} essais.
`;
}
