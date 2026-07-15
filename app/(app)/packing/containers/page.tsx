// =====================================================================
// /packing/containers — configurable, versioned & audited container capacity.
// =====================================================================
import { createClient } from "@/lib/supabase/server";
import ContainerConfigEditor from "@/components/packing/ContainerConfigEditor";

export const dynamic = "force-dynamic";

export default async function ContainersPage() {
  const sb = createClient();
  const [{ data: containers }, { data: changes }] = await Promise.all([
    sb.from("packing_container_type").select("*").order("code"),
    sb
      .from("packing_container_type_change")
      .select("code, field, old_value, new_value, reason, changed_at, effective_date")
      .order("changed_at", { ascending: false })
      .limit(60),
  ]);
  return <ContainerConfigEditor containers={(containers ?? []) as any} changes={(changes ?? []) as any} />;
}
