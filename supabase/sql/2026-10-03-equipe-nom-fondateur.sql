-- ════════════════════════════════════════════════════════════════════════════
-- Équipe agence (2026-10-03) : un FONDATEUR peut changer le nom affiché de
-- n'importe quel compte agence (Accès → Comptes de l'agence → Modifier).
-- Idempotent : peut être relancé sans risque. À lancer dans le SQL Editor.
-- (Chacun garde aussi set_my_display_name() pour son propre prénom.)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.set_agency_display_name(target uuid, name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_founder() then
    raise exception 'non_autorise';
  end if;
  update public.profiles set display_name = nullif(left(trim(name), 40), '')
   where user_id = target and role = 'agency';
  if not found then
    raise exception 'compte_introuvable';
  end if;
end $$;
revoke all on function public.set_agency_display_name(uuid, text) from public, anon;
grant execute on function public.set_agency_display_name(uuid, text) to authenticated;
