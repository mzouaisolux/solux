import Link from "next/link";
import {
  normalizeBlProfile,
  blDocumentCostByCurrency,
  type BlProfile,
} from "@/lib/bl";

/**
 * Read-only summary of a client's Shipping / BL profile, shown on the
 * client detail page so the profile is visible without entering edit
 * mode. Renders an empty-state prompt (with an Edit link) when no
 * profile has been configured yet.
 *
 * Pure presentational server component.
 */
export function ClientBlSummary({
  clientId,
  rawProfile,
}: {
  clientId: string;
  rawProfile: unknown;
}) {
  const configured = !!rawProfile && typeof rawProfile === "object";
  const profile: BlProfile = normalizeBlProfile(rawProfile);
  const includedDocs = profile.documents.filter((d) => d.included && d.label);
  const costByCur = blDocumentCostByCurrency(profile);

  return (
    <section className="panel p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="eyebrow">Shipping / BL profile</div>
          <p className="text-[11px] text-neutral-500 mt-0.5">
            Reusable parties + export-document checklist for this client.
          </p>
        </div>
        <Link
          href={`/clients/${clientId}/edit#bl`}
          className="text-[11px] text-neutral-600 hover:text-neutral-900 underline underline-offset-2 shrink-0"
        >
          {configured ? "Edit" : "Set up"} →
        </Link>
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
