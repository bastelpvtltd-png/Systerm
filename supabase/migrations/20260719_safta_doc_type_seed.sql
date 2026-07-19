-- Applied directly to the live project via the Supabase Management API --
-- kept here for history/reference, safe to re-run.
--
-- SAFTA didn't exist as a document type anywhere in the app (no BUILTIN_DOC_TYPES
-- entry, no Drive folder, no doc_templates row) — added alongside CO and Phyto
-- (which existed in code but had no doc_templates row either, so their
-- Templates page + Sheet Routing never had anything to configure). All three
-- default to Google Sheet format with a blank URL, ready for the admin to
-- paste each one's actual template URL in Templates.

insert into doc_templates (document_type, template_format, template_url)
values ('co', 'google_sheet', null), ('pytho', 'google_sheet', null), ('safta', 'google_sheet', null)
on conflict (document_type) do nothing;
