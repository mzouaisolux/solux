import { redirect } from "next/navigation";

/**
 * The cross-list dashboard is superseded by the price-list library on the main
 * Pricing page (each list is a saved, single-category object now).
 */
export default function PricingDashboardRedirect() {
  redirect("/admin/pricing");
}
