# Supabase — backend news + dailys (Pilier B)

Backend de la **news** (alertes globales/ciblées) et des **dailys** (flux
éditorial filtrable), pilotés par l'admin et **en lecture seule côté client**.
Stack : **Supabase** (Postgres + Auth + RLS + Realtime).

- Migrations SQL :
  [`migrations/20260628000000_news.sql`](migrations/20260628000000_news.sql) ·
  [`migrations/20260629000000_dailies.sql`](migrations/20260629000000_dailies.sql)
- **Déploiement (CLI), pas à pas** : [`DEPLOY.md`](DEPLOY.md) (un seul `db push`
  applique les deux)
- Contexte & modèle de données :
  [`../docs/projects/dashboard-p2.md`](../docs/projects/dashboard-p2.md) (news) ·
  [`../docs/projects/dashboard-dailies.md`](../docs/projects/dashboard-dailies.md) (dailys)

> ⚠️ La clé `service_role` ne doit **jamais** être embarquée dans l'app cliente :
> celle-ci n'utilise que la clé `anon` (publique), bornée par RLS.
