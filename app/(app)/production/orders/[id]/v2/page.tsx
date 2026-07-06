import { redirect } from "next/navigation";

/**
 * The V2 cockpit is no longer a separate prototype — it has BECOME the live
 * Production Order page (`../page.tsx`). One page, one workflow, one Operations
 * Cockpit. This route stays only to redirect any bookmarked `/v2` links to the
 * real page.
 */
export default function ProductionOrderV2Redirect({
  params,
}: {
  params: { id: string };
}) {
  redirect(`/production/orders/${params.id}`);
}
