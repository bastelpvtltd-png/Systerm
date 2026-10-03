-- Run after the two earlier files. Screenshots/diagnostics for automation runs (shown as a
-- "screenshot" link in the Barcode Enter run list and in Dashboard > Automate Errors).
alter table public.automation_jobs add column if not exists screenshot text;
alter table public.automation_jobs add column if not exists has_screenshot boolean not null default false;
alter table public.automation_jobs add column if not exists debug text;
