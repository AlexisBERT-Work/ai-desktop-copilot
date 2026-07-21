-- CatDesk — Publication ouverte de la revue de presse standard (tri modèles
-- 2026-07-20 : « les dailys doivent se lancer dès qu'un PC sur terre a lancé
-- CatDesk »). À exécuter après la migration dailies (20260629000000).
--
-- Problème résolu : jusqu'ici, SEUL le poste possédant les identifiants admin
-- (SUPABASE_ADMIN_EMAIL/PASSWORD) pouvait publier la revue de presse standard
-- (7 journaux + sujets transversaux + synthèse). Si ce poste n'est pas allumé
-- au bon moment, personne n'a de daily ce jour-là. On ouvre donc la publication
-- de CE LOT STANDARD à tout poste (session anonyme, comme la lecture), via une
-- fonction Postgres qui valide elle-même ce qu'elle accepte — la policy RLS
-- d'écriture (`dailies_admin_write`) reste admin-only pour l'INSERT direct :
-- seule cette fonction (SECURITY DEFINER, donc capable de la contourner) peut
-- écrire sans être admin, et seulement dans les gabarits de titre attendus.
--
-- Restent réservés à l'admin (inchangé) : les journaux personnalisés
-- (`press_feeds`) et les dailys manuelles (console admin, écrites via la
-- policy `dailies_admin_write`) — cette fonction ne les concerne pas.

-- ─── Idempotence au niveau base ────────────────────────────────
-- Jusqu'ici l'idempotence (une seule daily par titre et par jour) n'était
-- garantie qu'au niveau applicatif (vérif avant insert). Avec plusieurs postes
-- pouvant tenter une publication en même temps, il faut une garantie atomique.
create unique index if not exists dailies_title_key on public.dailies (title);

-- ─── Fonction de publication ouverte ───────────────────────────
create or replace function public.publish_daily_if_missing(
  p_title text,
  p_body text,
  p_category text default 'misc'
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text;
  v_body text;
  v_today_count integer;
begin
  -- N'accepte que les gabarits de titre produits par le pipeline standard
  -- (journaux fixes, sujets fixes, synthèse) — ferme la porte à un appel
  -- direct hors app (la clé anon est publique) qui injecterait un titre
  -- arbitraire dans le flux vu par tous les clients.
  if p_title !~ '^(La Tribune|CNBC|Le Monde|Le Figaro|France 24|BBC News|The Guardian) — revue du .+$'
     and p_title !~ '^Sujet — (International|Économie & marchés|Politique|Société|Tech & sciences|Culture & sport) · .+$'
     and p_title !~ '^Synthèse du jour — .+$'
  then
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

  -- Plafond défensif : le lot standard compte ~14 dailys/jour ; 60 laisse de
  -- la marge (croissance du nombre de journaux/sujets) tout en bornant le
  -- dégât d'un appel répété (bug ou abus) au flux partagé.
  select count(*) into v_today_count
  from public.dailies
  where published_at >= date_trunc('day', now());
  if v_today_count >= 60 then
    return false;
  end if;

  insert into public.dailies (title, body, category)
  values (p_title, v_body, v_category)
  on conflict (title) do nothing;

  return found;
end;
$$;

-- Exécutable par n'importe quelle session (y compris anonyme) — c'est le
-- point d'entrée conçu pour ça ; la validation ci-dessus est la seule barrière.
revoke all on function public.publish_daily_if_missing(text, text, text) from public;
grant execute on function public.publish_daily_if_missing(text, text, text) to anon, authenticated;

-- ─── Exemple d'appel (depuis un client, clé anon) ──────────────
-- select public.publish_daily_if_missing(
--   'Le Monde — revue du 20 juillet',
--   '## Points du jour\n\n- …',
--   'misc'
-- );
