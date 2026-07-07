-- Créateurs · colonnes instagram / tiktok / email_pro
alter table public.creators
  add column if not exists instagram text,
  add column if not exists tiktok text,
  add column if not exists email_pro text;
