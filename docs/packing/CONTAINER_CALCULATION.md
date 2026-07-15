# Container capacity, utilization & fill recommendations

Honest documentation of **how the numbers are produced** — so nobody mistakes a
volume ratio for a proven physical loading.

## 1. Audit — what the engine actually does

| Aspect | Status | File |
|---|---|---|
| Total CBM | `Σ (cbm_each × count)`, `cbm_each = L·W·H/1e9` | `index.ts` / `cbm.ts` |
| Dimensions | outer carton for master cartons, inner for individuals, pole's own dims | `carton.ts` |
| Master / incomplete cartons | integer: `floor(qty/N)` + leftovers (policy) | `carton.ts` |
| **Utilization %** | **`cargo CBM ÷ (usable CBM × containers)`** | `container.ts` |
| Gross weight | **checked** — count = `max(⌈CBM/usable⌉, ⌈gross/payload⌉)` | `container.ts` |
| Door dimensions | **checked** when configured (`fitsThroughDoor`) | `cbm.ts` / `container.ts` |
| Longest package | checked vs internal length (warning) | `container.ts` |
| Rotations / stacking / layers | **NOT** modelled | — |
| Poles / wooden cases | detected + `>5.5m ⇒ 40HQ`; wooden-case geometry NOT computed | `pole.ts` |
| Mixed-product placement | **NOT** simulated (CBM summed) | — |
| **3D bin-packing** | **NOT implemented** — honest stub only | `placement3d.ts` |

**Verdict:** the base recommendation is a **VOLUME + WEIGHT** estimate with door
and longest-length guards. It is never a physical fit.

## 2. Calculation methods (mandatory, prominent)

`CalcMethod` (`types.ts`) — every capacity/fit figure carries one, with an
honest caution and **never** the words "will fit":

| Method | Label | What it means |
|---|---|---|
| `VOLUME_ONLY` | Volume estimate only | CBM ÷ usable CBM |
| `VOLUME_AND_WEIGHT` | Volume & weight estimate | + payload check (**base engine**) |
| `RULE_BASED` | Dimension-aware estimate | + door / longest-length / integer cartons (**fill engine**) |
| `VALIDATED_TEMPLATE` | Previously validated loading | Operations-confirmed config |
| `THREE_DIMENSIONAL_PLACEMENT` | 3D placement simulated | real geometry (Phase 3, not yet) |
| `MANUALLY_VALIDATED` | Manually validated | a human confirmed the load |

Wording used for estimates: *"could potentially be added"*, *"estimated
additional quantity"*, *"subject to physical loading validation"*.

## 3. Three distinct CBM figures (`/packing/containers`)

- **Theoretical CBM** — internal L×W×H.
- **Operational usable CBM** — configured real-world usable volume (editable).
- **Current-calculation usable CBM** — `operational × (1 − safety%) − min reserve`.

Editable + **versioned + audited** (`packing_container_type_change`). Editing
never changes historical calculations — each calc snapshots
`container_config_used` (m174).

## 4. Fill engine — "products you could add" (`fill.ts`)

A `RULE_BASED` estimate (never a fit). For each candidate it uses the **packaging
BOM** and **integer carton** footprint (master cartons, incomplete cartons,
heads/arms/anchors/poles) — it never does `remaining CBM ÷ unit CBM`. It offers:

- **single-product** completion options ("Add up to N × X");
- **3–5 mixed-product** combos (max utilization, balanced, max quantity, maximize
  a selected product);
- per option: additional CBM, final utilization, remaining CBM, remaining
  payload, method, confidence, and an **expandable line-by-line breakdown**.

**Objectives** (§6): max CBM utilization · max products · min remaining CBM ·
maximize a selected product · balanced mix · only products already present.
**Constraints** (§5): family / selection / in-request catalogue, min/max/
increment qty, min final utilization, min safety reserve, exclude fragile /
poles, container compatibility.

## 5. Two-stage feasibility (`placement3d.ts` → `verifyFeasibility`)

1. a **validated template** wins → `VALIDATED_TEMPLATE`;
2. else a real **3D engine** if available → `THREE_DIMENSIONAL_PLACEMENT`;
3. else an **estimate** explicitly requiring Operations review → `RULE_BASED`.

The 3D engine is a **separate, isolated** module. Today `DEFAULT_3D_ENGINE`
reports `available:false` and places nothing — it never disguises the CBM/rule
estimate as a 3D simulation.

## 6. Acceptance criteria (§14) — status

1. usable CBM editable + versioned per container ✅ (m174 + editor)
2. calculations retain the config used at creation ✅ (`container_config_used`)
3. remaining CBM + remaining payload shown ✅
4. additional-product quantity recommendations ✅ (`fill.ts`)
5. single + mixed options ✅
6. each recommendation shows method + assumptions ✅
7. full BOM components included ✅ (footprint via `resolveBom` + `calcComponent`)
8. integer carton quantities ✅
9. no physical-fit claim from CBM alone ✅ (method + caution wording)
10. current method visible ✅ (banner + per-card + exports)
11. 3D separated from volume estimates ✅ (`placement3d.ts`, isolated)
12. Operations can modify/validate ⏳ manual line-lock/edit is next; objective +
    constraints + reserve + container profile switching are live
13. all changes audited ✅ (container audit + packaging field-change tables)
14. tests for configurable capacity + mixed recommendations ✅ (`tests/packing-fill.test.ts`)

## 7. Tests (`tests/packing-fill.test.ts`, `tests/packing-core.test.ts`)

usable-CBM 68→64 · historical snapshot unchanged · single / master / incomplete /
multi-BOM / mixed recommendations · weight-limited before CBM · package too large
for door · pole incompatible with 20GP · safety reserve · min-final-utilization ·
validated template vs no-engine vs 3D-stub feasibility. **32 packing tests green.**
