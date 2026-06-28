# PROJET — Plateforme Dashboard CatDesk

**Date :** 2026-06-28
**Statut :** Proposé (brouillon de cadrage, en évolution)
**Auteur :** @alexis.bert1412

> Doc de cadrage de la **plateforme Dashboard** de CatDesk. Deux piliers :
> **(A)** une interface d'accueil **configurable** (KPIs, stats, données, actions)
> qui remplace le simple bouton actuel, et **(B)** une **news globale pilotée par
> l'admin**, diffusée à tous les clients en lecture seule.
> Le **module Bourse** (ancien périmètre « Option B ») devient le **premier
> module concret** branché sur cette plateforme.
> À lire avec [CAPACITES.md](../CAPACITES.md) (outils existants) et
> [adr-001](../architecture/adr-001-stack-selection.md) (choix de stack).
>
> _Historique : ce doc partait d'un tableau de bord boursier (Option B). Il a été
> élargi en plateforme le 2026-06-28._

---

## 0. Vision

Faire passer la surface d'entrée de CatDesk d'un **bouton/action unique** (ex. « prendre
un screenshot ») à une **vraie interface tableau de bord** :

1. **Pilier A — Interface configurable.** Une page composée de **widgets
   paramétrables** (KPIs, stats, données live, actions rapides). L'utilisateur
   choisit quoi afficher et comment. Les détails de chaque widget seront précisés
   dans de prochaines évolutions — ici on pose **le principe et l'ossature**.

2. **Pilier B — News globale pilotée par l'admin.** Une zone de news qui
   **apparaît chez tous les clients** à l'ouverture, mais que **seul l'admin
   (toi)** peut rédiger/publier. Les clients sont en **lecture seule**. À terme,
   possibilité de news **ciblées par client**, toujours créées par nous.

> ⚠️ **Changement d'architecture majeur (Pilier B) — DÉCIDÉ : backend.** CatDesk
> est aujourd'hui « 100 % local, aucune donnée cloud ». Une news publiée par
> l'admin et diffusée à *tous* les clients introduit **le premier composant
> non-local** du produit : un **service central** (API + base) que les clients
> interrogent, et une notion de **« clients »** identifiés. C'est assumé et cadré
> (§5). On part **directement sur un backend** (et non un flux statique) : le
> **ciblage par client** devient natif dès le départ, et la news peut être diffusée
> en **quasi temps réel**. Les clients restent en **lecture seule**.

---

## 1. Objectifs / Non-objectifs

### Objectifs
- **A.** Interface d'accueil = grille de **widgets configurables** (le screenshot
  devient un widget « action rapide » parmi d'autres).
- **A.** Modèle de widget générique : `{ type, source de données, options, layout }`.
- **B.** Afficher chez **tous les clients** une **news globale** à l'ouverture.
- **B.** **Seul l'admin** publie ; les clients ne peuvent **pas** créer de news.
- **B.** Intégrité garantie : une news ne peut pas être **falsifiée/usurpée**.
- Rester cohérent avec CatDesk : permissions, audit, flux IPC, sandbox egress.

### Non-objectifs (pour ce cadrage)
- ❌ Figer le **catalogue exact de widgets** ni leur schéma de config (plus tard).
- ❌ Un **système multi-comptes complet** (SSO, rôles fins) : le backend se limite
  à **admin** (publie) + **clients identifiés** en lecture.
- ❌ News **rédigée côté client** ou commentaires/interactions (lecture seule).
- ❌ (Module Bourse) tick par tick, passage d'ordres, conseil financier.

---

## 2. Architecture d'ensemble

Deux flux distincts viennent alimenter la même interface. Tout egress réseau passe
par la **sandbox Rust** avec **allow-list de domaines** (règle « Rust valide tous
les inputs »). L'UI **n'appelle jamais** le sidecar ni le réseau directement.

