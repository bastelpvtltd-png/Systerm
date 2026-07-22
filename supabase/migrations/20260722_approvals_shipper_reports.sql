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

create table if not exists balance_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_name text,
  drive_url text,
  range_label text,
  amount numeric,
  generated_at timestamptz default now()
);
