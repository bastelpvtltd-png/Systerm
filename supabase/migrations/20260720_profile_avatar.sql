-- Applied directly to the live project via the Supabase Management API --
-- kept here for history/reference, safe to re-run.

alter table profiles add column if not exists avatar_url text;
