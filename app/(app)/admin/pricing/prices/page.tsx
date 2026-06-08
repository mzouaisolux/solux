import { redirect } from "next/navigation";

/**
 * The standalone Prices page has been folded into the Pricing control center
 * (/admin/pricing), where price preview now lives alongside category margins.
 */
export default function PricesRedirect({ searchParams }: { searchParams?: { list?: string } }) {
  redirect(searchParams?.list ? `/admin/pricing?list=${searchParams.list}` : "/admin/pricing");
}
