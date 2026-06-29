-- CatDesk — Pilier B : news pilotée par l'admin (P2)
-- À exécuter dans le SQL Editor du projet Supabase.
-- Mise en route complète : docs/projects/dashboard-p2.md

-- ─── Table ─────────────────────────────────────────────────────
create table if not exists public.news (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  body               text not null,                       -- Markdown
  severity           text not null default 'info'
                       check (severity in ('info','success','warning','critical')),
  audience_client_id uuid references auth.users(id) on delete cascade, -- NULL = global
  published_at       timestamptz not null default now(),
  expires_at         timestamptz,
  created_by         uuid not null default auth.uid() references auth.users(id)
);

create index if not exists news_published_at_idx on public.news (published_at desc);

-- ─── Row-Level Security ────────────────────────────────────────
alter table public.news enable row level security;

-- Lecture : client authentifié → news globales + celles qui le ciblent, non expirées
drop policy if exists news_read on public.news;
create policy news_read on public.news
  for select to authenticated
  using (
    (audience_client_id is null or audience_client_id = auth.uid())
    and (expires_at is null or expires_at > now())
  );

-- Écriture (insert/update/delete) : réservée au rôle admin
-- (claim app_metadata.role = 'admin'). Un client ne peut donc rien publier.
drop policy if exists news_admin_write on public.news;
create policy news_admin_write on public.news
  for all to authenticated
  using      ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ─── Realtime ──────────────────────────────────────────────────
alter publication supabase_realtime add table public.news;

-- ─── Donner le rôle admin (à faire UNE fois, remplacer l'email) ─
-- update auth.users
-- set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'
-- where email = 'alexis.bert1412@gmail.com';
