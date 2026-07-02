import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hasUiCapability } from "@/lib/permissions";
import { ImportWizard } from "./ImportWizard";
import type { ProductOption } from "@/lib/import/dto";

// Fresh render: the wizard is fully interactive; no stale catalog.
export const dynamic = "force-dynamic";

export default async function ImportInvoicesPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();

  const { data: client } = await supabase
    .from("clients")
    .select("id, company_name, client_code")
    .eq("id", params.id)
    .maybeSingle();
  if (!client) notFound();

  // Same capability that lets a user create commercial documents for a client.
  const canImport = await hasUiCapability("quotation.create");
  if (!canImport) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <div className="eyebrow">Access denied</div>
        <h1 className="doc-title mt-1">Not available for your role</h1>
        <p className="mt-2 text-sm text-neutral-500">
          Importing historical invoices requires the{" "}
          <code className="font-mono text-[12px]">quotation.create</code> capability.
          Ask a super-admin to enable it in <span className="font-medium">/permissions/actions</span>.
        </p>
        <div className="mt-6">
          <Link href={`/clients/${params.id}`} className="btn-secondary">
            ← Back to customer
          </Link>
        </div>
      </div>
    );
  }

  // Catalog for the "match existing product" picker (active = excludes legacy,
  // which are created with active=false).
  const { data: prods } = await supabase
    .from("products")
    .select("id, name, sku, category, category_id")
    .eq("active", true)
    .order("name");
  const products: ProductOption[] = (prods ?? []).map((p: any) => ({
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    categoryId: p.category_id ?? null,
    categoryName: p.category ?? null,
  }));

  const { data: cats } = await supabase
    .from("product_categories")
    .select("id, name")
    .order("name");
  const categories = (cats ?? []).map((c: any) => ({ id: c.id, name: c.name }));

  return (
    <ImportWizard
      clientId={client.id}
      clientName={client.company_name}
      clientCode={client.client_code ?? null}
      products={products}
      categories={categories}
    />
  );
}
