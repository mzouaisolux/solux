// =====================================================================
// Tender Pipeline (m112) — /prospects/pipeline. The WORK surface for
// accepted tenders: Kanban from Accepted to Opportunity Created, the
// full tender cockpit opening below the board. The discovery inbox
// (/prospects) keeps only New / Rejected / Lost tenders.
// Gated by prospect.access; rows scoped by the m108 tenders RLS
// (sales see their own assignments, directors see everything).
// =====================================================================

import { getEffectiveRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import { TenderPipeline } from "@/components/prospects/TenderPipeline";
import { loadTendersBundle } from "../tenders-data";

export const dynamic = "force-dynamic";

export default async function TenderPipelinePage() {
  const { userId } = await getEffectiveRole();
  const canAccess = await hasUiCapability("prospect.access");
  if (!canAccess) return <AccessDenied capability="prospect.access" />;

  const bundle = await loadTendersBundle();

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div>
        <div className="eyebrow">CRM — execution</div>
        <h1 className="doc-title">Tender Pipeline</h1>
        <p className="mt-1 max-w-2xl text-sm text-neutral-500">
          The EXECUTION universe — accepted tenders being worked: find the local partner,
          contact, follow up, qualify the interest, and convert into an opportunity only
          once the partner confirms. Discovery and qualification happen in the Tender Inbox.
        </p>
      </div>
      <TenderPipeline
        tenders={bundle.tenders}
        clients={bundle.clients}
        prospects={bundle.prospectOptions}
        owners={bundle.owners}
        ownerLabels={bundle.ownerLabels}
        currentUserId={userId ?? null}
      />
    </div>
  );
}
