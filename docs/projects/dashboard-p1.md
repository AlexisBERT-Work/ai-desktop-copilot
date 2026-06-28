# Dashboard P1 — interface configurable (implémenté)

**Date :** 2026-06-28
**Statut :** Implémenté (type-check + lint verts)
**Auteur :** @alexis.bert1412

> Documentation de l'**ossature du Pilier A** (interface configurable) telle que
> livrée en P1, et **guide pour l'étendre**. Cadre d'ensemble :
> [dashboard-platform.md](dashboard-platform.md).

---

## 1. Ce qui est livré

L'écran d'accueil n'est plus un simple bouton (« prendre un screenshot ») mais une
**grille de widgets paramétrables** :

- **Grille de widgets** pilotée par une `DashboardConfig`, rendue en CSS grid
  (3 colonnes), chaque widget occupant `w × h` cellules.
- **Mode édition** complet : **ajouter**, **réorganiser** (glisser-déposer),
  **redimensionner**, **renommer**, **configurer** et **retirer** un widget,
  plus **réinitialiser** la disposition (avec confirmation).
- **Persistance** robuste entre sessions (validée/réparée au rechargement).
- **Isolation des erreurs** : un widget qui plante n'emporte pas le tableau.
- Le **screenshot devient un widget** `quick_action` parmi d'autres ; le module
  bourse est un widget `stocks` (données live câblées en P3).

---

## 2. Arborescence

```
apps/desktop/src/features/dashboard/
├─ dashboardStore.ts          # état + actions (zustand, persisté)
├─ DashboardWindow.tsx        # fenêtre : header, mode édition, grille, DnD
├─ DashboardWidgetCard.tsx    # chrome d'un widget : titre, contrôles, drag, erreur
└─ widgets/
   ├─ types.ts                # WidgetProps
   ├─ registry.ts             # type de widget → composant (Record exhaustif)
   ├─ widgetMeta.ts           # libellé/icône/constructeur par type (menu d'ajout)
   ├─ QuickActionWidget.tsx   # action rapide (envoie une requête à l'agent)
   ├─ StocksWidget.tsx        # bourse (ossature, live en P3)
   ├─ PlaceholderWidget.tsx   # rendu par défaut des types pas encore faits
   ├─ WidgetConfigEditor.tsx  # éditeur de config par type (quick_action, stocks)
   └─ WidgetErrorBoundary.tsx # isolation des plantages

packages/shared-types/src/dashboard.ts   # Widget, WidgetType, WidgetLayout, DashboardConfig
```

Points d'entrée (câblage overlay) :
- `OverlayMode` gagne `'dashboard'` ([events.ts](../../packages/shared-types/src/events.ts)).
- [FloatingOverlay.tsx](../../apps/desktop/src/features/overlay/FloatingOverlay.tsx) rend la fenêtre.
- Ouverture : bouton **📊 Tableau de bord** ([MiniMode.tsx](../../apps/desktop/src/features/overlay/MiniMode.tsx)) + commande **Open dashboard** ([CommandPalette.tsx](../../apps/desktop/src/features/overlay/CommandPalette.tsx)).
- Taille de fenêtre dédiée ([useOverlayWindow.ts](../../apps/desktop/src/shared/hooks/useOverlayWindow.ts)).

---

## 3. Modèle de données

Dans [packages/shared-types/src/dashboard.ts](../../packages/shared-types/src/dashboard.ts) :

```ts
type WidgetType = 'kpi' | 'stat' | 'chart' | 'table' | 'stocks' | 'quick_action' | 'news';
interface WidgetLayout { x: number; y: number; w: number; h: number; }
interface Widget {
  id: string; type: WidgetType; title: string;
  dataSource?: string;                 // id d'un provider (ex. 'market')
  config: Record<string, unknown>;     // schéma propre au type
  layout: WidgetLayout;
}
interface DashboardConfig { version: number; widgets: Widget[]; }
```

> **Placement actuel** : l'ordre dans le tableau `widgets` + les spans `w`/`h`
> déterminent la disposition. Les champs `x`/`y` sont réservés pour un placement
> libre futur (cf. §8).

