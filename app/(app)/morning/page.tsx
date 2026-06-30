// =====================================================================
// /morning — MERGED into the dashboard (Phase 2, locked spec: "page
// d'atterrissage unique — My Morning supprimée, URL redirigée").
// Overdue/today actions and sleeping deals live in the SALES tab;
// the team table and geography analytics moved to /business.
// =====================================================================

import { redirect } from "next/navigation";

export default function MorningRedirect() {
  redirect("/dashboard?tab=sales");
}
