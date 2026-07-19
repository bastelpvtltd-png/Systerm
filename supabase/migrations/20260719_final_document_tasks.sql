-- Applied directly to the live project via the Supabase Management API --
-- kept here for history/reference, safe to re-run.
--
-- Pending "Final Document" approval queue: sending a generated document
-- (CO, Phyto, SAFTA, or any future custom type) via SendModal with reason
-- "Final Document" creates a row here. It shows on the Dashboard's
-- "Pending Final Document" panel for any user to Pick, then only the
-- picker can Reject (deletes the Drive file + clears the saved
-- cusdec_document_links row so it can be regenerated from scratch) or
-- Done (uploads a scanned signed/stamped PDF that replaces the file at
-- the same link).

create table if not exists final_document_tasks (
  id uuid primary key default gen_random_uuid(),
  cusdec_id uuid not null references cusdec(id) on delete cascade,
  cusdec_number text,
  document_type text not null,
  drive_url text not null,
  file_name text,
  status text not null default 'pending',
  created_by uuid,
  created_by_name text,
  created_at timestamptz default now(),
  picked_by uuid,
  picked_by_name text,
  picked_at timestamptz,
  resolved_at timestamptz,
  document_id uuid references document_uploads(id) on delete set null
);

create index if not exists final_document_tasks_status_idx on final_document_tasks (status);
create index if not exists final_document_tasks_cusdec_idx on final_document_tasks (cusdec_id);

-- document-uploads.ts now accepts an optional cusdec_id from the caller so
-- a "Final Document" send can be linked back to its CUSDEC + document type.
alter table document_uploads add column if not exists cusdec_id uuid references cusdec(id) on delete set null;
