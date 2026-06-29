# Dashboard — Dailys (flux éditorial filtrable)

**Date :** 2026-06-29
**Statut :** Implémenté côté code + SQL (type-check 3/3, lint 0 erreur). Reste à
appliquer la migration sur le projet Supabase (`db push`).
**Auteur :** @alexis.bert1412

> Extension du **Pilier B**. La **news** (alertes ponctuelles : bandeau coloré
> par gravité) reste inchangée. Les **dailys** sont un concept distinct : un flux
> de briefings quotidiens, rédigés par l'**admin**, que chaque client **consulte
> en lecture seule** et **filtre par centre d'intérêt**. Cadre :
> [dashboard-platform.md](dashboard-platform.md) · news : [dashboard-p2.md](dashboard-p2.md).

---

## 1. Décisions de conception

- **Table dédiée `dailies`** (séparée de `news`) — deux usages clairs : alertes
  vs flux éditorial. Même schéma d'auth/RLS/Realtime que `news`.
- **Une catégorie par daily**, dans une **liste fixe** :
  `markets, tech, crypto, macro, product, misc` (libellés FR dans l'UI).
- **Filtrage côté client** : l'utilisateur coche les catégories qui l'intéressent
  (puces dans le widget). C'est une **préférence locale persistée**, pas un
  secret serveur → la RLS renvoie toutes les catégories (non expirées).
- **Par défaut, tout s'affiche** (aucune catégorie suivie = opt-in au filtrage).

---

## 2. Modèle de données

[dailies.ts](../../packages/shared-types/src/dailies.ts) (camelCase client) ;
colonnes Postgres snake_case mappées dans `useDailies.ts`.

```ts
const DAILY_CATEGORIES = ['markets','tech','crypto','macro','product','misc'] as const;
type DailyCategory = (typeof DAILY_CATEGORIES)[number];

interface Daily {
  id: string; title: string; body: string;   // body = Markdown
  category: DailyCategory;
  publishedAt: string; expiresAt: string | null;
}
```

---

## 3. Arborescence

```
supabase/migrations/20260629000000_dailies.sql   # table + RLS + realtime

packages/shared-types/src/dailies.ts             # Daily, DailyCategory, libellés
apps/desktop/src/features/dailies/
├─ dailiesStore.ts   # items/status + followed (persisté) ; computeActiveDailies, filterByFollowed
└─ useDailies.ts     # auth anonyme + fetch + Realtime (réutilise le client news)
apps/desktop/src/features/dashboard/widgets/DailiesWidget.tsx  # DailiesView (pure) + widget connecté
```

Câblage : `useDailies()` dans
[useDashboardData.ts](../../apps/desktop/src/features/dashboard/useDashboardData.ts) ;
widget `dailies` enregistré dans
[registry.ts](../../apps/desktop/src/features/dashboard/widgets/registry.ts) et
proposé dans le menu d'ajout ([widgetMeta.ts](../../apps/desktop/src/features/dashboard/widgets/widgetMeta.ts)).

---

## 4. Lecture seule garantie + console admin

L'écriture (`dailies_admin_write`) exige le claim `app_metadata.role = 'admin'` :
un client (clé `anon`, session anonyme) ne peut **rien** publier, même en
contournant l'UI. Deux façons de rédiger côté admin :

- **Console intégrée** (recommandée) — bouton **« Admin »** dans l'en-tête de la
  fenêtre Marchés & News (visible si Supabase est configuré). Connexion par
  e-mail/mot de passe → CRUD complet (rédiger / éditer / faire expirer /
  supprimer). Fichiers : [adminAuth.ts](../../apps/desktop/src/features/dailies/adminAuth.ts),
  [dailiesAdmin.ts](../../apps/desktop/src/features/dailies/dailiesAdmin.ts),
  [DailiesAdminConsole.tsx](../../apps/desktop/src/features/dailies/DailiesAdminConsole.tsx).
- **Supabase Studio** (repli) — Table editor / SQL avec le compte admin.

> La console n'est qu'un confort d'écriture : **la sécurité est serveur** (RLS).
> Se connecter dans la console = obtenir le JWT admin ; sans le claim, les
> écritures sont rejetées par Postgres.

---

## 5. Filtrage par centre d'intérêt

- `followed: DailyCategory[]` dans `dailiesStore` (persisté, clé `catdesk-dailies`).
- `toggleCategory(c)` (puces du widget), `filterByFollowed(items, followed)` pur.
- `followed` vide ⇒ toutes les catégories ; sinon restreint aux catégories cochées.
- `merge` répare un état persisté obsolète (catégorie retirée de la liste).

---

## 6. Mise en route

La migration est appliquée par le même `pnpm exec supabase db push` que la news
(voir [../../supabase/DEPLOY.md](../../supabase/DEPLOY.md)). Pour utiliser la
**console admin**, le compte admin doit avoir un **mot de passe** (Auth → Add
user *avec* mot de passe, ou sign-up) **et** le claim `role=admin` (DEPLOY §7).
Ensuite : fenêtre Marchés & News → **Admin** → connexion → rédiger.

---

## 7. Vérification

- `pnpm type-check` : **3/3** · `pnpm lint` : **0 erreur**.
- Sans `.env` Supabase : widget masqué (status `unconfigured`).
- Avec backend + quelques dailys : le widget liste le flux, les puces filtrent,
  la sélection est mémorisée entre sessions.
- Le **guide des widgets** (bouton « Guide », exportable en PDF) inclut un aperçu.

---

## 8. Suite possible

- **Console admin** : ✅ livrée (login + CRUD dans l'app). Étendre à la **news**.
- Catégories paramétrables côté admin (au lieu d'une liste fixe).
- Multi-tags par daily (filtrage plus fin).
- Accusés de lecture / « non lus », marque-page.
- Programmation (publier à une date future) — aujourd'hui `published_at = now()`.
- Daily auto-générée par l'agent (lien avec `NewsSummarizer`/cron).
