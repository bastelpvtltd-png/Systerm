-- Applied directly to the live project via the Supabase Management API --
-- kept here for history/reference, safe to re-run.

alter table cusdec add column if not exists row_color text;
