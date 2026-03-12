-- profiles: one row per user, tracks generation quota
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  generations_used integer not null default 0,
  generations_limit integer not null default 10,
  created_at timestamptz not null default now()
);

-- projects: stores full diagram + outputs
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  title text not null default 'Untitled',
  description text,
  questionnaire_answers jsonb,
  nodes jsonb,
  edges jsonb,
  terraform_files jsonb,
  cost_estimate jsonb,
  chat_history jsonb,
  share_slug text unique,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: enable on both tables
alter table profiles enable row level security;
alter table projects enable row level security;

-- profiles policies
create policy "users read own profile"
  on profiles for select using (auth.uid() = id);
create policy "users update own profile"
  on profiles for update using (auth.uid() = id);

-- projects policies
create policy "users crud own projects"
  on projects for all using (auth.uid() = user_id);
create policy "public projects readable by anyone"
  on projects for select using (is_public = true);
