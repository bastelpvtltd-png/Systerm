-- Applied directly to the live project via the Supabase Management API —
-- kept here for history/reference, safe to re-run.
--
-- Adds support for XML and Text templates alongside the existing
-- Google Sheets templates (doc_templates was Sheets-only until now,
-- always requiring a template_url). XML/Text templates have no
-- spreadsheet — their raw {{field_label}} template body is typed
-- directly on the Templates page and stored in template_content;
-- generation does simple placeholder substitution instead of a Sheets
-- export.

alter table doc_templates add column if not exists template_format text not null default 'google_sheet';
alter table doc_templates add column if not exists template_content text;

-- template_url is currently NOT NULL (Sheets-only) — XML/Text templates
-- don't have one, so it needs to become optional.
alter table doc_templates alter column template_url drop not null;
