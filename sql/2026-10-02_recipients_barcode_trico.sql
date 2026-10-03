-- Run once in the Supabase SQL editor.

-- 1) Per-user saved mail recipients (To / Cc / Bcc) -------------------------
create table if not exists public.user_saved_recipients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  email text not null,
  kind text not null check (kind in ('to','cc','bcc')),
  created_at timestamptz not null default now(),
  unique (user_id, email, kind)
);
create index if not exists user_saved_recipients_user_idx on public.user_saved_recipients (user_id);

-- 2) Which Navis / SLPA / Trico login a shipper uses ------------------------
create table if not exists public.shipper_portal_credentials (
  shipper_key text primary key,            -- lower-cased first line of the shipper name
  shipper_name text not null,
  navis_credential_id uuid,
  slpa_credential_id uuid,
  trico_credential_id uuid,
  updated_at timestamptz not null default now()
);

-- 3) Job queue for the browser worker (Barcode Enter / Trico Gate Pass) -----
create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('barcode_enter','trico_gate_pass')),
  cdn_id uuid not null,
  container_no text,
  cusdec_number text,
  shipper text,
  status text not null default 'queued'
    check (status in ('queued','running','done','failed','cancelled')),
  step text,                               -- navis | slpa | finalize | trico
  attempts int not null default 0,
  error text,
  result jsonb,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists automation_jobs_kind_status_idx on public.automation_jobs (kind, status);
create index if not exists automation_jobs_cdn_idx on public.automation_jobs (cdn_id);

-- 4) Gate data on the CDN rows (Trico Checking fills these) ------------------
alter table public.cdn add column if not exists gate_add_time text;
alter table public.cdn add column if not exists gate_in_time text;
alter table public.cdn add column if not exists gate_out_time text;
alter table public.cdn add column if not exists trico_checked_at timestamptz;
alter table public.cdn add column if not exists trico_check_note text;

-- 5) Scheduler row for Trico Checking (starts PAUSED) ------------------------
insert into public.automation_runs (panel, interval_minutes, enabled)
select 'trico_check', 60, false
where not exists (select 1 from public.automation_runs where panel = 'trico_check');
