-- Le Fil : cartes courtes lues sur le téléphone par la PWA catdesk-fil
-- (pistes GitHub de la veille, news du brief IA), et likes de l'utilisateur.
--
-- Écriture des cartes : UNIQUEMENT par fil_publish(), appelée avec la clé anon
-- par les workflows ai-veille et ai-recap. Elle exige un jeton dont seul le
-- sha256 est en base (fil_publish_keys, invisible depuis l'API) : le dépôt
-- public ne porte ni service_role, ni aucun droit au-delà de l'ajout de cartes.
--
-- Lecture des cartes et likes : rôle admin (claim app_metadata.role), comme
-- dailies et press_feeds. Les sessions anonymes, ouvertes pour la publication
-- des dailys, ne voient rien. Rejouable sans casse.

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ cartes
create table if not exists public.fil_cards (
  id         text primary key check (id ~ '^[0-9a-f]{40}$'),  -- sha1(kind, url, titre)
  kind       text not null check (kind in ('github', 'version', 'news', 'tendance', 'breve')),
  day        date not null,                                   -- jour du rapport (Paris)
  rank       smallint not null default 0,                     -- ordre dans le jour
  title      text not null check (char_length(title) between 1 and 200),
  summary    text not null check (char_length(summary) between 1 and 600),
  why        text check (char_length(why) <= 400),
  verdict    text check (verdict in ('a_faire', 'a_garder')),
  details    text check (char_length(details) <= 6000),
  url        text check (url ~ '^https://'),
  source     text check (char_length(source) <= 120),
  links      jsonb not null default '[]'::jsonb
             check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 4),
  created_at timestamptz not null default now()
);

create index if not exists fil_cards_day_idx on public.fil_cards (day desc, rank);

-- ------------------------------------------------------------------- likes
create table if not exists public.fil_likes (
  card_id  text primary key references public.fil_cards (id) on delete cascade,
  liked_at timestamptz not null default now()
);

create index if not exists fil_likes_recent_idx on public.fil_likes (liked_at desc);

-- ----------------------------------------------------- jetons de publication
create table if not exists public.fil_publish_keys (
  key_hash   text primary key check (key_hash ~ '^[0-9a-f]{64}$'),  -- sha256 hex
  label      text not null,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------------- RLS
alter table public.fil_cards        enable row level security;
alter table public.fil_likes        enable row level security;
alter table public.fil_publish_keys enable row level security;

-- Volontairement sans policy : invisible et inaccessible depuis l'API.
revoke all on public.fil_publish_keys from anon, authenticated;

drop policy if exists fil_cards_admin_read on public.fil_cards;
create policy fil_cards_admin_read on public.fil_cards
  for select to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists fil_likes_admin_all on public.fil_likes;
create policy fil_likes_admin_all on public.fil_likes
  for all to authenticated
  using      ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ------------------------------------------------------------ publication
-- security definer contourne RLS : la fonction valide donc elle-même tout ce
-- qu'elle accepte. Une carte invalide fait échouer tout l'appel (le client
-- normalise avant d'envoyer : un échec ici signale un bug, pas une donnée).
create or replace function public.fil_publish(p_token text, p_cards jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_card     jsonb;
  v_link     jsonb;
  v_day      date;
  v_today    date := (now() at time zone 'Europe/Paris')::date;
  v_rows     integer;
  v_inserted integer := 0;
begin
  if p_token is null or char_length(p_token) < 32 or not exists (
    select 1 from public.fil_publish_keys
    where key_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  ) then
    raise exception 'jeton de publication refusé' using errcode = '28000';
  end if;

  if p_cards is null or jsonb_typeof(p_cards) <> 'array' then
    raise exception 'cartes : tableau attendu';
  end if;
  if jsonb_array_length(p_cards) > 60 then
    raise exception 'au plus 60 cartes par appel';
  end if;
  -- Plafond par jour : même avec un jeton fuité, la table ne déborde pas.
  if (select count(*) from public.fil_cards where day = v_today) > 300 then
    raise exception 'plafond de cartes du jour atteint';
  end if;

  for v_card in select value from jsonb_array_elements(p_cards) loop
    v_day := (v_card ->> 'day')::date;
    if v_day not between v_today - 2 and v_today + 1 then
      raise exception 'carte datée hors fenêtre : %', v_day;
    end if;

    if jsonb_typeof(coalesce(v_card -> 'links', '[]'::jsonb)) <> 'array' then
      raise exception 'liens : tableau attendu';
    end if;
    for v_link in select value from jsonb_array_elements(coalesce(v_card -> 'links', '[]'::jsonb)) loop
      if jsonb_typeof(v_link) <> 'object'
         or coalesce(v_link ->> 'url', '') !~ '^https://'
         or char_length(coalesce(v_link ->> 'label', '')) not between 1 and 120 then
        raise exception 'lien invalide';
      end if;
    end loop;

    insert into public.fil_cards
      (id, kind, day, rank, title, summary, why, verdict, details, url, source, links)
    values (
      v_card ->> 'id',
      v_card ->> 'kind',
      v_day,
      coalesce((v_card ->> 'rank')::smallint, 0),
      v_card ->> 'title',
      v_card ->> 'summary',
      v_card ->> 'why',
      v_card ->> 'verdict',
      v_card ->> 'details',
      v_card ->> 'url',
      v_card ->> 'source',
      coalesce(v_card -> 'links', '[]'::jsonb)
    )
    on conflict (id) do nothing;

    get diagnostics v_rows = row_count;
    v_inserted := v_inserted + v_rows;
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.fil_publish(text, jsonb) from public;
grant execute on function public.fil_publish(text, jsonb) to anon, authenticated;
