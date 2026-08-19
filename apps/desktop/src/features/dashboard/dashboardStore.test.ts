// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  useDashboardStore,
  fromGridUnits,
  sanitizeConfig,
  sanitizePresets,
  MIN_W,
  MIN_H,
  MAX_W,
  MAX_H,
} from './dashboardStore';
import { clampZoom, ZOOM_MIN, ZOOM_MAX } from '../../shared/hooks/useUiZoom';

const firstWidgetId = () => useDashboardStore.getState().config.widgets[0]!.id;
const widgetById = (id: string) =>
  useDashboardStore.getState().config.widgets.find(w => w.id === id)!;

describe('dashboardStore.setWidgetSize (canvas px)', () => {
  beforeEach(() => {
    useDashboardStore.getState().resetToDefault();
  });

  it('applique la taille exacte (snap 8 px) au bon widget', () => {
    const id = firstWidgetId();
    useDashboardStore.getState().setWidgetSize(id, 483, 245);
    expect(widgetById(id).layout).toMatchObject({ w: 480, h: 248 });
    // Les autres widgets ne bougent pas.
    const other = useDashboardStore.getState().config.widgets[1]!;
    expect(other.layout.w).not.toBe(480);
  });

  it('borne la taille (minimum lisible, maximum de sanité)', () => {
    const id = firstWidgetId();
    useDashboardStore.getState().setWidgetSize(id, 99999, 99999);
    expect(widgetById(id).layout).toMatchObject({ w: MAX_W, h: MAX_H });
    useDashboardStore.getState().setWidgetSize(id, 10, -5);
    expect(widgetById(id).layout).toMatchObject({ w: MIN_W, h: MIN_H });
  });
});

describe('dashboardStore.moveWidget / bringToFront (canvas libre)', () => {
  beforeEach(() => {
    useDashboardStore.getState().resetToDefault();
  });

  const ids = () => useDashboardStore.getState().config.widgets.map(w => w.id);

  it('pose le widget à la position exacte (snap 8 px)', () => {
    const id = firstWidgetId();
    useDashboardStore.getState().moveWidget(id, 123, 77);
    expect(widgetById(id).layout).toMatchObject({ x: 120, y: 80 });
  });

  it('borne à gauche et en haut (pas de position négative)', () => {
    const id = firstWidgetId();
    useDashboardStore.getState().moveWidget(id, -50, -50);
    expect(widgetById(id).layout).toMatchObject({ x: 0, y: 0 });
  });

  it('bringToFront envoie le widget en fin de liste (dessiné au-dessus)', () => {
    const first = ids()[0]!;
    useDashboardStore.getState().bringToFront(first);
    expect(ids().at(-1)).toBe(first);
    // No-op s'il est déjà au premier plan ou inconnu.
    const before = ids();
    useDashboardStore.getState().bringToFront(first);
    useDashboardStore.getState().bringToFront('nope');
    expect(ids()).toEqual(before);
  });
});

describe('migration v1 (unités de grille) → v2 (canvas px)', () => {
  it('fromGridUnits convertit les unités de grille en px', () => {
    expect(fromGridUnits({ x: 1, y: 1, w: 2, h: 1 })).toEqual({ x: 304, y: 136, w: 592, h: 120 });
  });

  it('sanitizeConfig migre un layout v1 et laisse un layout px intact', () => {
    const persisted = {
      config: {
        version: 1,
        widgets: [
          { id: 'a', type: 'kpi', title: 'A', config: {}, layout: { x: 1, y: 0, w: 1, h: 1 } },
          {
            id: 'b',
            type: 'kpi',
            title: 'B',
            config: {},
            layout: { x: 304, y: 136, w: 592, h: 120 },
          },
        ],
      },
    };
    const cfg = sanitizeConfig(persisted);
    expect(cfg.widgets[0]!.layout).toEqual({ x: 304, y: 0, w: 288, h: 120 });
    expect(cfg.widgets[1]!.layout).toEqual({ x: 304, y: 136, w: 592, h: 120 });
  });

  it('sanitizeConfig retombe sur la config par défaut si le contenu est corrompu', () => {
    const cfg = sanitizeConfig({ config: { widgets: [{ nope: true }] } });
    expect(cfg.widgets.length).toBeGreaterThan(0);
    expect(cfg.version).toBe(2);
  });
});

describe('dashboardStore.addWidget (placement automatique)', () => {
  beforeEach(() => {
    useDashboardStore.getState().resetToDefault();
  });

  it('convertit les tailles v1 des fabriques et place sous tout le contenu', () => {
    const before = useDashboardStore.getState().config.widgets;
    const bottom = Math.max(...before.map(w => w.layout.y + w.layout.h));
    useDashboardStore.getState().addWidget({
      type: 'kpi',
      title: 'Neuf',
      config: {},
      layout: { x: 0, y: 0, w: 1, h: 1 },
    });
    const added = useDashboardStore.getState().config.widgets.at(-1)!;
    expect(added.title).toBe('Neuf');
    expect(added.layout).toMatchObject({ x: 0, w: 288, h: 120 });
    expect(added.layout.y).toBeGreaterThanOrEqual(bottom);
  });
});

