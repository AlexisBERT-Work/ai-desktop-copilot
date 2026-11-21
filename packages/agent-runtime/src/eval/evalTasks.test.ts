import { describe, expect, it } from 'vitest';
import { CONFIG } from '../config';
import { EVAL_TASKS } from './evalTasks';
import { selectionReport } from './scoring';
import { buildSimulatedRegistry } from './SimulatedToolRegistry';
import { simulatedWorld } from './simulatedWorld';

const tools = buildSimulatedRegistry(simulatedWorld(new Date())).getEnabled();
const names = new Set(tools.map(t => t.name));

describe('jeu de tâches', () => {
  it('a des identifiants uniques', () => {
    const ids = EVAL_TASKS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ne cite que des outils du catalogue', () => {
    const unknown = EVAL_TASKS.flatMap(t => t.tools).filter(tool => !names.has(tool));
    expect(unknown).toEqual([]);
  });

  it("n'emploie aucun motif à drapeau g : test() en garderait l'état d'un essai à l'autre", () => {
    const stateful = EVAL_TASKS.filter(t => t.args?.global || t.answer?.global).map(t => t.id);
    expect(stateful).toEqual([]);
  });

  it('un piège ne prévoit aucun outil', () => {
    expect(EVAL_TASKS.filter(t => t.trap && t.tools.length > 0)).toEqual([]);
  });
});

/**
 * Plancher de la sélection, sans GPU : un mot-clé retiré, un outil renommé ou une
 * description réécrite qui rend un outil injoignable casse ce test. Les seuils
 * suivent les mesures de docs/SUIVI.md, un peu en dessous pour laisser respirer.
 */
describe('sélection des outils', () => {
  const report = (split: 'dev' | 'holdout') =>
    selectionReport(
      EVAL_TASKS.filter(t => t.split === split),
      tools,
      CONFIG.toolLimit,
    );
  const rate = ({ hit, total }: { hit: number; total: number }): number => hit / total;

  it('atteint le bon outil sur le jeu de réglage', () => {
    expect(report('dev').recall.misses).toEqual([]);
  });

  it('atteint le bon outil sur le jeu tenu à l’écart', () => {
    expect(rate(report('holdout').recall)).toBeGreaterThanOrEqual(0.8);
  });

  it("n'allonge pas le prompt pour une question sans outil", () => {
    expect(report('dev').coreOnly.extras).toEqual([]);
  });
});
