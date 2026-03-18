alter table if exists projects
  add column if not exists project_mode text;

update projects
set project_mode = case
  when generation_stage = 'discovery' then 'discovery'
  when generation_stage in (
    'queued',
    'running',
    'requirements',
    'architect',
    'parallel_agents',
    'budget_retry',
    'completed',
    'failed'
  ) then 'default'
  when coalesce(questionnaire_answers ->> '_mode', '') = 'chat_first' then 'discovery'
  else 'default'
end
where project_mode is null;

update projects
set project_mode = 'default'
where project_mode not in ('discovery', 'default');

alter table if exists projects
  alter column project_mode set default 'default';

alter table if exists projects
  alter column project_mode set not null;

alter table if exists projects
  drop constraint if exists projects_project_mode_check;

alter table if exists projects
  add constraint projects_project_mode_check
  check (project_mode in ('discovery', 'default'));
