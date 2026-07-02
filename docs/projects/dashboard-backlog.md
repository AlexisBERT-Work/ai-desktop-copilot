# Dashboard — MVP & backlog d'évolutions

**Date :** 2026-06-28
**Auteur :** @alexis.bert1412

> On gèle le périmètre **MVP** (déjà construit) et on **note de côté** toutes les
> évolutions possibles pour plus tard — sans les implémenter maintenant.
> Cadre : [dashboard-platform.md](dashboard-platform.md).
> Effort indicatif : **S** (≤ ½ j) · **M** (1-3 j) · **L** (> 3 j).

---

## ✅ MVP (périmètre figé — déjà livré, PR #1)

Ce qui constitue le MVP et qu'on **ne touche plus** sauf bug :

- **Interface configurable** : grille de widgets, mode édition (ajout / drag-reorder
  / resize / rename / config / reset), persistance.
- **Module Bourse** : cotations live (Yahoo ~30 s), **formules** mathjs recalculées,
  **sparklines**, synchro auto widgets ↔ watchlist du sidecar, 5 outils agent.
- **News admin** : schéma Supabase + RLS, bandeau + widget, lecture seule client.

### Definition of Done du MVP
- [ ] PR #1 **mergée** dans `master`.
- [ ] **Rust recompilé** (`pnpm dev` / `cargo build`) → events `market:update` +
      commande `set_market_watchlist` actifs.
- [ ] *(optionnel pour la news)* **Projet Supabase provisionné** (sinon news masquée).
- [ ] Validation visuelle : `Ctrl+Espace` → 📊, cours + formules + sparklines à jour.

---

## 🧊 Backlog — évolutions futures (notées de côté)

### Tableau de bord
| # | Évolution | Valeur | Effort |
|---|---|---|---|
| D1 | Widgets **KPI / stat / chart** réels (aujourd'hui placeholder) | Haute | M |
| D2 | **Placement libre** des widgets (drag x/y, `react-grid-layout`) | Moyenne | M |
| D3 | Nouveaux types de widgets (notes, todo, stats système) | Moyenne | M |
| D4 | Multi-dashboards / onglets | Faible | M |
| D5 | Thèmes / personnalisation visuelle | Faible | S |

### Bourse
| # | Évolution | Valeur | Effort |
|---|---|---|---|
| B1 | **Formules glissantes** — ✅ livré (2026-07-03) : `X.history` + `sma`/`ema` dans le scope mathjs | Haute | M |
| B2 | **Alertes / seuils** + notifications quand un cours/formule franchit un seuil | Haute | M |
| B3 | **Portefeuille** : quantités détenues → valeur, P&L (formules agrégées) | Haute | M |
| B4 | Plus de marchés (Euronext/crypto/forex) + `WebScrapeAdapter` de secours | Moyenne | M |
| B5 | Source payante (Finnhub/Twelve Data) pour fiabilité / vrai temps réel | Moyenne | M |
| B6 | **Persistance historique** en SQLite — ✅ livré (2026-07-03) : `MarketHistoryStore` (`data/market.db`) | Moyenne | S |
| B7 | Univers + cadence réglables depuis l'UI (pas seulement via env) | Faible | S |

### News & Dailys
> **Livré (2026-06-29)** : **dailys** — flux éditorial admin, lecture seule
> client, **filtrable par catégorie** (widget + préférence persistée).
> Voir [dashboard-dailies.md](dashboard-dailies.md).

| # | Évolution | Valeur | Effort |
|---|---|---|---|
| N1 | **Ciblage par client** : UI pour récupérer l'`uid` client + cibler depuis la console | Haute | M |
| N2 | **Console admin custom** — ✅ livrée pour les **dailys** (login + CRUD in-app) ; reste à étendre à la **news** | Moyenne | M |
| N3 | Analytics « qui a vu quoi » / accusés de lecture | Faible | M |
| N4 | Signature de contenu optionnelle (défense en profondeur) | Faible | S |
| N5 | Catégories de dailys **paramétrables** (liste fixe → admin) + multi-tags | Moyenne | M |
| N6 | Daily **auto-générée** par l'agent — ✅ livrée : revue de presse multi-journaux + analyse intra-journal (LLM) + publication cron (poste de référence) | Moyenne | M |

### Qualité / robustesse
| # | Évolution | Valeur | Effort |
|---|---|---|---|
| Q1 | **Tests UI** (widgets, stores zustand) | Moyenne | M |
| Q2 | Test d'intégration du chemin marché (sidecar) | Moyenne | S |
| Q3 | `/code-review` + `/security-review` de la PR | Moyenne | S |

### Infra / distribution
| # | Évolution | Valeur | Effort |
|---|---|---|---|
| I1 | Synchro cloud de la config dashboard (multi-postes) | Faible | M |
| I2 | Mettre à jour l'installeur / release autour des nouvelles deps | Moyenne | M |

---

## Quand piocher dans le backlog
Après le MVP, candidats **prioritaires** (forte valeur / effort raisonnable) :
**B2** (alertes), ~~B1~~ ✅, **B3** (portefeuille), **D1** (widgets KPI/chart),
**N1** (ciblage client). Le reste au fil des retours d'usage.
