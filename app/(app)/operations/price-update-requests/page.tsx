import IncomingRequestQueuePlaceholder from "@/components/requests/IncomingRequestQueuePlaceholder";

export const dynamic = "force-dynamic";

/**
 * PRICE UPDATE REQUESTS — placeholder queue (incoming Requests menu).
 * Price updates are today a kind of Transport Request (m161) for transport
 * prices, and Shipping Updates (m149) for document freight refreshes; this
 * page becomes the unified queue when the price-update module ships.
 */
export default function PriceUpdateRequestsPage() {
  return (
    <IncomingRequestQueuePlaceholder
      title="Price Update Requests"
      description="Price refresh requests from Sales on existing quotations and transport prices."
      capabilities={["shipping.process_update"]}
      todayHint={{
        label: "Transport Requests",
        href: "/operations/transport-requests",
      }}
    />
  );
}
