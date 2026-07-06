/**
 * Product Lighting Setup — read-only card for the Production Order page.
 *
 * Async server component: self-fetches the approved lighting config anchored on
 * the order's proforma (product_lighting_setups.document_id = order.quotation_id)
 * under the viewer's JWT (RLS decides visibility), signs the study downloads,
 * and renders a Premium CollapsibleSection. If there is no setup (pre-feature or
 * non-lighting orders) it renders NOTHING — fully additive, disrupts nobody.
 *
 * This is the Operations/Manufacturing/QC view of what Sales approved at launch:
 * lighting power, the dimming program, operating hours, the approved optic, and
 * the Energy Study + Dialux studies.
 */

import { createClient } from "@/lib/supabase/server";
import {
  CollapsibleSection,
  SummaryRow,
  SummaryStat,
} from "@/components/production/CollapsibleSection";
import { PremiumPill } from "@/components/production/premium-ui";
import { ATTACHMENTS_BUCKET } from "@/lib/attachments";
import {
  normalizeLightingProgram,
  totalProgramHours,
} from "@/lib/lighting/validate";
import type { LightingSetupRow } from "@/lib/lighting/types";

export default async function ProductLightingSetupCard({
  documentId,
}: {
  documentId: string | null | undefined;
}) {
  if (!documentId) return null;

  const supabase = createClient();
  const { data } = await supabase
    .from("product_lighting_setups")
    .select(
      "id, document_id, lighting_power, operating_hours, lighting_program, approved_optics, energy_study_path, energy_study_name, dialux_path, dialux_name, ai_extracted, created_at"
    )
    .eq("document_id", documentId)
    .maybeSingle();

  if (!data) return null; // no setup for this order → nothing to show (additive)
  const row = data as unknown as LightingSetupRow;

  const program = normalizeLightingProgram(row.lighting_program);
  const totalHours = totalProgramHours(program);

  async function signedUrl(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(path, 600); // 10 min
    return data?.signedUrl ?? null;
  }
  const energyUrl = await signedUrl(row.energy_study_path);
  const dialuxUrl = await signedUrl(row.dialux_path);

  const power = row.lighting_power != null ? `${row.lighting_power} W` : "—";
  const hours =
    row.operating_hours != null ? `${row.operating_hours} h/night` : "—";
  const optics = row.approved_optics?.trim() || "—";

  return (
    <CollapsibleSection
      title="Product Lighting Setup"
      icon={<LightIcon />}
      badge={<PremiumPill variant="pos">Configured</PremiumPill>}
      summary={
        <SummaryRow>
          <SummaryStat label="Lighting power" value={power} />
          <SummaryStat label="Operating hours" value={hours} />
          <SummaryStat label="Approved optics" value={optics} />
          <SummaryStat
            label="Program"
            value={
              program.length
                ? `${program.length} period${program.length > 1 ? "s" : ""} · ${totalHours} h`
                : "—"
            }
          />
          <SummaryStat
            label="Energy Study"
            value={row.energy_study_path ? "Attached" : "—"}
            tone={row.energy_study_path ? "success" : "muted"}
          />
          <SummaryStat
            label="Dialux Study"
            value={row.dialux_path ? "Attached" : "—"}
            tone={row.dialux_path ? "success" : "muted"}
          />
        </SummaryRow>
      }
    >
      <p className="text-xs text-neutral-500 mb-4">
        Approved lighting configuration transferred from Sales at Launch
        Production. Reference for manufacturing, controller programming and
        quality control.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Configuration */}
        <div className="rounded-md border border-neutral-200/80 bg-neutral-50/40 p-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-700">
            Configuration
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Cell label="Lighting power" value={power} />
            <Cell label="Operating hours" value={hours} />
            <Cell label="Approved optics" value={optics} />
            <Cell label="Total programmed" value={`${totalHours} h`} />
          </div>
        </div>

        {/* Documents */}
        <div className="rounded-md border border-neutral-200/80 bg-neutral-50/40 p-4 space-y-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-700">
            Documents
          </div>
          <StudyLink
            label="Energy Study"
            url={energyUrl}
            name={row.energy_study_name}
          />
          <StudyLink
            label="Dialux Study"
            url={dialuxUrl}
            name={row.dialux_name}
          />
        </div>
      </div>

      {/* Lighting program table */}
      <div className="mt-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-700 mb-2">
          Lighting program
        </div>
        {program.length ? (
          <div className="overflow-hidden rounded-md border border-neutral-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="text-left font-semibold px-3 py-2">Output</th>
                  <th className="text-left font-semibold px-3 py-2">Duration</th>
                  <th className="text-left font-semibold px-3 py-2">
                    Presence detection
                  </th>
                </tr>
              </thead>
              <tbody>
                {program.map((p, i) => (
                  <tr key={i} className="border-t border-neutral-100">
                    <td className="px-3 py-2 tabular-nums">{p.output}%</td>
                    <td className="px-3 py-2 tabular-nums">
                      {p.duration_hours} h
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {p.presence_detection ? (
                        <span className="text-amber-700">
                          ⚡ boost {p.detection_output ?? 100}% ·{" "}
                          {p.detection_hold_seconds ?? "—"} s
                          {p.estimated_detections != null
                            ? ` · ~${p.estimated_detections}/night`
                            : ""}
                        </span>
                      ) : (
                        <span className="text-neutral-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">No program defined.</p>
        )}
      </div>

      {/* Dialux configurations (AI-extracted at setup, reviewed by Sales) */}
      {row.ai_extracted?.dialux?.configurations?.length ? (
        <div className="mt-4">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-700 mb-2">
            Dialux configurations
          </div>
          <div className="overflow-x-auto rounded-md border border-neutral-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="text-left font-semibold px-3 py-2">
                    Configuration
                  </th>
                  <th className="text-left font-semibold px-3 py-2">Power</th>
                  <th className="text-left font-semibold px-3 py-2">
                    Mounting height
                  </th>
                  <th className="text-left font-semibold px-3 py-2">Optic</th>
                  <th className="text-left font-semibold px-3 py-2">CCT</th>
                  <th className="text-left font-semibold px-3 py-2">Qty</th>
                </tr>
              </thead>
              <tbody>
                {row.ai_extracted.dialux.configurations.map((c, i) => {
                  const optic = [
                    c.optic_code,
                    c.optic_lens_type,
                    c.optic_beam_distribution,
                  ]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <tr key={i} className="border-t border-neutral-100">
                      <td className="px-3 py-2 text-xs text-neutral-600">
                        {c.label ?? `Configuration ${i + 1}`}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {c.power != null ? `${c.power} W` : "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {c.mounting_height != null
                          ? `${c.mounting_height} m`
                          : "—"}
                      </td>
                      <td className="px-3 py-2">{optic || "—"}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {c.cct != null ? `${c.cct} K` : "—"}
                      </td>
                      <td className="px-3 py-2 tabular-nums">
                        {c.quantity != null ? c.quantity : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {row.ai_extracted ? (
        <p className="mt-3 text-[11px] text-neutral-400">
          Some values were pre-filled from the technical studies by AI and
          confirmed by Sales.
        </p>
      ) : null}
    </CollapsibleSection>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="text-sm text-neutral-800 tabular-nums">{value}</div>
    </div>
  );
}

function StudyLink({
  label,
  url,
  name,
  required = false,
}: {
  label: string;
  url: string | null;
  name: string | null;
  required?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-neutral-700">
          {label}
          {required ? (
            <span className="text-neutral-400 font-normal"> · required</span>
          ) : null}
        </div>
        {name ? (
          <div className="text-xs text-neutral-500 truncate">{name}</div>
        ) : (
          <div className="text-xs text-neutral-400">Not provided</div>
        )}
      </div>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs font-semibold text-solux hover:underline"
        >
          Download
        </a>
      ) : null}
    </div>
  );
}

function LightIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path d="M10 2a5 5 0 00-3 9v2.5a.5.5 0 00.5.5h5a.5.5 0 00.5-.5V11a5 5 0 00-3-9zM7.5 16a.5.5 0 000 1h5a.5.5 0 000-1h-5zm.5 2a.5.5 0 000 1h4a.5.5 0 000-1H8z" />
    </svg>
  );
}
