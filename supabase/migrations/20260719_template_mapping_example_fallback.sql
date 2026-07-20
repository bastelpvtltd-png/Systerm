-- Applied directly to the live project via the Supabase Management API --
-- kept here for history/reference, safe to re-run.
--
-- Per-field mapping metadata for Google Sheet templates: example_value is
-- purely informational (never enforced, never blocks Save if left blank —
-- just a hint shown to whoever configures the template). empty_fallback is
-- what actually gets written to the sheet cell when the real data is
-- missing/blank (defaults to '' — an empty string — matching existing
-- behavior when no fallback is configured).

alter table template_mappings add column if not exists example_value text;
alter table template_mappings add column if not exists empty_fallback text;
