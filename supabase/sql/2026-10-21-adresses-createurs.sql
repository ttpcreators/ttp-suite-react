-- ============================================================================
-- 2026-10-21 : plusieurs adresses mail par créateur (section « Mails »).
-- Titre Supabase : « Mails · plusieurs adresses par créateur »
-- ----------------------------------------------------------------------------
-- `alias` reste l'adresse principale (ex. lea@ttpcreators.pro). La nouvelle colonne
-- `aliases` contient ses adresses EN PLUS (ex. son adresse perso), en minuscules.
-- Toutes ses adresses = alias + aliases, sans doublon.
--
-- Règles (trigger creator_mail_settings_addresses) :
--   • chaque adresse en plus est mise en minuscules, sans espaces ni doublon, et
--     l'adresse principale n'y est pas répétée ;
--   • jamais une boîte commune de l'agence (partnerships@, talent@… : même liste
--     que la contrainte creator_mail_settings_alias_partagee) ;
--   • une adresse (principale ou en plus) = un seul créateur : sinon erreur claire.
-- Déjà foldé dans SETUP.sql. Peut être relancé sans risque.
-- ============================================================================

alter table public.creator_mail_settings add column if not exists aliases text[] not null default '{}';

create or replace function public.creator_mail_settings_addresses()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_main  text := nullif(lower(btrim(coalesce(new.alias, ''))), '');
  v_all   text[];
  v_addr  text;
  v_other text;
begin
  -- Adresses en plus : minuscules, sans vide ni doublon, sans l'adresse principale (ordre gardé).
  new.aliases := coalesce((
    select array_agg(d.a order by d.pos)
      from (select lower(btrim(x)) as a, min(u.pos) as pos
              from unnest(coalesce(new.aliases, '{}'::text[])) with ordinality as u(x, pos)
             where btrim(coalesce(x, '')) <> ''
             group by lower(btrim(x))) d
     where d.a is distinct from v_main
  ), '{}'::text[]);

  foreach v_addr in array new.aliases loop
    if v_addr !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'Adresse invalide : % (il faut une adresse e-mail complète)', v_addr;
    end if;
    if split_part(v_addr, '@', 1) in ('partnerships', 'talent', 'contact', 'hello', 'booking', 'info', 'admin', 'noreply', 'no-reply')
       and v_addr like '%@ttpcreators.pro' then
      raise exception 'C''est une boîte commune : % ne peut pas être l''adresse d''un créateur', v_addr;
    end if;
  end loop;

  v_all := new.aliases || case when v_main is null then '{}'::text[] else array[v_main] end;
  if cardinality(v_all) = 0 then
    return new;
  end if;

  -- Une écriture à la fois sur ces adresses : deux enregistrements simultanés ne
  -- peuvent pas donner la même adresse à deux créateurs.
  perform pg_advisory_xact_lock(hashtext('creator_mail_settings_addresses'));

  select x.a, o.creator into v_addr, v_other
    from unnest(v_all) as x(a)
    join public.creator_mail_settings o
      on o.creator <> new.creator
     and (lower(btrim(coalesce(o.alias, ''))) = x.a
          or exists (select 1 from unnest(o.aliases) y where lower(btrim(y)) = x.a))
   limit 1;
  if v_other is not null then
    raise exception 'L''adresse % est déjà utilisée par un autre créateur (%)', v_addr, v_other;
  end if;
  return new;
end $$;

revoke all on function public.creator_mail_settings_addresses() from public, anon, authenticated;

drop trigger if exists creator_mail_settings_addresses on public.creator_mail_settings;
create trigger creator_mail_settings_addresses
  before insert or update of creator, alias, aliases on public.creator_mail_settings
  for each row execute function public.creator_mail_settings_addresses();

-- Contrôle : doit afficher « aliases · ARRAY · '{}'::text[] » puis le trigger.
select column_name, data_type, column_default from information_schema.columns
 where table_schema = 'public' and table_name = 'creator_mail_settings' and column_name = 'aliases';
select tgname from pg_trigger
 where tgrelid = 'public.creator_mail_settings'::regclass and tgname = 'creator_mail_settings_addresses';
