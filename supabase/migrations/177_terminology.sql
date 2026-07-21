-- =====================================================================
-- m177 — Centralized terminology (fixed translations) for the Mapping
--        administration.
-- =====================================================================
--
-- The factory-facing vocabulary lived in two disconnected places: 36
-- terms centralized in lib/production-dossier.ts, and ~90 more typed by
-- hand INLINE in components/ProductionDossierPDF.tsx. Nothing was ever
-- machine-translated — but nothing protected the vocabulary either, and
-- the same concept had already drifted on the ENGLISH side:
--
--     数量   → "Qty" in three tables, "Quantity" in a fourth
--     备注   → "Note" in two tables, "Notes" in two others
--     运输方式 → "Shipping" in the header, "Shipping method" in transport
--
-- This table is the single source of truth. Every fixed term gets a
-- stable key, an English value (mandatory), a Chinese value, an optional
-- French value, a category, an editorial status and full audit
-- (updated_at / updated_by). Managed in Admin → Terminology by holders
-- of the `terminology.manage` capability (super_admin + Task List
-- Manager, owner decision 2026-07-21).
--
-- FALLBACK ORDER (lib/terminology.ts resolveTerm):
--   1. the VALIDATED row here
--   2. the built-in default shipped in lib/terminology.ts
--   3. the English value
--   4. the key itself — a factory document never renders a blank label
--
-- Only `validated` rows are rendered: a draft falls back to English so
-- half-finished Chinese can never reach a factory. There is no automatic
-- translation anywhere in this system and this migration introduces
-- none — an unvalidated term degrades to English, never to a guess.
--
-- The seed below is generated FROM lib/terminology.ts, so the built-in
-- catalog and the table start identical (130 rows, all owner-validated
-- vocabulary already in production). The app is DORMANT before this
-- migration: every read falls back to the built-in catalog.
--
-- Idempotent. Safe to re-run. Apply manually in the Supabase SQL editor.
-- =====================================================================

begin;

create table if not exists public.terminology (
  key         text primary key,
  category    text not null default 'field',
  en          text not null,
  zh          text,
  fr          text,
  status      text not null default 'draft',
  notes       text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

create index if not exists terminology_category_idx
  on public.terminology(category, key);

alter table public.terminology enable row level security;

-- Read: any authenticated user. The vocabulary renders on the task list,
-- the exports and the factory dossier — everyone who sees those needs it.
drop policy if exists "terminology read" on public.terminology;
create policy "terminology read" on public.terminology
  for select to authenticated using (true);

-- Write: the capability holders only (super_admin floor + the roles a
-- super-admin grants in /permissions). Enforced again server-side via
-- requireCapability("terminology.manage") — RLS is the backstop.
drop policy if exists "terminology write" on public.terminology;
create policy "terminology write" on public.terminology
  for all to authenticated
  using (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and (coalesce(r.super_admin, false)
              or r.role in ('admin', 'task_list_manager'))
    )
  )
  with check (
    exists (
      select 1 from user_roles r
       where r.user_id = auth.uid()
         and (coalesce(r.super_admin, false)
              or r.role in ('admin', 'task_list_manager'))
    )
  );

-- Capability (catalogued in lib/capabilities.ts as `terminology.manage`).
insert into permissions (key, category, label, description, sort_order) values
  ('terminology.manage', 'Admin', 'Manage terminology (fixed translations)',
   'Edit the centralized EN/ZH/FR vocabulary used by the Task List, the exports and the factory dossier. Validated terms are fixed controlled values — nothing retranslates them.', 95)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  -- floor in code, marked here for the matrix + clarity
  ('super_admin',       'terminology.manage', true),
  ('admin',             'terminology.manage', true),
  -- the owner's decision: the Task List Manager owns factory vocabulary
  ('task_list_manager', 'terminology.manage', true),
  -- explicit OFF (deliberate, visible in the matrix)
  ('sales',             'terminology.manage', false),
  ('sales_director',    'terminology.manage', false),
  ('operations',        'terminology.manage', false),
  ('finance',           'terminology.manage', false)
on conflict (role, permission_key) do nothing;

