alter table if exists projects
  add column if not exists thumbnail_url text;
