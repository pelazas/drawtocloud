alter table if exists projects
  add column if not exists setup_pdf_status text not null default 'none',
  add column if not exists setup_pdf_url text,
  add column if not exists setup_pdf_storage_path text,
  add column if not exists setup_pdf_generated_at timestamptz,
  add column if not exists setup_pdf_source_revision text,
  add column if not exists setup_pdf_error text,
  add column if not exists setup_pdf_progress integer not null default 0;

create index if not exists idx_projects_setup_pdf_status on projects (setup_pdf_status);
