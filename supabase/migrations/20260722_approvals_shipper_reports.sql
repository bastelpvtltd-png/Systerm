-- Applied directly to the live project via the Supabase Management API --
-- kept here for history/reference, safe to re-run.

create table if not exists doc_approvals (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null,
  cusdec_id uuid,
  doc_type text,
  reason text,
  uploaded_by uuid,
  uploaded_by_name text,
  status text not null default 'pending',
  stage text not null default 'upload',
  created_at timestamptz default now(),
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz
);
create index if not exists doc_approvals_status_idx on doc_approvals(status);
create index if not exists doc_approvals_document_id_idx on doc_approvals(document_id);

alter table work_counts add column if not exists pytho_inc int default 0;
alter table work_counts add column if not exists co_inc int default 0;
alter table work_counts add column if not exists safta_inc int default 0;

alter table work_rates add column if not exists pytho_rate numeric default 0;
alter table work_rates add column if not exists co_rate numeric default 0;
alter table work_rates add column if not exists safta_rate numeric default 0;

alter table profiles add column if not exists is_shipper boolean default false;
alter table profiles add column if not exists shipper_name text;

create table if not exists app_settings (
  key text primary key,
  value text
);

alter table salary_payments add column if not exists note text;

-- Monthly Report generation used to never reset anything — every report
-- re-summed the user's ENTIRE work_counts/other_work history, papering over
-- it with a synthetic self-payment row. `reported` archives exactly the
-- rows a given report actually summarized, so the next period starts at
-- zero without losing history (unreported rows keep accumulating normally).
alter table work_counts add column if not exists reported boolean default false;
alter table other_work add column if not exists reported boolean default false;
alter table balance_reports add column if not exists status text default 'received';

-- Boat Note completions (merge-and-pick, reason 'Boat Note Passed') had no
-- work_counts column of their own and were never gated by doc_approvals —
-- silently credited nothing. boat_cap is a separate, manually-set expected
-- count for boat-note billing, distinct from cusdec.cap (CDN-completeness gate).
alter table work_counts add column if not exists boat_note_inc int default 0;
alter table work_rates add column if not exists boat_note_rate numeric default 0;
alter table cusdec add column if not exists boat_cap text;

-- Barcode never had its own boat_note_passed/export_release_passed columns —
-- the manual color-set on a CUSDEC row (database.tsx) only ever cascaded to
-- its CDN rows, never to barcode, even though barcode is linked the exact
-- same way (via container_no, see cascadeDeleteCdn in docTables.ts).
alter table barcode add column if not exists boat_note_passed boolean default false;
alter table barcode add column if not exists export_release_passed boolean default false;

create table if not exists balance_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_name text,
  drive_url text,
  range_label text,
  amount numeric,
  generated_at timestamptz default now()
);
