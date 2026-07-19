import { describe, expect, it } from 'vitest';
import type { Daily } from '@catdesk/shared-types';
import { SearchDailiesTool } from './SearchDailiesTool';

const NOW = Date.now();
const daysAgo = (n: number): string => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

function daily(over: Partial<Daily>): Daily {
  return {
    id: over.id ?? `d-${Math.random()}`,
    title: over.title ?? 'Le Monde — revue du 18/07',
    body: over.body ?? 'Corps de la daily.',
    category: over.category ?? 'misc',
    publishedAt: over.publishedAt ?? daysAgo(0),
    expiresAt: over.expiresAt ?? null,
    ...(over.origin !== undefined ? { origin: over.origin } : {}),
  };
}

function makeTool(local: Daily[], shared: Daily[] = [], sharedError?: string) {
  return new SearchDailiesTool(
    { list: () => local },
    {
      fetch: async () => ({
        items: shared,
        ...(sharedError !== undefined ? { error: sharedError } : {}),
      }),
    },
  );
}

interface ResultData {
  dailies: { title: string; origin: string; body: string; category: string }[];
  totalInWindow: number;
  availableTitles?: string[];
  sharedSourceNote?: string;
}

async function run(tool: SearchDailiesTool, args: Record<string, unknown> = {}) {
  const res = await tool.run(args);
  expect(res.success).toBe(true);
  return res.data as ResultData;
}

describe('SearchDailiesTool', () => {
  it('sans query : renvoie les plus récentes, locales + partagées fusionnées', async () => {
    const tool = makeTool(
      [daily({ title: 'Local — revue du 18/07', publishedAt: daysAgo(1) })],
      [daily({ title: 'CNBC — revue du 19/07', publishedAt: daysAgo(0) })],
    );
    const data = await run(tool);
    expect(data.dailies.map(d => d.title)).toEqual([
      'CNBC — revue du 19/07',
      'Local — revue du 18/07',
    ]);
    expect(data.dailies[0]?.origin).toBe('shared');
    expect(data.dailies[1]?.origin).toBe('local');
  });

  it('query : trouve par mot-clé dans le corps, accents ignorés', async () => {
    const tool = makeTool([
      daily({ title: 'A', body: 'Nvidia dévoile ses résultats trimestriels.' }),
      daily({ title: 'B', body: 'La météo sera pluvieuse demain.' }),
    ]);
    const data = await run(tool, { query: 'resultats Nvidia' });
    expect(data.dailies.map(d => d.title)).toEqual(['A']);
  });

  it('query sans correspondance : liste les titres disponibles', async () => {
    const tool = makeTool([daily({ title: 'Le Figaro — revue du 18/07' })]);
    const data = await run(tool, { query: 'zzzintrouvable' });
    expect(data.dailies).toEqual([]);
    expect(data.availableTitles?.[0]).toContain('Le Figaro');
  });

  it('filtre par catégorie et par fenêtre de jours', async () => {
    const tool = makeTool([
      daily({ title: 'Tech récent', category: 'tech', publishedAt: daysAgo(2) }),
      daily({ title: 'Tech vieux', category: 'tech', publishedAt: daysAgo(20) }),
      daily({ title: 'Marchés récent', category: 'markets', publishedAt: daysAgo(1) }),
    ]);
    const data = await run(tool, { category: 'tech', days: 7 });
    expect(data.dailies.map(d => d.title)).toEqual(['Tech récent']);
  });

  it('dédoublonne par titre (garde la plus récente) et ignore les expirées', async () => {
    const tool = makeTool(
      [daily({ title: 'Doublon', body: 'ancienne', publishedAt: daysAgo(3) })],
      [
        daily({ title: 'Doublon', body: 'récente', publishedAt: daysAgo(1) }),
        daily({ title: 'Expirée', expiresAt: daysAgo(1), publishedAt: daysAgo(2) }),
      ],
    );
    const data = await run(tool);
    expect(data.totalInWindow).toBe(1);
    expect(data.dailies[0]?.body).toBe('récente');
  });

  it('tronque les corps trop longs', async () => {
    const tool = makeTool([daily({ title: 'Longue', body: 'x'.repeat(10_000) })]);
    const data = await run(tool);
    expect(data.dailies[0]?.body.length).toBeLessThan(5000);
    expect(data.dailies[0]?.body.endsWith('… [tronqué]')).toBe(true);
  });

  it('source partagée en erreur : répond quand même avec les locales + note', async () => {
    const tool = makeTool(
      [daily({ title: 'Locale' })],
      [],
      'Dailys partagées inaccessibles: HTTP 500',
    );
    const data = await run(tool);
    expect(data.dailies.map(d => d.title)).toEqual(['Locale']);
    expect(data.sharedSourceNote).toContain('inaccessibles');
  });

  it('arguments invalides refusés (days hors bornes)', async () => {
    const res = await makeTool([]).run({ days: 90 });
    expect(res.success).toBe(false);
  });
});
