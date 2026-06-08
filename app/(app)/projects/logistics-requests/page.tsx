import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import { ProjectQueueTable, type QueueRow } from "@/components/projects/ProjectQueueTable";

export const dynamic = "force-dynamic";

/** Packing + Freight requests still pending. */
export default async function LogisticsRequestsPage() {
  await getEffectiveRole();
  if (!(await hasUiCapability("project.enter_logistics"))) return <AccessDenied capability="project.enter_logistics" />;

  const supabase = createClient();
  const sel = "id, status, project_requests:project_request_id(id, name, status, quantity, country, archived_at, clients:client_id(company_name))";
  const [{ data: packing }, { data: freight }] = await Promise.all([
    supabase.from("packing_list_requests").select(sel).eq("status", "pending"),
    supabase.from("freight_cost_requests").select(sel).eq("status", "pending"),
  ]);

  const byId = new Map<string, QueueRow>();
  for (const c of [...((packing ?? []) as any[]), ...((freight ?? []) as any[])]) {
    const pr = c.project_requests;
    if (!pr || pr.archived_at) continue;
    if (!byId.has(pr.id)) {
      byId.set(pr.id, {
        id: pr.id,
        name: pr.name,
        clientName: pr.clients?.company_name ?? null,
        country: pr.country,
        quantity: pr.quantity,
        status: pr.status,
      });
    }
  }
  const rows = Array.from(byId.values());

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div>
        <div className="eyebrow">{rows.length} project{rows.length === 1 ? "" : "s"} need packing / freight</div>
        <h1 className="doc-title mt-1">Logistics Requests</h1>
      </div>
      <ProjectQueueTable rows={rows} emptyText="No packing or freight requests pending." />
    </div>
  );
}
