"use client";

/**
 * Knowledge Hub home — families browser (Section 14.1c, read-only).
 *
 * Style D "two-part master–detail": Lines stay on the LEFT; the RIGHT part
 * lists the selected line's ranges, and each range is a drop-down that expands
 * its families. Each family row is a single line — the family name (links to
 * the family page, where specs / version / history live), its models listed
 * inline (each links to the model page), and a plain status word. Search / the
 * pending filter fall back to a flat grouped family list so results stay
 * visible instead of hiding behind the drill-down.
 */

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import type { FamilySummary } from "../lib/types";
import { groupFamiliesByLineRange, UNCLASSIFIED } from "../lib/group";

const inputStyle = {
  flex: 1,
  minWidth: 220,
  padding: "8px 11px",
  border: "1px solid var(--sx-line-2, #dcdde1)",
  background: "#fff",
  font: "inherit",
  fontSize: 13,
};

/** One family on a single line: name → family page, models inline, status word.
 *  `cols` is the catalog-wide max model count, so every row's models align to
 *  the same fixed grid (empty trailing cells for smaller families). */
function FamilyRow({ f, cols }: { f: FamilySummary; cols: number }) {
  const statusCls = f.pending ? "pend" : f.currentVersion ? "pub" : "none";
  const statusLabel = f.pending ? "Pending" : f.currentVersion ? "Published" : "No version";
  return (
    <div className="pkh-frow">
      <Link href={`/productknowledgehub/${f.id}`} className="pkh-fname" title="Open family page">
        {f.name}
      </Link>
      <div className="pkh-mrow" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {f.models.map((m) => (
          <Link
            key={m.id}
            href={`/productknowledgehub/${f.id}/${m.id}`}
            className="pkh-m"
            title={m.name}
          >
            {m.sku ?? m.name}
          </Link>
        ))}
      </div>
      <span className={`pkh-stat ${statusCls}`}>{statusLabel}</span>
    </div>
  );
}

export function HubFamiliesTable({ families }: { families: FamilySummary[] }) {
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "pending">("all");

  // Left selection (line) + which ranges are expanded on the right. `selLine`
  // self-heals below if a filter removes it, so no effects are needed.
  const [selLine, setSelLine] = useState<string | null>(null);
  const [openRanges, setOpenRanges] = useState<Set<string>>(new Set());
  const toggleRange = (key: string) =>
    setOpenRanges((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  // Widest family in the catalog — drives a fixed model grid so every row lines up.
  const maxModels = useMemo(
    () => Math.max(1, ...families.map((f) => f.models.length)),
    [families]
  );

  const needle = q.trim().toLowerCase();
  const filtering = needle !== "" || tab === "pending";

  const rows = useMemo(() => {
    return families.filter((f) => {
      if (tab === "pending" && !f.pending) return false;
      if (needle) {
        const hay = [f.name, f.line ?? "", f.range ?? ""].join(" ").toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [families, needle, tab]);

  const groups = useMemo(() => groupFamiliesByLineRange(rows), [rows]);
  const showHierarchy = !(groups.length === 1 && groups[0]?.line === UNCLASSIFIED);

  const lineNames = groups.map((g) => g.line);
  const effLine = selLine && lineNames.includes(selLine) ? selLine : lineNames[0] ?? null;
  const lineGroup = groups.find((g) => g.line === effLine);

  return (
    <>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", margin: "16px 0 12px" }}>
        <input
          style={inputStyle}
          placeholder="Search family, line, or range…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className={`sx-btn ${tab === "all" ? "sx-btn-go" : ""}`} onClick={() => setTab("all")}>
          All
        </button>
        <button className={`sx-btn ${tab === "pending" ? "sx-btn-go" : ""}`} onClick={() => setTab("pending")}>
          Pending change
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="sx-panel">
          <div className="sx-empty">No families match.</div>
        </div>
      ) : filtering || !showHierarchy ? (
        // Filtered / unclassified: flat grouped family list so results stay visible.
        <div>
          {groups.map((lg) => (
            <Fragment key={`line-${lg.line}`}>
              {showHierarchy ? <div className="pkh-grp-line">{lg.line}</div> : null}
              {lg.ranges.map((rg) => (
                <Fragment key={`range-${lg.line}-${rg.range}`}>
                  {showHierarchy ? <div className="pkh-grp-range">{rg.range}</div> : null}
                  {rg.families.map((f) => (
                    <FamilyRow key={f.id} f={f} cols={maxModels} />
                  ))}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </div>
      ) : (
        // Default browse: Lines on the left; ranges (drop-downs) on the right.
        <div className="pkh-split">
          <div className="pkh-left">
            {groups.map((g) => (
              <button
                key={g.line}
                type="button"
                className={`pkh-line${g.line === effLine ? " sel" : ""}`}
                aria-pressed={g.line === effLine}
                onClick={() => setSelLine(g.line)}
              >
                <div className="line-name">{g.line}</div>
              </button>
            ))}
          </div>

          <div className="pkh-right">
            {(lineGroup?.ranges ?? []).map((rg) => {
              const key = `${effLine}||${rg.range}`;
              const open = openRanges.has(key);
              return (
                <Fragment key={rg.range}>
                  <button
                    type="button"
                    className={`pkh-range${open ? " open" : ""}`}
                    aria-expanded={open}
                    onClick={() => toggleRange(key)}
                  >
                    <span className="pkh-range-name">{rg.range}</span>
                  </button>
                  {open ? (
                    <div className="pkh-rangebody">
                      {rg.families.map((f) => (
                        <FamilyRow key={f.id} f={f} cols={maxModels} />
                      ))}
                    </div>
                  ) : null}
                </Fragment>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
