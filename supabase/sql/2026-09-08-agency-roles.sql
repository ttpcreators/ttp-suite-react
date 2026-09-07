-- ============================================================================
-- RÔLES AGENCE : FONDATEUR vs MEMBRE
-- ----------------------------------------------------------------------------
-- Deux niveaux au sein de l'agence :
--   • fondateur (Marc & Gianni) : accès TOTAL (dont Finance & gestion des Accès) ;
--   • membre   (équipe qui rejoint) : tout SAUF la Finance et les Accès.
--
-- Verrou CÔTÉ BASE (RLS), pas seulement l'UI : un membre ne peut PAS lire les
-- factures (CA, montants, clients), même via l'API. La seule table « finance »
-- est `invoices` ; reversements/relances/échéances en dérivent (blob agence).
--
-- Idempotent. À lancer dans le SQL Editor Supabase.
-- ============================================================================

-- 1) Colonne agency_role sur les profils (pertinent quand role='agency').
alter table public.profiles add column if not exists agency_role text not null default 'member';

-- 2) Les comptes AGENCE existants deviennent FONDATEURS (Marc & Gianni).
--    Les nouveaux comptes équipe seront créés en 'member' par la fonction create-access.
update public.profiles set agency_role = 'founder' where role = 'agency';

-- 3) is_founder() : agence ET fondateur (même forme que is_agency()).
create or replace function public.is_founder() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'agency'
      and coalesce(p.agency_role, 'member') = 'founder'
  );
$$;

-- 4) RLS invoices : l'accès AGENCE devient réservé aux FONDATEURS.
--    (Les créateurs continuent de LIRE leurs propres factures.)
drop policy if exists invoices_agency on public.invoices;
create policy invoices_agency on public.invoices for all to authenticated
  using (public.is_founder()) with check (public.is_founder());

drop policy if exists invoices_creator_read on public.invoices;
create policy invoices_creator_read on public.invoices for select to authenticated
  using (public.is_founder() or creator = public.my_creator());
