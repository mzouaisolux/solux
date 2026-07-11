import IncomingRequestQueuePlaceholder from "@/components/requests/IncomingRequestQueuePlaceholder";

export const dynamic = "force-dynamic";

/**
 * PACKING LIST REQUESTS — placeholder queue (incoming Requests menu).
 * Packing lists are today a kind of Transport Request (m161); this page
 * becomes their dedicated queue when the packing module ships.
 */
export default function PackingListRequestsPage() {
  return (
    <IncomingRequestQueuePlaceholder
      title="Packing List Requests"
      description="Packing lists requested by Sales — with the exact product configuration to pack."
      capabilities={["shipping.process_update"]}
      todayHint={{
        label: "Transport Requests",
        href: "/operations/transport-requests",
      }}
    />
  );
}
