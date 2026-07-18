// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { EMPTY_PRESS_FEED, type PressFeed } from '@catdesk/shared-types';
import { PressFeedList } from './PressFeedList';

afterEach(cleanup);

const feed = (over: Partial<PressFeed> = {}): PressFeed => ({
  id: 'f1',
  ...EMPTY_PRESS_FEED,
  name: 'Veille IA',
  sourceIds: ['lemonde'],
  ...over,
});

describe('PressFeedList', () => {
  it('affiche un message quand il n’y a aucun journal', () => {
    render(<PressFeedList items={[]} busy={false} onEdit={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText(/Aucun journal personnalisé/)).toBeTruthy();
    expect(screen.getByText(/\(0\)/)).toBeTruthy();
  });

  it('liste les journaux avec leur badge inactif le cas échéant', () => {
    render(
      <PressFeedList
        items={[feed(), feed({ id: 'f2', name: 'Revue crypto', enabled: false })]}
        busy={false}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Veille IA')).toBeTruthy();
    expect(screen.getByText('Revue crypto')).toBeTruthy();
    expect(screen.getAllByText('inactif')).toHaveLength(1);
  });

  it('Éditer délègue le journal au parent', () => {
    const onEdit = vi.fn();
    const f = feed();
    render(<PressFeedList items={[f]} busy={false} onEdit={onEdit} onRemove={vi.fn()} />);
    fireEvent.click(screen.getByText('Éditer'));
    expect(onEdit).toHaveBeenCalledWith(f);
  });

  it('la suppression exige une confirmation en deux clics', () => {
    const onRemove = vi.fn(async () => {});
    render(<PressFeedList items={[feed()]} busy={false} onEdit={vi.fn()} onRemove={onRemove} />);

    fireEvent.click(screen.getByText('Supprimer'));
    expect(onRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Confirmer ?'));
    expect(onRemove).toHaveBeenCalledWith('f1');
  });
});
