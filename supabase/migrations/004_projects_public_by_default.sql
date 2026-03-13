-- Make all projects shareable by default.
update projects
set is_public = true
where is_public is distinct from true;

alter table projects
alter column is_public set default true;