---

## 4. Le store (`dashboardStore.ts`)

Zustand + `persist`. Bornes : `MAX_W = 3` colonnes, `MAX_H = 2` hauteurs.

| Action | Effet |
|---|---|
| `setEditMode(on)` | Active/désactive le mode édition (transitoire) |
| `addWidget(widget)` | Ajoute un widget (id généré via `crypto.randomUUID()`) |
| `removeWidget(id)` | Retire un widget |
| `renameWidget(id, title)` | Renomme |
| `updateWidgetConfig(id, patch)` | Fusionne un patch dans `config` |
| `cycleWidgetWidth(id)` | Largeur 1→2→3→1 (bornée) |
| `cycleWidgetHeight(id)` | Hauteur 1→2→1 (bornée) |
| `reorderWidget(src, target)` | Déplace `src` avant `target` (drag & drop) |
| `resetToDefault()` | Rétablit la disposition par défaut |

---

## 5. Persistance & robustesse

- Clé localStorage : `catdesk-dashboard`, `version: 1`.
- **`partialize`** : seule la `config` est persistée ; `editMode` reste transitoire
  (le dashboard s'ouvre toujours en lecture, pas en édition).
- **`merge` + `sanitizeConfig`** : au rechargement, le contenu persisté est
  **validé widget par widget** (`isWidget`) ; tout état corrompu/obsolète retombe
  proprement sur la config par défaut. C'est la voie de migration douce (pas de
  crash sur de vieilles données).

---

## 6. Isolation des erreurs

Chaque widget est rendu dans `WidgetErrorBoundary` (composant classe, seul moyen
d'attraper une erreur de rendu en React). Un widget qui throw affiche un encart
d'erreur local ; les autres continuent de fonctionner.

---

## 7. Accessibilité & UX

- Fenêtre `role="dialog"` + `aria-label`.
- Boutons d'action avec `aria-label`/`title` ; toggles avec `aria-pressed`.
- **Échap** : ferme l'éditeur s'il est ouvert, sinon revient au mini-mode.
- En mode édition, les widgets sont rendus en `pointer-events-none` : pas de
  déclenchement accidentel d'une action pendant qu'on réorganise.
- Réinitialisation en **deux temps** (« Réinitialiser » → « Confirmer ? »).

---

## 8. Ajouter un nouveau type de widget (guide)

1. **Déclarer le type** dans `WidgetType`
   ([dashboard.ts](../../packages/shared-types/src/dashboard.ts)).
2. **Créer le composant** `widgets/MonWidget.tsx` avec les props `WidgetProps`
   (`{ widget }`). Lire `widget.config` de façon défensive (narrow `unknown`).
3. **L'enregistrer** dans `widgets/registry.ts`. Le `Record<WidgetType, …>` est
   **exhaustif** : oublier un type provoque une **erreur de compilation** (filet
   de sécurité). Faute de composant dédié, mapper vers `PlaceholderWidget`.
4. **Ajouter une entrée** dans `widgets/widgetMeta.ts` (`label`, `icon`, `build()`)
   → le widget apparaît dans le menu « Ajouter ».
5. *(option)* **Éditeur de config** : ajouter un cas dans `WidgetConfigEditor.tsx`
   (sinon « Ce widget n'a pas encore de réglages »).

---

## 9. Limites connues / hors P1

- **Placement libre `x`/`y`** (drag-resize façon Grafana) : non couvert ; à faire
  avec `react-grid-layout` en P4. P1 fait réorganisation par ordre + spans `w`/`h`.
- **Données live** : `StocksWidget` est une ossature ; le provider `market`
  arrive en **P3**. KPI/stat/chart/table/news = `PlaceholderWidget` pour l'instant.
- **Widget `news` réel** : dépend du backend **P2** (Supabase).
- **Tests UI** : aucun test ajouté à ce stade (logique surtout présentationnelle).

---

## 10. Vérification

- `pnpm type-check` : **3/3 packages verts**.
- `pnpm lint` : **0 erreur** (3 warnings préexistants hors de ce module).
- Manuel : `pnpm dev`, puis `Ctrl+Espace` → 📊.
