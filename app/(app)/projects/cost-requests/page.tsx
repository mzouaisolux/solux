import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import { ProjectQueueTable, type QueueRow } from "@/components/projects/ProjectQueueTable";

export const dynamic = "force-dynamic";

/** Factory cost requests still pending. RLS limits this to cost-viewers. */
export default async function CostRequestsPage() {
  await getEffectiveRole();
  if (!(await hasUiCapability("project.view_cost"))) return <AccessDenied capability="project.view_cost" />;

  const supabase = createClient();
  const { data } = await supabase
    .from("factory_cost_requests")
    .select("id, status, project_requests:project_request_id(id, name, status, quantity, country, archived_at, clients:client_id(company_name))")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const rows: QueueRow[] = ((data ?? []) as any[])
    .map((c) => c.project_requests)
    .filter((pr: any) => pr && !pr.archived_at)
    .map((pr: any) => ({
      id: pr.id,
      name: pr.name,
      clientName: pr.clients?.company_name ?? null,
      country: pr.country,
      quantity: pr.quantity,
      status: pr.status,
    }));

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-6">
      <div>
        <div className="eyebrow">{rows.length} cost{rows.length === 1 ? "" : "s"} to enter</div>
        <h1 className="doc-title mt-1">Cost Requests</h1>
      </div>
      <ProjectQueueTable rows={rows} emptyText="No factory cost requests pending." />
    </div>
  );
}
