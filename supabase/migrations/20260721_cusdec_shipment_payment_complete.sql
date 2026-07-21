-- Applied directly to the live project via the Supabase Management API --
-- kept here for history/reference, safe to re-run.

alter table cusdec add column if not exists shipment_complete boolean default false;
alter table cusdec add column if not exists shipment_complete_at timestamptz;
alter table cusdec add column if not exists payment_complete boolean default false;
alter table cusdec add column if not exists payment_complete_at timestamptz;
