-- Atomic quota check-and-reserve.
--
-- Replaces the two-step read-check + increment pattern that was vulnerable to
-- TOCTOU races under concurrent start_generation requests from the same user.
-- The entire check-and-increment is a single UPDATE transaction, so two
-- simultaneous requests cannot both pass the quota gate.
--
-- Behavior change vs. previous implementation:
--   Before: quota incremented only on successful generation completion.
--   After:  quota incremented at generation START (reservation semantics).
--           Failed/cancelled generations consume a quota slot.
--
-- Called from: backend/quota.py::_check_and_reserve_quota_sync
-- Args:
--   p_user_id — profiles.id
-- Returns: jsonb
--   { "ok": true,  "error": null,               "generations_used": N, "generations_limit": M }
--   { "ok": false, "error": "quota_exhausted",  "generations_used": N, "generations_limit": M }
--   { "ok": false, "error": "profile_not_found","generations_used": 0, "generations_limit": 0 }

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
