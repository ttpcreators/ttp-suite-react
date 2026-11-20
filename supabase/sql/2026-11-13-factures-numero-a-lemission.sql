-- ============================================================================
-- Factures : numéro attribué à l'ÉMISSION, jamais au brouillon
-- Titre Supabase : « Factures · numéro à l'émission, suite sans trou »
-- ============================================================================
-- Avant : chaque brouillon prenait un numéro dès sa création. Un brouillon jamais envoyé
-- laissait un trou dans la suite (2026-189, 190, 192, 194, 195), ce qu'un contrôle relève.
--
-- 1) Un brouillon n'a pas de numéro (même s'il est créé par Alfred ou une ancienne version).
-- 2) Au passage de « brouillon » à émise (en attente, payée, en retard), la base
--    donne le numéro suivant de l'année en cours : « AAAA-NNN ». Le 1er janvier, la suite
--    repart à AAAA-001. Verrou : deux émissions en même temps ne prennent pas le même.
-- 3) Une facture émise garde son numéro pour toujours : il ne peut plus être modifié.
-- 4) Les brouillons existants perdent le numéro qu'ils bloquaient (ils n'ont jamais été émis).
-- ============================================================================

create or replace function public.invoices_number_on_issue()
returns trigger language plpgsql as $$
declare
  y text;
  n int;
  was_issued boolean := tg_op = 'UPDATE' and coalesce(old.status, 'brouillon') <> 'brouillon' and coalesce(trim(old.ref), '') <> '';
begin
  -- 3) Numéro d'une facture émise : figé.
  if was_issued and new.ref is distinct from old.ref then
    raise exception 'Facture % émise : son numéro ne change plus.', old.ref using errcode = '42501';
  end if;
  -- 1) Brouillon jamais émis (ou brouillon annulé sans avoir été émis) : pas de numéro.
  if coalesce(new.status, 'brouillon') = 'brouillon' or (new.status = 'annulee' and not was_issued and coalesce(trim(new.ref), '') = '') then
    if not was_issued then
      new.ref := null;
    end if;
    return new;
  end if;
  -- Déjà numérotée : rien à faire.
  if coalesce(trim(new.ref), '') <> '' then
    return new;
  end if;
  -- 2) Émission : numéro suivant de l'année (heure de Paris).
  perform pg_advisory_xact_lock(hashtext('public.invoices.ref'));
  y := to_char(now() at time zone 'Europe/Paris', 'YYYY');
  select coalesce(max(substring(ref from '^\d{4}-(\d+)$')::int), 0) + 1 into n
    from public.invoices
   where ref ~ ('^' || y || '-\d+$');
  new.ref := y || '-' || lpad(n::text, 3, '0');
  return new;
end $$;

drop trigger if exists invoices_number_on_issue on public.invoices;
create trigger invoices_number_on_issue before insert or update on public.invoices
  for each row execute function public.invoices_number_on_issue();

-- 4) Les brouillons existants libèrent leur numéro.
update public.invoices set ref = null where coalesce(status, 'brouillon') = 'brouillon' and ref is not null;

-- Contrôle : le déclencheur existe, plus aucun brouillon numéroté.
select 'trigger' as quoi, count(*)::text as valeur from pg_trigger where tgname = 'invoices_number_on_issue'
union all
select 'brouillons numérotés', count(*)::text from public.invoices where coalesce(status, 'brouillon') = 'brouillon' and ref is not null;
