import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ImagesUploadClient from "./ImagesUploadClient";

export default async function ImagesUploadPage() {
  const supabase = createClient();
  const { data: products } = await supabase
    .from("products")
    .select("id, name, sku, image_url")
    .not("sku", "is", null)
    .order("sku", { ascending: true });

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Bulk upload product images</h1>
        <Link href="/admin/products" className="text-sm hover:underline">
          ← Back to products
        </Link>
      </div>
      <ImagesUploadClient products={products ?? []} />
    </div>
  );
}