describe('dashboardStore.setWidgetStyle (personnalisation)', () => {
  beforeEach(() => {
    useDashboardStore.getState().resetToDefault();
  });

  /** Style complet d'un widget neuf : tout est normalisé à l'écriture. */
  const DEFAULT_STYLE = {
    accent: 'default',
    textScale: 1,
    surface: 'auto',
    opacity: 1,
    hideHeader: false,
    border: 'thin',
    radius: 'soft',
    locked: false,
  };

  it('fusionne accent et taille de texte, avec bornes', () => {
    const id = firstWidgetId();
    useDashboardStore.getState().setWidgetStyle(id, { accent: 'emerald' });
    expect(widgetById(id).style).toEqual({ ...DEFAULT_STYLE, accent: 'emerald' });
    // Le patch suivant garde l'accent déjà choisi.
    useDashboardStore.getState().setWidgetStyle(id, { textScale: 1.3 });
    expect(widgetById(id).style).toEqual({
      ...DEFAULT_STYLE,
      accent: 'emerald',
      textScale: 1.3,
    });
    // Bornes : un zoom délirant est ramené dans [0.7, 1.6].
    useDashboardStore.getState().setWidgetStyle(id, { textScale: 99 });
    expect(widgetById(id).style?.textScale).toBe(1.6);
  });

  it('conserve fond, contour, coins et verrouillage entre deux patchs', () => {
    const id = firstWidgetId();
    useDashboardStore.getState().setWidgetStyle(id, { surface: 'tinted', locked: true });
    useDashboardStore.getState().setWidgetStyle(id, { border: 'thick', radius: 'round' });
    expect(widgetById(id).style).toEqual({
      ...DEFAULT_STYLE,
      surface: 'tinted',
      locked: true,
      border: 'thick',
      radius: 'round',
    });
  });

  it("borne l'opacité et ignore les valeurs inconnues", () => {
    const id = firstWidgetId();
    useDashboardStore.getState().setWidgetStyle(id, { opacity: 5 });
    expect(widgetById(id).style?.opacity).toBe(1);
    useDashboardStore.getState().setWidgetStyle(id, { opacity: 0 });
    expect(widgetById(id).style?.opacity).toBe(0.2);
    // Valeur hors énumération (config bidouillée à la main) → retour au défaut.
    useDashboardStore.getState().setWidgetStyle(id, { surface: 'neon' as unknown as 'auto' });
    expect(widgetById(id).style?.surface).toBe('auto');
  });
});

describe('dashboardStore — affichages enregistrés (presets)', () => {
  beforeEach(() => {
    useDashboardStore.getState().resetToDefault();
    for (const p of useDashboardStore.getState().presets) {
      useDashboardStore.getState().deletePreset(p.id);
    }
  });

  it('enregistre un instantané indépendant et le restaure', () => {
    const id = firstWidgetId();
    useDashboardStore.getState().moveWidget(id, 320, 480);
    useDashboardStore.getState().savePreset('Bourse');
    // Édition APRÈS enregistrement : le preset ne doit pas bouger.
    useDashboardStore.getState().moveWidget(id, 0, 0);
    expect(widgetById(id).layout).toMatchObject({ x: 0, y: 0 });

    const preset = useDashboardStore.getState().presets.find(p => p.name === 'Bourse')!;
    expect(preset.widgets.find(w => w.id === id)!.layout).toMatchObject({ x: 320, y: 480 });

    useDashboardStore.getState().applyPreset(preset.id);
    expect(widgetById(id).layout).toMatchObject({ x: 320, y: 480 });
  });

  it('nomme automatiquement les affichages sans nom et les supprime', () => {
    useDashboardStore.getState().savePreset('   ');
    const preset = useDashboardStore.getState().presets.at(-1)!;
    expect(preset.name).toBe('Affichage 1');
    useDashboardStore.getState().deletePreset(preset.id);
    expect(useDashboardStore.getState().presets).toHaveLength(0);
    // Appliquer un id inconnu ne change rien.
    const before = useDashboardStore.getState().config.widgets;
    useDashboardStore.getState().applyPreset('nope');
    expect(useDashboardStore.getState().config.widgets).toBe(before);
  });

  it('sanitizePresets écarte les presets corrompus et garde les sains', () => {
    const sain = {
      id: 'p1',
      name: 'OK',
      widgets: [
        { id: 'a', type: 'kpi', title: 'A', config: {}, layout: { x: 1, y: 0, w: 1, h: 1 } },
      ],
    };
    const out = sanitizePresets({
      presets: [sain, { id: 'p2' }, null, { id: 'p3', name: 'KO', widgets: [{ nope: true }] }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe('OK');
    // Migration v1 → px appliquée aussi aux presets.
    expect(out[0]!.widgets[0]!.layout).toEqual({ x: 304, y: 0, w: 288, h: 120 });
    expect(sanitizePresets({})).toEqual([]);
    expect(sanitizePresets(null)).toEqual([]);
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
