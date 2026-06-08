"use client";

import { useState } from "react";
// The package only exposes subpath exports (no root) — import the browser
// build explicitly. Same approach we already use for `read-excel-file`.
import writeXlsxFile from "write-excel-file/browser";
import { fetchExportData } from "./exportData";

/**
 * Production-ready Excel export — same source data as the PDF.
 *
 * Sheet 1 "Order Summary": vertical key/value header + a per-line product
 *   table (Product · Category · Quantity · Main configuration).
 * Sheet 2 "Factory Task List": flat per-row table with Sales value /
 *   Factory mapping / Manual override / Final factory instruction / Notes.
 *   Header row frozen, columns sized for legibility, long cells wrap.
 * Sheet 3 "Missing Mappings": only present when ≥1 row has no mapping —
 *   gives the admin a punch list to fix.
 */
export default function ExportExcelButton({
  taskListId,
}: {
  taskListId: string;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setWorking(true);
    try {
      const data = await fetchExportData(taskListId);

      // ----------------------------------------------------------------
      // SHEET 1 — Order Summary (vertical metadata + products table)
      // ----------------------------------------------------------------
      type Cell = {
        value?: string;
        fontWeight?: "bold";
        backgroundColor?: string;
        color?: string;
        wrap?: boolean;
        fontSize?: number;
        align?: "left" | "center" | "right";
      };

      const HEADER_BG = "#0b0f19";
      const HEADER_TEXT = "#ffffff";
      const SECTION_BG = "#e5e7eb";
      const ALT_ROW = "#f9fafb";

      const summaryRows: Cell[][] = [
        // Title banner
        [
          {
            value: "FACTORY TASK LIST",
            fontWeight: "bold",
            backgroundColor: HEADER_BG,
            color: HEADER_TEXT,
            fontSize: 14,
          },
          {
            value: data.number,
            fontWeight: "bold",
            backgroundColor: HEADER_BG,
            color: HEADER_TEXT,
            fontSize: 14,
            align: "right",
          },
        ],
        [{ value: "" }, { value: "" }],

        // Order section header
        [
          {
            value: "ORDER",
            fontWeight: "bold",
            backgroundColor: SECTION_BG,
            fontSize: 11,
          },
          { value: "", backgroundColor: SECTION_BG },
        ],
        kv("Client", clientLabel(data)),
        kv("Country", data.client.country ?? "—"),
        kv("Order reference", data.quotation_number ?? "—"),
        kv("Status", data.status.toUpperCase()),
        kv("Shipping", data.shipping_method ?? "—"),
        [{ value: "" }, { value: "" }],

        // Workflow section header
        [
          {
            value: "WORKFLOW",
            fontWeight: "bold",
            backgroundColor: SECTION_BG,
            fontSize: 11,
          },
          { value: "", backgroundColor: SECTION_BG },
        ],
        kv("Created date", data.created_at ? fmtDate(data.created_at) : "—"),
        kv("Created time", data.created_at ? fmtTime(data.created_at) : "—"),
        kv("Created by", data.created_by_label),
        kv("Reviewed by", data.validated_by_label),
        kv(
          "Submitted at",
          data.submitted_at
            ? new Date(data.submitted_at).toLocaleString()
            : "—"
        ),
        kv(
          "Validated at",
          data.validated_at
            ? new Date(data.validated_at).toLocaleString()
            : "—"
        ),
        [{ value: "" }, { value: "" }],

        // Notes section header
        [
          {
            value: "NOTES",
            fontWeight: "bold",
            backgroundColor: SECTION_BG,
            fontSize: 11,
          },
          { value: "", backgroundColor: SECTION_BG },
        ],
        [
          { value: "Production notes (sales)", fontWeight: "bold" },
          { value: data.production_notes ?? "—", wrap: true },
        ],
        [
          { value: "Technical notes (internal)", fontWeight: "bold" },
          { value: data.technical_notes ?? "—", wrap: true },
        ],
      ];

      // Append per-product table — a critical block for the factory.
      const productRows: Cell[][] = [
        [{ value: "" }, { value: "" }, { value: "" }, { value: "" }],
        [
          {
            value: "PRODUCTS",
            fontWeight: "bold",
            backgroundColor: SECTION_BG,
            fontSize: 11,
          },
          { value: "", backgroundColor: SECTION_BG },
          { value: "", backgroundColor: SECTION_BG },
          { value: "", backgroundColor: SECTION_BG },
        ],
        [
          {
            value: "Product / Model",
            fontWeight: "bold",
            backgroundColor: HEADER_BG,
            color: HEADER_TEXT,
          },
          {
            value: "Category",
            fontWeight: "bold",
            backgroundColor: HEADER_BG,
            color: HEADER_TEXT,
          },
          {
            value: "Quantity",
            fontWeight: "bold",
            backgroundColor: HEADER_BG,
            color: HEADER_TEXT,
            align: "right",
          },
          {
            value: "Main configuration",
            fontWeight: "bold",
            backgroundColor: HEADER_BG,
            color: HEADER_TEXT,
          },
        ],
        ...data.lines.map((l, i) => {
          const tint = i % 2 === 0 ? undefined : ALT_ROW;
          return [
            {
              value: l.product_name + (l.product_sku ? `\n${l.product_sku}` : ""),
              fontWeight: "bold" as const,
              backgroundColor: tint,
              wrap: true,
            },
            {
              value: l.product_category ?? "—",
              backgroundColor: tint,
              wrap: true,
            },
            {
              value: String(l.quantity),
              backgroundColor: tint,
              align: "right" as const,
              fontWeight: "bold" as const,
            },
            {
              value: l.config_summary || "—",
              backgroundColor: tint,
              wrap: true,
            },
          ] as Cell[];
        }),
      ];

      // Stitch the order metadata above the products table. The metadata
      // is 2 columns wide; the products section needs 4 — fill missing
      // cells with blanks so the sheet stays rectangular.
      const summarySheet: Cell[][] = [
        ...summaryRows.map((row) => [...row, { value: "" }, { value: "" }]),
        ...productRows,
      ];

      // ----------------------------------------------------------------
      // SHEET 2 — Factory Task List (flat per-row table)
      // ----------------------------------------------------------------
      const taskHeader: Cell[] = [
        h("Section"),
        h("Field"),
        h("Sales value"),
        h("Factory mapping instruction"),
        h("Manual override"),
        h("Final factory instruction"),
        h("Factory code"),
        h("Notes"),
      ];
      const taskRows: Cell[][] = [taskHeader];

      for (const l of data.lines) {
        const sectionLabel =
          l.product_name +
          (l.product_sku ? ` · ${l.product_sku}` : "") +
          ` (×${l.quantity})`;

        if (l.rows.length === 0) {
          taskRows.push([
            { value: sectionLabel, wrap: true },
            { value: "—" },
            { value: "—" },
            { value: "—" },
            { value: "—" },
            { value: "—" },
            { value: "—" },
            { value: "No sales fields recorded for this line.", wrap: true },
          ]);
        }

        for (const r of l.rows) {
          const rowTint =
            r.source === "missing"
              ? "#fee2e2" // red-100
              : r.source === "override"
              ? "#fef3c7" // amber-100
              : undefined;
          taskRows.push([
            { value: sectionLabel, backgroundColor: rowTint, wrap: true },
            { value: r.field_name, backgroundColor: rowTint, wrap: true },
            { value: r.sales_value, backgroundColor: rowTint, wrap: true },
            {
              value:
                r.factory_mapping_instruction ||
                (r.source === "missing" ? "⚠ Missing factory mapping" : ""),
              backgroundColor: rowTint,
              wrap: true,
            },
            {
              value: r.manual_override || "",
              backgroundColor: rowTint,
              wrap: true,
            },
            {
              value: r.final_factory_instruction || "",
              backgroundColor: rowTint,
              wrap: true,
              fontWeight: r.source !== "missing" ? "bold" : undefined,
            },
            { value: r.factory_code ?? "", backgroundColor: rowTint },
            { value: r.note, backgroundColor: rowTint, wrap: true },
          ]);
        }

        // Append technical refs as informational rows.
        for (const t of l.technical_entries) {
          taskRows.push([
            { value: sectionLabel, backgroundColor: "#fffbeb", wrap: true },
            { value: t.label, backgroundColor: "#fffbeb" },
            { value: "—", backgroundColor: "#fffbeb" },
            { value: "—", backgroundColor: "#fffbeb" },
            { value: "—", backgroundColor: "#fffbeb" },
            { value: t.value, backgroundColor: "#fffbeb", wrap: true },
            { value: "", backgroundColor: "#fffbeb" },
            { value: "Technical reference", backgroundColor: "#fffbeb" },
          ]);
        }
      }

      // ----------------------------------------------------------------
      // SHEET 3 — Missing Mappings (only if there are any)
      // ----------------------------------------------------------------
      const missingHeader: Cell[] = [
        h("Section"),
        h("Field"),
        h("Sales value"),
        h("Problem"),
        h("Action required"),
      ];
      const missingRows: Cell[][] = [missingHeader];
      for (const l of data.lines) {
        const sectionLabel =
          l.product_name +
          (l.product_sku ? ` · ${l.product_sku}` : "") +
          ` (×${l.quantity})`;
        for (const r of l.rows) {
          if (r.source !== "missing") continue;
          if (r.note === "Legacy field (no definition)") continue; // not a mapping issue
          if (r.note === "Sales field — no mapping required") continue;
          missingRows.push([
            { value: sectionLabel, backgroundColor: "#fee2e2", wrap: true },
            { value: r.field_name, backgroundColor: "#fee2e2" },
            { value: r.sales_value, backgroundColor: "#fee2e2" },
            {
              value:
                "No factory mapping exists for this sales value.",
              backgroundColor: "#fee2e2",
              wrap: true,
            },
            {
              value:
                "Add the mapping in Admin → Factory mapping, OR set a one-off override on this task list line.",
              backgroundColor: "#fee2e2",
              wrap: true,
            },
          ]);
        }
      }
      const hasMissing = missingRows.length > 1;

      // ----------------------------------------------------------------
      // Column widths
      // ----------------------------------------------------------------
      const summaryColumns = [
        { width: 26 },
        { width: 40 },
        { width: 14 },
        { width: 50 },
      ];
      const taskColumns = [
        { width: 32 }, // Section
        { width: 20 }, // Field
        { width: 18 }, // Sales value
        { width: 48 }, // Mapping
        { width: 48 }, // Override
        { width: 52 }, // Final
        { width: 16 }, // Code
        { width: 18 }, // Notes
      ];
      const missingColumns = [
        { width: 32 },
        { width: 20 },
        { width: 18 },
        { width: 50 },
        { width: 60 },
      ];

      // ----------------------------------------------------------------
      // Assemble and write — multi-sheet with sticky header row on the
      // task list + missing-mappings sheets (Sheet 1's first rows are
      // dedicated to the title banner, not a row of column headers).
      // ----------------------------------------------------------------
      const sheets: any[] = [
        {
          sheet: "Order Summary",
          data: summarySheet,
          columns: summaryColumns,
        },
        {
          sheet: "Factory Task List",
          data: taskRows,
          columns: taskColumns,
          stickyRowsCount: 1,
        },
      ];
      if (hasMissing) {
        sheets.push({
          sheet: "Missing Mappings",
          data: missingRows,
          columns: missingColumns,
          stickyRowsCount: 1,
        });
      }

      await writeXlsxFile(sheets).toFile(`${data.number}-FACTORY.xlsx`);

      // ----- Small helpers -----
      function kv(label: string, value: string): Cell[] {
        return [
          { value: label, fontWeight: "bold" },
          { value, wrap: true },
        ];
      }
      function h(label: string): Cell {
        return {
          value: label,
          fontWeight: "bold",
          backgroundColor: HEADER_BG,
          color: HEADER_TEXT,
          align: "left",
        };
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to generate Excel file");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={working}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border border-emerald-700 bg-white px-3.5 py-2 text-sm font-semibold text-emerald-800 shadow-sm transition-colors hover:bg-emerald-50 disabled:opacity-50"
        title="Download the factory task list as an editable .xlsx"
      >
        {working ? "Generating…" : "Export Excel"}
      </button>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB");
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}
function clientLabel(d: {
  client: { company_name: string; client_code: string | null };
}): string {
  return (
    d.client.company_name +
    (d.client.client_code ? ` · ${d.client.client_code}` : "")
  );
}
