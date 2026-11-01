-- ============================================================================
-- Factures : garde-fous en base (audit du 1er novembre, n° 3, 4 et 30)
-- Titre Supabase : « Factures · numéro unique, pas de suppression, date de paiement »
-- ============================================================================
-- 1) Une facture émise (tout sauf « brouillon ») ne peut plus être supprimée, même hors
--    de l'app : elle s'annule (statut « annulee ») et garde son numéro.
-- 2) Numéro unique : deux factures ne peuvent plus porter le même numéro (le 30/10,
--    deux « 2026-184 » existaient). Contrôle fait avant : aucun doublon en base.
-- 3) Date de paiement `paid_at` : remplie toute seule au passage en « payee », vidée si
--    la facture quitte « payee ». Sert à « Encaissé ce mois » (jour où l'argent arrive,
--    pas l'échéance) et au rapprochement bancaire (Qonto).
-- ============================================================================

-- 1) Pas de suppression d'une facture émise.
create or replace function public.invoices_no_delete()
returns trigger language plpgsql as $$
begin
  if coalesce(old.status, '') <> 'brouillon' then
    raise exception 'Facture % émise : elle ne se supprime pas, elle s''annule (statut Annulée).', old.ref
      using errcode = '42501';
  end if;
  return old;
end $$;
drop trigger if exists invoices_no_delete on public.invoices;
create trigger invoices_no_delete before delete on public.invoices
  for each row execute function public.invoices_no_delete();

-- 2) Numéro unique (les brouillons sans numéro ne gênent pas).
create unique index if not exists invoices_ref_unique on public.invoices (ref)
  where coalesce(trim(ref), '') <> '';

-- 3) Date de paiement.
alter table public.invoices add column if not exists paid_at timestamptz;
create or replace function public.invoices_paid_at()
returns trigger language plpgsql as $$
begin
  if new.status = 'payee' and (tg_op = 'INSERT' or old.status is distinct from 'payee') then
    new.paid_at := coalesce(new.paid_at, now());
  elsif new.status <> 'payee' then
    new.paid_at := null;
  end if;
  return new;
end $$;
drop trigger if exists invoices_paid_at on public.invoices;
create trigger invoices_paid_at before insert or update of status, paid_at on public.invoices
  for each row execute function public.invoices_paid_at();

-- Contrôle : les déclencheurs et l'index existent.
select tgname from pg_trigger where tgrelid = 'public.invoices'::regclass and tgname in ('invoices_no_delete', 'invoices_paid_at')
union all select indexname from pg_indexes where indexname = 'invoices_ref_unique';
