-- Titre Supabase : « Cloche · mails lus dans Gmail ou Spark »
-- Un mail ouvert dans Gmail ou Spark passe en « lu » dans la cloche de l'app.
-- gmail-poll remplit ces deux colonnes (rien d'autre ne change, rien n'est supprimé).
alter table public.email_activity add column if not exists read_at timestamptz;
alter table public.email_activity add column if not exists box text;

-- Vérification : les deux colonnes doivent apparaître.
select column_name, data_type from information_schema.columns
 where table_schema = 'public' and table_name = 'email_activity' and column_name in ('read_at', 'box');
