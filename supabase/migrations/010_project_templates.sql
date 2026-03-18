alter table if exists projects
  add column if not exists is_template boolean not null default false;

create index if not exists idx_projects_is_template
  on projects (is_template);
