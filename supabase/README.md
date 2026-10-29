# Supabase — backend news + dailys (Pilier B)

Backend de la **news** (alertes globales/ciblées) et des **dailys** (flux
éditorial filtrable). Stack : **Supabase** (Postgres + Auth + RLS + Realtime).

- Migrations SQL :
  [`migrations/20260628000000_news.sql`](migrations/20260628000000_news.sql) ·
  [`migrations/20260629000000_dailies.sql`](migrations/20260629000000_dailies.sql) ·
  [`migrations/20260702000000_press_feeds.sql`](migrations/20260702000000_press_feeds.sql) ·
  [`migrations/20260720000000_press_digest_open_publish.sql`](migrations/20260720000000_press_digest_open_publish.sql) ·
  [`migrations/20261029143431_publish_daily_harden.sql`](migrations/20261029143431_publish_daily_harden.sql) ·
  [`migrations/20261029170000_dailies_unique_per_day.sql`](migrations/20261029170000_dailies_unique_per_day.sql)
- **Déploiement (CLI), pas à pas** : [`DEPLOY.md`](DEPLOY.md) (un seul `db push`
  applique toutes les migrations)
- Contexte & modèle de données :
  [`../docs/projects/dashboard.md`](../docs/projects/dashboard.md) — § 5 (news),
  § 6 (dailys)

> ⚠️ La clé `service_role` ne doit **jamais** être embarquée dans l'app cliente :
> celle-ci n'utilise que la clé `anon` (publique), bornée par RLS.

## Publication ouverte du lot standard (tri modèles 2026-07-20)

La revue de presse **standard** (7 journaux fixes + 6 sujets transversaux +
synthèse) n'est plus réservée au poste admin : **tout poste ayant lancé
CatDesk** peut la publier, via une session anonyme et la fonction
`publish_daily_if_missing` (SECURITY DEFINER — voir la migration
`20260720000000`). Cette fonction, pas la policy RLS, autorise l'écriture :
elle **valide elle-même** ce qu'elle accepte avant d'insérer :

- le **titre** doit correspondre à un des 3 gabarits attendus (journal fixe,
  sujet fixe, ou synthèse du jour) — rejette tout titre arbitraire ;
- depuis la migration `20261029143431`, la **date du titre** doit être celle du
  jour à un jour près (les postes datent dans leur fuseau) : 14 titres valides
  par date, pas un de plus ;
- une **session** est obligatoire, et une même session publie au plus
  **20 dailys/jour** (migration `20261029143431`) ;
- la **catégorie** doit être une des 6 valeurs autorisées (repli `misc`) ;
- le **corps** est plafonné à 20 000 caractères ;
- au plus **60 lignes/jour** au total (le lot réel en compte ~14).
- **idempotente** : contrainte unique sur le **titre et le jour de Paris**
  (`dailies_title_day_key`, migration `20261029170000`) et
  `on conflict do nothing` — si deux postes publient la même daily le même
  jour, un seul insert passe. L'unicité n'est plus sur `title` seul : les
  titres ne portent pas l'année, et rien ne purge la table, donc le titre de
  l'an dernier aurait bloqué en silence celui du jour.

Risque restant, assumé : le premier qui publie un titre du jour l'emporte. Un
appel direct avec la clé anon peut donc devancer le vrai pipeline avec un faux
contenu ; seul l'admin peut alors supprimer la ligne.

Restent réservés à l'admin, **inchangés** : les journaux personnalisés
(`press_feeds`, lecture ET écriture admin-only) et les dailys manuelles
(console admin, policy `dailies_admin_write`).

Chaque poste vérifie d'abord (lecture anonyme, gratuite) si le lot du jour
existe déjà avant de lancer sa propre génération LLM — évite le gaspillage si
plusieurs postes se lancent dans la même fenêtre, sans l'empêcher totalement
(l'idempotence en base couvre le reste).
