-- ============================================================================
-- 2026-10-25 : l'argent du blob agence réservé aux FONDATEURS (verrou en base).
-- Titre Supabase : « Finance fondateurs 2026-10-25 »
-- ----------------------------------------------------------------------------
-- La table `invoices` est déjà réservée aux fondateurs (is_founder()). Mais le blob
-- agence (module_rows, ligne '__app_state__'), lisible par TOUTE l'agence, contenait
-- aussi l'argent : lignes des factures (invoiceDetails), comptes bancaires
-- (invoiceBankAccounts), émetteur (invoiceIssuer), versements aux créateurs
-- (creatorPayouts) et taux de commission (creatorCommission). Un membre ne les voyait
-- pas à l'écran, mais pouvait les lire par l'API.
--
-- Ici :
--   1) ces 5 clés vivent dans une 2e ligne, '__finance_state__', que seuls les
--      fondateurs (et le serveur) peuvent lire ou écrire ;
--   2) app_state_set / app_state_merge / app_state_list rangent d'office ces clés
--      dans cette ligne : rien à changer dans les écritures de l'app ni du serveur ;
--   3) les clés sont déplacées de '__app_state__' vers '__finance_state__' ;
--   4) la sauvegarde quotidienne et la vue de l'agent lisent les deux lignes.
--
-- L'app (déployée avant ce SQL) lit les deux lignes : elle marche avant comme après.
-- AVANT ce SQL : redéployer creator-report, daily-digest, ttp-mcp et monthly-backup
-- (ils lisent aussi la ligne finance). Peut être relancé sans risque.
-- ============================================================================

-- 0) Les clés « argent ».
create or replace function public.app_finance_key(p_key text) returns boolean
language sql immutable set search_path = public as $$
  select p_key = any (array['invoiceDetails', 'invoiceBankAccounts', 'invoiceIssuer', 'creatorPayouts', 'creatorCommission']);
$$;

-- 1) Lecture et écriture de la ligne finance : fondateurs seulement.
drop policy if exists module_rows_agency on public.module_rows;
create policy module_rows_agency on public.module_rows for all to authenticated
  using (public.is_agency() and (module <> '__finance_state__' or public.is_founder()))
  with check (public.is_agency() and (module <> '__finance_state__' or public.is_founder()));

-- 2) Écritures d'une clé : la bonne ligne selon la clé.
create or replace function public.app_state_set(p_key text, p_value jsonb)
returns void
language plpgsql
security invoker              -- respecte la RLS module_rows (agence seule écrit)
set search_path = public
as $$
declare
  v_id     uuid;
  v_module text := case when public.app_finance_key(p_key) then '__finance_state__' else '__app_state__' end;
begin
  if v_module = '__finance_state__' and auth.uid() is not null and not public.is_founder() then
    raise exception 'réservé aux fondateurs' using errcode = '42501';
  end if;
  select id into v_id
    from public.module_rows
   where module = v_module
   order by created_at desc
   limit 1;
  if v_id is null then
    insert into public.module_rows (module, a)
      values (v_module, jsonb_build_object(p_key, coalesce(p_value, 'null'::jsonb))::text);
  else
    -- coalesce : jsonb_set(…, NULL) renverrait NULL et effacerait TOUT le blob (2026-10-15).
    update public.module_rows
       set a = jsonb_set(coalesce(nullif(a, ''), '{}')::jsonb, array[p_key], coalesce(p_value, 'null'::jsonb), true)::text
     where id = v_id;
  end if;
end;
$$;
grant execute on function public.app_state_set(text, jsonb) to authenticated;

create or replace function public.app_state_merge(p_key text, p_set jsonb, p_remove text[] default '{}')
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id     uuid;
  v_all    jsonb;
  v_cur    jsonb;
  v_module text := case when public.app_finance_key(p_key) then '__finance_state__' else '__app_state__' end;
