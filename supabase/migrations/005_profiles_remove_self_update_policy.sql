-- Lock down profile updates from client-side roles.
-- Quota fields should only be changed by trusted backend/service-role operations.
drop policy if exists "users update own profile" on public.profiles;
