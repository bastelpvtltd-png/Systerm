-- Applied directly to the live project via the Supabase Management API —
-- kept here for history/reference, safe to re-run.
--
-- Seeds the "cdn_text" doc_templates row (format 'text') matching the
-- ASYCUDA "internal information" B_CDN dump format exactly, field-mapped
-- to cusdec/cdn columns so Docs Create's CDN Text tab (now the generic
-- CustomDocPanel — the bespoke CdnTextPanel component was removed) can
-- pull it straight from the database, or fill it by hand in Manual Entry.
-- Also backfills cusdec.declarant_code — the clearing agent's own fixed
-- registration number, identical across every declaration, confirmed from
-- two independent samples — for any row where it's still unset.

update cusdec set declarant_code = '1748813322525' where declarant_code is null or declarant_code = '';

with tpl as (
  insert into doc_templates (document_type, template_format, template_content, template_url, print_sheet_name, print_range, paper_size, orientation, fit_to_page, updated_at)
  values (
    'cdn_text', 'text',
    $CONTENT$===================================================
 DEFAULT INTERNAL INFORMATION FOR: un.asycdn B_CDN
===================================================

-=-=-=-= Form: Cargo Dispatch Note =-=-=-=-=
----------- Page 1: -----------
COD: {{CDN Office Code}}
YEA: {{CDN Year}}
SER: {{CDN Serial}}
NBR: {{CDN Number}}
COD: {{Declarant Ref Office Code}}
YEA: {{Declarant Ref Year}}
SER: {{Declarant Ref Serial}}
NBR: {{Declarant Ref Number}}
ADD: {{Exporter Address}}
ADD: {{Consignee Address}}
NBR: {{Linked CUSDEC Number}}
DAT: {{CDN Date}}
BOL: {{Bill of Lading No}}
DRV: {{Driver Name}}
CLN: {{Terminal}}
NBR: {{Lorry No}}
TRL: {{Trailer No}}
LOD: {{Loading Port}}
ULD: {{Discharge Port}}
EXV: {{Vessel}}
VSL: {{VOC}}
OPC: {{COC}}
SLP: {{SLPA No}}
NBR: {{Package No}}
TYP: {{Package Type}}
VOL: {{Volume}}
DSC: {{Goods Description}}
NBR: {{Container No}}
TYP: {{Container Type}}
SEA: {{Seal No}}
MRK: {{Marks}}
GWT: {{Gross Mass}}
TMP: ...
NAM: {{Prepared By}}
DAT: {{Approval Date}}
COD: {{Declarant Code}}
CNT: 1
$CONTENT$,
    null, null, null, 'A4', 'Portrait', true, now()
  )
  on conflict (document_type) do update set
    template_format = excluded.template_format,
    template_content = excluded.template_content,
    updated_at = now()
  returning id
),
cleared as (
  delete from template_mappings where template_id in (select id from tpl)
)
insert into template_mappings (template_id, field_label, data_source, column_name, is_repeating, target_cell_or_range, sheet_name)
select tpl.id, v.field_label, v.data_source, v.column_name, false, '', null
from tpl, (values
  ('CDN Office Code',            'cdn',    'cdn_no[1]'),
  ('CDN Year',                   'cdn',    'cdn_no[0]'),
  ('CDN Serial',                 'cdn',    'cdn_no[2]'),
  ('CDN Number',                 'cdn',    'cdn_no[3]'),
  ('Declarant Ref Office Code',  'manual', ''),
  ('Declarant Ref Year',         'manual', ''),
  ('Declarant Ref Serial',       'manual', ''),
  ('Declarant Ref Number',       'manual', ''),
  ('Exporter Address',           'cdn',    'shipper'),
  ('Consignee Address',          'cusdec', 'consignee'),
  ('Linked CUSDEC Number',       'cusdec', 'number'),
  ('CDN Date',                   'cdn',    'voyage_date'),
  ('Bill of Lading No',          'cdn',    'bl_no'),
  ('Driver Name',                'cdn',    'driver_name'),
  ('Terminal',                   'cdn',    'location'),
  ('Lorry No',                   'cdn',    'lorry_no'),
  ('Trailer No',                 'cdn',    'trailer_no'),
  ('Loading Port',               'cdn',    'loading_port'),
  ('Discharge Port',             'cdn',    'discharge_port'),
  ('Vessel',                     'cdn',    'vessel'),
  ('VOC',                        'cdn',    'voc'),
  ('COC',                        'cdn',    'coc'),
  ('SLPA No',                    'cdn',    'slpa_no'),
  ('Package No',                 'cdn',    'pkg_no'),
  ('Package Type',               'cdn',    'pkg_type'),
  ('Volume',                     'cdn',    'volume'),
  ('Goods Description',          'cdn',    'goods_description'),
  ('Container No',               'cdn',    'container_no'),
  ('Container Type',             'cdn',    'con_type'),
  ('Seal No',                    'cdn',    'seal_no'),
  ('Marks',                      'cdn',    'marks'),
  ('Gross Mass',                 'cdn',    'gross_mass'),
  ('Prepared By',                'manual', ''),
  ('Approval Date',              'cdn',    'approved_at'),
  ('Declarant Code',             'cusdec', 'declarant_code')
) as v(field_label, data_source, column_name);
