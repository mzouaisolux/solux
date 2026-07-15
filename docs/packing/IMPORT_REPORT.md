# Import report — `packing list all.xlsx`

First import into local Supabase (`scripts/import-packing-xlsx.ts --fresh`).

- **Source:** `packing list all.xlsx`, sheet `产品数据` (Product Data), author "Shirley".
- **SHA-256:** `0c021d046bdfadea3692a521d13fecab284dfc531d1f4795e1ab97595aff4a7b`
  (original preserved verbatim in `packing_import.original_file` **and**
  `data/packing/source/`).
- **Rows scanned:** 159 (Excel rows 3–161).
- **Items created:** 159 — **all DRAFT**, none auto-validated.
- **Images:** 45 files extracted → `public/packing/images/`; 54 rows linked.
- **Poles detected:** 14.
- **BOM proposals:** 8 (HEAD + POLE adjacency, `needs_validation`).

## Issues catalogued (162) — never silently discarded

| Type | Count | Example |
|------|------:|---------|
| missing_image | 105 | rows with no anchored photo |
| missing_weight | 22 | net/gross blank |
| duplicate_reference | 13 | "ANCHOR", "new pole"… (names ≠ keys) |
| bom_needs_validation | 8 | inferred HEAD+POLE BOMs |
| missing_outside_carton | 5 | "4pcs/carton" but no outer dims |
| diameter_symbol | 4 | "Φ340", "Φ330" poles |
| two_weights_one_cell | 3 | "4.6/24.45", "5.6/24", "7.9/35.35" |
| suspicious_dimension | 1 | B005/SL-005 120CM `C = 1 mm` |
| pole_layer_discrepancy | 1 | 40HQ 8m 300mm flange: 16×9=144 ≠ stated 150 |

All are reviewable at `/packing/issues` (filterable by type). Every ambiguous
value is kept verbatim with a proposed interpretation; corrections + write-back
(with audit) are Phase 1b.

## Column mapping applied

| Excel | Field |
|-------|-------|
| A Product No. | `reference` / `name` (+ family/component/variant derived; **not** a unique key) |
| B Picture | image (or variant text "60W"/"M24") |
| C/D/E | `inner_l/w/h_mm` |
| F/G/H | `outer_l/w/h_mm` |
| I Packing Method | `packing_method_raw` → `qty_per_outside_carton`, `packaging_type` |
| J Net Wet. | `net_weight_kg` |
| K Gross Wet. | `gross_weight_unit_kg` (+ `_master_kg` when "x/y") |
| L/M/N/O | **recomputed** (`cbm_inner`, `cbm_outer`, `volumetric_weight_kg` = CBM×200) |
