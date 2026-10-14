-- ============================================================================
-- Mails · fiabilité (2026-10-14)
-- Titre Supabase : « Mails · fiabilité (index email_activity, alias créateur unique) »
-- ============================================================================
-- 1. email_activity : plus de doublons (la relève tournait deux fois sur le même mail) et un
--    index pour la cloche et la pastille « Mails » (relues toutes les 20 s).
-- 2. creator_mail_settings : un alias = un seul créateur, et jamais une boîte partagée
--    (sinon un créateur verrait des mails qui ne le concernent pas). Si des doublons
--    existent déjà, rien n'est bloqué : un avis liste les créateurs à corriger.
-- ============================================================================

-- 1. email_activity ------------------------------------------------------------
delete from public.email_activity a
 using public.email_activity b
 where a.gmail_message_id is not null
   and a.gmail_message_id = b.gmail_message_id
   and a.ctid > b.ctid;
create unique index if not exists email_activity_gmail_msg_uidx
  on public.email_activity (gmail_message_id) where gmail_message_id is not null;
create index if not exists email_activity_dir_created_idx
  on public.email_activity (direction, created_at desc);

-- 2. creator_mail_settings -----------------------------------------------------
do $$
declare v_dups text; v_shared text;
begin
  select string_agg(lower(alias) || ' (' || n || ' créateurs)', ', ') into v_dups
    from (select lower(alias) as alias, count(*) as n from public.creator_mail_settings
           where alias is not null and alias <> '' group by lower(alias) having count(*) > 1) d;
  if v_dups is not null then
    raise notice 'Alias utilisés par plusieurs créateurs : % → corrige-les dans Mails › Créateurs, puis relance ce SQL.', v_dups;
  else
    create unique index if not exists creator_mail_settings_alias_uidx
      on public.creator_mail_settings (lower(alias)) where alias is not null and alias <> '';
  end if;

  select string_agg(creator || ' → ' || alias, ', ') into v_shared
    from public.creator_mail_settings
   where lower(split_part(alias, '@', 1)) in ('partnerships', 'talent', 'contact', 'hello', 'booking', 'info', 'admin', 'noreply', 'no-reply')
     and lower(alias) like '%@ttpcreators.pro';
  if v_shared is not null then
    raise notice 'Boîte partagée réglée comme alias de créateur : % → change l''alias.', v_shared;
  else
    alter table public.creator_mail_settings drop constraint if exists creator_mail_settings_alias_partagee;
    alter table public.creator_mail_settings add constraint creator_mail_settings_alias_partagee check (
      alias is null or alias = ''
      or not (lower(split_part(alias, '@', 1)) in ('partnerships', 'talent', 'contact', 'hello', 'booking', 'info', 'admin', 'noreply', 'no-reply')
              and lower(alias) like '%@ttpcreators.pro'));
  end if;
end $$;

select indexname from pg_indexes
 where tablename in ('email_activity', 'creator_mail_settings')
   and indexname in ('email_activity_gmail_msg_uidx', 'email_activity_dir_created_idx', 'creator_mail_settings_alias_uidx')
 order by indexname;
