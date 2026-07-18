-- Applied directly to the live project via the Supabase Management API —
-- kept here for history/reference, safe to re-run.
--
-- Generic "one saved link per (CUSDEC, document_type)" table — the same
-- role cusdec.boat_note_url / cusdec.party_copy_url / cusdec.invoice_drive_url
-- already play for their own fixed types, but for Invoice/Packing List's new
-- template flow and every dynamic custom document type (CO, Phyto, any
-- "+ Add New Document Type") there's no dedicated column to add per type.
-- A new Save replaces the row (old Drive file deleted, new link written) —
-- see /api/save-document-link.ts — so there's always at most one link per
-- (cusdec_id, document_type).

create table if not exists cusdec_document_links (
  id uuid primary key default gen_random_uuid(),
  cusdec_id uuid not null references cusdec(id) on delete cascade,
  document_type text not null,
  drive_url text not null,
  file_name text,
  updated_at timestamptz default now(),
  unique (cusdec_id, document_type)
);
