"use client";

import { useState } from "react";
import { CountrySelect } from "@/components/forms/CountrySelect";
import { createProjectRequest, updateProjectRequest } from "../actions";
import { toast } from "@/components/feedback/toast-store";
import { SubmitButton } from "@/components/feedback/ActionForm";
import { TRANSPORT_MODES, TRANSPORT_MODE_LABEL } from "@/lib/types";
import { ACTIVE_SERVICE_TYPES } from "@/lib/service-types";
import { TILT_ANGLE_PRESETS, cleanTiltAngle } from "@/lib/industrial-spec";

function isNavError(e: any): boolean {
  const d = e?.digest;
  return typeof d === "string" && (d.startsWith("NEXT_REDIRECT") || d.startsWith("NEXT_NOT_FOUND"));
}

type ClientOption = { id: string; name: string; country: string | null };
type CategoryOption = { id: string; name: string };
type AffairOption = { id: string; name: string; clientId: string | null };

/** m109 — pre-fill payload built server-side from a tender or an
 *  opportunity (?tender= / ?affair= on /projects/new). */
export type ProjectFormInitial = {
  name: string;
  clientId: string;
  affairId: string;
  country: string;
  quantity: string;
  opportunityValue: string;
  additionalNotes: string;
  sourceTenderId: string | null;
  sourceLabel: string;
  // BUG-2 — edit-mode prefill (optional; absent for create / tender / affair flows)
  productCategoryId?: string;
  reqProduct?: boolean;
  reqPacking?: boolean;
  reqFreight?: boolean;
  ledPower?: string;
  solarPanelSize?: string;
  /** m159 — Solar Panel Tilt Angle (degrees) — MANDATORY: it drives the pole
   *  drawing and factory production instructions downstream. */
  tiltAngle?: string;
  batterySpec?: string;
  controller?: string;
  iotRequired?: boolean;
  poleRequired?: boolean;
  poleQuantity?: string;
  poleHeight?: string;
  armLength?: string;
  poleNotes?: string;
  transportMode?: string;
  freightDestination?: string;
  freightNotes?: string;
  affairName?: string | null;
};

/**
 * Create form — General · Information required · Solar Product Configuration ·
 * Pole Configuration (conditional) · Freight Information (conditional) · a
 * pre-submit summary. Built for speed (< 3 min); lands on the detail page.
 *
 * Styled with the SOLUX Projects design (mockup .form-card / .form-sec / .fgrid);
 * inputs inherit the scoped control styling from the `.solux-pro` page wrapper.
 */
