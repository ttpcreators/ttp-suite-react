-- ============================================================================
-- 2026-11-27 · Vague 1 : « En discussion » côté créateur, seulement les vraies discussions
-- Titre Supabase : « Discussions du créateur »
-- ----------------------------------------------------------------------------
-- Pourquoi (audit du 27/11, points D2 et W22) : creator_discussions montrait au créateur
-- toute piste de prospection sans collab, quel que soit son stade : des marques seulement
-- repérées (jamais contactées, ou pas encore validées par Marc), des pistes perdues, et
-- des discussions éteintes depuis des mois.
--
-- Quoi :
--   1) Colonne prospects.updated_at (date de la dernière modification), mise à jour par le
--      déclencheur prospects_touch à chaque modification de la ligne. Reprise faite UNE
--      seule fois, quand la colonne est créée : updated_at = created_at (aucun prospect de
--      plus de 60 jours au 27/11).
--   2) creator_discussions (même signature, mêmes colonnes) ne montre plus que les stades
--      à partir du premier contact (sans casse, espaces retirés) : Contact, Contactée,
--      Négociation, En négociation, Signé, Signée. Jamais : Prospection, Repérée, Perdu,
--      Perdue, vide ou inconnu. Et plus rien après 60 jours sans modification.
--
-- Avant ce SQL, l'app filtre déjà les stades de son côté (lot C) ; pas de règle des 60 jours.
-- Reprise des stades (Repérée, Perdue) : ménage de données à part, après accord de Marc.
-- Contrôle : la requête à la fin. Attendu : 1 · true · true · false
-- Relançable sans risque : la reprise ne se refait pas, le reste est create or replace.
-- Pas encore dans SETUP.sql (à replier après la réécriture de SETUP.sql en cours).
-- Après ce SQL, ne plus relancer 2026-10-23-negociations-createur.sql : il remettrait
-- l'ancienne creator_discussions sans aucune erreur (son en-tête le dit).
-- ============================================================================

-- 1) Date de la dernière modification -------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'prospects' and column_name = 'updated_at') then
    alter table public.prospects add column updated_at timestamptz not null default now();
    -- Reprise, avant la pose du déclencheur : la date de création.
    update public.prospects set updated_at = coalesce(created_at, updated_at);
  end if;
end $$;
drop trigger if exists prospects_touch on public.prospects;
create trigger prospects_touch before update on public.prospects
  for each row execute function public.touch_updated_at_simple();

-- 2) Ce que le créateur voit dans « En discussion » -------------------------------------
create or replace function public.creator_discussions(p_creator text default null)
returns table (id uuid, brand text, deliverables text, stage text, created_at timestamptz)
  language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.brand, p.deliverables, p.stage, p.created_at
    from public.prospects p
   where p.collab_id is null
     and lower(btrim(coalesce(p.creator, ''))) <> ''
     and lower(btrim(p.creator)) = lower(btrim(
           case when public.is_agency() then coalesce(p_creator, '') else coalesce(public.my_creator(), '') end))
     -- À partir du premier contact : jamais une marque seulement repérée, ni une piste perdue.
     and lower(btrim(coalesce(p.stage, ''))) in ('contact', 'contactée', 'négociation', 'en négociation', 'signé', 'signée')
     -- Rien de neuf depuis 60 jours : la discussion est éteinte.
     and coalesce(p.updated_at, p.created_at) >= now() - interval '60 days'
   order by p.created_at desc
   limit 50;
$$;
revoke all on function public.creator_discussions(text) from public, anon;
grant execute on function public.creator_discussions(text) to authenticated;

-- Contrôle (une ligne). Attendu : 1 · true · true · false
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'prospects' and column_name = 'updated_at') as colonne,
  exists (select 1 from pg_trigger where tgname = 'prospects_touch' and not tgisinternal) as declencheur,
  position('60 days' in pg_get_functiondef('public.creator_discussions(text)'::regprocedure)) > 0 as fonction_ok,
  has_function_privilege('anon', 'public.creator_discussions(text)', 'execute') as anon_peut;
