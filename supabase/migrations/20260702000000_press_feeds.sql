-- CatDesk — Journaux personnalisés (revue de presse pilotée par l'admin)
-- À exécuter dans le SQL Editor du projet Supabase (après la migration dailies).
-- Mise en route complète : docs/projects/dashboard-dailies.md
--
-- Modèle : l'admin définit des « recettes » de collecte (sources + URLs de flux
-- + règles de tri par mots-clés/regex). Le planificateur agent-runtime les lit,
-- agrège les articles, les analyse (LLM local) et publie une daily par journal
-- dans `public.dailies`. Lecture réservée à l'admin (config potentiellement
-- sensible : URLs internes, filtres) ; écriture réservée à l'admin. Les clients
-- ne voient QUE les dailys produites, pas les recettes.

-- ─── Table ─────────────────────────────────────────────────────
create table if not exists public.press_feeds (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  category         text not null default 'misc'
                     check (category in ('markets','tech','crypto','macro','product','misc')),
  source_ids       text[] not null default '{}',           -- clés NEWS_SOURCES intégrées
  feed_urls        text[] not null default '{}',           -- URLs RSS/Atom arbitraires
  include_keywords text[] not null default '{}',           -- « recherche de caractères »
  include_regex    text,                                   -- ne garde que ce qui matche
  exclude_regex    text,                                   -- retire ce qui matche
  since_hours      integer not null default 24 check (since_hours between 1 and 168),
  article_limit    integer not null default 12 check (article_limit between 1 and 200),
  enabled          boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid not null default auth.uid() references auth.users(id)
);

create index if not exists press_feeds_enabled_idx on public.press_feeds (enabled);

-- ─── Row-Level Security ────────────────────────────────────────
alter table public.press_feeds enable row level security;

-- Lecture ET écriture : réservées au rôle admin (claim app_metadata.role='admin').
-- Contrairement à `dailies`, les recettes ne sont PAS lisibles par les clients.
drop policy if exists press_feeds_admin_all on public.press_feeds;
create policy press_feeds_admin_all on public.press_feeds
  for all to authenticated
  using      ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ─── Exemple (admin, depuis Studio) ────────────────────────────
-- insert into public.press_feeds (name, category, source_ids, include_keywords) values
--   ('Le Monde · IA', 'tech', array['lemonde'], array['IA','intelligence artificielle']);