export default function NewProjectForm({
  clients,
  categories,
  affairs,
  initial,
  lockClient = false,
  editId = null,
}: {
  clients: ClientOption[];
  categories: CategoryOption[];
  affairs: AffairOption[];
  /** m109 — pre-fill from a tender / opportunity. Null = blank form. */
  initial?: ProjectFormInitial | null;
  /** CRM refactor: opened from a Client Workspace — client fixed & hidden. */
  lockClient?: boolean;
  /** BUG-2 — editing an existing DRAFT request; saves via updateProjectRequest. */
  editId?: string | null;
}) {
  const isEdit = !!editId;
  // Tender flow: the local partner may not be selected yet → the client
  // becomes optional (the detail page's "No client set" banner enforces
  // it again before pricing).
  const tenderMode = !!initial?.sourceTenderId;
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [categoryId, setCategoryId] = useState(initial?.productCategoryId ?? "");
  // CRM refactor (2026-06-17): a request is identified by its AFFAIRE. Pick an
  // existing affaire of this client OR name a new one (mutually exclusive) —
  // there is no separate "project name".
  const [affairId, setAffairId] = useState(initial?.affairId ?? "");
  const [newAffairName, setNewAffairName] = useState(
    initial?.affairId ? "" : (initial?.name ?? "")
  );
  const [countrySeed, setCountrySeed] = useState(initial?.country ?? "");
  const [quantity, setQuantity] = useState(initial?.quantity ?? "");
  // information required
  const [reqProduct, setReqProduct] = useState(initial?.reqProduct ?? true);
  const [reqPacking, setReqPacking] = useState(initial?.reqPacking ?? false);
  const [reqFreight, setReqFreight] = useState(initial?.reqFreight ?? false);
  // m159 — Solar Panel Tilt Angle (degrees). MANDATORY (owner 2026-07-08): it
  // determines the pole drawing and factory production instructions. Presets
  // 0/10/15/20/30/45° + a custom value.
  const initialTilt = (initial?.tiltAngle ?? "").trim();
  const tiltIsPreset = TILT_ANGLE_PRESETS.some((p) => String(p) === initialTilt);
  const [tiltChoice, setTiltChoice] = useState<string>(
    initialTilt === "" ? "" : tiltIsPreset ? initialTilt : "custom"
  );
  const [tiltCustom, setTiltCustom] = useState<string>(tiltIsPreset ? "" : initialTilt);
  const tiltValue = tiltChoice === "custom" ? tiltCustom.trim() : tiltChoice;
  // pole — default OFF (#9): poles are the exception, not the rule; an opt-in
  // checkbox stops every request silently including poles. Edit mode keeps the
  // stored value (initial?.poleRequired wins when defined).
  const [poleRequired, setPoleRequired] = useState(initial?.poleRequired ?? false);
  const [poleQuantity, setPoleQuantity] = useState(initial?.poleQuantity ?? "");
  const [poleHeight, setPoleHeight] = useState(initial?.poleHeight ?? "");
  const [armLength, setArmLength] = useState(initial?.armLength ?? "");
  // freight brief
  const [transportMode, setTransportMode] = useState(initial?.transportMode ?? "");
  const [freightDestination, setFreightDestination] = useState(initial?.freightDestination ?? "");
  // Wizard (Sprint 1 — S1-5): 0 General · 1 Services · 2 Configuration · 3 Review.
  // Every field stays MOUNTED (only the current step is shown) so the single
  // <form> still submits a complete FormData on the final step.
  const STEPS = ["General", "Services", "Configuration", "Review"];
  const [step, setStep] = useState(0);
  // #19 — inline, form-preserving error: a server failure is surfaced
  // persistently near the submit button (not just a transient toast). All
  // wizard fields stay mounted, so the user's input is never lost on failure.
  const [formError, setFormError] = useState<string | null>(null);

  const hasQty = quantity.trim() !== "" && Number(quantity) > 0;

  // Service checkboxes render from the SERVICE_TYPES registry
  // (lib/service-types.ts) — adding an active service there renders it here.
  // Each active service maps to its existing form state via this lookup.
  const serviceState: Record<string, { checked: boolean; set: (v: boolean) => void }> = {
    req_product_pricing: { checked: reqProduct, set: setReqProduct },
    req_packing_list: { checked: reqPacking, set: setReqPacking },
    req_freight: { checked: reqFreight, set: setReqFreight },
  };
  const categoryName = categories.find((c) => c.id === categoryId)?.name ?? null;
  const clientName = clients.find((c) => c.id === clientId)?.name ?? null;
  // Only THIS client's affairs are selectable (point 5 — never another client's).
  const clientAffairs = affairs.filter((a) => a.clientId === clientId);
  const affairName =
    clientAffairs.find((a) => a.id === affairId)?.name ?? (newAffairName.trim() || null);

  const yn = (b: boolean) => (b ? "Yes" : "No");
  const orDash = (s: string) => (s.trim() ? s : "—");

  // Per-step validation before advancing (server actions remain the backstop).
  function canLeaveStep0(): boolean {
    if (isEdit) return true;
    if (!tenderMode && !clientId) { toast.error("Select a client first."); return false; }
    const hasExisting = affairId.trim() !== "";
    const hasNew = newAffairName.trim() !== "";
    if (hasExisting && hasNew) { toast.error("Pick an existing affair OR name a new one — not both."); return false; }
    if (!hasExisting && !hasNew && !tenderMode) { toast.error("An affair is required — choose one or name a new one."); return false; }
    return true;
  }
  function canLeaveStep1(): boolean {
    if (reqFreight && hasQty && (!transportMode || !freightDestination.trim())) {
      toast.error("Transport mode and destination are required for a freight estimate.");
      return false;
    }
    return true;
  }
  function canLeaveStep2(): boolean {
    // m159 — the tilt angle is mandatory: it drives the pole drawing +
    // production. Validate before Review so the error lands next to the field.
    if (tiltValue === "" || cleanTiltAngle(tiltValue) == null) {
      toast.error("Solar panel tilt angle is required (0–90°) — pick a preset or enter a custom value.");
      return false;
    }
    return true;
  }
  function next() {
    if (step === 0 && !canLeaveStep0()) return;
    if (step === 1 && !canLeaveStep1()) return;
    if (step === 2 && !canLeaveStep2()) return;
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }
  function back() { setStep((s) => Math.max(0, s - 1)); }

  return (
    <form
      action={async (fd) => {
        setFormError(null);
        // Create mode: affaire mandatory — exactly one of {existing, new}.
        // Edit mode: client + affaire are fixed, so skip that gate.
        if (!isEdit) {
          const hasExisting = affairId.trim() !== "";
          const hasNew = newAffairName.trim() !== "";
          if (hasExisting && hasNew) {
            const m = "Pick an existing affair OR name a new one — not both.";
            setFormError(m); toast.error(m); return;
          }
          if (!hasExisting && !hasNew && !tenderMode) {
            const m = "An affair is required to create a service request.";
            setFormError(m); toast.error(m); return;
          }
        }
        // m159 — final backstop for the mandatory tilt angle (the wizard
        // already blocks leaving the Configuration step without it).
        if (tiltValue === "" || cleanTiltAngle(tiltValue) == null) {
          const m = "Solar panel tilt angle is required (0–90°).";
          setFormError(m); toast.error(m); return;
        }
        try {
          // both redirect on success → ?flash confirms on the detail page
          if (isEdit) await updateProjectRequest(fd);
          else await createProjectRequest(fd);
        } catch (e: any) {
          if (isNavError(e)) throw e;
          const m =
            e?.message ??
            (isEdit ? "Could not save the changes." : "Could not create the service request.");
          setFormError(m); // input preserved (fields stay mounted)
          toast.error(m);
        }
      }}
      className="card form-card"
      onKeyDown={(e) => {
        // In the wizard, Enter on a non-final step must not submit the form.
        if (e.key === "Enter" && step < STEPS.length - 1 && (e.target as HTMLElement).tagName !== "TEXTAREA") e.preventDefault();
      }}
    >
      {/* WIZARD STEP INDICATOR */}
      <ol style={{ display: "flex", gap: 10, listStyle: "none", padding: 0, margin: "0 0 22px", flexWrap: "wrap" }}>
        {STEPS.map((label, i) => (
          <li key={label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600, color: i === step ? "var(--sx-ink, #111)" : "var(--sx-mute-2, #999)" }}>
            <span style={{ display: "inline-flex", width: 22, height: 22, borderRadius: 999, alignItems: "center", justifyContent: "center", fontSize: 12, color: i <= step ? "#fff" : "#666", background: i === step ? "var(--sx-ink, #111)" : i < step ? "#16a34a" : "#e5e5e5" }}>{i < step ? "✓" : i + 1}</span>
            {label}
            {i < STEPS.length - 1 && <span style={{ color: "#ccc", marginLeft: 2 }}>→</span>}
          </li>
        ))}
      </ol>

      {/* GENERAL */}
      <div className="form-sec" style={{ display: step !== 0 ? "none" : undefined }}>
        <h3>General information</h3>
        <div className="fgrid">
          <div className="fcol">
            <span className="fl">
              Client {tenderMode ? <span style={{ color: "var(--sx-mute-2)", fontWeight: 400 }}>(partner — optional)</span> : <span className="req">*</span>}
            </span>
            {/* m109 — tender-sourced requests keep the tender link and may
                start clientless (partner not selected yet). */}
            {initial?.sourceTenderId && (
              <input type="hidden" name="source_tender_id" value={initial.sourceTenderId} />
            )}
            {(lockClient || isEdit) && clientId ? (
              // Client is fixed: opened from a Client Workspace (lockClient) or
              // editing an existing request (isEdit). Injected, never re-asked.
              <>
                <input type="hidden" name="client_id" value={clientId} />
                <input value={clientName ?? "Selected client"} disabled />
              </>
            ) : (
              <select
                name="client_id"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  const c = clients.find((x) => x.id === e.target.value);
                  if (c?.country) setCountrySeed(c.country);
                  // The affair belongs to a client — reset both affair fields.
                  setAffairId("");
                  setNewAffairName("");
                }}
              >
                <option value="">— Select a client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
          </div>
          <div className="fcol span3">
            <span className="fl">Affair <span className="req">*</span></span>
            {isEdit ? (
              // Editing an existing request — the affaire is fixed (read-only).
              <input value={initial?.affairName ?? affairName ?? "—"} disabled />
            ) : (
              <>
            <select
              name="affair_id"
              value={affairId}
              disabled={!clientId}
              onChange={(e) => {
                setAffairId(e.target.value);
                if (e.target.value) setNewAffairName("");
              }}
            >
              <option value="">
                {clientId ? "— Select an existing affair —" : "— Select a client first —"}
              </option>
              {clientAffairs.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <div style={{ textAlign: "center", margin: "8px 0", fontSize: 12, fontWeight: 500, color: "var(--sx-mute-2)" }}>
              OR
            </div>
            <input
              name="new_affair_name"
              value={newAffairName}
              disabled={!clientId && !tenderMode}
              placeholder="New affair — e.g. AO SONELGAZ 2027"
              onChange={(e) => {
                setNewAffairName(e.target.value);
                if (e.target.value.trim()) setAffairId("");
              }}
            />
            <p style={{ fontSize: 12, color: "var(--sx-mute-2)", margin: "6px 0 0" }}>
              {!clientId
                ? "Pick a client first, then choose its affair or name a new one."
                : "Choose an existing affair for this client, or name a new one — it's created and linked automatically."}
            </p>
              </>
            )}
          </div>
          <div className="fcol">
            <span className="fl">Product category</span>
            <select name="product_category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">— Select a product family —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="fcol">
            <span className="fl">Country</span>
            <CountrySelect name="country" defaultValue={countrySeed} key={countrySeed || "nocountry"} />
          </div>
          <div className="fcol">
            <span className="fl">Quantity</span>
            <input name="quantity" type="number" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="e.g. 200" />
          </div>
          <div className="fcol">
            <span className="fl">Opportunity value (USD, optional)</span>
            <input
              name="opportunity_value"
              type="number"
              min={0}
              step="0.01"
              placeholder="e.g. 300000"
              defaultValue={initial?.opportunityValue || undefined}
            />
          </div>
        </div>
      </div>

      {/* INFORMATION REQUIRED */}
      <div className="form-sec" style={{ display: step !== 1 ? "none" : undefined }}>
        <h3>Services requested</h3>
        <div className="req-checks">
          {ACTIVE_SERVICE_TYPES.map((s) => {
            const st = serviceState[s.field];
            if (!st) return null;
            return (
              <label
                key={s.field}
                style={s.needsQuantity ? { opacity: hasQty ? 1 : 0.5 } : undefined}
              >
                <input
                  type="checkbox"
                  name={s.field}
                  checked={s.needsQuantity ? st.checked && hasQty : st.checked}
                  disabled={s.needsQuantity && !hasQty}
                  onChange={(e) => st.set(e.target.checked)}
                />{" "}
                {s.label}
              </label>
            );
          })}
        </div>
        {!hasQty && <p className="warn-text">Quantity is required before requesting Packing List or Freight Cost.</p>}
      </div>

      {/* SOLAR PRODUCT CONFIGURATION */}
      <div className="form-sec" style={{ display: step !== 2 ? "none" : undefined }}>
        <h3>Solar product configuration</h3>
        <div className="fgrid">
          <div className="fcol"><span className="fl">LED power</span><input name="led_power" placeholder="e.g. 60W" defaultValue={initial?.ledPower || undefined} /></div>
          <div className="fcol"><span className="fl">Solar panel size</span><input name="solar_panel_size" placeholder="e.g. 120W" defaultValue={initial?.solarPanelSize || undefined} /></div>
          <div className="fcol">
            <span className="fl">Solar panel tilt angle <span className="req">*</span></span>
            <select
              value={tiltChoice}
              onChange={(e) => setTiltChoice(e.target.value)}
              aria-label="Solar panel tilt angle"
            >
              <option value="">— Select the tilt angle —</option>
              {TILT_ANGLE_PRESETS.map((a) => (
                <option key={a} value={String(a)}>{a}°</option>
              ))}
              <option value="custom">Custom…</option>
            </select>
            {tiltChoice === "custom" && (
              <input
                type="number"
                min={0}
                max={90}
                step="0.5"
                value={tiltCustom}
                onChange={(e) => setTiltCustom(e.target.value)}
                placeholder="e.g. 25"
                style={{ marginTop: 6 }}
                aria-label="Custom tilt angle (degrees)"
              />
            )}
            {/* The resolved value travels as one field; the server re-validates. */}
            <input type="hidden" name="solar_panel_tilt_angle" value={tiltValue} />
            <span style={{ fontSize: 11, color: "var(--sx-mute-2)", marginTop: 4 }}>
              Drives the pole drawing &amp; production — mandatory.
            </span>
          </div>
          <div className="fcol"><span className="fl">Battery specification</span><input name="battery_spec" placeholder="e.g. 12.8V 60Ah LiFePO4" defaultValue={initial?.batterySpec || undefined} /></div>
          <div className="fcol"><span className="fl">Controller</span><input name="controller" placeholder="e.g. MPPT 20A" defaultValue={initial?.controller || undefined} /></div>
          <div className="fcol" style={{ display: "flex", alignItems: "center", gap: 9, paddingTop: 24 }}>
            <input name="iot_required" type="checkbox" defaultChecked={initial?.iotRequired} />
            <span style={{ fontSize: 13, color: "var(--sx-ink-soft)" }}>IoT required</span>
          </div>
        </div>
      </div>

      {/* POLE CONFIGURATION */}
      <div className="form-sec" style={{ display: step !== 2 ? "none" : undefined }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0 }}>Pole configuration</h3>
          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--sx-ink-soft)" }}>
            <input type="checkbox" name="pole_required" checked={poleRequired} onChange={(e) => setPoleRequired(e.target.checked)} /> Pole required
          </label>
        </div>
        {poleRequired ? (
          <div className="fgrid">
            <div className="fcol"><span className="fl">Pole quantity</span><input name="pole_quantity" type="number" min={0} value={poleQuantity} onChange={(e) => setPoleQuantity(e.target.value)} placeholder="e.g. 200" /></div>
            <div className="fcol"><span className="fl">Pole height</span><input name="pole_height" value={poleHeight} onChange={(e) => setPoleHeight(e.target.value)} placeholder="e.g. 8m" /></div>
            <div className="fcol"><span className="fl">Arm length</span><input name="arm_length" value={armLength} onChange={(e) => setArmLength(e.target.value)} placeholder="e.g. 1.5m" /></div>
            <div className="fcol span3"><span className="fl">Pole notes</span><input name="pole_notes" placeholder="e.g. Single arm galvanized pole" defaultValue={initial?.poleNotes || undefined} /></div>
          </div>
        ) : (
          <p style={{ fontSize: 12, color: "var(--sx-mute-2)" }}>No poles in this project.</p>
        )}
      </div>

      {/* FREIGHT INFORMATION — only when a freight estimate is requested */}
      {reqFreight && hasQty && (
        <div className="form-sec" style={{ display: step !== 1 ? "none" : undefined }}>
          <h3>Freight information</h3>
          <div className="fgrid">
            <div className="fcol">
              <span className="fl">Transport mode <span className="req">*</span></span>
              <select name="freight_transport_mode" value={transportMode} onChange={(e) => setTransportMode(e.target.value)}>
                <option value="">— Select —</option>
                {TRANSPORT_MODES.map((m) => (
                  <option key={m} value={m}>{TRANSPORT_MODE_LABEL[m]}</option>
                ))}
              </select>
            </div>
            <div className="fcol">
              <span className="fl">Delivery destination <span className="req">*</span></span>
              <input name="freight_destination" value={freightDestination} onChange={(e) => setFreightDestination(e.target.value)} placeholder="e.g. Paris (France) · Port of Cotonou" />
              <span style={{ fontSize: 11, color: "var(--sx-mute-2)", marginTop: 4 }}>City, port or airport — wherever the goods must be delivered.</span>
            </div>
            <div className="fcol"><span className="fl">Freight notes</span><input name="freight_notes" placeholder="optional" defaultValue={initial?.freightNotes || undefined} /></div>
          </div>
        </div>
      )}

      {/* ADDITIONAL NOTES */}
      <div className="form-sec" style={{ display: step !== 2 ? "none" : undefined }}>
        <h3>Additional notes</h3>
        <textarea
          name="additional_notes"
          rows={initial?.additionalNotes ? 8 : 3}
          placeholder="Tender constraints, certifications, deadlines…"
          defaultValue={initial?.additionalNotes || undefined}
        />
      </div>

      {/* PROJECT SUMMARY — verify before submitting (Review step) */}
      <div className="form-summary" style={{ display: step !== 3 ? "none" : undefined }}>
        <div className="sx-micro">Summary — verify before submitting</div>
        <div className="sg">
          <Summary label="Client" value={clientName ?? "—"} />
          <Summary label="Affair" value={affairName ?? "—"} />
          <Summary label="Product category" value={categoryName ?? "—"} />
          <Summary label="Quantity" value={hasQty ? quantity : "—"} />
          <Summary label="Panel tilt angle" value={tiltValue !== "" ? `${tiltValue}°` : "—"} />
          <Summary label="Pole" value={yn(poleRequired)} />
          {poleRequired && <Summary label="Pole qty" value={orDash(poleQuantity)} />}
          {poleRequired && <Summary label="Pole height" value={orDash(poleHeight)} />}
          {poleRequired && <Summary label="Arm length" value={orDash(armLength)} />}
          <Summary label="Pricing requested" value={yn(reqProduct)} />
          <Summary label="Packing requested" value={yn(reqPacking && hasQty)} />
          <Summary label="Freight requested" value={yn(reqFreight && hasQty)} />
          {reqFreight && hasQty && <Summary label="Transport mode" value={transportMode ? TRANSPORT_MODE_LABEL[transportMode as keyof typeof TRANSPORT_MODE_LABEL] ?? transportMode : "—"} />}
          {reqFreight && hasQty && <Summary label="Destination" value={orDash(freightDestination)} />}
        </div>
      </div>

      <div className="form-foot" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {isEdit && <input type="hidden" name="id" value={editId ?? ""} />}
        {step > 0 && (
          <button type="button" className="sx-btn" onClick={back}>← Back</button>
        )}
        {step < STEPS.length - 1 && (
          <button type="button" className="sx-btn sx-btn-go" onClick={next}>Next →</button>
        )}
        {step === STEPS.length - 1 && (
          <SubmitButton className="sx-btn sx-btn-go" pendingLabel={isEdit ? "Saving…" : "Creating…"}>
            {isEdit ? "Save changes" : "Create service request"}
          </SubmitButton>
        )}
        {formError && (
          <p role="alert" style={{ color: "#dc2626", fontSize: 13, fontWeight: 600, margin: 0, flexBasis: "100%", order: -1 }}>
            {formError}
          </p>
        )}
        <span className="note">
          {step < STEPS.length - 1
            ? `Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`
            : isEdit
              ? "Changes are saved to the draft — re-submit for review on the request page."
              : "Saved as a draft — attach documents & submit on the next screen."}
        </span>
      </div>
    </form>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta">
      <div className="mk">{label}</div>
      <div className="mv">{value}</div>
    </div>
  );
}
