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

## 8. Génération automatique (revue de presse IA)

Le cœur des dailys : un pipeline qui agrège plusieurs **journaux**, fait une
**analyse intra-journal** par le LLM local, et **publie une daily par journal**.
Tourne **uniquement sur le poste de référence** (celui qui a les identifiants
admin) → « tout passe par nous » ; les clients ne publient jamais.

**Chaîne** (tout en TypeScript, agent-runtime — aucun changement Rust/frontend) :
1. `aggregateNews({ sources:[id], topics, sinceHours, limit })` par journal —
   registre étendu (finance, généraliste FR, international, tech) dans
   [FetchTechNewsTool.ts](../../packages/agent-runtime/src/tools/web/FetchTechNewsTool.ts).
   Le filtre `topics` = la **« recherche de caractères »** (mots-clés dans titre+extrait).
2. `enrichExcerpts` (récupère un extrait pour les articles qui n'en ont pas).
3. `analyzeJournal` → JSON `{ analyse, resumes[] }` (LLM local) →
   [pressDigest.ts](../../packages/agent-runtime/src/news/pressDigest.ts).
4. `buildJournalBody` → Markdown (analyse + liste d'articles liés/résumés) ;
   catégorie déduite du journal (`categoryForSourceLabel`).
5. `publishDailies` → connexion admin (mot de passe) + `insert` REST, **idempotent**
   (saute une daily de même titre), renvoie les drafts **réellement insérés** →
   [SupabasePublisher.ts](../../packages/agent-runtime/src/news/SupabasePublisher.ts).
6. `PressDigestScheduler` → exécution **quotidienne** à `CATDESK_PRESS_HOUR`.
7. *(optionnel)* **Miroir Discord** : les dailys **neuves** (celles insérées à
   l'étape 5, pas les doublons ignorés) sont aussi postées en embeds sur un
   webhook → [DiscordDailyPublisher.ts](../../packages/agent-runtime/src/news/DiscordDailyPublisher.ts).
   Un embed par daily (couleur selon la catégorie), lots de 10 (limite Discord).
   Comme on ne miroite que le neuf, l'idempotence Supabase couvre aussi Discord :
   pas de doublon au redémarrage / run-on-start.

**Activation (poste de référence — fichier `packages/agent-runtime/.env`, gitignoré, jamais distribué)** :

Pré-requis : un **compte admin Supabase** existant, avec **mot de passe** et le
claim `role=admin` (cf. [DEPLOY §7](../../supabase/DEPLOY.md)). Vérifiable en se
connectant une fois dans la **console Admin** de l'app.

```
CATDESK_PRESS_DIGEST=1
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=<clé anon>
SUPABASE_ADMIN_EMAIL=<email admin>
SUPABASE_ADMIN_PASSWORD=<mot de passe admin>
# Optionnels :
CATDESK_PRESS_MODE=both        # journal = 1 daily/journal · topic = les news importantes triées par SUJET · both
CATDESK_PRESS_TOPIC_LIMIT=24   # articles les plus importants soumis au tri par sujet (mode topic/both)
CATDESK_PRESS_RUN_ON_START=1   # publie aussi au démarrage (vérif immédiate, idempotent)
CATDESK_PRESS_SOURCES=latribune,cnbc,lemonde,lefigaro,france24,bbc,guardian
CATDESK_PRESS_TOPICS=IA,inflation,Nvidia      # recherche de caractères (filtre)
CATDESK_PRESS_SYNTHESIS=1   # 1 (défaut) = ajoute une « Synthèse du jour » transversale ; 0 = off
CATDESK_PRESS_HOUR=7        # heure locale de publication
CATDESK_PRESS_SINCE_HOURS=24
CATDESK_PRESS_LIMIT=6       # articles max par journal
CATDESK_PRESS_DISCORD_WEBHOOK=https://discord.com/api/webhooks/…  # miroir Discord (repli sur DISCORD_WEBHOOK_URL)
```

> Modèle (template) versionné : [`packages/agent-runtime/.env.example`](../../packages/agent-runtime/.env.example).
> Idempotence : rejouer une même journée (redémarrage, run-on-start) ne crée pas
> de doublon — une daily de même titre est ignorée.

> Flux RSS **testés en direct** (2026-06-30). Marchent : La Tribune, Yahoo Finance,
> Investing, MarketWatch, FT, CNBC, Le Monde (+Éco), Le Figaro, Libération,
> France 24, BBC, The Guardian, Al Jazeera, + sources tech. **Les Échos** est
> retiré (flux en 403). Une source en échec est ignorée sans bloquer les autres.

> Sans `CATDESK_PRESS_DIGEST=1` **et** les 4 identifiants, le planificateur ne
> démarre pas (cas des postes clients). La sécurité reste serveur (RLS admin).

## 8bis. Journaux personnalisés (admin)

L'admin définit ses propres « journaux » sans redéploiement, via la console admin
(onglet **Journaux personnalisés**). Chaque recette est stockée dans
`public.press_feeds` (RLS admin uniquement — les clients ne voient QUE les dailys
produites, pas les recettes) et comprend :

- **Sources** : ids intégrés (`lemonde`, `lefigaro`, …) et/ou **URLs de flux** RSS/Atom.
- **Filtres** : **mots-clés** (garde ce qui en contient un) + **regex** inclure
  (ne garde que ce qui matche) / exclure (retire ce qui matche), sur titre+extrait.
- **Fenêtre** (heures) et **nombre d'articles max**, actif/inactif.

Le planificateur `PressDigestScheduler` lit les journaux **actifs** à chaque run
(`fetchEnabledPressFeeds`), agrège+filtre (`buildCustomJournalDailies`), analyse
via le LLM local (même pipeline que les revues par journal) et publie une daily
par journal (titre `<Nom> — revue du <date>` ⇒ genre « journal », idempotent).

Migration : [`supabase/migrations/20260702000000_press_feeds.sql`](../../supabase/migrations/20260702000000_press_feeds.sql).

**Publier maintenant** : le bouton de la console envoie l'IPC
`run_press_digest` → RPC `press.run_now` → `scheduler.runOnce()` (fire-and-forget ;
les dailys arrivent via Realtime). Sans effet sur un poste sans identifiants admin.

## 9. Suite possible

- **Console admin** : ✅ livrée (dailys + journaux personnalisés). Étendre à la **news**.
- Synthèse transversale (tous journaux) en plus de l'intra-journal.
- Catégories paramétrables / multi-tags par daily (filtrage plus fin).
- Accusés de lecture / « non lus », marque-page.
- Programmation (publier à une date future) — aujourd'hui `published_at = now()`.