-- Seed — generated from lib/terminology.ts (TERM_DEFAULTS). These are the
-- terms already in production, so applying this migration changes NOTHING
-- visually; it only makes them editable. `do nothing` on conflict: a term a
-- human has since edited is never overwritten by a re-run.
insert into public.terminology (key, category, en, zh, status) values
  ('section.dossier', 'section', 'Production Dossier', '生产档案', 'validated'),
  ('section.customer', 'section', 'Customer Information', '客户信息', 'validated'),
  ('section.project', 'section', 'Project Information', '项目信息', 'validated'),
  ('section.order_summary', 'section', 'Order Summary', '订单摘要', 'validated'),
  ('section.production_notes', 'section', 'Production Notes', '生产说明', 'validated'),
  ('section.product_configuration', 'section', 'Product Configuration', '产品配置', 'validated'),
  ('section.factory_mapping', 'section', 'Factory Mapping', '工厂映射', 'validated'),
  ('section.factory_instructions', 'section', 'Factory Instructions', '工厂生产说明', 'validated'),
  ('section.battery', 'section', 'Battery Information', '电池信息', 'validated'),
  ('section.battery_type', 'section', 'Battery Type', '电池类型', 'validated'),
  ('section.technical_refs', 'section', 'Technical References', '技术参数', 'validated'),
  ('section.factory_extras', 'section', 'Additional Factory Parameters', '工厂附加参数', 'validated'),
  ('section.lighting_program', 'section', 'Lighting Program', '灯光程序', 'validated'),
  ('section.energy', 'section', 'Energy Configuration', '能源配置', 'validated'),
  ('section.stickers', 'section', 'Stickers', '标签信息', 'validated'),
  ('section.industrial_file', 'section', 'Industrial Production File', '工业生产规格', 'validated'),
  ('section.tilt_angle', 'section', 'Solar Panel Tilt Angle', '太阳能板倾角', 'validated'),
  ('section.pole_accessories', 'section', 'Pole Accessories', '灯杆配件', 'validated'),
  ('section.packaging', 'section', 'Packaging', '包装要求', 'validated'),
  ('section.user_manual', 'section', 'User Manual', '用户手册', 'validated'),
  ('section.spare_parts', 'section', 'Spare Parts', '备品备件', 'validated'),
  ('section.transport', 'section', 'Transport Information', '运输信息', 'validated'),
  ('section.quality', 'section', 'Quality Control', '质量控制', 'validated'),
  ('section.internal_notes', 'section', 'Internal Notes', '内部备注', 'validated'),
  ('section.uploads', 'section', 'Uploaded Documents', '上传文件', 'validated'),
  ('section.appendix', 'section', 'Appendix', '附录', 'validated'),
  ('section.contents', 'section', 'Contents', '文件目录', 'validated'),
  ('section.dimming_schedule', 'section', 'Dimming schedule', '调光程序', 'validated'),
  ('section.dialux_configs', 'section', 'DIALux production configurations', 'DIALux 生产配置', 'validated'),
  ('field.client', 'field', 'Client', '客户', 'validated'),
  ('field.country', 'field', 'Country', '国家', 'validated'),
  ('field.contact', 'field', 'Contact', '联系人', 'validated'),
  ('field.order_reference', 'field', 'Order reference', '订单编号', 'validated'),
  ('field.task_list', 'field', 'Task list', '任务单编号', 'validated'),
  ('field.status', 'field', 'Status', '状态', 'validated'),
  ('field.created', 'field', 'Created', '创建日期', 'validated'),
  ('field.created_by', 'field', 'Created by', '创建人', 'validated'),
  ('field.validated_by', 'field', 'Validated by', '审核人', 'validated'),
  ('field.validated_on', 'field', 'Validated on', '审核日期', 'validated'),
  ('field.shipping_method', 'field', 'Shipping method', '运输方式', 'validated'),
  ('field.generated', 'field', 'Generated', '生成日期', 'validated'),
  ('field.original_sales_request', 'field', 'Original sales request', '客户原始需求', 'validated'),
  ('field.production_notes_sales', 'field', 'Production notes (from sales)', '销售生产说明', 'validated'),
  ('field.manual_specs', 'field', 'Specifications (manual item)', '产品规格（非标准件）', 'validated'),
  ('field.line_notes', 'field', 'Line notes', '产线备注', 'validated'),
  ('field.accessory_notes', 'field', 'Accessory notes', '配件备注', 'validated'),
  ('field.packaging_version', 'field', 'Packaging version', '包装版本', 'validated'),
  ('field.packaging_notes', 'field', 'Packaging notes', '包装备注', 'validated'),
  ('field.manual_version', 'field', 'Manual version', '手册版本', 'validated'),
  ('field.languages', 'field', 'Languages', '语言', 'validated'),
  ('field.manual_notes', 'field', 'Manual notes', '手册备注', 'validated'),
  ('field.lighting_power', 'field', 'Lighting power', '额定功率', 'validated'),
  ('field.operating_hours', 'field', 'Operating hours / night', '每晚工作时长', 'validated'),
  ('field.approved_optics', 'field', 'Approved optics', '配光透镜', 'validated'),
  ('field.energy_study', 'field', 'Energy study', '能耗报告', 'validated'),
  ('field.dialux_report', 'field', 'DIALux report', 'DIALux 报告', 'validated'),
  ('field.sticker_notes', 'field', 'Sticker notes', '标签总备注', 'validated'),
  ('field.incoterm', 'field', 'Incoterm', '贸易条款', 'validated'),
  ('field.freight_type', 'field', 'Freight type', '货运类型', 'validated'),
  ('field.port_of_loading', 'field', 'Port of loading', '装运港', 'validated'),
  ('field.port_of_destination', 'field', 'Port of destination', '目的港', 'validated'),
  ('field.production_time', 'field', 'Production time', '生产周期', 'validated'),
  ('field.quality_risk_notes', 'field', 'Quality & risk notes', '质量与风险备注', 'validated'),
  ('field.technical_notes_internal', 'field', 'Technical notes (internal)', '内部技术备注', 'validated'),
  ('field.battery_type', 'field', 'Battery Type', '电池类型', 'validated'),
  ('field.factory_code', 'field', 'Factory code', '工厂代码', 'validated'),
  ('field.customer_naming', 'field', 'Customer', '客户命名', 'validated'),
  ('table.qty', 'table', 'Qty', '数量', 'validated'),
  ('table.note', 'table', 'Notes', '备注', 'validated'),
  ('table.field', 'table', 'Field', '配置项', 'validated'),
  ('table.value', 'table', 'Value', '参数值', 'validated'),
  ('table.product', 'table', 'Product', '产品', 'validated'),
  ('table.category', 'table', 'Category', '系列', 'validated'),
  ('table.main_configuration', 'table', 'Main configuration', '主要配置', 'validated'),
  ('table.accessory', 'table', 'Accessory', '配件', 'validated'),
  ('table.included', 'table', 'Included', '是否包含', 'validated'),
  ('table.part', 'table', 'Part', '部件', 'validated'),
  ('table.model', 'table', 'Model', '型号', 'validated'),
  ('table.factory_name', 'table', 'Factory name', '工厂命名', 'validated'),
  ('table.period', 'table', 'Period', '时段', 'validated'),
  ('table.output', 'table', 'Output', '输出', 'validated'),
  ('table.duration', 'table', 'Duration', '时长', 'validated'),
  ('table.motion_sensor', 'table', 'Motion sensor', '感应模式', 'validated'),
  ('table.zone', 'table', 'Zone', '区域', 'validated'),
  ('table.power_w', 'table', 'W', '功率', 'validated'),
  ('table.mounting_height', 'table', 'H (m)', '安装高度', 'validated'),
  ('table.optic', 'table', 'Optic', '光学', 'validated'),
  ('table.cct', 'table', 'CCT', '色温', 'validated'),
  ('table.sticker_item', 'table', 'Item', '标签', 'validated'),
  ('table.method', 'table', 'Method', '工艺', 'validated'),
  ('table.branding', 'table', 'Branding', '品牌', 'validated'),
  ('table.position', 'table', 'Position', '位置', 'validated'),
  ('table.ref', 'table', 'Ref', '编号', 'validated'),
  ('table.file', 'table', 'File', '文件', 'validated'),
  ('table.type', 'table', 'Type', '类型', 'validated'),
  ('table.status', 'table', 'Status', '状态', 'validated'),
  ('status.included', 'status', 'Included', '包含', 'validated'),
  ('status.excluded', 'status', 'EXCLUDED', '不包含', 'validated'),
  ('status.laser', 'status', 'Laser', '激光', 'validated'),
  ('status.sticker', 'status', 'Sticker', '贴纸', 'validated'),
  ('status.branding_customer', 'status', 'Customer', '客户', 'validated'),
  ('status.fixed_level', 'status', 'Fixed level', '固定输出', 'validated'),
  ('status.in_appendix', 'status', 'Included in appendix', '已合并至附录', 'validated'),
  ('status.provided_separately', 'status', 'Provided separately', '另行提供', 'validated'),
  ('status.motion_boost', 'status', 'boost to', '感应加亮至', 'validated'),
  ('notice.complete_package', 'notice', 'Complete production package', '工厂完整生产文件', 'validated'),
  ('notice.manual_item_no_catalog', 'notice', 'Manual item — no catalog configuration.', '非标准产品 — 无目录配置', 'validated'),
  ('notice.no_sales_fields', 'notice', 'No sales fields recorded for this line.', '无销售配置记录', 'validated'),
  ('notice.no_factory_mapped_fields', 'notice', 'No factory-mapped fields on this line.', '无需工厂映射', 'validated'),
  ('notice.missing_factory_mapping', 'notice', 'Missing factory mapping — resolve in Admin → Factory mapping or set a line override.', '缺少工厂映射', 'validated'),
  ('notice.tilt_checked', 'notice', 'Pole drawing checked against the required tilt angle', '灯杆图纸倾角已核对', 'validated'),
  ('notice.tilt_not_checked', 'notice', 'Pole drawing NOT yet checked against the required tilt angle — confirm before production.', '灯杆图纸倾角未核对', 'validated'),
  ('notice.packaging_artwork_appendix', 'notice', 'Customer packaging artwork, if uploaded, is included in the Appendix.', '客户包装图稿见附录', 'validated'),
  ('notice.manual_artwork_appendix', 'notice', 'Customer manual artwork, if uploaded, is included in the Appendix.', '客户手册图稿见附录', 'validated'),
  ('notice.no_stickers', 'notice', 'No sticker requirements.', '无标签要求', 'validated'),
  ('notice.sticker_artwork_appendix', 'notice', 'Sticker artwork files, if uploaded, are included in the Appendix.', '标签图稿见附录', 'validated'),
  ('notice.no_uploads', 'notice', 'No documents uploaded for this project.', '本项目无上传文件', 'validated'),
  ('notice.appendix_preamble', 'notice', 'The following appendix pages contain the uploaded project documents in full, in reference order (A1, A2…). This dossier is the complete production package.', '以下附录页为项目上传文件的完整内容，按编号顺序排列（A1、A2…）。本档案为工厂唯一生产依据。', 'validated'),
  ('enum.packaging.neutral', 'enum', 'Neutral version (no logo)', '中性包装（无标识）', 'validated'),
  ('enum.packaging.solux_standard', 'enum', 'Standard SOLUX version', 'SOLUX 标准包装', 'validated'),
  ('enum.packaging.french_branch', 'enum', 'French Branch Exclusive version', '法国分公司专用包装', 'validated'),
  ('enum.packaging.custom_client', 'enum', 'Customized Client version (customer logo + design files)', '客户定制包装（需客户标识及设计文件）', 'validated'),
  ('enum.manual_brand.solux', 'enum', 'SOLUX branded manual', 'SOLUX 品牌手册', 'validated'),
  ('enum.manual_brand.neutral', 'enum', 'Neutral manual (no brand)', '中性手册（无品牌）', 'validated'),
  ('enum.manual_brand.custom', 'enum', 'Customized customer manual (customer artwork)', '客户定制手册（客户提供图稿）', 'validated'),
  ('enum.manual_language.en', 'enum', 'English', '英文', 'validated'),
  ('enum.manual_language.fr', 'enum', 'French', '法文', 'validated'),
  ('enum.manual_language.ar', 'enum', 'Arabic', '阿拉伯文', 'validated'),
  ('factory_instruction.final', 'factory_instruction', 'Final factory instruction', '最终生产指令', 'validated'),
  ('factory_instruction.standard_overridden', 'factory_instruction', 'Standard mapping (replaced by override)', '标准映射（已被覆盖）', 'validated')
on conflict (key) do nothing;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('177_terminology.sql',
        'Centralized terminology (fixed translations): public.terminology (key/category/en/zh/fr/status/notes/updated_at/updated_by) + terminology.manage capability (super_admin + admin + task_list_manager) + 130-row seed generated from lib/terminology.ts. Validated rows override the built-in catalog; drafts fall back to English. No automatic translation anywhere.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   select count(*) from public.terminology;                    -- 130
--   select category, count(*) from public.terminology group by 1 order by 1;
--   select key, en, zh from public.terminology
--    where key in ('table.qty','table.note','field.shipping_method');
--   -- terms still awaiting a validated Chinese value
--   select key, en from public.terminology
--    where status <> 'validated' or zh is null or zh = '';
-- ---------------------------------------------------------------------
