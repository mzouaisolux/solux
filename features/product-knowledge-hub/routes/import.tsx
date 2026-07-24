/**
 * Knowledge Hub — baseline import (admin-gated). Bulk-seed a family's spec
 * schema + values from a CSV (dry-run preview, then commit) and optionally
 * attach designed spec-sheet PDFs to models. Server component: guards on
 * `spec.import`, fetches the product list for the PDF dropdown, and renders the
 * client importer. Writes happen only inside the server actions it calls.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessOrAdmin } from "@/lib/permissions";
import { listProductsForImport } from "../lib/read";
import { ImportBaseline } from "../components/ImportBaseline";

export default async function KnowledgeHubImport() {
  const ok = await canAccessOrAdmin(["spec.import"]);
  if (!ok) notFound();

  const products = await listProductsForImport();

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <div className="sx-head">
          <div>
            <div className="sx-eyebrow">
              <Link href="/productknowledgehub" className="sx-link">
                Knowledge Hub
              </Link>{" "}
              · admin
            </div>
            <h1 className="sx-h1">Import baseline</h1>
            <p className="sx-sub">
              Seed spec fields and values from a CSV, then optionally attach the designed spec-sheet PDFs. Preview
              first — nothing is written until you commit.
            </p>
          </div>
        </div>

        <ImportBaseline products={products} />
      </div>
    </div>
  );
}