```
                         ┌──────────────────────────────┐
                         │   Interface Dashboard (React) │
                         │   ┌────────────────────────┐  │
   News (Pilier B) ─────►│   │ Bandeau / zone News     │  │
   (lecture seule)       │   ├────────────────────────┤  │
                         │   │ Grille de widgets (A)   │  │
   Données widgets ─────►│   │  KPI · stats · table    │  │
   (Pilier A: bourse…)   │   │  bourse · action rapide │  │
                         │   └────────────────────────┘  │
                         └──────────────▲────────────────┘
                                        │ tauri emit() / invoke()
                            ┌───────────┴───────────┐
                            │      Bridge Rust       │
                            │  sandbox + egress      │
                            │  allow-list + audit    │
                            └─────▲────────────▲─────┘
      API news HTTPS (read-only)  │            │   stdout NDJSON
   (clients identifiés)          │            │
        ┌──────────────────┐     │      ┌─────┴───────────────────────┐
        │  Backend News     │─────┘      │  Sidecar agent Node          │
        │  API + DB + authz │            │  WidgetProviders (dont       │
        │  (global + ciblé) │            │  MarketPoller / module Bourse)│
        └──────────────────┘            └──────────────────────────────┘
              ▲
              │ publie (admin authentifié uniquement)
        ┌─────┴───────────┐
        │  Console admin   │  (hors app cliente : web/CLI, login admin)
        │  CRUD news        │
        └─────────────────┘
```

---

## 3. Pilier A — Interface configurable (principe)

L'écran d'accueil devient une **grille de widgets**. Chaque widget est autonome :
un **type**, une **source de données**, des **options** et une **position**.

```ts
/** Un widget paramétrable de l'interface. */
export interface Widget {
  id: string;
  type: 'kpi' | 'stat' | 'chart' | 'table' | 'stocks' | 'quick_action' | 'news';
  title: string;
  dataSource?: string;                 // id d'un provider (ex. 'market', 'system')
  config: Record<string, unknown>;     // schéma propre à chaque type (défini plus tard)
  layout: { x: number; y: number; w: number; h: number };
}

/** Disposition complète, persistée entre sessions. */
export interface DashboardConfig {
  version: number;
  widgets: Widget[];
}
```

Principes posés maintenant (détails reportés) :
- Le **bouton screenshot actuel** = un widget `quick_action` ⇒ rétro-compatible.
- Le **module Bourse** (§6) = un widget `stocks` alimenté par le provider `market`.
- Les widgets `kpi` / `stat` / `chart` consomment un **provider de données** ; la
  liste des providers et le schéma de `config` de chaque type seront spécifiés
  dans une évolution dédiée.
- Disposition **paramétrable** (drag/resize) et **persistée** (settings).

> On livre d'abord **l'ossature** (grille + 2-3 widgets dont screenshot et bourse),
> puis on enrichit le catalogue widget par widget.

---

## 4. Pilier B — News globale pilotée par l'admin (principe)

**Besoin :** à l'ouverture, chaque client voit une news ; **seul l'admin** la crée ;
plus tard, possibilité de news **par client** (créées par nous).

### Modèle de données
```ts
export interface NewsItem {
  id: string;
  title: string;
  body: string;                        // Markdown
  severity: 'info' | 'success' | 'warning' | 'critical';
  publishedAt: number;                 // epoch ms
  expiresAt?: number;                  // disparaît après cette date
  audience: 'global' | { clientId: string }; // ciblage natif dès le départ
}

/** Réponse de l'API news. Le client reçoit global + ce qui le cible. */
export interface NewsFeed {
  version: number;
  items: NewsItem[];
  signature?: string;                  // optionnel : anti-falsification (le backend + TLS + authz suffisent)
}

/** Identité d'un client, émise/validée par le backend. */
export interface ClientIdentity {
  clientId: string;                    // ID d'installation (ou clé de licence)
  token: string;                       // jeton de lecture, scope read-only
}
```

### Comment « seul moi peux publier » est garanti (via backend)
1. **L'app cliente ne contient AUCUNE capacité de publication.** Le CRUD news vit
   dans une **console admin séparée** (web/CLI), protégée par **login admin**, non
   livrée aux clients. ⇒ un client **ne peut pas** émettre de news, par construction.
