-- New automation_runs panels for Boat Note Create / Party's Copy Create
-- (auto-generate + save the PDF for every Boat-Note-pending CUSDEC that
-- doesn't have one yet, skipping shippers Sheet Routing can't resolve).
-- Both start disabled — explicitly requested to stay OFF until turned on
-- by hand from Automation, same "Live/Paused" toggle the other panels use.
alter table automation_runs drop constraint if exists automation_runs_panel_check;
alter table automation_runs add constraint automation_runs_panel_check
  check (panel = any (array['boat_note', 'export_release', 'vessel_trigger', 'boat_note_create', 'party_copy_create']));

insert into automation_runs (panel, interval_minutes, enabled)
values
  ('boat_note_create', 60, false),
  ('party_copy_create', 60, false)
on conflict (panel) do nothing;
