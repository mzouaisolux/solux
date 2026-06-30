import Link from "next/link";
import {
  normalizeBlProfile,
  blDocumentCostByCurrency,
  blProfileStatus,
  blProfileMissingFields,
  type BlProfile,
} from "@/lib/bl";
import { RequestBlInfoButton } from "@/components/clients/RequestBlInfoButton";

/**
 * Read-only summary of a client's Shipping / BL profile, shown on the
 * client detail page AND in the Shipping & Logistics section of a
 * production order.
 *
 * BL workflow step (Sales → Operations): the block leads with a COMPUTED
 * completeness badge — Ready (green) / Incomplete (orange) / Missing
 * (red) — so Operations sees the booking blocker before the last minute.
 * When `requestOrderId` is provided (production-order context), an
 * incomplete profile shows the "Request information from Sales" button,
 * which notifies + tasks the deal's sales owner and logs the request in
 * the affair history.
 *
 * Server component; the request button posts a server action.
 */
export function ClientBlSummary({
  clientId,
  rawProfile,
  requestOrderId,
}: {
  clientId: string;
  rawProfile: unknown;
  /** Production order id — enables the "Request from Sales" button. */
  requestOrderId?: string;
}) {
  const configured = !!rawProfile && typeof rawProfile === "object";
  const profile: BlProfile = normalizeBlProfile(rawProfile);
  const includedDocs = profile.documents.filter((d) => d.included && d.label);
  const costByCur = blDocumentCostByCurrency(profile);
  const status = blProfileStatus(profile);
  const missing = blProfileMissingFields(profile);

  const badge = {
    complete: {
      label: "BL Profile Ready",
      cls: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
      dot: "bg-emerald-500",
      text: "Shipping profile complete and ready for booking.",
    },
    partial: {
      label: "BL Profile Incomplete",
      cls: "bg-amber-50 text-amber-800 ring-1 ring-amber-300",
      dot: "bg-amber-500",
      text: "Some required shipping information is still missing.",
    },
    missing: {
      label: "BL Profile Missing",
      cls: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
      dot: "bg-rose-500",
      text: "Shipping information must be completed before shipment booking.",
    },
  }[status];

  return (
    <section className="panel p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="eyebrow">Shipping / BL profile</div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${badge.cls}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${badge.dot}`} aria-hidden />
              {badge.label}
            </span>
          </div>
          <p
            className={`text-[11px] mt-1 ${
              status === "complete"
                ? "text-emerald-700"
                : status === "partial"
                  ? "text-amber-700"
                  : "text-rose-700"
            }`}
          >
            {badge.text}
            {status !== "complete" && missing.length > 0 && (
              <span className="text-neutral-500"> Missing: {missing.join(", ")}.</span>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status !== "complete" && requestOrderId && (
            <RequestBlInfoButton
              orderId={requestOrderId}
              tone={status === "missing" ? "missing" : "partial"}
            />
          )}
          <Link
            href={`/clients/${clientId}/edit#bl`}
            className="text-[11px] text-neutral-600 hover:text-neutral-900 underline underline-offset-2 shrink-0"
          >
            {configured ? "Edit" : "Set up"} →
          </Link>
        </div>
      </div>

      {!configured ? (
        <p className="text-xs text-neutral-400">
          No BL profile configured yet. Use Edit client to set the
          consignee, notify party and required documents.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <Party title="Consignee" p={profile.consignee} />
          <Party
            title="Notify party"
            p={
              profile.notify.same_as_consignee
                ? { ...profile.consignee, _note: "Same as consignee" }
                : profile.notify
            }
          />
          <div>
            <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium mb-1">
              Documents ({includedDocs.length})
            </div>
            {includedDocs.length === 0 ? (
              <p className="text-neutral-400">None selected</p>
            ) : (
              <ul className="space-y-0.5">
                {includedDocs.map((d) => (
                  <li
                    key={d.key}
                    className="flex items-baseline justify-between gap-2"
                  >
                    <span className="text-neutral-700 truncate">{d.label}</span>
                    {d.cost != null && d.cost > 0 && (
                      <span className="tabular-nums text-neutral-500 shrink-0">
                        {d.cost.toLocaleString()} {d.currency}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {costByCur.size > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-neutral-100 text-[11px] text-neutral-600">
                Doc costs:{" "}
                {Array.from(costByCur.entries())
                  .map(([cur, v]) => `${v.toLocaleString()} ${cur}`)
                  .join(" · ")}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Party({
  title,
  p,
}: {
  title: string;
  p: {
    company_name: string | null;
    address: string | null;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    _note?: string;
  };
}) {
  const lines = [
    p.company_name,
    p.contact_person,
    p.address,
    p.phone,
    p.email,
  ].filter(Boolean) as string[];
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-neutral-500 font-medium mb-1">
        {title}
      </div>
      {p._note ? (
        <p className="text-neutral-500 italic">{p._note}</p>
      ) : lines.length === 0 ? (
        <p className="text-neutral-400">—</p>
      ) : (
        <div className="space-y-0.5 text-neutral-700">
          {lines.map((l, i) => (
            <div key={i} className="truncate" title={l}>
              {l}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
