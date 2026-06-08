import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { hasUiCapability } from "@/lib/permissions";
import AccessDenied from "@/components/AccessDenied";
import NewProjectForm from "./NewProjectForm";

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  await getEffectiveRole();
  const canCreate = await hasUiCapability("project.create");
  if (!canCreate) return <AccessDenied capability="project.create" />;

  const supabase = createClient();
  const [{ data: clients }, { data: categories }] = await Promise.all([
    supabase.from("clients").select("id, company_name, country").order("company_name", { ascending: true }),
    supabase
      .from("product_categories")
      .select("id, name")
      .eq("is_template", false)
      .order("position")
      .order("name"),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <Link href="/projects" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Project Requests
      </Link>
      <div>
        <h1 className="doc-title">New project request</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Capture the essentials — you can attach tender documents, specs and drawings on the
          next screen, then submit for the Sales Director&apos;s approval.
        </p>
      </div>
      <NewProjectForm
        clients={((clients ?? []) as any[]).map((c) => ({
          id: c.id,
          name: c.company_name,
          country: c.country ?? null,
        }))}
        categories={((categories ?? []) as any[]).map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
