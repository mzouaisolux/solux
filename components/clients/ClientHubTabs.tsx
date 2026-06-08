// =====================================================================
// Client Hub tab bar (Stage B). URL-driven (Next Links → ?tab=…), no client
// state. The "Overview" tab is the default (no ?tab). Server component.
// =====================================================================

import Link from "next/link";

export const HUB_TABS = [
  "overview",
  "affairs",
  "documents",
  "messages",
  "contacts",
  "activity",
] as const;
export type HubTab = (typeof HUB_TABS)[number];

const LABEL: Record<HubTab, string> = {
  overview: "Overview",
  affairs: "Affairs",
  documents: "Documents",
  messages: "Messages",
  contacts: "Contacts",
  activity: "Activity",
};

export function ClientHubTabs({
  clientId,
  active,
}: {
  clientId: string;
  active: HubTab;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-neutral-200">
      {HUB_TABS.map((t) => {
        const isActive = t === active;
        // Affairs is the default tab → it owns the bare client URL.
        const href =
          t === "affairs"
            ? `/clients/${clientId}`
            : `/clients/${clientId}?tab=${t}`;
        return (
          <Link
            key={t}
            href={href}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
              isActive
                ? "border-solux text-solux-ink"
                : "border-transparent text-neutral-500 hover:text-neutral-800"
            }`}
          >
            {LABEL[t]}
          </Link>
        );
      })}
    </div>
  );
}