2. **Autorisation côté serveur.** Les jetons clients ont un **scope strictement
   `read-only`** ; seuls les comptes **rôle `admin`** peuvent écrire (POST/PUT/DELETE).
   ⇒ même en rejouant les appels de l'API, un client ne peut rien publier.
3. **Transport sécurisé** : HTTPS/TLS partout. Signature du contenu **optionnelle**
   (défense en profondeur / cache hors-ligne), pas indispensable avec un backend
   de confiance.

### Distribution — DÉCIDÉ : backend
| Aspect | Choix |
|---|---|
| **Forme** | Service central **API + base de données + authz par rôle** |
| **Clients** | **Identifiés** (`ClientIdentity`), lecture seule (global + news ciblées) |
| **Admin** | **Console séparée** (login), CRUD news, choix de l'audience (global/clientId) |
| **Temps réel** | Possible : **WebSocket/SSE** (push) ou poll léger en repli |
| **Ciblage par client** | **Natif dès le départ** (`audience: { clientId }`) |

> **Stack backend : DÉCIDÉ — Supabase.** Chaque besoin se mappe sur une brique
> native, donc très peu de code serveur à écrire :
>
> | Besoin | Brique Supabase |
> |---|---|
> | « Seul l'admin publie » + clients lecture | **Row-Level Security** : policy write réservée au rôle `admin`, policy read pour `authenticated` |
> | Ciblage par client | Policy RLS : `audience = 'global' OR audience->>'clientId' = auth.uid()` |
> | Identité client | **Supabase Auth** (compte anonyme / lien magique / clé) → `auth.uid()` = `clientId` |
> | News temps réel | **Realtime** (abonnement à la table `news`) |
> | API | **PostgREST auto-générée** + client `@supabase/supabase-js` |
> | Console admin | **Supabase Studio** au début, ou petite page admin custom plus tard |
>
> Les clients embarquent uniquement la **clé `anon`** (publique, scope limité par
> RLS) — **jamais** la `service_role`. L'app cliente n'expose aucune écriture.

### Affichage côté client
- À l'ouverture : le client s'authentifie (jeton), appelle l'API et reçoit
  **global + news qui le ciblent**. Abonnement temps réel optionnel pour les
  mises à jour pendant la session.
- Rendu Markdown dans une **zone news** (bandeau ou panneau), tri par date,
  masquage des `expiresAt` dépassés.
