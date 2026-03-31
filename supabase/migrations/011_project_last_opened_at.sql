alter table if exists projects
  add column if not exists last_opened_at timestamptz;

update projects
set last_opened_at = updated_at
where last_opened_at is null;

create index if not exists idx_projects_user_last_opened_at
  on projects (user_id, last_opened_at desc);
