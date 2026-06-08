import Link from "next/link";
import ImportClient from "./ImportClient";

export default function ImportProductsPage() {
  return (
    <div className="mx-auto max-w-4xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Import products</h1>
        <Link href="/admin/products" className="text-sm hover:underline">
          ← Back to products
        </Link>
      </div>
      <ImportClient />
    </div>
  );
}
