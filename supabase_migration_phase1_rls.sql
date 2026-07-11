-- =============================================
-- PHASE 1 MIGRATION — Pick History delete + RLS backstop
-- Run this in Supabase SQL Editor (project: systerm / cxbvfvsbcdvaoinvalqv)
-- =============================================
--
-- Scope note: this migration only touches `pick_history_log` and
-- `deleted_records`. Both are confirmed (by grepping the whole src/ tree)
-- to be read/written ONLY from Next.js API routes using the service-role
-- key — never directly from the browser with the anon key — so enabling
-- RLS here cannot break any existing page.
--
-- Other tables the app uses (cusdec, cdn, boat_notes, uploaded_documents,
-- pdf_templates, document_templates, automation_credentials, messages)
-- were deliberately NOT touched in this pass: `messages` in particular IS
-- read/written directly from the browser (src/pages/admin/messages.tsx,
-- both a direct .insert() and a realtime postgres_changes subscription),
-- and the others haven't been checked against the LIVE schema/columns —
-- enabling RLS on them without first confirming every legitimate access
-- path risks breaking a working page in production. Do that as a separate,
-- supervised pass once the real schema can be inspected directly (e.g. by
-- connecting a Supabase MCP session to the "systerm" project specifically).
--
-- The actual access-control fix for "admin-only delete" already landed in
-- the API layer itself (requireSection()/requireAdmin() checks in
-- admin-data.ts, recycle-bin.ts, pick-history.ts) — that's the real gate.
-- This migration is a defense-in-depth backstop in case those tables are
-- ever queried directly with a leaked anon/user JWT.

alter table pick_history_log enable row level security;
alter table deleted_records enable row level security;

-- Idempotent: drop-then-create so this migration can be re-run safely.
drop policy if exists "admin_all_pick_history_log" on pick_history_log;
create policy "admin_all_pick_history_log" on pick_history_log for all
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true))
  with check (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

drop policy if exists "admin_all_deleted_records" on deleted_records;
create policy "admin_all_deleted_records" on deleted_records for all
  using (exists (select 1 from profiles where id = auth.uid() and is_admin = true))
  with check (exists (select 1 from profiles where id = auth.uid() and is_admin = true));

-- Note: these policies check is_admin only (full admin), not the granular
-- section:pick-history.delete / section:database.delete grants the API
-- layer supports — Postgres RLS policies can't easily read a jsonb/array
-- "allowed_tabs" column with the same semantics as the app's usePermission()
-- helper without a custom function. Since this is a backstop (the real gate
-- is server-side), the slightly coarser is_admin-only check here is
-- intentional and fine: a non-admin who's been granted the section key can
-- still delete through the app's API (which runs as service-role and
-- bypasses RLS entirely), they just couldn't do it via a raw anon-key
-- request even with a valid section grant. That's an acceptable trade-off
-- for a fallback layer.
