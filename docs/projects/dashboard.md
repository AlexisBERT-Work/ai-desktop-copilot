# Dashboard, Bourse, News & Dailys — mémoire des décisions

> **Document de décisions, pas d'état.** Il garde le « pourquoi » des choix faits
> en juin-juillet 2026 sur le tableau de bord et ses trois modules, et les
> modèles de données qui n'existent nulle part ailleurs en prose. Pour **l'état
> réel** : [SUIVI.md](../SUIVI.md) · capacités : [CAPACITES.md](../CAPACITES.md) ·
> bornes : [LIMITES.md](../LIMITES.md) · ce qui reste à faire :
> [AMELIORATIONS.md](../AMELIORATIONS.md).
>
> Fusion (2026-09-02) des six documents de cadrage `dashboard-platform`, `-p1`,
> `-p2`, `-p3`, `-dailies` et `-backlog`. Leur contenu périmé (étapes de mise en
> route déjà faites, checklists soldées, chiffres de tests d'époque) est tombé ;
> `git log -- docs/projects/` les retrouve intégralement.

---

## 1. Les deux piliers

L'écran d'accueil est passé d'un **bouton unique** (« prendre un screenshot ») à
un tableau de bord à deux sources :

- **Pilier A — interface configurable** : une grille de **widgets paramétrables**
  (KPI, stats, données live, actions rapides). Le screenshot est devenu un widget
  `quick_action` parmi d'autres. Premier module de données : la **Bourse** (§4).
- **Pilier B — news pilotée par l'admin** : une zone d'annonces qui apparaît chez
  **tous les clients**, que **seul l'admin** rédige, en **lecture seule** côté
  client, globale ou ciblée (§5). Les **dailys** en sont l'extension éditoriale (§6).

**La décision structurante** : le Pilier B introduit le **premier composant non
local** du produit. CatDesk passe de « 100 % local » à « **local-first avec flux
distants contrôlés, en lecture seule** » :

| Flux distant             | Sens                   | Contrôle                                           |
| ------------------------ | ---------------------- | -------------------------------------------------- |
| Cotations (Pilier A)     | entrant, lecture       | allow-list de domaine + audit                      |
| News / dailys (Pilier B) | entrant, lecture seule | RLS serveur, clé `anon` publique, écriture = admin |
| Inférence LLM            | **reste 100 % local**  | inchangé (Ollama)                                  |

Non-objectifs assumés dès le cadrage : pas de multi-comptes ni de rôles fins
(admin + clients anonymes, point), pas de news rédigée côté client, pas de
commentaires, et côté bourse **ni tick par tick, ni passage d'ordres, ni conseil
financier**.

---

## 2. Architecture d'ensemble

```
                         ┌───────────────────────────────┐
   News / dailys ───────►│  Interface Dashboard (React)   │
   (lecture seule)       │   bandeau + grille de widgets  │
   Cotations     ───────►│                                │
                         └──────────────▲─────────────────┘
                                        │ invoke() / emit()
                            ┌───────────┴───────────┐
                            │      Bridge Rust      │
                            └─────▲───────────▲─────┘
      HTTPS + WSS (RLS)           │           │  stdout NDJSON
        ┌──────────────────┐      │     ┌─────┴──────────────────┐
        │ Supabase         │──────┘     │ Sidecar agent Node     │
        │ Postgres+Auth+RLS│            │ MarketPoller, digests  │
        └──────────────────┘            └────────────────────────┘
```

> ⚠️ **Écart connu avec ce schéma** : les appels Supabase partent **directement du
> webview**, sans passer par Rust — la CSP a été élargie pour ça. C'est une
> exception assumée à la règle d'architecture n°1, décrite dans
> [AMELIORATIONS.md](../AMELIORATIONS.md) §1.2. Le sidecar, lui, publie bien par
> le chemin normal.

---

## 3. Pilier A — interface configurable

Livré en juin 2026 sur une **grille CSS 3 colonnes**, puis **dépassé** le
2026-07-18 par un **canvas libre en pixels** (`WidgetLayout {x,y,w,h}` réellement
utilisé, `useWidgetDrag`, affichages enregistrés). Les champs `x`/`y` du modèle,
réservés à l'origine, servent donc aujourd'hui.

### 3.1 Modèle de données

`packages/shared-types/src/dashboard.ts` :

```ts
type WidgetType = 'kpi' | 'stat' | 'chart' | 'table' | 'stocks' | 'quick_action' | 'news';
interface WidgetLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  dataSource?: string; // id d'un provider (ex. 'market')
  config: Record<string, unknown>; // schéma propre au type
  layout: WidgetLayout;
}
interface DashboardConfig {
  version: number;
  widgets: Widget[];
}
```

### 3.2 Ajouter un type de widget

1. Déclarer le type dans `WidgetType` (`shared-types/src/dashboard.ts`).
2. Créer `widgets/MonWidget.tsx` avec les props `WidgetProps`. Lire
   `widget.config` **défensivement** — c'est de l'`unknown` persisté.
3. L'enregistrer dans `widgets/registry.ts`. Le `Record<WidgetType, …>` est
   **exhaustif** : un type oublié casse la compilation — c'est le filet.
4. Ajouter une entrée dans `widgets/widgetMeta.ts` (`label`, `icon`, `build()`)
   pour qu'il apparaisse dans le menu « Ajouter ».
5. _(option)_ un cas dans `WidgetConfigEditor.tsx` pour ses réglages.

### 3.3 Ce qui protège la grille

- **Persistance validée** : `partialize` ne persiste que la `config` (le mode
  édition reste transitoire) ; au rechargement, `merge` + `sanitizeConfig`
  valident **widget par widget** et retombent sur la config par défaut si l'état
  persisté est corrompu ou obsolète. C'est la voie de migration douce — pas de
  crash sur de vieilles données.
- **Isolation des erreurs** : chaque widget est rendu dans `WidgetErrorBoundary`
  (composant classe, seul moyen d'attraper une erreur de rendu React). Un widget
  qui plante affiche un encart local ; les autres continuent.
- **UX** : en mode édition les widgets sont en `pointer-events-none` (pas de
  déclenchement accidentel pendant qu'on réorganise), et la réinitialisation se
  fait en deux temps.

---

## 4. Module Bourse

### 4.1 Décisions actées

| #   | Décision                                                    | Justification                                                                                                                                           |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Cadence ~30 s**, jamais tick par tick                     | Le tick est une donnée propriété des bourses (frais de licence) et bloqué par les API gratuites. À cette échelle, la seconde = bruit de microstructure. |
| D2  | **Sources par adaptateurs**, API d'abord, scraping en filet | investing.com n'a pas d'API officielle, ajoute de l'anti-bot et rend ses valeurs en JS.                                                                 |
| D3  | **Intégré à CatDesk** plutôt qu'externe                     | Réutilise sandbox, permissions, audit, IPC — et l'agent comme interface de configuration.                                                               |
| D4  | **Construire** le moteur de formules                        | « Formules libres recalculées en direct » n'existe ni dans TradingView ni dans Sheets.                                                                  |

### 4.2 Chemin de bout en bout

```
MarketPoller (30 s) → MarketService.refresh()
   ├─ YahooQuoteSource (fetch)
   └─ FormulaEngine (mathjs)
   → stdout {method:'market.update'} → bridge.rs → emit('market:update')
   → useTauriEvents → marketStore.apply() → StocksWidget (live)
```

Modules : `agent-runtime/src/market/{YahooQuoteSource,FormulaEngine,MarketService,MarketPoller}.ts`,
outils dans `tools/market/`, types dans `shared-types/src/market.ts` (`Quote`,
`WatchlistItem`, `FormulaCell`, `ComputedValue`, `MarketSnapshot`).

L'agent peut tout configurer en langage naturel (« ajoute TSLA, calcule le ratio
AAPL/MSFT »), puis ça tourne seul — **sans re-prompter**.

### 4.3 Sources de données

Yahoo `v8/finance/chart/{symbole}` : **pas de crumb ni de cookie**, une requête
par symbole, parser pur testé. `change`/`changePercent` sont dérivés de
`chartPreviousClose`. Un symbole en échec **garde sa dernière valeur**, marquée
`stale`. Le batch « 1 requête = N symboles » du v7 exigerait un crumb : repli
volontaire sur le v8 par symbole, suffisant à la minute.

| Source                            | Coût        | Débit           | Verdict            |
| --------------------------------- | ----------- | --------------- | ------------------ |
| **Yahoo Finance** (JSON non off.) | gratuit     | 1 req./symbole  | ✅ principale      |
| Finnhub (free)                    | gratuit     | ~60 req/min, WS | alternative        |
| Twelve Data (free)                | gratuit     | 8 req/min       | alternative        |
| Alpha Vantage (free)              | gratuit     | 25/jour         | ❌ trop limité     |
| Scraping investing.com            | « gratuit » | bannissement    | ⚠️ filet seulement |

### 4.4 Moteur de formules

Contexte mathjs = un objet par symbole (`AAPL.price`, `.change`, `.changePercent`,
`.volume`, `.history`). Ratios croisés (`AAPL.price / MSFT.price`), agrégats,
glissantes (`sma`/`ema` sur `history`, persisté par `MarketHistoryStore` dans
`data/market.db`). **Erreur isolée par formule** (`ComputedValue.error`) : une
expression fausse n'emporte jamais le tableau. Langage mathjs, **jamais d'`eval`
JS**.

Choix de librairie : **mathjs** (Apache-2.0). HyperFormula est en **GPLv3**, donc
contaminante pour une distribution propriétaire.

### 4.5 Outils agent et configuration

| Outil                                        | Risque    |
| -------------------------------------------- | --------- |
| `get_market`                                 | 🟢 low    |
| `add_to_watchlist` / `remove_from_watchlist` | 🟡 medium |
| `set_formula` / `remove_formula`             | 🟡 medium |

Env du sidecar : `CATDESK_WATCHLIST` (défaut `AAPL,MSFT,TSLA`),
`CATDESK_MARKET_INTERVAL_MS` (défaut `30000`).

### 4.6 Précédence : les widgets font foi

`useMarketWatchSync` calcule l'union des symboles et des formules de **tous** les
widgets `stocks` et l'envoie au sidecar (`set_market_watchlist` → `StdinBridge` →
`MarketService.setWatchlist()` + `setFormulas()` + refresh immédiat). Ces appels
**remplacent** l'état ; les outils agent restent utiles en chat/headless, mais une
re-synchro de l'UI réaligne tout sur les widgets.

---

## 5. Pilier B — news (Supabase)

### 5.1 Modèle de données

`shared-types/src/news.ts` (camelCase client, colonnes Postgres en snake_case,
mapping dans `features/news/model.ts`) :

```ts
interface NewsItem {
  id: string;
  title: string;
  body: string; // Markdown
  severity: 'info' | 'success' | 'warning' | 'critical';
  audienceClientId: string | null; // null = global ; sinon cible un client
  publishedAt: string;
  expiresAt: string | null;
}
```

### 5.2 Comment « seul l'admin publie » est garanti

Quatre couches, dont **une seule** est côté client :

1. **RLS serveur** — la policy `news_admin_write` exige le claim
   `app_metadata.role = 'admin'`. La clé `anon` ne l'a pas : rejouer l'API à la
   main ne donne rien. **C'est là qu'est la sécurité.**
2. **`service_role` jamais embarquée** — le client n'a que la clé `anon`, publique
   par construction et bornée par RLS.
3. **Lecture filtrée** — `news_read` ne renvoie que le global + ce qui cible ce
   client, et masque les annonces expirées.
4. **L'app cliente n'a aucun code d'écriture** — confort, pas barrière.

> La console admin intégrée (onglets « Annonces » et « Dailys manuelles ») n'est
> qu'un **confort d'écriture** : s'y connecter revient à obtenir le JWT admin.
> Sans le claim, Postgres rejette. Supabase Studio reste le repli, et le seul
> endroit où retrouver l'`uid` d'un poste (aucun annuaire dans l'app).

### 5.3 Identité client et temps réel

`signInAnonymously()` donne à chaque installation un `auth.uid()` **stable**
(session persistée) qui sert de `clientId` pour le ciblage. Le client s'abonne au
canal `postgres_changes` : toute insertion déclenche un re-fetch, lui-même filtré
par RLS — donc sûr même si l'événement Realtime est générique. Repli implicite :
au pire, l'annonce est vue au prochain montage de l'app.

**Piège vécu, corrigé dans le code** : omettre `audience_client_id` dans un insert
bascule l'annonce en **global**, silencieusement. `newsAdmin.ts` l'envoie donc
**toujours** explicitement (`null` pour global), et la portée est une case à
cocher visible côté UI — jamais un champ vide qui déciderait à la place de l'admin.

---

## 6. Dailys (flux éditorial filtrable)

### 6.1 Décisions de conception

- **Table dédiée `dailies`**, séparée de `news` : deux usages nets — alertes
  ponctuelles vs flux éditorial. Même schéma d'auth/RLS/Realtime.
- **Une catégorie par daily**, liste **fixe** : `markets, tech, crypto, macro,
product, misc` (libellés FR dans l'UI).
- **Filtrage côté client** : les catégories suivies sont une **préférence locale
  persistée**, pas un secret serveur — la RLS renvoie tout ce qui n'est pas expiré.
- **Par défaut, tout s'affiche** : `followed` vide = pas de filtre (opt-in).

```ts
const DAILY_CATEGORIES = ['markets', 'tech', 'crypto', 'macro', 'product', 'misc'] as const;
interface Daily {
  id: string;
  title: string;
  body: string; // Markdown
  category: DailyCategory;
  publishedAt: string;
  expiresAt: string | null;
}
```

### 6.2 La revue de presse automatique

Le cœur des dailys : agréger plusieurs **journaux**, faire une **analyse
intra-journal** par le LLM local, publier **une daily par journal**. Tout en
TypeScript dans l'agent-runtime — aucun code Rust ni frontend.

1. `aggregateNews({ sources, topics, sinceHours, limit })` par journal (registre
   dans `news/sources.ts`). Le filtre `topics` est une recherche de caractères sur
   titre + extrait.
2. `enrichExcerpts` complète les articles sans extrait.
3. `analyzeJournal` → JSON `{ analyse, resumes[] }` via le LLM local.
4. `buildJournalBody` → Markdown ; catégorie déduite du journal.
5. `publishDailiesOpen` → session anonyme + RPC `publish_daily_if_missing`.
6. `PressDigestScheduler` → run quotidien à `CATDESK_PRESS_HOUR`, précédé d'un
   `hasTodaysSharedDigest` : si un autre poste a déjà publié, on ne régénère rien.
7. _(extra admin)_ **miroir Discord** des dailys **réellement insérées** — donc
   pas de doublon au redémarrage, l'idempotence Supabase couvrant aussi Discord.

**Flux RSS testés en direct (2026-06-30)** : La Tribune, Yahoo Finance, Investing,
MarketWatch, FT, CNBC, Le Monde (+Éco), Le Figaro, Libération, France 24, BBC, The
Guardian, Al Jazeera, + sources tech. **Les Échos retiré** (flux en 403). Une
source en échec est ignorée sans bloquer les autres.

### 6.3 Publication ouverte à tout poste (2026-07-20)

Le lot standard (7 journaux + 6 sujets + synthèse) ne dépend plus d'un poste admin
allumé. **La fonction Postgres `publish_daily_if_missing` (`SECURITY DEFINER`),
pas la policy RLS, autorise l'écriture** — et valide elle-même ce qu'elle
accepte : titre conforme à l'un des **3 gabarits**, catégorie parmi les 6, corps
≤ 20 000 caractères, **≤ 60 lignes/jour**. Idempotente en base (contrainte unique
sur `title`, `on conflict do nothing`) : deux postes qui publient en même temps →
un seul insert passe.

Restent **admin uniquement** : les journaux personnalisés (`press_feeds`, lecture
**et** écriture) et les dailys manuelles (`dailies_admin_write`).

### 6.4 Journaux personnalisés (admin)

L'admin définit ses propres journaux sans redéploiement (console admin, onglet
« Journaux personnalisés »), stockés dans `public.press_feeds` — RLS admin
uniquement : **les clients ne voient que les dailys produites, jamais les
recettes**. Chaque recette porte des sources (ids intégrés et/ou URLs RSS/Atom),
des filtres (mots-clés + regex inclure/exclure sur titre+extrait), une fenêtre en
heures, un plafond d'articles et un état actif/inactif.

### 6.5 Configuration

**Activation : aucune.** Le lot standard tourne par défaut sur tout poste (URL et
clé anon publiques, en défaut dans le code) ; `CATDESK_PRESS_DIGEST=0` le coupe
sur un poste donné. Les réglages du lot standard (`CATDESK_PRESS_MODE`,
`_TOPIC_LIMIT`, `_RUN_ON_START`, `_SOURCES`, `_TOPICS`, `_SYNTHESIS`, `_HOUR`,
`_SINCE_HOURS`, `_LIMIT`) et les **extras admin** (`SUPABASE_ADMIN_EMAIL` /
`_PASSWORD` pour les journaux personnalisés, `CATDESK_PRESS_DISCORD_WEBHOOK` pour
le miroir) sont documentés dans `packages/agent-runtime/.env.example`, qui fait foi.

---

## 7. Les décisions ouvertes de juin, et ce qu'elles sont devenues

| Question de juin 2026                     | Tranchée par                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| Backend de la news : lequel ?             | **Supabase managé**, plan free, région **EU (Frankfurt)** pour le RGPD. |
| Identité client : anonyme ou nominative ? | **Anonyme** (`signInAnonymously`), ID d'installation stable.            |
| Console admin : Studio ou page custom ?   | **Console intégrée à l'app** (dailys, journaux, annonces).              |
| Temps réel dès la V1 ?                    | **Oui** — `postgres_changes`, re-fetch filtré par RLS.                  |
| Le dashboard remplace-t-il la bulle ?     | **Il s'ajoute** : `OverlayMode` gagne `'dashboard'`.                    |
| Univers bourse, lib de formules, cadence  | US via Yahoo · **mathjs** · **30 s** · historique SQLite.               |
| Placement libre des widgets               | **Fait** (canvas en pixels, 2026-07-18) — sans `react-grid-layout`.     |

**Les risques identifiés en juin, aujourd'hui** : la falsification de news est
couverte par l'authz serveur ; le coût et l'ops du backend, par le managé ; le
RGPD, par l'anonymat. **Restent ouverts** : l'endpoint Yahoo non officiel peut
casser (mitigation : adaptateurs interchangeables, état `stale` visible), et
l'érosion du local-first reste un arbitrage assumé, pas un problème résolu.

---

## 8. Ce qui n'a jamais été fait

Le reste du backlog de juin, non priorisé depuis. Le backlog **vivant** est dans
[AMELIORATIONS.md](../AMELIORATIONS.md) ; ceci n'en est que la part dashboard.

| #   | Évolution                                                            | Valeur  |
| --- | -------------------------------------------------------------------- | ------- |
| B2  | **Alertes / seuils** : notification quand un cours franchit un seuil | Haute   |
| B3  | **Portefeuille** : quantités détenues → valeur, P&L                  | Haute   |
| N1  | **Ciblage par client** : récupérer l'`uid` d'un poste depuis l'UI    | Haute   |
| D1  | Widgets **KPI / stat / chart** réels (encore `PlaceholderWidget`)    | Moyenne |
| N5  | Catégories de dailys **paramétrables** + multi-tags                  | Moyenne |
| B4  | Plus de marchés (Euronext, crypto, forex) + adaptateur de scraping   | Moyenne |
| B5  | Source payante (Finnhub, Twelve Data) pour la fiabilité              | Moyenne |
| D3  | Nouveaux types de widgets (notes, todo, stats système)               | Moyenne |
| Q1  | **Tests UI** des widgets et des stores zustand                       | Moyenne |
| N3  | Analytics « qui a vu quoi » / accusés de lecture                     | Faible  |
| D4  | Multi-dashboards / onglets · D5 thèmes et personnalisation visuelle  | Faible  |
| I1  | Synchro cloud de la config dashboard (multi-postes)                  | Faible  |
