/**
 * Knowledge Hub — schema editor (admin-gated). Add / edit / delete the spec
 * fields that make up each family's schema. Server component: guards on
 * `spec.manage_schema`, loads every family with its fields + value counts, and
 * renders the client editor. All writes happen inside the server actions it
 * calls (createSchemaField / updateSchemaField / deleteSchemaField), each of
 * which emits spec.schema_changed.
 *
 * Deliberately OUTSIDE the change-request flow: schema management is an admin
 * concern; raising a change request versions the *values*.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessOrAdmin } from "@/lib/permissions";
import { listSchemaFamilies } from "../lib/read";
import { SchemaEditor } from "../components/SchemaEditor";

export default async function KnowledgeHubSchema() {
  const ok = await canAccessOrAdmin(["spec.manage_schema"]);
  if (!ok) notFound();

  const families = await listSchemaFamilies();

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
            <h1 className="sx-h1">Schema editor</h1>
            <p className="sx-sub">
              Define the spec fields for each family. Changes apply immediately and are logged. A field can only be
              deleted once it has no values.
            </p>
          </div>
        </div>

        <SchemaEditor families={families} />
      </div>
    </div>
  );
}
