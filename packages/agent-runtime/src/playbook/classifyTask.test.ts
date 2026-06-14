import { describe, it, expect } from 'vitest';
import { classifyTask } from './classifyTask';

describe('classifyTask', () => {
  it('classifies common intents (FR/EN)', () => {
    expect(classifyTask('Débogue ce stacktrace, ça plante')).toBe('debug');
    expect(classifyTask('Fix this error in the parser')).toBe('debug');
    expect(classifyTask('Écris des tests unitaires pour cette fonction')).toBe('tests');
    expect(classifyTask('Refactor ce module trop long')).toBe('refactor');
    expect(classifyTask('Fais un commit puis ouvre une PR')).toBe('git');
    expect(classifyTask('Cherche où est défini handleSubmit')).toBe('search');
    expect(classifyTask('Explique pourquoi ce code est lent')).toBe('explain');
    expect(classifyTask('Rédige la doc de ce composant')).toBe('write');
  });

  it('falls back to general', () => {
    expect(classifyTask('Bonjour, ça va ?')).toBe('general');
    expect(classifyTask('')).toBe('general');
  });

  it('is deterministic and priority-ordered (debug before tests)', () => {
    // mentions both "bug" and "test" → debug wins (higher priority)
    expect(classifyTask('il y a un bug dans le test')).toBe('debug');
  });
});
