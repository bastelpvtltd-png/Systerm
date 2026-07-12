-- =============================================
-- PHASE 8 MIGRATION — Reason-tagged Quick Upload
-- Already applied directly to the live "systerm" project via the Supabase
-- Management API — kept here for history/reference, safe to re-run.
-- =============================================

alter table document_uploads add column if not exists reason text;
alter table document_uploads add column if not exists reason_note text;