begin
  if v_module = '__finance_state__' and auth.uid() is not null and not public.is_founder() then
    raise exception 'réservé aux fondateurs' using errcode = '42501';
  end if;
  select id, coalesce(nullif(a, ''), '{}')::jsonb into v_id, v_all
    from public.module_rows
   where module = v_module
   order by created_at desc
   limit 1
   for update;
  v_cur := v_all -> p_key;
  if v_cur is null or jsonb_typeof(v_cur) <> 'object' then v_cur := '{}'::jsonb; end if;
  v_cur := (v_cur - coalesce(p_remove, '{}')) || coalesce(p_set, '{}'::jsonb);
  if v_id is null then
    insert into public.module_rows (module, a) values (v_module, jsonb_build_object(p_key, v_cur)::text);
  else
    update public.module_rows set a = jsonb_set(v_all, array[p_key], v_cur, true)::text where id = v_id;
  end if;
end;
$$;
grant execute on function public.app_state_merge(text, jsonb, text[]) to authenticated;

create or replace function public.app_state_list(p_key text, p_upsert jsonb, p_remove text[] default '{}', p_prepend boolean default false)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id     uuid;
  v_all    jsonb;
  v_cur    jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_new    jsonb := '[]'::jsonb;
  v_el     jsonb;
  v_up     jsonb;
  v_ids    text[];
  v_module text := case when public.app_finance_key(p_key) then '__finance_state__' else '__app_state__' end;
begin
  if v_module = '__finance_state__' and auth.uid() is not null and not public.is_founder() then
    raise exception 'réservé aux fondateurs' using errcode = '42501';
  end if;
  select id, coalesce(nullif(a, ''), '{}')::jsonb into v_id, v_all
    from public.module_rows
   where module = v_module
   order by created_at desc
   limit 1
   for update;
  v_cur := v_all -> p_key;
  if v_cur is null or jsonb_typeof(v_cur) <> 'array' then v_cur := '[]'::jsonb; end if;
  if p_upsert is null or jsonb_typeof(p_upsert) <> 'array' then p_upsert := '[]'::jsonb; end if;
  select coalesce(array_agg(x ->> 'id'), '{}') into v_ids from jsonb_array_elements(p_upsert) x;
  -- Remplacées sur place, retirées, ou gardées telles quelles.
  for v_el in select * from jsonb_array_elements(v_cur) loop
    if (v_el ->> 'id') = any(coalesce(p_remove, '{}')) then continue; end if;
    if (v_el ->> 'id') = any(v_ids) then
      select x into v_up from jsonb_array_elements(p_upsert) x where x ->> 'id' = v_el ->> 'id' limit 1;
      v_out := v_out || jsonb_build_array(v_up);
    else
      v_out := v_out || jsonb_build_array(v_el);
    end if;
  end loop;
  -- Nouvelles entrées : au début ou à la fin selon p_prepend.
  for v_up in select * from jsonb_array_elements(p_upsert) loop
    if not exists (select 1 from jsonb_array_elements(v_cur) y where y ->> 'id' = v_up ->> 'id') then
      v_new := v_new || jsonb_build_array(v_up);
    end if;
  end loop;
  v_out := case when p_prepend then v_new || v_out else v_out || v_new end;
  if v_id is null then
    insert into public.module_rows (module, a) values (v_module, jsonb_build_object(p_key, v_out)::text);
  else
    update public.module_rows set a = jsonb_set(v_all, array[p_key], v_out, true)::text where id = v_id;
  end if;
end;
$$;
grant execute on function public.app_state_list(text, jsonb, text[], boolean) to authenticated;

-- 3) Déplacement des 5 clés vers la ligne finance (relançable : la ligne finance
--    garde ses valeurs, les entrées qui n'existent que dans l'ancienne ligne y sont ajoutées).
do $$
declare
  v_app_id uuid;
  v_app    jsonb;
  v_fin_id uuid;
  v_fin    jsonb;
  k        text;
