-- =============================================
-- PHASE 6 MIGRATION — Boat Note "Save Only" support
-- Already applied directly to the live "systerm" project via the Supabase
-- Management API — kept here for history/reference, safe to re-run.
-- =============================================

alter table cusdec add column if not exists boat_note_drive_url text;
alter table cusdec add column if not exists boat_note_saved_at timestamptz;

-- "Done Boat Note" archive — one row per Boat Note ever saved (via Save Only)
create table if not exists generated_boat_notes (
  id uuid primary key default gen_random_uuid(),
  cusdec_id uuid,
  cusdec_number text,
  file_name text,
  drive_url text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz default now()
);
alter table generated_boat_notes enable row level security;
drop policy if exists "auth_all_generated_boat_notes" on generated_boat_notes;
create policy "auth_all_generated_boat_notes" on generated_boat_notes for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
