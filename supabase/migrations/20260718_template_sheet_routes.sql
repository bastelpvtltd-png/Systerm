-- Applied directly to the live project via the Supabase Management API —
-- kept here for history/reference, safe to re-run.
--
-- Per-shipper sheet routing for Google Sheet templates: a field-mapping
-- "Sheet" and the Print Settings "Print Tab (sheet)" used to be one fixed
-- value for every generation. This lets different TIN VAT numbers (unique,
-- unlike exporter name spelling) route to different physical sheet tabs in
-- the same spreadsheet — e.g. Exporter A's CUSDECs fill/print on "Sheet1",
-- Exporter B's on "Sheet2". sheet_gid (the tab's stable Sheets ID) is stored
-- rather than the display name so renaming a tab in Google Sheets doesn't
-- silently break a route — the name is always re-resolved live from gid.

create table if not exists template_sheet_routes (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references doc_templates(id) on delete cascade,
  route_type text not null check (route_type in ('fill', 'print')),
  sheet_gid text not null,
  sheet_name text not null,
  tin_vat_list text[] not null default '{}',
  created_at timestamptz default now()
);

create index if not exists template_sheet_routes_template_id_idx on template_sheet_routes(template_id);
