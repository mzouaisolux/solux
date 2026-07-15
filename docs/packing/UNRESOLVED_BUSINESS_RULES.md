# Unresolved business rules — Packing module

These need an Operations decision before the module is validated for wider use.
Each is currently handled by a conservative, explicit assumption (never a silent
guess) and, where relevant, surfaced in the Import Issues page.

| # | Question | Current assumption | Where |
|---|----------|--------------------|-------|
| 1 | "4pcs/carton" = 4 pieces per **outside** carton (1 per inner)? | Yes | engine `carton.ts` |
| 2 | Gross-weight cells "4.6/24.45" = unit / master-carton? | unit=4.6, master=24.45 | issue `two_weights_one_cell` |
| 3 | Incomplete outside carton → leftovers as individual cartons, or round up? | `remaining_individual_cartons` | `packing_config` (configurable) |
| 4 | Volumetric factor 200 — per air / sea / forwarder? | global 200 (=1000/5) | `packing_config.volumetric_factor` |
| 5 | Poles > 5.5 m ⇒ 40HQ. Are 3.3 m poles allowed in 20GP? | assumed yes | `packing_config.pole_forces_40hq_length_mm` |
| 6 | 40HQ 8 m / 300 mm flange: **150** pcs/case stated, but 16×9 = **144**. | flagged, NOT assumed correct | issue `pole_layer_discrepancy` + `packing_pole_profile.has_discrepancy` |
| 7 | 40GP operational loading method + usable CBM. | not documented → `rules_validated=false` | `packing_container_type` (40GP) |
| 8 | Col B "60W / 100W" = distinct power variants (separate dimensions)? | imported as `variant`, needs validation | issue `linked_to_previous_row` |
| 9 | Default container safety margin. | 10 % of operational CBM | `packing_config.default_safety_margin_pct` + per-container |
| 10 | Hardware (bolt / nut / screw): own package or included in a parent? | own item, no BOM link yet | `packing_bom` (manual) |
| 11 | HEAD + POLE adjacency BOMs (8 proposed) — correct components/options? | proposed `needs_validation` | `packing_bom` |
| 12 | Suspicious dim B005/SL-005 120CM `C = 1 mm`. | kept verbatim, flagged | issue `suspicious_dimension` |
| 13 | Φ (diameter) poles: L/W left blank, diameter in remarks. | length in H, diameter noted | issue `diameter_symbol` |

**Data-integrity guarantees already enforced** (spec §24): stable UUID keys (not
names); imported records never auto-validated (all DRAFT); ambiguous data flagged,
never silently cleaned; CBM not computed when a dimension is missing; negative
dimensions/weights rejected by CHECK constraints; historical calculations snapshot
their packaging versions and never change when master data changes.
