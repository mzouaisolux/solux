"use client";

/**
 * "New change request" — a single entry point for raising a change request
 * (Section 14, scenario C). Two-step modal:
 *
 *   Step 1 — choose the family (searchable; shows model count, current version,
 *            and a "pending" badge where a request is already open).
 *   Step 2 — choose the method:
 *            • "Type the changes"  → deep-links to the family page with the
 *              existing Raise form auto-opened (/productknowledgehub/[id]?raise=1).
 *            • "Upload marked-up sheet" (CR-Extractor) → DISPLAY-ONLY for now:
 *              a disabled "Coming soon" affordance (see CR_Extractor_Plan.md).
 *
 * Gated by the parent on spec.raise, so this only renders for operations/admins.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FamilySummary } from "../lib/types";

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,15,15,.32)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  paddingTop: "9vh",
  zIndex: 50,
};
const box: React.CSSProperties = {
  width: "min(640px, 94%)",
  background: "#fff",
  border: "1px solid var(--sx-line-2, #dcdde1)",
  boxShadow: "0 14px 40px rgba(15,15,15,.22)",
  maxHeight: "80vh",
  display: "flex",
  flexDirection: "column",
};

export function NewChangeRequestModal({ families }: { families: FamilySummary[] }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const router = useRouter();

  const family = useMemo(() => families.find((f) => f.id === familyId) ?? null, [families, familyId]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return families;
    return families.filter((f) => f.name.toLowerCase().includes(q));
  }, [families, query]);

  function reset() {
    setStep(1);
    setFamilyId(null);
    setQuery("");
  }
  function close() {
    setOpen(false);
    reset();
  }
  function pick(id: string) {
    setFamilyId(id);
    setStep(2);
  }
  function typeChanges() {
    if (!familyId) return;
    close();
    router.push(`/productknowledgehub/${familyId}?raise=1`);
  }

  return (
    <>
      <button type="button" className="sx-btn sx-btn-go" onClick={() => setOpen(true)}>
        <span style={{ fontSize: 15, fontWeight: 800, lineHeight: 1 }}>+</span> New change request
      </button>

      {open && (
        <div style={overlay} onClick={close}>
          <div style={box} onClick={(e) => e.stopPropagation()}>
            {/* header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "13px 16px",
                borderBottom: "1px solid var(--sx-line, #e7e7ea)",
              }}
            >
              <b style={{ fontSize: 14 }}>
                New change request
                {step === 2 && family ? (
                  <span style={{ color: "var(--sx-green-deep, #0b7a39)" }}> · {family.name}</span>
                ) : null}
              </b>
              <button type="button" className="sx-clear" onClick={close} aria-label="Close">
                ✕
              </button>
            </div>

            {/* stepper */}
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                fontSize: 11,
                fontWeight: 700,
                color: "var(--sx-mute, #67646f)",
                padding: "10px 16px 0",
              }}
            >
              <span style={{ color: step === 1 ? "#0f0f0f" : undefined }}>1 · Family</span>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--sx-line-2,#dcdde1)" }} />
              <span style={{ color: step === 2 ? "#0f0f0f" : undefined }}>2 · How</span>
            </div>

            <div style={{ padding: "12px 16px 16px", overflowY: "auto" }}>
              {step === 1 && (
                <>
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search family…"
                    style={{ width: "100%", padding: 8, border: "1px solid var(--sx-line-2,#dcdde1)", fontSize: 13, marginBottom: 10 }}
                  />
                  {filtered.length === 0 ? (
                    <p className="sx-sub">No families match “{query}”.</p>
                  ) : (
                    filtered.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => pick(f.id)}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "9px 10px",
                          border: "1px solid var(--sx-line,#e7e7ea)",
                          background: "#fff",
                          marginBottom: 6,
                          cursor: "pointer",
                        }}
                      >
                        <span>
                          <span style={{ fontSize: 13, fontWeight: 600, display: "block" }}>{f.name}</span>
                          <span style={{ fontSize: 11, color: "var(--sx-mute,#67646f)" }}>
                            {f.modelCount} model{f.modelCount === 1 ? "" : "s"}
                            {f.currentVersion ? ` · current ${f.currentVersion}` : " · no version yet"}
                          </span>
                        </span>
                        {f.pending ? (
                          <span
                            style={{
                              background: "var(--sx-amber-tint, rgba(232,135,14,.1))",
                              color: "var(--sx-amber-deep, #9a5a00)",
                              padding: "2px 8px",
                              borderRadius: 20,
                              fontSize: 10.5,
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                            }}
                          >
                            request open
                          </span>
                        ) : (
                          <span style={{ color: "var(--sx-mute,#67646f)", fontSize: 16 }}>›</span>
                        )}
                      </button>
                    ))
                  )}
                </>
              )}

              {step === 2 && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    {/* functional path */}
                    <button
                      type="button"
                      onClick={typeChanges}
                      style={{
                        textAlign: "left",
                        border: "1px solid var(--sx-line-2,#dcdde1)",
                        background: "#fff",
                        padding: 14,
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>✎ Type the changes</div>
                      <div style={{ fontSize: 11.5, color: "var(--sx-mute,#67646f)" }}>
                        Edit values in the form; the diff is computed against the current version.
                      </div>
                    </button>

                    {/* DISPLAY-ONLY — CR-Extractor not built yet */}
                    <div
                      aria-disabled
                      title="Coming soon — see CR_Extractor_Plan.md"
                      style={{
                        position: "relative",
                        border: "1px dashed var(--sx-line-2,#dcdde1)",
                        background: "var(--sx-lilac, #f6f5f9)",
                        padding: 14,
                        cursor: "not-allowed",
                        opacity: 0.7,
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          top: 10,
                          right: 10,
                          background: "#eef0f3",
                          color: "#4b5563",
                          padding: "1px 8px",
                          borderRadius: 20,
                          fontSize: 9.5,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: ".04em",
                        }}
                      >
                        Coming soon
                      </span>
                      <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>⬆ Upload marked-up sheet</div>
                      <div style={{ fontSize: 11.5, color: "var(--sx-mute,#67646f)" }}>
                        Drop the red-boxed .xlsx; the CR-Extractor reads the changes for you.
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                    <button type="button" className="sx-clear" onClick={() => setStep(1)}>
                      ← Back
                    </button>
                    <span className="sx-sub" style={{ fontSize: 11.5 }}>
                      Pick a method to continue
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
