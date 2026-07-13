-- ═══════════════════════════════════════════════════════════════════
-- Migration: Work Counts + Trigger Log + Boat Note URL columns
-- Run once in Supabase SQL Editor → https://supabase.com/dashboard
-- ═══════════════════════════════════════════════════════════════════

-- 1. Work counts (CDN/Cusdec count tracking per user)
CREATE TABLE IF NOT EXISTS work_counts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES profiles(id) ON DELETE CASCADE,
  user_name    text NOT NULL DEFAULT '',
  document_id  uuid,
  file_name    text,
  reason       text,
  action       text NOT NULL,       -- 'mail' | 'download'
  cdn_inc      integer NOT NULL DEFAULT 0,
  cusdec_inc   integer NOT NULL DEFAULT 0,
  cap_inc      integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_counts_user_idx ON work_counts(user_id);
CREATE INDEX IF NOT EXISTS work_counts_date_idx ON work_counts(created_at DESC);

-- 2. Boat Note + Party's Copy URL stored on cusdec (no separate table)
ALTER TABLE cusdec ADD COLUMN IF NOT EXISTS boat_note_url         text;
ALTER TABLE cusdec ADD COLUMN IF NOT EXISTS boat_note_created_at  timestamptz;
ALTER TABLE cusdec ADD COLUMN IF NOT EXISTS party_copy_url        text;
ALTER TABLE cusdec ADD COLUMN IF NOT EXISTS party_copy_created_at timestamptz;

-- 3. Trigger log (boat note / export release / vessel trigger events)
CREATE TABLE IF NOT EXISTS trigger_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     text NOT NULL,       -- 'boat_note' | 'export_release' | 'vessel'
  cusdec_id      uuid,
  cusdec_number  text,
  user_id        uuid,
  user_name      text,
  fired_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trigger_log_event_idx ON trigger_log(event_type, fired_at DESC);

-- 4. RLS — allow authenticated users to read their own work_counts
ALTER TABLE work_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Users see own counts" ON work_counts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY IF NOT EXISTS "Service role full access wc" ON work_counts
  FOR ALL USING (true);

SELECT 'migration complete' AS status;
