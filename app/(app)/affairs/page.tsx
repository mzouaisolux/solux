// =====================================================================
// The top-level "Affaires" module has been RETIRED (owner decision 2026-06-02):
// the Client Hub is the single entry point. The affair list now lives in the
// Client Hub (Clients → a client → Affaires tab); the affair WORKSPACE stays at
// /affairs/[id]. This legacy list route redirects to the new primary surface.
// (The old list components — AffairsExperimentalView / ClientCard — are now
// dead code, scheduled for a later cleanup.)
// =====================================================================

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AffairsListRetired() {
  redirect("/clients");
}
