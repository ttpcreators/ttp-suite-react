-- ============================================================================
-- 2026-10-15 · Sécurité : vues publiques en lecture seule, pièces jointes des tâches,
-- feuille de route, blob agence. (Audit du 2026-10-15, déjà foldé dans SETUP.sql.)
-- Sans risque à relancer : chaque étape remplace ou retire un droit, rien n'est effacé.
-- ============================================================================

-- 1) Media kit public : « Prix masqués » masque aussi la note des tarifs en anglais.
create or replace view public.public_mediakit
with (security_invoker = false) as
  select name, handle, niche, platform, photo_url, sort_order,
         case when coalesce((mediakit->>'hideRates')::boolean, false)
              then mediakit - 'rates' - 'ratesNote' - 'ratesNoteEn'
              else mediakit end as mediakit
  from public.creators
  where coalesce(status, 'actif') <> 'inactif';

-- 2) Les 3 vues publiques du site (roster, media kits, deck agence) tournent avec les
--    droits du propriétaire : sans ce retrait, la clé publique pourrait MODIFIER ou
--    SUPPRIMER des créateurs à travers elles (droits par défaut de Supabase).
--    Lecture seule pour tout le monde.
revoke insert, update, delete, truncate
  on public.public_roster, public.public_mediakit, public.public_agency_mediakit
  from anon, authenticated, public;
grant select on public.public_roster, public.public_mediakit, public.public_agency_mediakit to anon, authenticated;

-- 3) Pièces jointes des tâches : un créateur ne lit que les fichiers rangés sous SA tâche
--    (todo-attachments/<id de la tâche>/…), plus jamais un chemin recopié d'ailleurs.
drop policy if exists documents_obj_creator_own_read on storage.objects;
create policy documents_obj_creator_own_read on storage.objects for select to authenticated
  using (
    bucket_id = 'documents' and (
      name like 'creator-uploads/' || auth.uid()::text || '/%'
      or exists (
        select 1 from public.todos t, jsonb_array_elements(coalesce(t.attachments, '[]'::jsonb)) a
         where a->>'path' = storage.objects.name and t.creator = public.my_creator()
           and storage.objects.name like 'todo-attachments/' || t.id::text || '/%'
      )
    )
  );

-- 4) Feuille de route : le créateur met à jour sa cadence, mais ne peut plus supprimer la
--    feuille de route écrite par l'agence.
drop policy if exists creator_roadmap_write on public.creator_roadmap;
drop policy if exists creator_roadmap_agency on public.creator_roadmap;
drop policy if exists creator_roadmap_creator_ins on public.creator_roadmap;
drop policy if exists creator_roadmap_creator_upd on public.creator_roadmap;
create policy creator_roadmap_agency on public.creator_roadmap for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
create policy creator_roadmap_creator_ins on public.creator_roadmap for insert to authenticated
  with check (creator = public.my_creator());
create policy creator_roadmap_creator_upd on public.creator_roadmap for update to authenticated
  using (creator = public.my_creator()) with check (creator = public.my_creator());

-- 5) Blob agence : une valeur nulle n'efface plus TOUT le blob (jsonb_set(…, NULL) = NULL).
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
      values ('__app_state__', jsonb_build_object(p_key, coalesce(p_value, 'null'::jsonb))::text);
  else
    update public.module_rows
       set a = jsonb_set(coalesce(a, '{}')::jsonb, array[p_key], coalesce(p_value, 'null'::jsonb), true)::text
     where id = v_id;
  end if;
end;
$$;
grant execute on function public.app_state_set(text, jsonb) to authenticated;

-- Vérification (lecture seule) : doit montrer UNIQUEMENT « SELECT » pour anon et authenticated.
select table_name as vue, grantee as qui, string_agg(privilege_type, ', ' order by privilege_type) as droits
  from information_schema.role_table_grants
 where table_schema = 'public'
   and table_name in ('public_roster', 'public_mediakit', 'public_agency_mediakit')
   and grantee in ('anon', 'authenticated')
 group by 1, 2
 order by 1, 2;
