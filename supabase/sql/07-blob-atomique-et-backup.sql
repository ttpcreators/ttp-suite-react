-- ============================================================================
-- 07-blob-atomique-et-backup.sql
-- ----------------------------------------------------------------------------
-- SOLIDITÉ du blob agence __app_state__ (module_rows.a, du JSON stocké en texte).
--
--  1) ÉCRITURE ATOMIQUE : fonction app_state_set(clé, valeur). Au lieu que le
--     client lise → modifie → réécrive TOUT le blob (course : si Marc et Gianni
--     sauvent en même temps, le dernier écrase l'autre), Postgres fait le
--     jsonb_set d'UNE clé en une seule instruction, sous verrou de ligne →
--     deux écritures de clés différentes ne s'écrasent plus jamais.
--
--  2) BACKUP QUOTIDIEN : un instantané/jour du blob (30 j d'historique). Un blob
--     corrompu devient une simple restauration au lieu d'une perte totale.
--
-- À exécuter une fois sur la base live (SQL Editor).
-- ============================================================================

-- ─── 1) Écriture atomique d'une clé ─────────────────────────────────────────
create or replace function public.app_state_set(p_key text, p_value jsonb)
returns void
language plpgsql
security invoker              -- respecte la RLS module_rows (agence seule écrit)
set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id
    from public.module_rows
   where module = '__app_state__'
   order by created_at desc
   limit 1;

  if v_id is null then
    insert into public.module_rows (module, a)
      values ('__app_state__', jsonb_build_object(p_key, p_value)::text);
  else
    update public.module_rows
       set a = jsonb_set(coalesce(a, '{}')::jsonb, array[p_key], p_value, true)::text
     where id = v_id;
  end if;
end;
$$;

grant execute on function public.app_state_set(text, jsonb) to authenticated;

-- ─── 2) Table + fonction + cron de backup ───────────────────────────────────
create table if not exists public.app_state_backups (
  id         uuid primary key default gen_random_uuid(),
  snapshot   text not null,
  created_at timestamptz default now()
);

alter table public.app_state_backups enable row level security;
drop policy if exists app_state_backups_agency on public.app_state_backups;
create policy app_state_backups_agency on public.app_state_backups
  for select to authenticated using (public.is_agency());
-- (aucune policy d'écriture : seule la fonction backup_app_state, SECURITY DEFINER, écrit)

create or replace function public.backup_app_state()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_state_backups (snapshot)
    select a from public.module_rows
     where module = '__app_state__' and a is not null
     order by created_at desc limit 1;
  -- purge au-delà de 30 jours
  delete from public.app_state_backups where created_at < now() - interval '30 days';
end;
$$;

-- Seul le cron (postgres) doit la déclencher.
revoke execute on function public.backup_app_state() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.unschedule('ttp-app-state-backup')
where exists (select 1 from cron.job where jobname = 'ttp-app-state-backup');
select cron.schedule('ttp-app-state-backup', '0 2 * * *', $$ select public.backup_app_state(); $$);

-- Faire un premier backup tout de suite (facultatif) :
--   select public.backup_app_state();
--
-- RESTAURER le dernier instantané (en cas de pépin) :
--   update public.module_rows
--      set a = (select snapshot from public.app_state_backups order by created_at desc limit 1)
--    where module = '__app_state__';
--
-- Vérifier : select created_at, length(snapshot) from public.app_state_backups order by created_at desc;
