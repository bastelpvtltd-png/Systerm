-- =============================================
-- PHASE 4 MIGRATION — Automation Triggers scheduler
-- Already applied directly to the live "systerm" project via the Supabase
-- Management API — kept here for history/reference, safe to re-run (all
-- statements are idempotent).
-- =============================================

create table if not exists automation_runs (
  panel text primary key check (panel in ('boat_note', 'export_release')),
  interval_minutes integer not null default 60,
  last_run_at timestamptz,
  updated_at timestamptz default now()
);

insert into automation_runs (panel, interval_minutes)
values ('boat_note', 60), ('export_release', 60)
on conflict (panel) do nothing;

alter table automation_runs enable row level security;

drop policy if exists "admin_all_automation_runs" on automation_runs;
create policy "admin_all_automation_runs" on automation_runs for all
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true))
  with check (exists (select 1 from profiles where id = auth.uid() and is_admin = true));
