-- Run after 2026-10-02_recipients_barcode_trico.sql
-- Where/why an automation job failed (shown in Dashboard > Automate Errors).
alter table public.automation_jobs add column if not exists error_step text;   -- prepare | navis | slpa | finalize | trico
alter table public.automation_jobs add column if not exists error_field text;  -- e.g. 'Gross Mass', 'Vessel / Voyage', 'Seal Number'
alter table public.automation_jobs add column if not exists error_dismissed_at timestamptz;
