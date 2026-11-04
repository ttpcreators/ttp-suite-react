-- ============================================================================
-- Briefs ⇄ Collabs : toujours à jour, sans saisie à la main (demande de Marc, 4 nov. 2026)
-- ----------------------------------------------------------------------------
-- 1. Chaque collab a son brief : une nouvelle collab crée son brief (marque, créateur,
--    livrables), relié par collab_id et collabs.brief_id.
-- 2. L'étape de la collab fixe le statut du brief :
--      1 Signature                         → « attente »
--      2 Brief transmis … 5 Validation     → « cours »
--      6 Publication et après              → « terminé »
-- 3. Le brief passé « en cours » ou « terminé » par l'agence fait AVANCER la collab
--    (étape 2 ou 6 au moins), jamais reculer. Un créateur qui change le statut de son
--    brief ne touche pas à la collab.
-- 4. Rattrapage : un brief pour chaque collab active ou gagnée qui n'en a pas, statuts
--    réalignés, PDF déjà rangé joint quand il existe.
-- Rejouable sans risque.
-- ============================================================================

create or replace function public.brief_status_for_step(p_step integer)
returns text language sql immutable as $$
  select case when coalesce(p_step, 1) <= 1 then 'attente'
              when p_step <= 5 then 'cours'
              else 'terminé' end
$$;

-- Étape minimale qu'un statut de brief impose à sa collab (null = aucune).
create or replace function public.collab_step_for_brief(p_status text)
returns integer language sql immutable as $$
  select case lower(coalesce(p_status, ''))
              when 'cours' then 2
              when 'terminé' then 6
              when 'termine' then 6
              else null end
$$;

-- 1 + 2 : collab créée → son brief ; étape changée → statut du brief.
create or replace function public.collabs_sync_brief()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_brief uuid;
begin
  if tg_op = 'INSERT' then
    if new.status not in ('active', 'gagnee') then return new; end if;
    select id into v_brief from public.briefs where collab_id = new.id limit 1;
    if v_brief is null then
      insert into public.briefs (brand, creator, deliverables, due, status, collab_id)
      values (new.brand, new.creator, coalesce(new.deliverables, ''), '—',
              public.brief_status_for_step(new.step), new.id)
      returning id into v_brief;
    end if;
    update public.collabs set brief_id = v_brief where id = new.id and brief_id is distinct from v_brief;
    return new;
  end if;
  -- UPDATE : seulement quand l'étape change.
  if new.step is distinct from old.step then
    update public.briefs
       set status = public.brief_status_for_step(new.step)
     where collab_id = new.id
       and status is distinct from public.brief_status_for_step(new.step);
  end if;
  return new;
end $$;

drop trigger if exists collabs_sync_brief_ins on public.collabs;
create trigger collabs_sync_brief_ins after insert on public.collabs
  for each row execute function public.collabs_sync_brief();
drop trigger if exists collabs_sync_brief_upd on public.collabs;
create trigger collabs_sync_brief_upd after update of step on public.collabs
  for each row when (pg_trigger_depth() < 2) execute function public.collabs_sync_brief();

-- 3 : brief en cours / terminé (par l'agence) → la collab avance, jamais ne recule.
create or replace function public.briefs_sync_collab()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  v_min integer := public.collab_step_for_brief(new.status);
begin
  if new.collab_id is null or v_min is null then return new; end if;
  if new.status is not distinct from old.status and new.collab_id is not distinct from old.collab_id then return new; end if;
  if auth.uid() is not null and not public.is_agency() then return new; end if;
  update public.collabs set step = v_min where id = new.collab_id and coalesce(step, 1) < v_min;
  return new;
end $$;

drop trigger if exists briefs_sync_collab_upd on public.briefs;
create trigger briefs_sync_collab_upd after update of status, collab_id on public.briefs
  for each row when (pg_trigger_depth() < 2) execute function public.briefs_sync_collab();

-- 4 : rattrapage des collabs existantes.
insert into public.briefs (brand, creator, deliverables, due, status, collab_id)
select c.brand, c.creator, coalesce(c.deliverables, ''), '—', public.brief_status_for_step(c.step), c.id
  from public.collabs c
 where c.status in ('active', 'gagnee')
   and not exists (select 1 from public.briefs b where b.collab_id = c.id);

update public.collabs c
   set brief_id = b.id
  from public.briefs b
 where b.collab_id = c.id and c.brief_id is distinct from b.id;

update public.briefs b
   set status = public.brief_status_for_step(c.step)
  from public.collabs c
 where b.collab_id = c.id
   and c.status in ('active', 'gagnee')
   and b.status is distinct from public.brief_status_for_step(c.step);

-- PDF déjà rangé dans Documents : brief d'octobre de Léna × Nutripure.
update public.briefs b
   set pdf = jsonb_build_object('name', d.name, 'path', d.path, 'docId', d.id::text)
  from public.documents d
 where b.collab_id = '409dfe62-6c66-4049-afee-5d970b2a11b1'
   and d.id = '459a6d36-6f76-477d-b19a-efce5ab3cb7c'
   and b.pdf is null;
