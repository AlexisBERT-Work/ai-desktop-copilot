# Dashboard P2 — news pilotée par l'admin (Supabase)

**Date :** 2026-06-28
**Statut :** Implémenté côté code + SQL (type-check + lint verts). Reste à
**provisionner le projet Supabase** (étapes §7).
**Auteur :** @alexis.bert1412

> Implémentation du **Pilier B** : une news rédigée par **toi seul** (admin) et
> diffusée à **tous les clients** en lecture seule, globale **ou ciblée** par
> client. Cadre d'ensemble : [dashboard-platform.md](dashboard-platform.md).

---

## 1. Ce qui est livré

- **SQL** prêt à appliquer : table `news` + **RLS** + Realtime
  ([supabase/migrations/20260628000000_news.sql](../../supabase/migrations/20260628000000_news.sql)).
- **Client complet** : client Supabase, identité anonyme stable, fetch + **Realtime**,
  **bandeau** d'annonce à l'ouverture, **widget `news`** dans le dashboard.
- **Dégradation propre** : sans variables d'env, la news est simplement masquée —
  l'app build et tourne sans Supabase.
- **Egress** : `*.supabase.co` (HTTPS + WSS) ajouté à la **CSP** Tauri.

---

## 2. Arborescence

```
supabase/
├─ migrations/20260628000000_news.sql     # table + RLS + realtime (+ snippet rôle admin)
└─ README.md

apps/desktop/
├─ .env.example                 # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
├─ src/vite-env.d.ts            # typage des variables d'env
├─ src-tauri/tauri.conf.json    # CSP connect-src étendu à Supabase
└─ src/features/news/
   ├─ supabaseClient.ts         # client (null si non configuré)
   ├─ useNews.ts                # auth anonyme + fetch + abonnement Realtime
   ├─ newsStore.ts              # items/status/dismiss (zustand, dismiss persisté)
   ├─ newsStyles.ts             # couleurs + icônes par gravité
   ├─ NewsMarkdown.tsx          # rendu Markdown du corps
   └─ NewsBanner.tsx            # bandeau haut, masquable
apps/desktop/src/features/dashboard/widgets/NewsWidget.tsx  # widget liste

packages/shared-types/src/news.ts   # NewsItem, NewsSeverity, ClientIdentity
```

Câblage : `useNews()` + `<NewsBanner />` dans
[App.tsx](../../apps/desktop/src/App.tsx) ; widget `news` enregistré dans
[registry.ts](../../apps/desktop/src/features/dashboard/widgets/registry.ts).

---

## 3. Modèle de données

[news.ts](../../packages/shared-types/src/news.ts) (camelCase côté client) ;
les colonnes Postgres sont en snake_case et mappées dans `useNews.ts`.

```ts
interface NewsItem {
  id: string; title: string; body: string;  // body = Markdown
  severity: 'info' | 'success' | 'warning' | 'critical';
  audienceClientId: string | null;          // null = global ; sinon cible un client
  publishedAt: string; expiresAt: string | null;
}
```

---

## 4. Comment « seul moi peux publier » est garanti

1. **L'app cliente n'a aucune capacité d'écriture** : elle ne fait que `select` +
   `subscribe`. Aucune insertion/édition n'est codée côté client.
2. **RLS serveur** : la policy d'écriture (`news_admin_write`) exige le claim
   `app_metadata.role = 'admin'`. La clé `anon` des clients ne l'a pas → écriture
   impossible, même en rejouant l'API.
3. **`service_role` jamais embarquée** : le client n'utilise que la clé `anon`
   (publique, bornée par RLS).
4. **Lecture filtrée** : `news_read` ne renvoie à un client que le **global** + ce
   qui le **cible**, et masque les annonces **expirées**.

> Rédaction des news = **Supabase Studio** (Table editor / SQL) avec ton compte
> admin. Pas de console custom livrée aux clients.

---

## 5. Identité client (ciblage)

`useNews` appelle `signInAnonymously()` : chaque installation obtient un
`auth.uid()` **stable** (session persistée) = le `clientId`. Pour cibler un
client précis, on renseigne `audience_client_id` = son `uid` (sinon `null` =
global). Récupérer l'uid d'un client : table `auth.users` dans Studio, ou
exposer l'uid dans l'app pour qu'il te le communique (piste UI ultérieure).

---

## 6. Temps réel

`useNews` s'abonne au canal `postgres_changes` sur `public.news` : toute
insertion/édition déclenche un re-fetch (lui-même filtré par RLS). Repli
implicite : au pire, la news est vue au prochain montage de l'app.

---

## 7. Mise en route (à faire une fois)

1. **Créer un projet Supabase** — région **EU (Frankfurt)** pour le RGPD.
2. **SQL Editor** → exécuter
   [`supabase/migrations/20260628000000_news.sql`](../../supabase/migrations/20260628000000_news.sql).
3. **Auth → Providers** : activer **Anonymous sign-ins**.
4. **Compte admin** : crée ton utilisateur (Auth → Add user, ou sign-up), puis
   donne-lui le rôle admin (SQL, en remplaçant l'email) :
   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data,'{}'::jsonb) || '{"role":"admin"}'
   where email = 'alexis.bert1412@gmail.com';
   ```
5. **Env client** : copier `apps/desktop/.env.example` en `.env` et renseigner
   `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (Project Settings → API).
6. **Publier une news** : Table editor → `news` → Insert (`title`, `body` Markdown,
   `severity`, `audience_client_id` = vide pour global ou un uid pour cibler).

---

## 8. Limites connues / suite

- **Console d'admin custom** : non livrée (on utilise Studio) — possible plus tard.
- **Realtime + RLS** : selon la config du projet, l'événement peut être générique ;
  le re-fetch reste filtré par RLS, donc sûr.
- **Analytics « qui a vu quoi »** et **signature de contenu** : non couverts (P4).
- **Tests** : logique surtout présentationnelle/IO ; pas de tests ajoutés.

---

## 9. Vérification

- `pnpm type-check` : **3/3 verts** · `pnpm lint` : **0 erreur**.
- Sans `.env` Supabase : l'app démarre, news masquée (status `unconfigured`).
- Avec un projet configuré + une news globale : bandeau visible à l'ouverture chez
  tous les clients, masquable ; widget `news` listant les annonces.
