import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import { ProjectQueueTable, type QueueRow } from "@/components/projects/ProjectQueueTable";

export const dynamic = "force-dynamic";

export default async function PendingApprovalsPage() {
  await getEffectiveRole();
  if (!(await hasUiCapability("project.approve"))) return <AccessDenied capability="project.approve" />;

  const supabase = createClient();
  const { data } = await supabase
    .from("project_requests")
    .select("id, name, status, quantity, country, clients:client_id(company_name)")
    .eq("status", "waiting_director_approval")
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  const rows: QueueRow[] = ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    clientName: r.clients?.company_name ?? null,
    country: r.country,
    quantity: r.quantity,
    status: r.status,
  }));

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div>
        <div className="eyebrow">{rows.length} awaiting decision</div>
        <h1 className="doc-title mt-1">Pending Approvals</h1>
      </div>
      <ProjectQueueTable rows={rows} emptyText="Nothing awaiting director approval." />
    </div>
  );
}
