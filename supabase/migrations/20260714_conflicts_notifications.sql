-- ═══════════════════════════════════════════════════════════════════
-- Migration: Document Conflicts + In-App Notifications
-- Run once in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════

-- 1. Conflicts: tracks when an updated upload arrives for an already-picked doc
CREATE TABLE IF NOT EXISTS document_conflicts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  old_doc_id       uuid NOT NULL,   -- original document_uploads row (already picked)
  new_doc_id       uuid NOT NULL,   -- newly uploaded document_uploads row
  picked_by        uuid,            -- user_id who holds the old doc
  picked_by_name   text NOT NULL DEFAULT '',
  doc_type         text,
  ref_key          text,            -- container_no / cusdec number / whatever matched
  resolved         boolean NOT NULL DEFAULT false,
  resolved_by      uuid,
  resolution       text,            -- 'keep_old' | 'use_new' | 'both'
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);
CREATE INDEX IF NOT EXISTS doc_conflicts_new_idx ON document_conflicts(new_doc_id);
CREATE INDEX IF NOT EXISTS doc_conflicts_resolved_idx ON document_conflicts(resolved, created_at DESC);

-- 2. In-app notifications (per-user, not global like dashboard_notifications)
CREATE TABLE IF NOT EXISTS user_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type        text NOT NULL DEFAULT 'info',  -- 'conflict' | 'info' | 'warning'
  title       text NOT NULL DEFAULT '',
  body        text NOT NULL DEFAULT '',
  link_href   text,                          -- optional navigation target
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_notifs_user_idx ON user_notifications(user_id, read_at, created_at DESC);

-- RLS
ALTER TABLE document_conflicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Admins see all conflicts" ON document_conflicts
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

ALTER TABLE user_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users see own notifications" ON user_notifications
  FOR ALL USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Service role full access notifs" ON user_notifications
  FOR ALL USING (true);

SELECT 'conflicts + notifications migration complete' AS status;
