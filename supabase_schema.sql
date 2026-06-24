-- =============================================
-- EXPORT MANAGEMENT SYSTEM - SUPABASE SCHEMA
-- Run this in Supabase SQL Editor
-- =============================================

-- USERS / PROFILES
create table profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  full_name text,
  role text check (role in ('admin','worker')) default 'worker',
  avatar_url text,
  created_at timestamptz default now()
);

-- LOGIN LOGS (IP tracking)
create table login_logs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles(id),
  username text,
  ip_address text,
  user_agent text,
  status text check (status in ('success','failed')),
  created_at timestamptz default now()
);

-- SHIPMENTS
create table shipments (
  id uuid default gen_random_uuid() primary key,
  shipment_no text unique not null,
  shipper_name text,
  shipper_address text,
  wharf text,
  driver_name text,
  driver_nic text,
  driver_phone text,
  vehicle_no text,
  status text check (status in ('pending','processing','released','completed')) default 'pending',
  created_by uuid references profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- INVOICES
create table invoices (
  id uuid default gen_random_uuid() primary key,
  shipment_id uuid references shipments(id) on delete cascade,
  invoice_no text,
  invoice_date date,
  amount numeric(12,2),
  currency text default 'USD',
  details jsonb,
  created_at timestamptz default now()
);

-- PACKING LISTS
create table packing_lists (
  id uuid default gen_random_uuid() primary key,
  shipment_id uuid references shipments(id) on delete cascade,
  items jsonb,
  total_packages int,
  total_weight numeric(10,2),
  created_at timestamptz default now()
);

-- CUSDEC
create table cusdec (
  id uuid default gen_random_uuid() primary key,
  shipment_id uuid references shipments(id) on delete cascade,
  cusdec_no text,
  xml_data text,
  pdf_url text,
  status text check (status in ('pending','submitted','approved')) default 'pending',
  created_at timestamptz default now()
);

-- BOAT NOTES
create table boat_notes (
  id uuid default gen_random_uuid() primary key,
  shipment_id uuid references shipments(id) on delete cascade,
  boat_note_no text,
  pdf_url text,
  details jsonb,
  created_at timestamptz default now()
);

-- CDN
create table cdn (
  id uuid default gen_random_uuid() primary key,
  shipment_id uuid references shipments(id) on delete cascade,
  cdn_no text,
  details jsonb,
  status text check (status in ('pending','completed')) default 'pending',
  created_at timestamptz default now()
);

-- TRICO
create table trico (
  id uuid default gen_random_uuid() primary key,
  shipment_id uuid references shipments(id) on delete cascade,
  trico_data jsonb,
  status text check (status in ('pending','processed')) default 'pending',
  created_at timestamptz default now()
);

-- DOCUMENTS (assessment slips, bank slips, etc.)
create table documents (
  id uuid default gen_random_uuid() primary key,
  shipment_id uuid references shipments(id) on delete cascade,
  doc_type text check (doc_type in ('assessment_slip','trico','bank_slip','other')),
  file_url text,
  file_name text,
  uploaded_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- FINANCIAL RECORDS
create table financials (
  id uuid default gen_random_uuid() primary key,
  shipment_id uuid references shipments(id) on delete cascade,
  worker_id uuid references profiles(id),
  description text,
  amount numeric(12,2),
  type text check (type in ('income','expense')),
  created_at timestamptz default now()
);

-- WORKER TASKS
create table worker_tasks (
  id uuid default gen_random_uuid() primary key,
  shipment_id uuid references shipments(id) on delete cascade,
  assigned_to uuid references profiles(id),
  task_type text,
  status text check (status in ('pending','done')) default 'pending',
  notes text,
  created_at timestamptz default now()
);

-- RLS POLICIES
alter table profiles enable row level security;
alter table login_logs enable row level security;
alter table shipments enable row level security;
alter table invoices enable row level security;
alter table packing_lists enable row level security;
alter table cusdec enable row level security;
alter table boat_notes enable row level security;
alter table cdn enable row level security;
alter table trico enable row level security;
alter table documents enable row level security;
alter table financials enable row level security;
alter table worker_tasks enable row level security;

-- Admin sees everything
create policy "Admin full access" on shipments for all using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
create policy "Workers see assigned" on worker_tasks for select using (
  assigned_to = auth.uid()
);
create policy "Users see own profile" on profiles for select using (auth.uid() = id);
create policy "Users update own profile" on profiles for update using (auth.uid() = id);
