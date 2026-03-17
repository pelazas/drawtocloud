-- Atomic JSONB append for chat history.
--
-- Replaces the read-modify-write pattern in generation_service.append_chat_history
-- (read chat_history, append in Python, write back) with a single atomic UPDATE.
-- This prevents a lost-update race when two concurrent appends target the same
-- project row — relevant once multi-worker / Redis pub-sub support is added.
--
-- Called from: backend/project_store.py::_append_chat_message_sync
-- Args:
--   p_project_id  — projects.id
--   p_user_id     — projects.user_id  (ownership check)
--   p_message     — jsonb object e.g. {"role": "user", "content": "..."}

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
