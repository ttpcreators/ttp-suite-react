-- Contacts · colonnes prénom / nom
alter table public.contacts add column if not exists first_name text;
alter table public.contacts add column if not exists last_name text;
