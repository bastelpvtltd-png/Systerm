-- =============================================
-- PHASE 7 MIGRATION — Vessel Trigger module
-- Already applied directly to the live "systerm" project via the Supabase
-- Management API — kept here for history/reference, safe to re-run.
-- =============================================

create table if not exists vessel_triggers (
  id uuid primary key default gen_random_uuid(),
  terminal text,
  vessel text not null,
  voyage text not null,
  opening_time text,
  closing_time text,
  etb text,
  last_update text,
  updated_at timestamptz default now(),
  unique(vessel, voyage)
);
alter table vessel_triggers enable row level security;
drop policy if exists "auth_all_vessel_triggers" on vessel_triggers;
create policy "auth_all_vessel_triggers" on vessel_triggers for all
  using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

alter table automation_runs drop constraint if exists automation_runs_panel_check;
alter table automation_runs add constraint automation_runs_panel_check
  check (panel in ('boat_note', 'export_release', 'vessel_trigger'));

insert into automation_runs (panel, interval_minutes, enabled)
values ('vessel_trigger', 60, true)
on conflict (panel) do nothing;
