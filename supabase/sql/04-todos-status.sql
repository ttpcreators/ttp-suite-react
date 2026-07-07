-- 4 · Tâches status — colonne status (À faire / En cours / Fait) sur les todos
alter table public.todos add column if not exists status text default 'À faire';
update public.todos set status = case when done then 'Fait' else 'À faire' end where status is null;
