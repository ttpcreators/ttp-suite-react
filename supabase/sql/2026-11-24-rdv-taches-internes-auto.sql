-- ============================================================================
-- 2026-11-24 (suite de « Tâches internes privées ») : un rendez-vous recopié d'une
-- tâche (« Tâche : … ») est TOUJOURS interne, d'où qu'il vienne (Planning de l'app,
-- Google Agenda, connecteur). Avant, seuls la reprise et le connecteur le marquaient :
-- un « Tâche : … » créé dans le Planning ou revenu de Google restait lisible par le
-- créateur cité.
-- Titre Supabase : « Rendez-vous de tâches toujours internes »
-- Relançable sans risque.
-- ============================================================================
create or replace function public.events_interne_auto() returns trigger
  language plpgsql set search_path = public, pg_temp as $$
begin
  if coalesce(new.title, '') ~* '^\s*t[âa]che\s*:' then new.interne := true; end if;
  return new;
end $$;

drop trigger if exists events_interne_auto on public.events;
create trigger events_interne_auto before insert or update of title, interne on public.events
  for each row execute function public.events_interne_auto();

update public.events set interne = true where not interne and title ~* '^\s*t[âa]che\s*:';

-- Contrôle : 1 · 0 (déclencheur en place, plus aucun « Tâche : » visible).
select
  (select count(*) from pg_trigger where tgname = 'events_interne_auto') as declencheur,
  (select count(*) from public.events where not interne and title ~* '^\s*t[âa]che\s*:') as taches_visibles;
