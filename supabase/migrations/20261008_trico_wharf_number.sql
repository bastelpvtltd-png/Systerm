-- Per-user Trico Wharf Clerk phone number (Settings -> Users -> "Trico Wharf Number").
-- Used by the Trico Gate Pass Enter automation to pick the matching "wc_list"
-- option on Trico's New Export Gate Pass form for whoever queued the job.
alter table profiles add column if not exists trico_wharf_number text;
