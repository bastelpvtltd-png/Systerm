-- Applied directly to the live project via the Supabase Management API —
-- kept here for history/reference, safe to re-run.
--
-- Pick/lock columns for temporary_shipments, mirroring the existing
-- document pick system (dashboard_notifications/user_tasks/pick_history_log)
-- but scoped directly on the row since a shipment entry isn't a
-- document_uploads row. Claimed atomically via
-- `UPDATE ... WHERE id=? AND locked_by IS NULL` — see /api/pick-shipment.ts.

alter table temporary_shipments add column if not exists locked_by uuid;
alter table temporary_shipments add column if not exists locked_by_name text;
alter table temporary_shipments add column if not exists locked_at timestamptz;
