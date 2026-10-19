-- ============================================================================
-- 2026-10-21 : écritures PARTIELLES dans les réglages partagés (blob __app_state__).
-- ----------------------------------------------------------------------------
-- Avant : l'app relisait une clé entière (ex. invoiceDetails), la modifiait puis la
-- réécrivait. Deux postes qui enregistraient dans la même seconde : le second
-- effaçait le travail du premier. Ces fonctions modifient seulement les ENTRÉES
-- touchées, ligne verrouillée (FOR UPDATE) : les écritures passent l'une après
-- l'autre et aucune ne perd celle de l'autre.
--   app_state_merge : clé = objet { id: valeur } (factures, versements, notes…)
--   app_state_list  : clé = liste d'objets qui ont un champ "id" (historiques)
-- security invoker : la RLS de module_rows s'applique (agence seule écrit).
-- Déjà foldé dans SETUP.sql. Peut être relancé sans risque.
-- ============================================================================

create or replace function public.app_state_merge(p_key text, p_set jsonb, p_remove text[] default '{}')
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id  uuid;
  v_all jsonb;
  v_cur jsonb;
begin
  select id, coalesce(a, '{}')::jsonb into v_id, v_all
    from public.module_rows
   where module = '__app_state__'
   order by created_at desc
   limit 1
   for update;
  v_cur := v_all -> p_key;
  if v_cur is null or jsonb_typeof(v_cur) <> 'object' then v_cur := '{}'::jsonb; end if;
  v_cur := (v_cur - coalesce(p_remove, '{}')) || coalesce(p_set, '{}'::jsonb);
  if v_id is null then
    insert into public.module_rows (module, a) values ('__app_state__', jsonb_build_object(p_key, v_cur)::text);
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
  v_id   uuid;
  v_all  jsonb;
  v_cur  jsonb;
  v_out  jsonb := '[]'::jsonb;
  v_new  jsonb := '[]'::jsonb;
  v_el   jsonb;
  v_up   jsonb;
  v_ids  text[];
begin
  select id, coalesce(a, '{}')::jsonb into v_id, v_all
    from public.module_rows
   where module = '__app_state__'
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
    insert into public.module_rows (module, a) values ('__app_state__', jsonb_build_object(p_key, v_out)::text);
  else
    update public.module_rows set a = jsonb_set(v_all, array[p_key], v_out, true)::text where id = v_id;
  end if;
end;
$$;
grant execute on function public.app_state_list(text, jsonb, text[], boolean) to authenticated;

-- Contrôle : les deux lignes doivent apparaître.
select proname from pg_proc where proname in ('app_state_merge', 'app_state_list') order by proname;
