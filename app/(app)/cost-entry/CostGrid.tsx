"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  saveCostBatch,
  type CostEntry,
  type CostEntryProduct,
  type CostVersionEntry,
} from "../admin/pricing/actions";

const ALL = "__all__";
const UNCAT = "__uncat__";

type Category = { id: string; name: string; count: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Parse a pasted/typed cost cell into a number. Tolerant of Excel currency
 * formatting: strips currency symbols / letters / spaces (incl. non-breaking),
 * then resolves comma vs dot as decimal or thousands separator.
 *   "CN¥ 1 440"  → 1440      "¥1,440.00" → 1440
 *   "1.440,50"   → 1440.5    "1440,50"   → 1440.5    "1,440" → 1440
 */
function parseCost(raw: string): number {
  let s = String(raw ?? "").trim();
  if (!s) return 0;
  s = s.replace(/[^\d.,]/g, ""); // drop ¥, CN, $, spaces, letters, minus
  if (!s) return 0;
  const hasDot = s.includes(".");
  const hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // The last separator is the decimal point; the other groups thousands.
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    const parts = s.split(",");
    // one comma with ≤2 trailing digits = decimal; otherwise thousands grouping
    s = parts.length === 2 && parts[1].length <= 2 ? `${parts[0]}.${parts[1]}` : s.replace(/,/g, "");
  } else if (hasDot) {
    const parts = s.split(".");
    if (parts.length > 2) {
      const last = parts.pop() as string;
      s = parts.join("") + "." + last;
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

/** "2026-06-04" / ISO timestamp → "04 Jun 2026" (no timezone math). */
function fmtDateLong(s: string | null): string {
  if (!s) return "—";
  const m = String(s).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(s).slice(0, 10);
  const [, y, mo, d] = m;
  return `${d} ${MONTHS[Number(mo) - 1] ?? mo} ${y}`;
}

/**
 * Finance cost-entry page body — cost data only, by category. Renders the
 * header, latest-version banner, category selector, the editable cost grid
 * (Tab/Enter to move down; paste a column from Excel) and the audited version
 * history. Saving creates a dated cost version; margins/prices live in Pricing.
 */
export default function CostGrid({
  products,
  categories,
  initialCategoryId = ALL,
  versions,
  canLinkPricing,
}: {
  products: CostEntryProduct[];
  categories: Category[];
  initialCategoryId?: string;
  versions: CostVersionEntry[];
  canLinkPricing: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [selectedCat, setSelectedCat] = useState(initialCategoryId);
  const [filter, setFilter] = useState("");
  const [note, setNote] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  // Editable "new cost" strings keyed by product id; seeded from current cost.
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const d: Record<string, string> = {};
    for (const p of products) d[p.id] = p.costRmb ? String(p.costRmb) : "";
    return d;
  });
  const baseline = useMemo(() => {
    const b: Record<string, number> = {};
    for (const p of products) b[p.id] = p.costRmb ?? 0;
    return b;
  }, [products]);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const uncatCount = useMemo(() => products.filter((p) => !p.categoryId).length, [products]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return products.filter((p) => {
      if (selectedCat === UNCAT) {
        if (p.categoryId) return false;
      } else if (selectedCat !== ALL) {
        if (p.categoryId !== selectedCat) return false;
      }
      if (q && !(p.name.toLowerCase().includes(q) || (p.sku ?? "").toLowerCase().includes(q))) return false;
      return true;
    });
  }, [products, selectedCat, filter]);

  const dirtyIds = useMemo(
    () => products.filter((p) => parseCost(draft[p.id] ?? "") !== baseline[p.id]).map((p) => p.id),
    [products, draft, baseline]
  );

  function setCost(id: string, value: string) {
    setDraft((d) => ({ ...d, [id]: value }));
  }
  function focusRow(i: number) {
    const el = inputRefs.current[i];
    if (el) {
      el.focus();
      el.select();
    }
  }
  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      focusRow(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(i - 1);
    }
  }
  function onPaste(e: React.ClipboardEvent<HTMLInputElement>, startIndex: number) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\n") && !text.includes("\t")) return;
    e.preventDefault();
    const values = text
      .split(/\r?\n/)
      .map((line) => line.split("\t")[0])
      .filter((v, i, arr) => !(i === arr.length - 1 && v.trim() === ""));
    setDraft((d) => {
      const next = { ...d };
      for (let k = 0; k < values.length; k++) {
        const row = visible[startIndex + k];
        if (!row) break;
        // Normalize formatted/currency cells to a clean number for display;
        // keep the raw text if it doesn't parse so the user can spot it.
        const raw = values[k].trim();
        const parsed = parseCost(raw);
        next[row.id] = parsed ? String(parsed) : raw;
      }
      return next;
    });
  }

  function onSave() {
    setErr(null);
    setMsg(null);
    const entries: CostEntry[] = dirtyIds.map((id) => ({ productId: id, costRmb: parseCost(draft[id] ?? "") }));
    if (entries.length === 0) {
      setMsg("Nothing changed to save.");
      return;
    }
    const categoryId = selectedCat !== ALL && selectedCat !== UNCAT ? selectedCat : null;
    startTransition(async () => {
      try {
        const res = await saveCostBatch(entries, { categoryId, effectiveDate: effectiveDate || null, note: note || null });
        setMsg(`Saved ${res?.changed ?? entries.length} cost change(s).`);
        setNote("");
        router.refresh();
      } catch (e: any) {
        setErr(e?.message ?? "Save failed.");
      }
    });
  }

  // "+ New version" — start a fresh cost version: clear the version metadata and
  // status, then drop focus into the grid. Non-destructive to entered costs.
  function onNewVersion() {
    setNote("");
    setEffectiveDate("");
    setErr(null);
    setMsg(null);
    focusRow(0);
  }

  const editingLabel =
    selectedCat === ALL
      ? "All categories"
      : selectedCat === UNCAT
        ? "Uncategorized"
        : categories.find((c) => c.id === selectedCat)?.name ?? "—";

  const latest = versions[0] ?? null;

  const catTab = (id: string, label: string, count: number) => (
    <button
      key={id}
      type="button"
      onClick={() => setSelectedCat(id)}
      className={`ce-cat-tab${id === selectedCat ? " on" : ""}`}
    >
      <span>{label}</span>
      <span className="ct-count">{count}</span>
    </button>
  );

  return (
    <>
      {/* HEADER */}
      <div className="sx-head">
        <div>
          <div className="ce-label-row">
            <span className="sx-micro">Finance · Pricing</span>
            <span className="px-pill">
              <span className="d" />
              RMB costs
            </span>
          </div>
          <h1 className="sx-h1">Cost entry</h1>
          <div className="ce-lead">Finance — RMB costs &amp; versions</div>
          <div className="ce-ref-line">
            Enter product costs in RMB, one category at a time. Tab / Enter moves down; paste a column from Excel.
            Saving creates a dated, audited cost version. Margins &amp; selling prices are set under{" "}
            {canLinkPricing ? (
              <Link className="sx-link" href="/admin/pricing">
                Pricing
              </Link>
            ) : (
              "Pricing"
            )}
            .
          </div>
        </div>
        <div className="ce-head-actions">
          {canLinkPricing && (
            <div className="row">
              <Link className="sx-btn sx-btn-sm" href="/admin/pricing">
                ← Pricing
              </Link>
            </div>
          )}
          <div className="row">
            <button type="button" className="sx-btn sx-btn-ink" onClick={onNewVersion}>
              + New version
            </button>
            <button
              type="button"
              className="sx-btn sx-btn-go"
              onClick={onSave}
              disabled={pending || dirtyIds.length === 0}
            >
              {pending ? "Saving…" : "Save cost version"}
            </button>
          </div>
        </div>
      </div>

      {/* VERSION BANNER */}
      {latest && (
        <div className="px-banner ce-ver-banner" style={{ marginTop: 24 }}>
          <div className="ce-ver-left">
            <span className="ce-ver-tag">Version {latest.versionNo}</span>
            <span className="ce-ver-text">
              <b>Latest cost version</b> &nbsp;·&nbsp; <span className="muted">saved by</span> {latest.savedBy}{" "}
              <span className="muted">·</span> {fmtDateLong(latest.effectiveDate)}
              {latest.note ? (
                <>
                  {" "}
                  <span className="muted">· note:</span> {latest.note}
                </>
              ) : null}
            </span>
          </div>
          <a className="sx-link" href="#history">
            View version history ↓
          </a>
        </div>
      )}

      {/* CATEGORIES */}
      <h2 className="ce-h2">Categories</h2>
      <div className="card sec">
        <div className="sx-micro" style={{ marginBottom: 11 }}>
          Select a category to enter costs
        </div>
        <div className="ce-cat-tabs">
          {catTab(ALL, "All categories", products.length)}
          {categories.map((c) => catTab(c.id, c.name, c.count))}
          {uncatCount > 0 && catTab(UNCAT, "Uncategorized", uncatCount)}
        </div>
        <div className="ce-editing-line">
          Entering costs for: <b>{editingLabel}</b>
        </div>
      </div>

      {/* COST GRID */}
      <h2 className="ce-h2">Cost grid</h2>
      <div className="card sec">
        <div className="ce-toolbar">
          <div className="ce-tb-field">
            <span className="ce-tbl">Filter</span>
            <input
              className="ce-tb-search"
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name / SKU…"
            />
          </div>
          <div className="ce-tb-field">
            <span className="ce-tbl">Effective date</span>
            <input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              style={{ width: "auto" }}
            />
          </div>
          <div className="ce-tb-field ce-tb-note">
            <span className="ce-tbl">Version note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Q3 supplier update"
            />
          </div>
          <div className="ce-tb-right">
            {dirtyIds.length > 0 && <span className="ce-unsaved-pill">{dirtyIds.length} unsaved</span>}
            {msg && (
              <span className="ce-saved-msg">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                {msg}
              </span>
            )}
            {err && <span className="ce-err-msg">{err}</span>}
            <button
              type="button"
              className="sx-btn sx-btn-go"
              onClick={onSave}
              disabled={pending || dirtyIds.length === 0}
            >
              {pending ? "Saving…" : "Save cost version"}
            </button>
          </div>
        </div>

        <div className="ce-grid-wrap" style={{ marginTop: 18 }}>
          <table className="ce-cost">
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Category</th>
                <th className="num">Current RMB</th>
                <th className="num">New cost RMB</th>
                <th className="num">Δ Delta</th>
                <th>Last updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr className="ce-grid-empty">
                  <td colSpan={7}>No products in {editingLabel}.</td>
                </tr>
              ) : (
                visible.map((p, i) => {
                  const newCost = parseCost(draft[p.id] ?? "");
                  const base = baseline[p.id];
                  const dirty = newCost !== base;
                  const delta = newCost - base;
                  let deltaEl: React.ReactNode;
                  if (base <= 0 && newCost > 0) {
                    deltaEl = <span className="ce-delta new">New</span>;
                  } else if (Math.abs(delta) < 0.005) {
                    deltaEl = <span className="ce-delta flat">—</span>;
                  } else if (delta > 0) {
                    deltaEl = <span className="ce-delta up">▲ +{delta.toFixed(2)}</span>;
                  } else {
                    deltaEl = <span className="ce-delta down">▼ −{Math.abs(delta).toFixed(2)}</span>;
                  }
                  return (
                    <tr key={p.id} className={dirty ? "dirty" : ""}>
                      <td className="ce-pname">{p.name}</td>
                      <td>
                        <span className="ce-psku">{p.sku ?? "—"}</span>
                      </td>
                      <td className="ce-pcat">{p.categoryName ?? "—"}</td>
                      <td className={`num ce-cur-rmb${base ? "" : " ce-cell-empty"}`}>{base ? base.toFixed(2) : "—"}</td>
                      <td className="num">
                        <input
                          ref={(el) => {
                            inputRefs.current[i] = el;
                          }}
                          className={`ce-cost-input${dirty ? " dirty" : ""}`}
                          value={draft[p.id] ?? ""}
                          onChange={(e) => setCost(p.id, e.target.value)}
                          onKeyDown={(e) => onKeyDown(e, i)}
                          onPaste={(e) => onPaste(e, i)}
                          onFocus={(e) => e.target.select()}
                          inputMode="decimal"
                          placeholder="0.00"
                        />
                      </td>
                      <td className="num">{deltaEl}</td>
                      <td className="ce-updated">{fmtDate(p.updatedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="ce-grid-foot">
          Cost entry stores RMB costs only. Selling prices &amp; margins are configured by category under Pricing.
        </p>
      </div>

      {/* VERSION HISTORY */}
      <div className="card sec" id="history">
        <div className="ce-vh-head">
          <div>
            <div className="sx-micro">Version history</div>
            <div className="ce-seclead">
              Every save creates a dated, audited cost version. Each version records who saved it, the effective date,
              the category scope and an optional note.
            </div>
          </div>
          <div className="ce-vh-count">
            {versions.length} version{versions.length === 1 ? "" : "s"}
          </div>
        </div>
        {versions.length === 0 ? (
          <div className="ce-vh-empty">No cost versions yet. Saving cost changes creates the first version.</div>
        ) : (
          versions.map((v, idx) => (
            <div className="ce-vh-row" key={v.id}>
              <div className="ce-vh-left">
                <span className={`ce-vh-num${idx === 0 ? " current" : ""}`}>v{v.versionNo}</span>
                <div className="ce-vh-body">
                  <div className="ce-vh-title">{v.note || "Cost update"}</div>
                  <div className="ce-vh-sub">
                    Scope: {v.categoryName ?? "All categories"} · {v.changeCount} cost change
                    {v.changeCount === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
              <div className="ce-vh-meta">
                Saved by <b>{v.savedBy}</b>
                <br />
                {fmtDateLong(v.createdAt)} · effective {fmtDateLong(v.effectiveDate)}
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