- **Lecture seule.** Egress (domaine de l'API) en **allow-list** + journalisé (audit).

---

## 5. Impact local-first (à assumer explicitement)

CatDesk évolue de « **100 % local** » vers « **local-first avec flux distants
contrôlés, en lecture seule** » :

| Flux distant | Sens | Contrôle |
|---|---|---|
| Données widgets (ex. cours bourse) | entrant, lecture | allow-list domaine + audit |
| News (Pilier B) | entrant, lecture seule (API backend) | allow-list + HTTPS + **jeton client read-only** (écriture = admin only) |
| Inférence LLM | **reste 100 % local** (Ollama) | inchangé |

À refléter dans [CAPACITES.md](../CAPACITES.md) §11 (« 100 % local ») le moment venu.

---

## 6. Module Bourse (premier module du Pilier A)

> Contenu de l'ancien périmètre « Option B », conservé tel quel : c'est le premier
> widget `stocks` / provider `market`.

### 6.1 Décisions actées
| # | Décision | Justification |
|---|---|---|
| D1 | **Cadence ~1 min** (polling 30–60 s), pas de tick par tick | Tick = données propriété des bourses → **frais de licence** + débit bloqué par les API gratuites. À cette échelle, la seconde = **bruit de microstructure**. |
| D2 | **Sources via adaptateurs**, API d'abord, scraping en filet | investing.com **sans API officielle** + anti-bot + JS. Yahoo renvoie **N actions en 1 requête**, robuste et gratuit. |
| D3 | **Intégré à CatDesk** | Réutilise sandbox + permissions + audit + IPC + l'agent comme interface de config. |
| D4 | **Construire** le moteur de formules | « Formules libres recalculées en direct » non couvert par TradingView/Sheets. |

### 6.2 Composants
| Composant | Emplacement proposé | Rôle |
|---|---|---|
| `MarketPoller` | `packages/agent-runtime/src/market/MarketPoller.ts` | Tick (via `CronScheduler`), appelle les adaptateurs |
| `DataSourceAdapter` | `packages/agent-runtime/src/market/adapters/` | `YahooAdapter` (batch) + `WebScrapeAdapter` (URL+sélecteur, filet) |
| `MarketStore` | `packages/agent-runtime/src/market/MarketStore.ts` | Cache courant + historique (SQLite) |
| `FormulaEngine` | `packages/agent-runtime/src/market/FormulaEngine.ts` | Recalcul des formules à chaque tick |

Réutilise l'existant : `CronScheduler` (tick 60 s), SQLite, logique `call_api` /
`read_webpage`/Playwright, `analyze_data` (pandas) pour les stats lourdes. Push UI
via event `market:update` calqué sur le pattern `agent:plan`.

### 6.3 Modèle de données
```ts
export interface Quote {
  symbol: string; price: number; change: number; changePercent: number;
  volume: number | null; currency: string;
  source: 'yahoo' | 'web' | string; timestamp: number; stale: boolean;
}
export interface WatchlistItem {
  symbol: string; label?: string; adapter: 'yahoo' | 'web';
  webConfig?: { url: string; selector: string; field: string };
}
export interface FormulaCell {
  id: string; name: string; expression: string;
  scope: 'row' | 'aggregate' | 'cross' | 'rolling';
  lastValue?: number; error?: string;
}
```

### 6.4 Sources
investing.com : pas d'API, anti-bot, valeurs en JS ⇒ scraping **fragile, lourd,
contraire aux CGU, bannissement** au polling. Préférer une API JSON.

| Source | Coût | Débit | Verdict |
|---|---|---|---|
| **Yahoo Finance** (JSON non officiel) | Gratuit | **Batch** : 1 requête = N symboles | ✅ Principale |
| Finnhub (free) | Gratuit | ~60 req/min, WS | Alternative |
| Twelve Data (free) | Gratuit | 8 req/min, 800/j | Alternative |
| Alpha Vantage (free) | Gratuit | 25/jour | ❌ trop limité |
| Scraping investing.com | « gratuit » | bannissement | ⚠️ filet seulement |

### 6.5 Moteur de formules
Par ligne (`change/price*100`), croisées (`AAPL.price/MSFT.price`), agrégées
(`sum(qty*price)`), glissantes (`movingAverage(AAPL.price,20)` → historique SQLite).
Erreur isolée par cellule (`FormulaCell.error`), ne casse jamais le tableau.

| Lib | Licence | Verdict |
|---|---|---|
| **mathjs** | Apache-2.0 | ✅ défaut (sûr en distribution proprio) |
| HyperFormula | **GPLv3/commerciale** | ⚠️ éviter sauf licence acceptée |
| hot-formula-parser | MIT | alternative légère |

### 6.6 Outils agent (config par l'IA)
Process [CLAUDE.md](../../CLAUDE.md) §« Adding a New Tool ». Le poller est un
**service de fond**, pas un `BaseTool` ; les outils ne font que lire/muter sa config.

| Outil | Risque | Confirmation |
|---|:--:|:--:|
| `get_quotes` / `get_watchlist` | 🟢 low | non |
| `add_to_watchlist` / `remove_from_watchlist` | 🟡 medium | non |
| `set_formula` / `remove_formula` | 🟡 medium | non |

---

## 7. Décisions ouvertes

**Plateforme**
1. ✅ **Distribution news : backend Supabase** (décidé). Reste à choisir le **plan**
   (free pour démarrer) et la région d'hébergement.
2. **Identité client** : compte **anonyme** Supabase (ID d'installation) vs
   **nominatif** (lien magique / clé de licence) ? → impacte ciblage et RGPD.
3. **Console admin** : Supabase Studio (rapide) vs petite page admin custom ?
4. **Temps réel** : WebSocket/SSE dès la V1 ou poll d'abord ?
5. **L'interface configurable remplace-t-elle** la bulle/action actuelle, ou
   s'ajoute-t-elle à côté ?

**Module Bourse**
6. Univers (US seul vs Euronext/crypto/forex) · 7. Lib formules (mathjs vs autre) ·
8. Cadence (30 s/60 s) · 9. Profondeur d'historique SQLite.

---

## 8. Risques & limites

| Risque | Impact | Mitigation |
|---|---|---|
| **News falsifiée / usurpée** | Message frauduleux chez tous les clients | **Authz serveur (rôle admin)** + HTTPS + app cliente **sans capacité d'écriture** (+ signature optionnelle) |
| Érosion du local-first | Confiance utilisateur | Flux **en lecture seule**, allow-list, audit, inférence locale inchangée |
| **Backend = ops / sécurité / coût** | Surface d'attaque, maintenance, hébergement | **Supabase managé** (pas de serveur à tenir), **RLS** par rôle, `service_role` jamais côté client, périmètre limité à la news, plan free au départ |
| **Données clients (identité)** | Vie privée / RGPD | ID d'installation **anonyme** par défaut, minimisation, consentement si nominatif |
| Endpoint Yahoo non officiel casse | Plus de data | Adaptateurs interchangeables + `WebScrapeAdapter` |
| Données différées prises pour du RT | Mauvaise décision | Horodatage + état `stale` visibles |
| Licence GPL (HyperFormula) | Contamination proprio | Défaut `mathjs` |
| Formule erronée | UI cassée | Erreur isolée par cellule |

---

## 9. Lotissement (roadmap)

| Phase | Contenu | Sortie |
|---|---|---|
| **P0 — Cadrage** | Projet **Supabase** (plan/région), modèle d'identité client, schéma table `news` + **policies RLS** | Backend prêt à coder |
| **P1 — Ossature dashboard** ✅ | Grille de widgets + `DashboardConfig` persistée + **mode édition** (ajout / drag-reorder / resize / rename / config) + widgets `quick_action` & `stocks` | **Implémenté** — voir [dashboard-p1.md](dashboard-p1.md) |
| **P2 — Backend news (Supabase)** ✅ | Table `news` + **RLS** + Auth anonyme + `@supabase/supabase-js` + Realtime + bandeau & widget news + CSP egress | **Code + SQL livrés** (reste : provisionner le projet Supabase) — voir [dashboard-p2.md](dashboard-p2.md) |
| **P3 — Module Bourse** ✅ | YahooQuoteSource + MarketService + MarketPoller + FormulaEngine (mathjs) + 5 outils agent + event `market:update` + widget `stocks` live | **Implémenté** — voir [dashboard-p3.md](dashboard-p3.md) |
| **P4 — Enrichissements** | Catalogue widgets (KPI/stat/chart), **temps réel news (WS/SSE)**, alertes, `WebScrapeAdapter`, analytics « qui a vu quoi » | Plateforme étendue |

---

## 10. Annexe — P0 : implémentation Supabase (détail)

Sortie attendue de P0 : un backend **prêt à coder**. Tout le SQL ci-dessous se passe
dans le SQL Editor du projet Supabase.

### 10.1 Table `news`
```sql
create table public.news (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,                     -- Markdown
  severity     text not null default 'info'
                 check (severity in ('info','success','warning','critical')),
  audience_client_id uuid references auth.users(id) on delete cascade, -- NULL = global
  published_at timestamptz not null default now(),
  expires_at   timestamptz,
  created_by   uuid not null default auth.uid() references auth.users(id)
);
create index on public.news (published_at desc);
```

### 10.2 RLS — le cœur de « seul l'admin publie »
```sql
alter table public.news enable row level security;

-- Lecture : tout client authentifié voit le global + ce qui le cible, non expiré
create policy news_read on public.news
  for select to authenticated
  using (
    (audience_client_id is null or audience_client_id = auth.uid())
    and (expires_at is null or expires_at > now())
  );

-- Écriture (insert/update/delete) : réservée au rôle admin
create policy news_admin_write on public.news
  for all to authenticated
  using      ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');
```
> Les deux policies sont permissives (combinées en OR) : un **client** ne matche que
> `news_read` (lecture filtrée) ; **toi (admin)** matches `news_admin_write` → tu vois
> tout et tu es le seul à pouvoir écrire. Un client ne peut rien publier, même en
> rejouant l'appel : la policy d'écriture exige le claim admin qu'il n'a pas.

```sql
-- Donner le rôle admin UNE fois (via SQL Editor / service_role) :
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"admin"}'
where email = 'alexis.bert1412@gmail.com';
```

### 10.3 Identité client
- `supabase.auth.signInAnonymously()` → chaque installation obtient un `auth.uid()`
  **stable** (session persistée) = le `clientId` utilisé pour le ciblage.
- ⚠️ Pour cibler « tel client » nominativement, l'admin doit relier un **uid** à un
  **nom**. Si besoin : passer en **lien magique / clé de licence**, ou ajouter une
  table `clients (uid → label)`. → reste la décision ouverte §7.2.

### 10.4 Realtime
```sql
alter publication supabase_realtime add table public.news;
```

### 10.5 Point d'intégration dans CatDesk
Les appels Supabase = **egress réseau**. Deux options vis-à-vis de la règle « Rust
valide l'egress » :
- **(reco) Renderer direct** via `@supabase/supabase-js` — nécessaire pour le
  **WebSocket Realtime**, simple. On ajoute `*.supabase.co` à l'**allow-list / CSP
  Tauri**. Sûr : clé `anon` + RLS lecture seule.
- **Proxy sidecar** : plus conforme à « l'UI n'appelle pas le réseau », mais relayer
  le WS Realtime est lourd. À réserver si on veut tout journaliser côté Rust.

Config embarquée : `SUPABASE_URL` + `SUPABASE_ANON_KEY` (anon = publique par design).
La `service_role` n'est **jamais** dans l'app cliente (uniquement console admin).

### 10.6 Snippets
```ts
// CLIENT (CatDesk) — clé anon
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
await supabase.auth.signInAnonymously();              // clientId stable

const { data: news } = await supabase                  // RLS filtre déjà global+ciblé+non expiré
  .from('news').select('*').order('published_at', { ascending: false });

supabase.channel('news')                               // temps réel
  .on('postgres_changes', { event: '*', schema: 'public', table: 'news' }, reloadNews)
  .subscribe();
```
```ts
// ADMIN (console séparée, session admin — NON livrée aux clients)
await supabase.from('news').insert({
  title: 'Maintenance prévue', body: 'Indispo le 30/06 14h-15h.',
  severity: 'warning', audience_client_id: null,       // null = global ; sinon un uid
});
```

### 10.7 Checklist de sortie P0
- [ ] Projet Supabase créé — plan **free**, région **EU (Frankfurt)** pour le RGPD
- [ ] `news` + RLS (`news_read`, `news_admin_write`) + index + publication realtime
- [ ] Compte admin + `app_metadata.role = 'admin'`
- [ ] `signInAnonymously` + persistance de session côté client
- [ ] `*.supabase.co` en allow-list / CSP Tauri

---

## 11. Références techniques
- Architecture & IPC : [CLAUDE.md](../../CLAUDE.md)
- Outils réutilisables : [CAPACITES.md](../CAPACITES.md)
- Stack (Tauri/Node/SQLite) : [adr-001](../architecture/adr-001-stack-selection.md)
- Pattern event UI (`agent:plan`) & distribution : [SUIVI.md](../SUIVI.md), [DISTRIBUTION.md](../DISTRIBUTION.md)
- Libs formules : `mathjs` (Apache-2.0), `HyperFormula` (GPL/comm.) · Data : `yahoo-finance2`, Finnhub, Twelve Data
- **Backend news : Supabase** (Postgres + Auth + RLS + Realtime + PostgREST) · client `@supabase/supabase-js` (clé `anon` uniquement, jamais `service_role`)
- Signature de contenu **optionnelle** : réutiliser le mécanisme de signature des releases si souhaité
