-- Applied directly to the live project via the Supabase Management API --
-- kept here for history/reference, safe to re-run.

create table if not exists other_work_types (
  id uuid primary key default gen_random_uuid(),
  label text unique not null,
  created_at timestamptz default now()
);
insert into other_work_types (label) values ('Panel'), ('Amendment'), ('Other') on conflict (label) do nothing;
