// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useDashboardStore, MAX_W, MAX_H } from './dashboardStore';
import { clampZoom, ZOOM_MIN, ZOOM_MAX } from '../../shared/hooks/useUiZoom';

const firstWidgetId = () => useDashboardStore.getState().config.widgets[0]!.id;
const widgetById = (id: string) =>
  useDashboardStore.getState().config.widgets.find(w => w.id === id)!;

describe('dashboardStore.setWidgetSize', () => {
  beforeEach(() => {
    useDashboardStore.getState().resetToDefault();
  });

  it('applique la taille exacte au bon widget', () => {
    const id = firstWidgetId();
    useDashboardStore.getState().setWidgetSize(id, 3, 2);
    expect(widgetById(id).layout).toMatchObject({ w: 3, h: 2 });
    // Les autres widgets ne bougent pas.
    const other = useDashboardStore.getState().config.widgets[1]!;
    expect(other.layout.w).not.toBe(3);
  });

  it('borne dans la grille (1..MAX_W × 1..MAX_H) et arrondit', () => {
    const id = firstWidgetId();
    useDashboardStore.getState().setWidgetSize(id, 99, 99);
    expect(widgetById(id).layout).toMatchObject({ w: MAX_W, h: MAX_H });
    useDashboardStore.getState().setWidgetSize(id, 0, -5);
    expect(widgetById(id).layout).toMatchObject({ w: 1, h: 1 });
    useDashboardStore.getState().setWidgetSize(id, 2.4, 1.6);
    expect(widgetById(id).layout).toMatchObject({ w: 2, h: 2 });
  });
});

describe('clampZoom', () => {
  it('borne le zoom et arrondit au dixième', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(5)).toBe(ZOOM_MAX);
    expect(clampZoom(1.2499)).toBe(1.2);
    expect(clampZoom(0.95)).toBe(1);
  });
});
