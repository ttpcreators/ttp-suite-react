-- ============================================================================
-- collab_steps : lecture rétablie pour l'app (audit du 1er novembre, n° 9 et 11)
-- Titre Supabase : « collab_steps · droits de lecture »
-- ============================================================================
-- La table a la RLS activée mais plus aucune règle : l'app (rôle authenticated)
-- lit 0 ligne sans erreur. Conséquences : la page Collabs retombe sur updated_at
-- (réécrit chaque matin par le scan Instagram → « 0 j » partout) et le bloc
-- « Activité » de la fiche collab reste vide. Le connecteur (clé de service) les
-- voyait, d'où des chiffres différents entre le site et Claude.
-- Mêmes règles que SETUP.sql : agence = tout ; créatrice = l'historique de ses collabs.
-- ============================================================================

alter table public.collab_steps enable row level security;

drop policy if exists collab_steps_read on public.collab_steps;
create policy collab_steps_read on public.collab_steps for select to authenticated
  using (public.is_agency() or exists (
    select 1 from public.collabs c where c.id = collab_steps.collab_id and c.creator = public.my_creator()));

drop policy if exists collab_steps_agency on public.collab_steps;
create policy collab_steps_agency on public.collab_steps for all to authenticated
  using (public.is_agency()) with check (public.is_agency());

-- Contrôle : 2 règles attendues.
select polname from pg_policy where polrelid = 'public.collab_steps'::regclass order by 1;
