-- Admin · Rôle agence (partnerships@) — promeut un compte existant en agence.
-- Raccourci pratique (le schéma maître le fait déjà pour cet email au 1er run).
update public.profiles set role = 'agency'
where user_id = (select id from auth.users where email = 'partnerships@ttpcreators.pro');
