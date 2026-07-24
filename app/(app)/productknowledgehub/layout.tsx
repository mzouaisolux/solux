import { canAccessOrAdmin } from "@/features/Permissions/lib/permissions";
import HubTabs, { type HubTab } from "@/components/HubTabs";

/**
 * Knowledge Hub section layout — renders the page-tab bar across every
 * /productknowledgehub/* route. Browse (families directory + family/model
 * detail) is the base tab; Change requests is read-only; Import baseline and
 * Schema editor are capability-gated so a user never sees a tab they can't open.
 */
export default async function KnowledgeHubLayout({ children }: { children: React.ReactNode }) {
  // Gate exactly like the pages themselves (capability OR admin), so an admin
  // who can open Import/Schema always sees their tabs.
  const [canImport, canSchema] = await Promise.all([
    canAccessOrAdmin(["spec.import"]),
    canAccessOrAdmin(["spec.manage_schema"]),
  ]);

  const tabs: HubTab[] = [
    { href: "/productknowledgehub", label: "Browse", base: true },
    { href: "/productknowledgehub/requests", label: "Change requests" },
    ...(canImport ? [{ href: "/productknowledgehub/import", label: "Import baseline" } satisfies HubTab] : []),
    ...(canSchema ? [{ href: "/productknowledgehub/schema", label: "Schema editor" } satisfies HubTab] : []),
  ];

  return (
    <>
      <HubTabs tabs={tabs} />
      {children}
    </>
  );
}
