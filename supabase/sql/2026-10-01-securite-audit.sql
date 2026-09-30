-- ════════════════════════════════════════════════════════════════════════════
-- Audit sécurité du 2026-10-01 : resserrage des droits (AUCUNE donnée modifiée).
-- Idempotent : peut être relancé sans risque. À lancer dans le SQL Editor.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) PROFILS (critique) : un compte « membre » pouvait se passer fondateur, ou
--    rattacher son compte à une créatrice, via l'API. Lecture = agence ;
--    écriture = fondateurs uniquement (l'app ne modifie jamais `profiles` ;
--    create-access passe par la clé serveur).
drop policy if exists profiles_agency on public.profiles;
drop policy if exists profiles_agency_read on public.profiles;
drop policy if exists profiles_founder_write on public.profiles;
create policy profiles_agency_read on public.profiles for select to authenticated
  using (public.is_agency());
create policy profiles_founder_write on public.profiles for all to authenticated
  using (public.is_founder()) with check (public.is_founder());

-- 2) SAUVEGARDES du blob (contient finance + anciens accès) : fondateurs seulement.
drop policy if exists app_state_backups_agency on public.app_state_backups;
create policy app_state_backups_agency on public.app_state_backups
  for select to authenticated using (public.is_founder());

-- 3) CONTACTS : une créatrice voyait (via l'API) tout le carnet partagé de l'agence.
--    Elle ne lit plus que les siens ; l'agence lit tout.
drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts for select to authenticated
  using (public.is_agency() or creator = public.my_creator());

-- 4) COLLABS : la créatrice LIT ses collabs, seule l'agence écrit.
drop policy if exists collabs_scoped on public.collabs;
drop policy if exists collabs_read on public.collabs;
drop policy if exists collabs_agency_write on public.collabs;
create policy collabs_read on public.collabs for select to authenticated
  using (public.is_agency() or creator = public.my_creator());
create policy collabs_agency_write on public.collabs for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- 5) BRIEFS : la créatrice lit les siens et ne peut modifier QUE le statut et son
--    script (consignes). Création / suppression = agence.
drop policy if exists briefs_scoped on public.briefs;
drop policy if exists briefs_read on public.briefs;
drop policy if exists briefs_agency_write on public.briefs;
drop policy if exists briefs_creator_update on public.briefs;
create policy briefs_read on public.briefs for select to authenticated
  using (public.is_agency() or creator = public.my_creator());
create policy briefs_agency_write on public.briefs for all to authenticated
  using (public.is_agency()) with check (public.is_agency());
create policy briefs_creator_update on public.briefs for update to authenticated
  using (creator = public.my_creator()) with check (creator = public.my_creator());

create or replace function public.briefs_creator_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_agency() then return new; end if;
  -- Créatrice : tout reste comme avant, sauf status et consignes.
  return jsonb_populate_record(old, jsonb_build_object('status', new.status, 'consignes', new.consignes));
end $$;
drop trigger if exists briefs_creator_guard on public.briefs;
create trigger briefs_creator_guard before update on public.briefs
  for each row execute function public.briefs_creator_guard();

-- 6) MEDIA KIT PUBLIC : quand « Prix masqués » est coché, les tarifs ne doivent pas
--    être lisibles non plus via l'API publique.
create or replace view public.public_mediakit
with (security_invoker = false) as
  select name, handle, niche, platform, photo_url, sort_order,
         case when coalesce((mediakit->>'hideRates')::boolean, false)
              then mediakit - 'rates' - 'ratesNote'
              else mediakit end as mediakit
  from public.creators
  where coalesce(status, 'actif') <> 'inactif';
grant select on public.public_mediakit to anon, authenticated;

-- 7) PIÈCES JOINTES DES TÂCHES : une créatrice ne pouvait ni ouvrir ni supprimer
--    ses propres pièces jointes (ni celles que l'agence joint à SES tâches).
drop policy if exists documents_obj_creator_own_read on storage.objects;
create policy documents_obj_creator_own_read on storage.objects for select to authenticated
  using (
    bucket_id = 'documents' and (
      name like 'creator-uploads/' || auth.uid()::text || '/%'
      or exists (
        select 1 from public.todos t, jsonb_array_elements(coalesce(t.attachments, '[]'::jsonb)) a
         where a->>'path' = storage.objects.name and t.creator = public.my_creator()
      )
    )
  );
drop policy if exists documents_obj_creator_own_delete on storage.objects;
create policy documents_obj_creator_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and name like 'creator-uploads/' || auth.uid()::text || '/%');

-- 8) AGENT (Megan) : page réservée aux fondateurs dans l'app → idem en base.
--    (Le rôle technique ttp_agent garde ses propres droits, inchangés.)
do $$
declare t text;
begin
  foreach t in array array['cockpits','actions','prospects','cercle','memoire_createurs','lecons','journal'] loop
    if to_regclass('agent.' || t) is not null then
      execute format('drop policy if exists %I_agence on agent.%I;', t, t);
      execute format('create policy %I_agence on agent.%I for all to authenticated using (public.is_founder()) with check (public.is_founder());', t, t);
    end if;
  end loop;
end $$;

-- 9) Hygiène : fonctions SECURITY DEFINER avec search_path fixé.
alter function public.is_agency() set search_path = public;
alter function public.my_creator() set search_path = public;
alter function public.handle_new_user() set search_path = public;
alter function public.creators_guard() set search_path = public;
alter function public.creator_roadmap_guard() set search_path = public;
