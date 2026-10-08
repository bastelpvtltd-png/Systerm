-- Trico Wharf Clerk phone number, set per Trico login (Settings -> Credentials),
-- not per staff user — several people may queue jobs under the same shipper's
-- Trico account, and the wharf clerk belongs to that account/run, not the clicker.
-- Used by the Trico Gate Pass Enter automation to pick the matching "wc_list"
-- option on Trico's New Export Gate Pass form.
alter table automation_credentials add column if not exists wharf_number text;
