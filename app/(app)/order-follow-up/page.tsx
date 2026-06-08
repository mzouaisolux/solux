import { redirect } from "next/navigation";

/**
 * /order-follow-up is now consolidated into /operations.
 *
 * The previous split (two pages, two KPI strips, same data) created
 * visual duplication. The unified workspace at /operations now hosts
 * both the operational command center and the follow-up table. This
 * stub preserves any links / bookmarks that still point here.
 */
export default function OrderFollowUpPage() {
  redirect("/operations");
}
