-- ============================================================
-- DrawToCloud Production Database Migration — Full Consolidated Script
-- Run this in Supabase SQL Editor. All operations are idempotent.
-- ============================================================

-- ============================================================
-- 001: Initial Schema (profiles, projects, RLS)
-- ============================================================

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

-- profiles policies (drop first for idempotency, since postgres has no IF NOT EXISTS for policies)
drop policy if exists "users read own profile" on profiles;
create policy "users read own profile"
  on profiles for select using (auth.uid() = id);

drop policy if exists "users update own profile" on profiles;
create policy "users update own profile"
  on profiles for update using (auth.uid() = id);

-- projects policies
drop policy if exists "users crud own projects" on projects;
create policy "users crud own projects"
  on projects for all using (auth.uid() = user_id);

drop policy if exists "public projects readable by anyone" on projects;
create policy "public projects readable by anyone"
  on projects for select using (is_public = true);

-- ============================================================
-- 002: Auth Profile Trigger (auto-create profile on signup)
-- ============================================================

-- Ensure newly registered users get a profile row with the free-tier quota defaults.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Beta quota defaults are 5 free generations.
alter table public.profiles
  alter column generations_limit set default 5;

update public.profiles
set generations_limit = 5
where generations_limit <> 5;

-- ============================================================
-- 003: Generation Observability (status/stage/error/trace columns)
-- ============================================================

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

-- ============================================================
-- 004: Projects Public By Default
-- ============================================================

-- Make all projects shareable by default.
update projects
set is_public = true
where is_public is distinct from true;

alter table projects
  alter column is_public set default true;

-- ============================================================
-- 005: Remove Self-Update Policy on Profiles
-- ============================================================

-- Lock down profile updates from client-side roles.
-- Quota fields should only be changed by trusted backend/service-role operations.
drop policy if exists "users update own profile" on public.profiles;

-- ============================================================
-- 006: Append Chat Message RPC (atomic JSONB append)
-- ============================================================

-- Atomic JSONB append for chat history.
-- Replaces the read-modify-write pattern with a single atomic UPDATE.
-- Called from: backend/project_store.py::_append_chat_message_sync
create or replace function public.append_chat_message(
    p_project_id  uuid,
    p_user_id     uuid,
    p_message     jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update projects
    set
        chat_history = coalesce(chat_history, '[]'::jsonb) || jsonb_build_array(p_message),
        updated_at   = now()
    where id      = p_project_id
      and user_id = p_user_id;
end;
$$;

-- ============================================================
-- 007: Check and Reserve Quota RPC (atomic check-and-reserve)
-- ============================================================

-- Atomic quota check-and-reserve.
-- Replaces the two-step read-check + increment pattern that was vulnerable to TOCTOU races.
-- Called from: backend/quota.py::_check_and_reserve_quota_sync
create or replace function public.check_and_reserve_quota(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_used  integer;
    v_limit integer;
begin
    -- Atomically increment if quota is available.
    update profiles
    set generations_used = generations_used + 1
    where id             = p_user_id
      and generations_used < generations_limit
    returning generations_used, generations_limit
    into v_used, v_limit;

    if not found then
        -- Distinguish "quota exhausted" from "profile missing".
        select generations_used, generations_limit
        into v_used, v_limit
        from profiles
        where id = p_user_id;

        if not found then
            return jsonb_build_object(
                'ok',               false,
                'error',            'profile_not_found',
                'generations_used', 0,
                'generations_limit', 0
            );
        end if;

        return jsonb_build_object(
            'ok',               false,
            'error',            'quota_exhausted',
            'generations_used', v_used,
            'generations_limit', v_limit
        );
    end if;

    return jsonb_build_object(
        'ok',               true,
        'error',            null::text,
        'generations_used', v_used,
        'generations_limit', v_limit
    );
end;
$$;

-- ============================================================
-- 008: User LLM Keys Table (BYOK encryption storage)
-- ============================================================

create table if not exists user_llm_keys (
  id uuid default gen_random_uuid() primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openrouter', 'openai')),
  encrypted_key text not null,
  model text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id)
);

-- RLS
alter table user_llm_keys enable row level security;

-- Service role can do everything (backend uses service key)
drop policy if exists "Service role full access" on user_llm_keys;
create policy "Service role full access" on user_llm_keys
  for all using (true) with check (true);

-- ============================================================
-- 009: Project Mode Column (discovery vs default)
-- ============================================================

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

-- ============================================================
-- 009b: User LLM Keys Salt and Version (BYOK encryption v2)
-- ============================================================

-- Migration: add salt and encryption_version to user_llm_keys (issue 228)
-- Strengthen BYOK encryption with proper key derivation

-- Add per-user salt (nullable for backward compatibility with v1 keys)
alter table user_llm_keys
  add column if not exists salt text;

-- Add encryption version tracking (1 = legacy SHA256, 2 = PBKDF2)
alter table user_llm_keys
  add column if not exists encryption_version integer not null default 1;

-- Existing rows will have version=1 and salt=NULL, which triggers legacy decryption path
-- They are auto-migrated to v2 on the next read via get_user_llm_key()

-- ============================================================
-- 010: Project Templates Flag
-- ============================================================

alter table if exists projects
  add column if not exists is_template boolean not null default false;

create index if not exists idx_projects_is_template
  on projects (is_template);

-- ============================================================
-- 011: Project Last Opened At
-- ============================================================

alter table if exists projects
  add column if not exists last_opened_at timestamptz;

update projects
set last_opened_at = updated_at
where last_opened_at is null;

create index if not exists idx_projects_user_last_opened_at
  on projects (user_id, last_opened_at desc);

-- ============================================================
-- 012: Project Thumbnail URL
-- ============================================================

alter table if exists projects
  add column if not exists thumbnail_url text;

-- ============================================================
-- 013: Terraform Architecture Timestamps
-- ============================================================

-- Add timestamp columns to track when terraform and architecture were last generated/modified
-- This enables detection of "outdated" terraform/PDF when architecture changes

alter table projects add column if not exists terraform_generated_at timestamptz;
alter table projects add column if not exists architecture_modified_at timestamptz;

-- ============================================================
-- 014: Setup PDF Metadata
-- ============================================================

alter table if exists projects
  add column if not exists setup_pdf_status text not null default 'none',
  add column if not exists setup_pdf_url text,
  add column if not exists setup_pdf_storage_path text,
  add column if not exists setup_pdf_generated_at timestamptz,
  add column if not exists setup_pdf_source_revision text,
  add column if not exists setup_pdf_error text,
  add column if not exists setup_pdf_progress integer not null default 0;

create index if not exists idx_projects_setup_pdf_status on projects (setup_pdf_status);
