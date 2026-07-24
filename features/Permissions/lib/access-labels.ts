/**
 * Business-friendly vocabulary for the visibility/access admin.
 *
 * The DB stores technical scope types (self/team/region/lens/all); this
 * module maps them to wording, help text, operational examples and colors
 * that a manager — not a developer — can understand. Pure module (no
 * server imports) so both the server page and the client GrantForm use it.
 */

export type AccessTypeKey = "self" | "team" | "region" | "lens" | "all";
export type Tone = "rose" | "violet" | "indigo" | "amber" | "neutral";

export type AccessTypeInfo = {
  /** Manager-facing name (what we show instead of "scope"). */
  label: string;
  /** What it does, in one plain sentence. */
  help: string;
  /** A real example of who gets this. */
  example: string;
  tone: Tone;
};

/** Ordered for the picker: broad → narrow. */
export const ACCESS_TYPES: Record<AccessTypeKey, AccessTypeInfo> = {
  all: {
    label: "Full visibility (everything)",
    help: "Sees every client, quotation, task list and order across the whole company.",
    example: "Super admins, company directors.",
    tone: "rose",
  },
  region: {
    label: "Region access",
    help: "Sees all accounts in a region — and every project those accounts run.",
    example: "A regional director: “all Africa accounts”.",
    tone: "violet",
  },
  team: {
    label: "Team access",
    help: "Sees everything owned by the members of a sales team.",
    example: "A Task List Manager supervising Mehdi + Gavin + Hamza.",
    tone: "indigo",
  },
  lens: {
    label: "Department access",
    help: "Cross-department, workflow-based access — regardless of which salesperson owns the deal.",
    example: "Production, Finance or Logistics back-office teams.",
    tone: "amber",
  },
  self: {
    label: "Own records only",
    help: "Sees only the clients and deals they personally own.",
    example: "An individual sales rep.",
    tone: "neutral",
  },
};

export type LensKey = "production" | "finance" | "logistics";

export type LensInfo = {
  label: string;
  /** Plain list of what this department can view. */
  sees: string[];
};

export const LENS_INFO: Record<LensKey, LensInfo> = {
  production: {
    label: "Production",
    sees: [
      "Validated task lists",
      "Production orders",
      "Factory release documents",
    ],
  },
  finance: {
    label: "Finance",
    sees: ["Won quotations", "Invoices", "Payment data", "Revenue dashboards"],
  },
  logistics: {
    label: "Logistics",
    sees: ["Shipments & ETA", "BL / booking data", "Shipping workflows"],
  },
};

/** Tailwind classes per tone (literal, so they're not purged). */
export const TONE_BADGE: Record<Tone, string> = {
  rose: "bg-rose-50 border-rose-200 text-rose-900",
  violet: "bg-violet-50 border-violet-200 text-violet-900",
  indigo: "bg-indigo-50 border-indigo-200 text-indigo-900",
  amber: "bg-amber-50 border-amber-200 text-amber-900",
  neutral: "bg-neutral-100 border-neutral-200 text-neutral-700",
};

/** Short label for an access-rule chip, e.g. "Team · Africa". */
export function grantChipLabel(
  scopeType: string,
  teamName: string | null,
  lensKey: string | null
): string {
  switch (scopeType) {
    case "all":
      return "Everything";
    case "region":
      return `Region · ${teamName ?? "?"}`;
    case "team":
      return `Team · ${teamName ?? "?"}`;
    case "lens":
      return `${LENS_INFO[lensKey as LensKey]?.label ?? lensKey} dept.`;
    case "self":
      return "Own records";
    default:
      return scopeType;
  }
}

export function grantTone(scopeType: string): Tone {
  return ACCESS_TYPES[scopeType as AccessTypeKey]?.tone ?? "neutral";
}

/**
 * Plain-English bullets of what a user can actually SEE, given their
 * grants. Empty grants → the role default sentence.
 */
export function visibilitySummary(
  grants: Array<{ scope_type: string; team_id: string | null; lens_key: string | null }>,
  teamName: (id: string | null) => string
): string[] {
  if (grants.length === 0) {
    return [
      "Default for their role — sales: their own clients & deals; management: everything.",
    ];
  }
  const out: string[] = [];
  for (const g of grants) {
    switch (g.scope_type) {
      case "all":
        out.push("Everything across the company");
        break;
      case "region":
        out.push(`All ${teamName(g.team_id)} accounts & their projects`);
        break;
      case "team":
        out.push(`Everything owned by ${teamName(g.team_id)} members`);
        break;
      case "lens": {
        const info = LENS_INFO[g.lens_key as LensKey];
        out.push(
          info ? `${info.label}: ${info.sees.join(", ")}` : `${g.lens_key} workflows`
        );
        break;
      }
      case "self":
        out.push("Their own clients & deals");
        break;
    }
  }
  return out;
}
