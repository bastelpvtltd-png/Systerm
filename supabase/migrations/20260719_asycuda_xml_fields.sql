-- Applied directly to the live project via the Supabase Management API —
-- kept here for history/reference, safe to re-run.
--
-- Adds the CUSDEC columns needed to fully populate an ASYCUDA export
-- declaration XML (see src/lib/asycudaXml.ts / docs/AM.xml sample) via the
-- new "ASYCUDA CUSDEC XML" template format's field mapping — previously
-- only ~15 of the ~65 declaration fields had a real column to map to, the
-- rest silently stayed blank. All additive, all nullable text.

alter table cusdec add column if not exists assess_number text;
alter table cusdec add column if not exists assess_date text;
alter table cusdec add column if not exists receipt_number text;
alter table cusdec add column if not exists receipt_date text;
alter table cusdec add column if not exists declarant_code text;
alter table cusdec add column if not exists declarant_name text;
alter table cusdec add column if not exists country_first_destination text;
alter table cusdec add column if not exists trading_country text;
alter table cusdec add column if not exists destination_country_code text;
alter table cusdec add column if not exists destination_country_name text;
alter table cusdec add column if not exists border_info_identity text;
alter table cusdec add column if not exists delivery_terms text;
alter table cusdec add column if not exists place_of_loading_code text;
alter table cusdec add column if not exists place_of_loading_name text;
alter table cusdec add column if not exists bank_code text;
alter table cusdec add column if not exists bank_name text;
alter table cusdec add column if not exists bank_branch text;
alter table cusdec add column if not exists bank_reference text;
alter table cusdec add column if not exists payment_terms_code text;
alter table cusdec add column if not exists payment_terms_description text;
alter table cusdec add column if not exists mode_of_payment text;
alter table cusdec add column if not exists global_taxes text;
alter table cusdec add column if not exists total_taxes text;
alter table cusdec add column if not exists invoice_amount_lkr text;
alter table cusdec add column if not exists invoice_amount_usd text;
alter table cusdec add column if not exists licence_number text;
alter table cusdec add column if not exists licence_date text;
alter table cusdec add column if not exists marks1 text;
alter table cusdec add column if not exists marks2 text;
alter table cusdec add column if not exists package_kind_code text;
alter table cusdec add column if not exists package_kind_name text;
alter table cusdec add column if not exists preference_code text;
alter table cusdec add column if not exists procedure_code text;
alter table cusdec add column if not exists summary_declaration text;
alter table cusdec add column if not exists item_taxes_amount text;
alter table cusdec add column if not exists duty_amount_cc1 text;
alter table cusdec add column if not exists duty_amount_ced text;
