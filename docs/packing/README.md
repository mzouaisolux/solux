# Packing List Module — Phase 1 (isolated, in-repo)

A standalone Packing List calculation module living **inside** the ERP repo but
strictly isolated during Phase 1: dedicated `packing_*` tables, a
framework-independent engine, dedicated `/packing` routes, **local Supabase
only**, **Super-Admin only**, and **zero changes** to Sales / Operations / PI /
Quotation / SR / Transport workflows.

Future ERP integration only needs to connect existing ERP records to the module
— never a rewrite of the calculation engine.

---

## Architecture

```
lib/packing-core/            ← PURE ENGINE (no Next / Supabase / React / DB imports)
  types.ts                     contract — public I/O matches spec §19 exactly
  cbm.ts                       CBM = L·W·H/1e9 ; volumetric = CBM × factor
  carton.ts                    complete/incomplete cartons, packages, weights
  container.ts                 volume+weight recommendation (method-tagged)
  fill.ts                      "products you could add" — integer, BOM, mixed (RULE_BASED)
  placement3d.ts               3D placement INTERFACE + honest stub (Phase 3, isolated)
  pole.ts                      lamp-pole detection + ">5.5m ⇒ 40HQ" rule
  index.ts   → calculatePackingList(input, context): PackingResult   ← single entry

lib/packing-server.ts        ← ADAPTER: DB (Supabase) → engine PackingContext
lib/packing-export.ts        ← Excel packing list (exceljs)
components/packing/           ← CalculatorClient, PackingListPdf (@react-pdf)
app/(app)/packing/           ← Overview, Library, Issues, Calculator, export route
scripts/
  packing-apply-local.mjs      apply a migration to LOCAL Supabase (host-guarded)
  import-packing-xlsx.ts       import the Excel → packing_* tables (local only)
supabase/migrations/173_packing_module.sql
data/packing/source/         ← the ORIGINAL Excel, preserved verbatim
tests/packing-core.test.ts   ← 17 engine tests (node:test)
```

**Golden rule:** the ERP reuses `lib/packing-core/` unchanged. Only
`lib/packing-server.ts` (the adapter) changes when wiring real ERP records.

---

## The engine contract (spec §19)

```ts
calculatePackingList(
  { source_type, source_id, items: [{ product_id, quantity, options }] },
  context   // { config, containers, getPackaging, resolveBom? }  — DB-free
): {
  packages, lines, total_packages, total_cbm, net_weight, gross_weight,
  volumetric_weight, longest_package_mm, has_poles,
  container_recommendations, warnings, assumptions,
  requires_operations_validation: true,   // ALWAYS in Phase 1
  packaging_versions_used
}
```

- **CBM** = L·W·H ÷ 1 000 000 000 (mm). Missing dim → `null`, never a fake 0.
- **Volumetric weight** = CBM × factor. Factor is **config** (`packing_config`,
  default 200 = the Excel's `×1000/5`), not hard-coded.
- **Incomplete cartons** are explicit + configurable
  (`remaining_individual_cartons` | `round_up_outside_carton`) — rounding is
  never hidden.
- **Container recommendation is volume-based ONLY** and always flagged
  "Operations review required". It never claims a proven physical fit.
- **40GP** exists but `rules_validated=false` → offered as an alternative,
  never auto-recommended, always warned.
- **Poles > 5.5 m** force 40HQ regardless of quantity (Word §II).

---

## Data model (`packing_*`, 17 tables)

Master data (versioned, never overwritten):
`packing_import` (original file bytes preserved) · `packing_item` (stable UUID —
names are never keys) · `packing_item_version` (all packaging data, DRAFT →
Needs Validation → Validated → Deprecated → Archived) · `packing_field_change`
(field-level audit) · `packing_bom` / `packing_bom_line` (needs-validation
proposals) · `packing_import_issue` · `packing_product_image`.

Config (editable, versioned): `packing_container_type` · `packing_rule` ·
`packing_pole_profile` · `packing_config`.

Calculations (immutable snapshots): `packing_calculation` (+ `_line`,
`packing_package`) with `packaging_versions_used` so historical lists never
change when master data changes · `packing_template`.

**RLS:** every `packing_*` table is Super-Admin-only via `packing_is_admin()`.

---

## Run it (LOCAL dev only)

```bash
# 1) apply the schema to LOCAL Supabase (127.0.0.1:54322). Host-guarded — refuses non-local.
node scripts/packing-apply-local.mjs supabase/migrations/173_packing_module.sql

# 2) import the Excel (preserves original, extracts images, flags issues)
node --experimental-strip-types scripts/import-packing-xlsx.ts --fresh

# 3) engine tests
node --experimental-strip-types --test tests/packing-core.test.ts

# 4) app — dev server must run with .env.development.local (local Supabase)
#    then sign in as a Super-Admin and open /packing
```

Never run `npm run db:migrate --apply` for this — that targets **prod**. Use the
host-guarded local helper above.

---

## Permissions (Phase 1)

Everything is **Super-Admin only** — the layout guard (`getCurrentUserRole`),
the server actions (`requireSuperAdmin`), the export route, and RLS all enforce
it. The nav entry "Packing (beta)" (`{ kind: "superAdminOnly" }`) shows only to a
real Super-Admin who isn't simulating another role. Widen roles (Sales /
Operations / Manager) in a later migration when validated — see §21 of the spec.

---

## ERP integration points (later)

The ERP calls the **same** `calculatePackingList()` from: Sales Project Request ·
Packing List Request · Transport Request · Proforma · Quotation · Order · Factory
prep. Only `lib/packing-server.ts` changes to resolve ERP `product_id`s and BOMs.
Use stable ERP product IDs where available; standalone manual/imported items
remain valid when no ERP mapping exists (`packing_item.erp_product_id` nullable).

---

## Delivered vs. deferred

**Delivered (Phase 1):** schema + RLS · pure engine + 17 tests · Excel import
(original preserved, 159 items DRAFT, 45 images, 162 issues catalogued, 8 BOM
proposals) · Overview / Library / Import Issues / Calculator pages · volume-based
container recommendation · save calculation with version snapshot · Excel + PDF
export · Super-Admin nav entry.

**Deferred (Phase 1b — tables/audit already exist):** inline + bulk edit and
version-history diff/restore UI · issue accept/correct write-back · BOM editor
UI · Excel re-import diff/preview.

**Phase 2:** validated loading rules · validated per-container capacities · pole
profiles wooden-case geometry · validated templates.

**Phase 3:** geometric 3D placement / loading diagram (only after data + rules
are reliable).

See [CONTAINER_CALCULATION.md](./CONTAINER_CALCULATION.md) (capacity/utilization
audit, calculation methods, fill engine, 3D separation, acceptance criteria),
[UNRESOLVED_BUSINESS_RULES.md](./UNRESOLVED_BUSINESS_RULES.md) and
[ANALYSIS.md](./ANALYSIS.md).
