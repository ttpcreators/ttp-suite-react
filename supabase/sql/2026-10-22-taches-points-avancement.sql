-- ════════════════════════════════════════════════════════════════════════════
-- Titre Supabase : « To-do · points d'avancement visibles du créateur »
-- 2026-10-22 · Les points d'avancement d'une tâche (« Où j'en suis », questions de
-- l'agence) vivaient dans le blob agence `itemNotes`, que le créateur ne peut pas lire.
-- Ils passent dans une colonne de la tâche : `todos.progress` (un point par ligne,
-- « 22/10/2026 · Agence : texte »). La RLS de `todos` s'applique telle quelle :
-- l'agence lit tout, un créateur lit et écrit seulement les tâches partagées avec lui.
-- Relançable sans risque. L'app marche avant ce SQL (repli sur le blob).
-- ════════════════════════════════════════════════════════════════════════════

alter table public.todos add column if not exists progress text;

-- Reprise des points déjà écrits par l'agence (blob `itemNotes`, clé = id de la tâche),
-- seulement là où la colonne est encore vide.
with blob as (
  select coalesce(a, '{}')::jsonb -> 'itemNotes' as notes
    from public.module_rows
   where module = '__app_state__'
   order by created_at desc
   limit 1
)
update public.todos t
   set progress = n.value
  from blob, jsonb_each_text(coalesce(blob.notes, '{}'::jsonb)) as n(key, value)
 where t.id::text = n.key
   and nullif(btrim(t.progress), '') is null
   and nullif(btrim(n.value), '') is not null;

-- Contrôle : la colonne existe et combien de tâches ont des points.
select count(*) filter (where nullif(btrim(progress), '') is not null) as taches_avec_points,
       count(*) as taches
  from public.todos;
