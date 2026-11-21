-- CatDesk — Durcissement de la publication ouverte (`publish_daily_if_missing`).
-- À exécuter après 20260720000000_press_digest_open_publish.sql.
--
-- Constat (advisors Supabase + relecture, 2026-10-29) : la fonction ne vérifiait
-- que le DÉBUT du titre (`^Le Monde — revue du .+$`). La clé anon étant publique,
-- n'importe qui pouvait donc, hors de l'app :
--   1. publier un titre libre derrière un préfixe valide (« Le Monde — revue du
--      <n'importe quoi> ») avec un corps arbitraire, lu par tous les clients ;
--   2. remplir à lui seul le plafond global de 60 lignes/jour, et priver tout le
--      monde de dailys ce jour-là.
--
-- Ce qui change — signature et droits inchangés, donc rien à modifier côté
-- agent-runtime :
--   - la date du titre doit être celle du jour, à un jour près. Les postes datent
--     le titre dans LEUR fuseau (`toLocaleDateString('fr-FR')` sans timeZone),
--     de UTC−12 à UTC+14 : leur date locale est toujours la veille, le jour ou le
--     lendemain de la date UTC. Il ne reste que 14 titres valides par date
--     (7 journaux + 6 sujets + synthèse), et `title` est unique : le volume qui
--     passe par cette fonction est borné par construction ;
--   - une session est obligatoire : sans elle, l'insert échouait déjà sur
--     `created_by not null`, mais en erreur plutôt qu'en refus propre. Une même
--     session publie au plus 20 dailys par jour. Le
--     lot réel en compte 14, publié par UNE session anonyme (`publishDailiesOpen`
--     ne s'authentifie qu'une fois par lot) ;
--   - `search_path` vide : tous les objets sont qualifiés, rien ne peut être
--     résolu dans un schéma inattendu.
--
-- Risque restant, assumé : le premier qui publie un titre du jour l'emporte
-- (`on conflict do nothing`). Un appel direct peut encore devancer le vrai
-- pipeline avec un faux contenu pour l'un des 14 titres du jour : aucun contrôle
-- SQL ne distingue un poste CatDesk d'un appel hors app (même clé anon). Le
-- recours reste l'admin, qui peut supprimer ces lignes (`dailies_admin_write`).

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

  insert into public.dailies (title, body, category, created_by)
  values (p_title, v_body, v_category, v_author)
  on conflict (title) do nothing;

  return found;
end;
$$;

-- Droits inchangés (`create or replace` les conserve), redits ici pour qu'ils se
-- lisent avec la fonction.
revoke all on function public.publish_daily_if_missing(text, text, text) from public;
grant execute on function public.publish_daily_if_missing(text, text, text) to anon, authenticated;
