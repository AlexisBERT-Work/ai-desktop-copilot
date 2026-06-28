# Dashboard P3 — module Bourse (données live)

**Date :** 2026-06-28
**Statut :** Implémenté (type-check + lint verts, 9 tests bourse). Le bras Rust
`market.update` n'a pas été compilé ici (pas de `cargo build` dans la boucle) —
miroir exact de `proactive.suggestion`.
**Auteur :** @alexis.bert1412

> Le module bourse du Pilier A : cotations **en direct** dans le dashboard +
> **formules** recalculées à chaque tick + **pilotage par l'agent**. Cadre :
> [dashboard-platform.md](dashboard-platform.md) §6.

---

## 1. Chemin de bout en bout

```
Sidecar Node                          Rust                 React
MarketPoller (30 s)
  └─ MarketService.refresh()
       ├─ YahooQuoteSource (fetch)
       └─ FormulaEngine (mathjs)
       → stdout {method:'market.update', params: snapshot}
                          │ NDJSON
                   bridge.rs ── emit('market:update') ──► useTauriEvents
                                                          └─ marketStore.apply()
                                                             └─ StocksWidget (live)
```

L'agent peut configurer en langage naturel (« ajoute TSLA, calcule le ratio
AAPL/MSFT ») via les outils, puis ça tourne tout seul — **sans re-prompter**.

---

## 2. Fichiers

```
packages/shared-types/src/market.ts        Quote, WatchlistItem, FormulaCell,
                                            ComputedValue, MarketSnapshot
packages/agent-runtime/src/market/
  ├─ YahooQuoteSource.ts (+test)           fetch Yahoo v8 chart (sans crumb) + parser pur
  ├─ FormulaEngine.ts    (+test)           évaluation mathjs (champs, croisé, fonctions)
  ├─ MarketService.ts                      watchlist + cotations + historique + formules
  └─ MarketPoller.ts                       tick → notification `market.update`
packages/agent-runtime/src/tools/market/   get_market, add_to_watchlist,
                                            remove_from_watchlist, set_formula, remove_formula
apps/desktop/src-tauri/src/ipc/bridge.rs   bras `market.update` → event `market:update`
apps/desktop/src/features/market/marketStore.ts   store front (quotes + computed)
apps/desktop/src/shared/hooks/useTauriEvents.ts   écoute `market:update`
apps/desktop/src/features/dashboard/widgets/StocksWidget.tsx  affichage live
```

Câblage sidecar : [index.ts](../../packages/agent-runtime/src/index.ts) crée le
`MarketService` (seed `CATDESK_WATCHLIST`), enregistre les outils, démarre le
`MarketPoller` (cadence `CATDESK_MARKET_INTERVAL_MS`, défaut 30 s) et l'arrête au
SIGTERM.

---

## 3. Source de données

Yahoo `v8/finance/chart/{symbole}` : **pas de crumb/cookie**, une requête par
symbole, parser pur testé. On dérive `change`/`changePercent` depuis
`chartPreviousClose`. Un symbole en échec garde sa dernière valeur marquée
`stale`. (Le batch « 1 requête = N symboles » du v7 nécessite un crumb : repli
volontaire sur le v8 par-symbole, suffisant à la minute.)

---

## 4. Formules (mathjs)

Contexte = un objet par symbole : `AAPL.price`, `AAPL.change`,
`AAPL.changePercent`, `AAPL.volume`. Exemples :
- `AAPL.price / MSFT.price` (ratio croisé)
- `max(AAPL.changePercent, MSFT.changePercent)`
- `AAPL.change * 100 + MSFT.change`

Erreur isolée par formule (`ComputedValue.error`), jamais de crash. Langage mathjs
(pas d'`eval` JS).

**Colonnes de formules dans le widget** : chaque widget `stocks` porte ses formules
dans sa config (`config.formulas: { name, expression }[]`), éditables via l'éditeur
de widget. Elles sont synchronisées au sidecar (même mécanisme que les symboles,
voir §7), calculées à chaque tick et **affichées sous les cotations** (matchées par
nom sur `computed`), avec valeur ou « erreur » par formule.

---

## 5. Outils agent

| Outil | Rôle | Risque |
|---|---|:--:|
| `get_market` | Instantané courant (rafraîchi) : cotations + formules | 🟢 low |
| `add_to_watchlist` | Ajoute un symbole + rafraîchit | 🟡 medium |
| `remove_from_watchlist` | Retire un symbole | 🟡 medium |
| `set_formula` | Crée/modifie une formule (mathjs) | 🟡 medium |
| `remove_formula` | Supprime une formule | 🟡 medium |

---

## 6. Configuration (env du sidecar)

| Variable | Défaut | Rôle |
|---|---|---|
| `CATDESK_WATCHLIST` | `AAPL,MSFT,TSLA` | Watchlist de départ |
| `CATDESK_MARKET_INTERVAL_MS` | `30000` | Cadence de rafraîchissement |

---

## 7. Synchro config (symboles + formules) widget ↔ sidecar (résolu)

La **config bourse est pilotée par l'UI** : `useMarketWatchSync` calcule l'union des
**symboles** et des **formules** de tous les widgets `stocks` et l'envoie au sidecar
via la commande Tauri `set_market_watchlist` → `StdinBridge` (`market.set_watchlist`)
→ `MarketService.setWatchlist()` + `setFormulas()` + refresh immédiat. Éditer un
widget suffit donc (plus besoin de passer par l'agent).

Chemin : `useMarketWatchSync` → `invoke('set_market_watchlist', { symbols, formulas })`
→ `chat.rs` → `send_to_agent` (stdin) → `StdinBridge` → `MarketService` +
`MarketPoller.refreshNow()`.

> Précédence : les widgets font foi (`setWatchlist`/`setFormulas` **remplacent**).
> Les outils agent `add/remove_to_watchlist`, `set/remove_formula` restent utiles en
> chat/headless, mais une re-synchro de l'UI réaligne tout sur les widgets.

---

## 8. Vérification

- `pnpm type-check` : **3/3 verts** · `pnpm lint` : **0 erreur**.
- `pnpm --filter @catdesk/agent-runtime test` : **388 verts** (dont 9 bourse :
  parser Yahoo + moteur de formules).
- Endpoint Yahoo validé en réel (prix/variation/volume).
- ⚠️ Rust : recompiler (`cargo build` / `pnpm dev`) pour activer le nouvel event.
