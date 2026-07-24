/**
 * Knowledge Hub — change-requests list (Section 14). A standalone, cross-family
 * view of every spec change request with a status filter and inline actions.
 * Server component: guards on `spec.read`, loads all requests (family name +
 * author resolved), and passes the caller's raise/approve capabilities so the
 * client can show the right inline actions. Writes happen inside the existing
 * server actions the client calls.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessOrAdmin, hasUiCapability } from "@/lib/permissions";
import { listAllChangeRequests, listFamilies } from "../lib/read";
import { RequestsList } from "../components/RequestsList";
import { NewChangeRequestModal } from "../components/NewChangeRequestModal";

export default async function KnowledgeHubRequests() {
  const ok = await canAccessOrAdmin(["spec.read"]);
  if (!ok) notFound();

  const [requests, canRaise, canApprove] = await Promise.all([
    listAllChangeRequests(),
    hasUiCapability("spec.raise"),
    hasUiCapability("spec.approve"),
  ]);
  // Families for the "New change request" picker (only fetched when raising is possible).
  const families = canRaise ? await listFamilies() : [];

  return (
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <div className="sx-head">
          <div>
            <div className="sx-eyebrow">
              <Link href="/productknowledgehub" className="sx-link">
                Knowledge Hub
              </Link>{" "}
              · governance
            </div>
            <h1 className="sx-h1">Change requests</h1>
            <p className="sx-sub">
              Every spec change request across all families. Filter by status; submit, review, approve or reject
              inline.
            </p>
          </div>
          {canRaise && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <NewChangeRequestModal families={families} />
            </div>
          )}
        </div>

        <RequestsList requests={requests} canRaise={canRaise} canApprove={canApprove} />
      </div>
    </div>
  );
}
