alter table if exists projects
  add column if not exists generation_status text not null default 'idle',
  add column if not exists generation_stage text,
  add column if not exists generation_error text,
  add column if not exists generation_trace_id text,
  add column if not exists generation_started_at timestamptz,
  add column if not exists generation_completed_at timestamptz,
  add column if not exists last_event_at timestamptz;

create index if not exists idx_projects_generation_status on projects (generation_status);
create index if not exists idx_projects_generation_trace_id on projects (generation_trace_id);
