-- ============================================================================
-- 2026-10-29 : page Compta : deux réglages d'argent de plus réservés aux FONDATEURS.
-- Titre Supabase : « Compta 2026-10-29 »
-- ----------------------------------------------------------------------------
-- La page Compta (src/views/Compta.tsx) enregistre :
--   • `comptaSettings` : activité URSSAF, taux, régime de TVA, déclaration ;
--   • `collabCashMode` : qui encaisse chaque collab (l'agence ou le créateur).
-- Ces deux clés rejoignent les clés d'argent de la ligne '__finance_state__'
-- (SQL 2026-10-25-finance-fondateurs.sql) : app_state_set / merge / list les y rangent
-- d'office, et celles déjà écrites dans la ligne commune y sont déplacées.
-- À lancer APRÈS 2026-10-25-finance-fondateurs.sql. L'app marche avant comme après.
-- Peut être relancé sans risque.
-- ============================================================================

create or replace function public.app_finance_key(p_key text) returns boolean
language sql immutable set search_path = public as $$
  select p_key = any (array['invoiceDetails', 'invoiceBankAccounts', 'invoiceIssuer', 'creatorPayouts', 'creatorCommission', 'comptaSettings', 'collabCashMode']);
$$;

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
  foreach k in array array['comptaSettings', 'collabCashMode'] loop
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

-- ----------------------------------------------------------------------------
-- Contrôle : une ligne, toutes les colonnes à true.
-- ----------------------------------------------------------------------------
select
  public.app_finance_key('comptaSettings') and public.app_finance_key('collabCashMode') as cles_argent,
  (select not (coalesce(nullif(a, ''), '{}')::jsonb ?| array['comptaSettings', 'collabCashMode'])
     from public.module_rows where module = '__app_state__' order by created_at desc limit 1) as cles_deplacees;
