-- =============================================
-- PHASE 7 MIGRATION — notify tracking on Processed History (pick_history_log)
-- Already applied directly to the live "systerm" project via the Supabase
-- Management API — kept here for history/reference, safe to re-run.
-- =============================================

alter table pick_history_log add column if not exists pdf_notify_user text;
alter table pick_history_log add column if not exists notify_update_time timestamptz;
