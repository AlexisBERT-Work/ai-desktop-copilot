# Supabase — backend news (Pilier B)

Backend de la **news globale/ciblée** pilotée par l'admin (lecture seule côté
client). Stack décidée : **Supabase** (Postgres + Auth + RLS + Realtime).

- Migration SQL : [`migrations/0001_news.sql`](migrations/0001_news.sql)
- Mise en route pas à pas (projet, env, rôle admin, publication) :
  [`../docs/projects/dashboard-p2.md`](../docs/projects/dashboard-p2.md)

> ⚠️ La clé `service_role` ne doit **jamais** être embarquée dans l'app cliente :
> celle-ci n'utilise que la clé `anon` (publique), bornée par RLS.
