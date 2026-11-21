-- CatDesk — Unicité des dailys par (titre, jour) au lieu du titre seul
-- (2026-10-29). À exécuter après 20261029143431_publish_daily_harden.sql.
--
-- Problème corrigé : l'index `dailies_title_key` (migration 20260720000000) rend
-- chaque titre unique POUR TOUJOURS. Or les titres du lot standard ne portent
-- pas l'année (« Le Monde — revue du 29 octobre ») et rien ne purge la table
-- (`expires_at` n'est jamais écrit). Un an après la première publication, le
-- titre existe donc déjà : `publish_daily_if_missing` tombe sur
-- `on conflict (title) do nothing`, renvoie false, le client compte un « skip »
-- — et la daily du jour n'est jamais publiée, sans aucune erreur. Les premières
-- dailys datent de l'été 2026 : les collisions commenceraient à l'été 2027.
--
-- Correction en base plutôt que dans les titres : les exe 0.1.x déjà installés
-- (ligne figée, jamais mis à jour) publient des titres sans année et le feront
-- toujours ; seule la base les corrige tous, sans nouvelle version cliente.
--
-- Nouvelle règle : un titre au plus par jour calendaire DE PARIS, le jour qui
-- figure dans le titre (les postes datent leurs titres en heure locale
-- française). Un jour UTC dédoublonnerait mal deux postes qui publient de part
-- et d'autre de minuit UTC (entre 0 h et 2 h, heure de Paris). Si un même titre
-- arrive deux jours différents (lot commencé avant minuit, inséré après), on
-- obtient au pire un doublon visible, plus jamais une daily perdue en silence.
--
-- Données : aucune ligne n'est modifiée. Les lignes existantes respectent déjà
-- la nouvelle contrainte, plus lâche que l'ancienne.
--
-- Ordre sûr même hors transaction : le nouvel index d'abord, puis la fonction
-- (sans cible de conflit, donc valable avec l'un ou l'autre index), puis la
-- suppression de l'ancien index. La RPC fonctionne à chaque étape.

-- ─── Nouvelle contrainte d'unicité ─────────────────────────────
-- `at time zone` + `::date` sont immuables : l'expression est indexable
-- (`date_trunc` sur un timestamptz, lui, ne l'est pas).
create unique index if not exists dailies_title_day_key
  on public.dailies (title, ((published_at at time zone 'Europe/Paris')::date));

-- ─── Fonction de publication ouverte ───────────────────────────
-- Identique à la version 20261029143431, sauf le `on conflict` en fin de
-- fonction : sans cible, il couvre `dailies_title_day_key` (et l'ancien index
-- tant qu'il existe).
create or replace function public.publish_daily_if_missing(
  p_title text,
  p_body text,
  p_category text default 'misc'
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Mois tels que les écrit `toLocaleDateString('fr-FR', { day: 'numeric',
  -- month: 'long' })` : « 1 juillet », « 15 août » (jour sans zéro ni « 1er »).
  v_months constant text[] := array[
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
  ];
  v_author uuid := auth.uid();
  v_today date := (now() at time zone 'UTC')::date;
  v_date_label text;
  v_category text;
  v_body text;
  v_author_count integer;
  v_today_count integer;
begin
  if v_author is null then
    return false;
  end if;

  -- Gabarits du pipeline standard (journaux fixes, sujets fixes, synthèse) :
  -- seule la date, en fin de titre, reste variable.
  v_date_label := substring(p_title from (
    '^(?:(?:La Tribune|CNBC|Le Monde|Le Figaro|France 24|BBC News|The Guardian) — revue du '
    || '|Sujet — (?:International|Économie & marchés|Politique|Société|Tech & sciences|Culture & sport) · '
    || '|Synthèse du jour — )(.+)$'
  ));
  if v_date_label is null or not exists (
    select 1
    from unnest(array[v_today - 1, v_today, v_today + 1]) as d(day)
    where v_date_label = extract(day from d.day)::int::text || ' ' || v_months[extract(month from d.day)::int]
  ) then
    return false;
  end if;

  v_category := case
    when p_category in ('markets','tech','crypto','macro','product','misc') then p_category
    else 'misc'
  end;
  v_body := left(coalesce(p_body, ''), 20000);
  if length(trim(v_body)) = 0 then
    return false;
  end if;

  -- Plafond par session : borne ce qu'un seul appelant peut publier.
  select count(*) into v_author_count
  from public.dailies
  where created_by = v_author
    and published_at >= date_trunc('day', now());
  if v_author_count >= 20 then
    return false;
  end if;

  -- Plafond global, inchangé : dernier filet si le nombre de titres valides grandit.
  select count(*) into v_today_count
  from public.dailies
  where published_at >= date_trunc('day', now());
  if v_today_count >= 60 then
    return false;
  end if;

  -- Déjà publiée aujourd'hui (même titre, même jour de Paris) → rien inséré,
  -- `found` reste faux. Une daily d'une année précédente ne bloque plus.
  insert into public.dailies (title, body, category, created_by)
  values (p_title, v_body, v_category, v_author)
  on conflict do nothing;

  return found;
end;
$$;

-- Droits inchangés (`create or replace` les conserve), redits ici pour qu'ils se
-- lisent avec la fonction.
revoke all on function public.publish_daily_if_missing(text, text, text) from public;
grant execute on function public.publish_daily_if_missing(text, text, text) to anon, authenticated;

-- ─── Ancienne contrainte ───────────────────────────────────────
drop index if exists public.dailies_title_key;
