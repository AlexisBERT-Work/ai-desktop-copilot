// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import type { Daily } from '@catdesk/shared-types';
import { filterByOrigin, isDailyOriginFilter } from './dailiesStore';

const daily = (id: string, origin?: Daily['origin']): Daily => ({
  id,
  title: `T ${id}`,
  body: 'corps',
  category: 'tech',
  publishedAt: '2026-07-19T08:00:00.000Z',
  expiresAt: null,
  ...(origin !== undefined ? { origin } : {}),
});

describe('filterByOrigin', () => {
  const items = [daily('a', 'shared'), daily('b', 'local'), daily('c')];

  it('sépare persos et partagées ; une daily sans tag est partagée (serveur)', () => {
    expect(filterByOrigin(items, 'local').map(d => d.id)).toEqual(['b']);
    expect(filterByOrigin(items, 'shared').map(d => d.id)).toEqual(['a', 'c']);
    expect(filterByOrigin(items, 'all')).toHaveLength(3);
  });

  it('isDailyOriginFilter valide les valeurs persistées', () => {
    expect(isDailyOriginFilter('local')).toBe(true);
    expect(isDailyOriginFilter('shared')).toBe(true);
    expect(isDailyOriginFilter('all')).toBe(true);
    expect(isDailyOriginFilter('nope')).toBe(false);
    expect(isDailyOriginFilter(undefined)).toBe(false);
  });
});