begin
  select id, coalesce(nullif(a, ''), '{}')::jsonb into v_app_id, v_app
    from public.module_rows where module = '__app_state__'
   order by created_at desc limit 1 for update;
  if v_app_id is null then return; end if;
  select id, coalesce(nullif(a, ''), '{}')::jsonb into v_fin_id, v_fin
    from public.module_rows where module = '__finance_state__'
   order by created_at desc limit 1 for update;
  v_fin := coalesce(v_fin, '{}'::jsonb);
  foreach k in array array['invoiceDetails', 'invoiceBankAccounts', 'invoiceIssuer', 'creatorPayouts', 'creatorCommission'] loop
    if v_app ? k then
      if not (v_fin ? k) then
        v_fin := v_fin || jsonb_build_object(k, v_app -> k);
      elsif jsonb_typeof(v_fin -> k) = 'object' and jsonb_typeof(v_app -> k) = 'object' then
        v_fin := jsonb_set(v_fin, array[k], (v_app -> k) || (v_fin -> k));
      end if;
      v_app := v_app - k;
    end if;
  end loop;
  if v_fin_id is null then
    insert into public.module_rows (module, a) values ('__finance_state__', v_fin::text);
  else
    update public.module_rows set a = v_fin::text where id = v_fin_id;
  end if;
  update public.module_rows set a = v_app::text where id = v_app_id;
end $$;

-- 4a) Sauvegarde quotidienne : les deux lignes réunies (sauvegardes lisibles des seuls fondateurs).
create or replace function public.backup_app_state()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.app_state_backups (snapshot)
    select (coalesce(nullif(a.a, ''), '{}')::jsonb || coalesce(nullif(f.a, ''), '{}')::jsonb)::text
      from (select a from public.module_rows where module = '__app_state__' and a is not null
             order by created_at desc limit 1) a
      left join lateral (select a from public.module_rows where module = '__finance_state__'
             order by created_at desc limit 1) f on true;
  delete from public.app_state_backups where created_at < now() - interval '30 days';
end;
$$;
revoke execute on function public.backup_app_state() from public, anon, authenticated;

-- 4b) Vue de l'agent : les versements lus dans la ligne finance.
create or replace view agent_lecture.reversements as
select e.key as creatrice, p->>'id' as id,
       case when (p->>'date') ~ '^\d{4}-\d{2}-\d{2}'
            then left(p->>'date', 10)::date else null end as paye_le
  from (select a from public.module_rows
         where module = '__finance_state__' order by created_at desc limit 1) m,
       jsonb_each(coalesce(nullif(m.a, '')::jsonb -> 'creatorPayouts', '{}'::jsonb)) as e(key, value),
       jsonb_array_elements(
         case when jsonb_typeof(e.value) = 'array' then e.value else '[]'::jsonb end) as p;

-- ----------------------------------------------------------------------------
-- Contrôle : une ligne, toutes les colonnes à true.
--   cles_deplacees : plus aucune clé argent dans la ligne commune ;
--   ligne_finance  : la ligne finance existe ;
--   verrou         : la règle d'accès mentionne bien les fondateurs ;
--   une_seule_regle: aucune autre règle sur module_rows ne rouvre l'accès.
-- ----------------------------------------------------------------------------
select
  (select not (coalesce(nullif(a, ''), '{}')::jsonb ?| array['invoiceDetails', 'invoiceBankAccounts', 'invoiceIssuer', 'creatorPayouts', 'creatorCommission'])
     from public.module_rows where module = '__app_state__' order by created_at desc limit 1) as cles_deplacees,
  exists (select 1 from public.module_rows where module = '__finance_state__') as ligne_finance,
  (select qual like '%is_founder%' from pg_policies where tablename = 'module_rows' and policyname = 'module_rows_agency') as verrou,
  (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'module_rows') as une_seule_regle;
