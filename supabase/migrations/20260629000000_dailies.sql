-- CatDesk — Pilier B : dailys (briefings quotidiens pilotés par l'admin)
-- À exécuter dans le SQL Editor du projet Supabase (après la migration news).
-- Mise en route complète : docs/projects/dashboard-dailies.md
--
-- Modèle : table dédiée, distincte de `news` (alertes). Une catégorie par daily
-- (liste fixe) ; le filtrage par centre d'intérêt se fait CÔTÉ CLIENT. Lecture
-- pour tout client authentifié, écriture réservée à l'admin (même schéma RLS
-- que `news`).

-- ─── Table ─────────────────────────────────────────────────────
create table if not exists public.dailies (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,                              -- Markdown
  category     text not null default 'misc'
                 check (category in ('markets','tech','crypto','macro','product','misc')),
  published_at timestamptz not null default now(),
  expires_at   timestamptz,
  created_by   uuid not null default auth.uid() references auth.users(id)
);

create index if not exists dailies_published_at_idx on public.dailies (published_at desc);
create index if not exists dailies_category_idx on public.dailies (category);

-- ─── Row-Level Security ────────────────────────────────────────
alter table public.dailies enable row level security;

-- Lecture : tout client authentifié → dailys non expirées (toutes catégories ;
-- le filtrage par intérêt est local, pas un secret).
drop policy if exists dailies_read on public.dailies;
create policy dailies_read on public.dailies
  for select to authenticated
  using (expires_at is null or expires_at > now());

-- Écriture (insert/update/delete) : réservée au rôle admin
-- (claim app_metadata.role = 'admin'). Un client ne peut donc rien publier.
drop policy if exists dailies_admin_write on public.dailies;
create policy dailies_admin_write on public.dailies
  for all to authenticated
  using      ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ─── Realtime ──────────────────────────────────────────────────
alter publication supabase_realtime add table public.dailies;

-- ─── Publier une daily (admin, depuis Studio) ──────────────────
-- insert into public.dailies (title, body, category) values
--   ('Ouverture des marchés', 'Les futures US **en hausse**…', 'markets');
