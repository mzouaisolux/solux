import IncomingRequestQueuePlaceholder from "@/components/requests/IncomingRequestQueuePlaceholder";

export const dynamic = "force-dynamic";

/**
 * CUSTOM PRODUCT REQUESTS — placeholder queue (incoming Requests menu).
 * Custom product requests are today submitted as Service Requests with the
 * product-pricing service; this page becomes their dedicated queue.
 */
export default function CustomProductRequestsPage() {
  return (
    <IncomingRequestQueuePlaceholder
      title="Custom Product Requests"
      description="Non-catalogue products requested by Sales — specs to study, cost and price."
      capabilities={["project.enter_cost", "task_list.validate"]}
      todayHint={{ label: "Service Requests", href: "/projects" }}
    />
  );
}
