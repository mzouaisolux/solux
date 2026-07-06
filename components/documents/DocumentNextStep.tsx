import QuotationActionBar from "@/components/documents/QuotationActionBar";
import InvoiceCreateMenu from "@/components/invoicing/InvoiceCreateMenu";
import DocStatusActions from "@/components/DocStatusActions";
import { documentKindLabel, documentKindLower } from "@/lib/document-label";
import { canInvoiceDocument, type InvoiceCreateOption } from "@/lib/invoicing";
import type { DocStatus } from "@/lib/types";

/**
 * "Next step" cockpit for a commercial document — the guided, one-primary-
 * action-at-a-time panel a rep (even a first-day one) can follow without
 * training. It propagates the Service-Request "Next step — gated by status &
 * role" pattern (the UX backlog's gold standard) onto the money screen.
 *
 * It does NOT reinvent behaviour: it COMPOSES the already-tested
 * `QuotationActionBar` (status transitions + Mark-Won confirm + Launch) and
 * `InvoiceCreateMenu` (deposit/balance creation), and adds only what was
 * missing — a status+role title, coaching copy, an explicit "Create deposit
 * invoice" primary at Won, and the secondary status moves in-context.
 *
 * Proforma-first (owner 2026-07-03): the vocabulary leads with "proforma".
 * Rendered only for the commercial document (type='quotation'); the internal
 * order-confirmation proforma keeps its own page.
 */

type Props = {
  doc: {
    id: string;
    status: string;
    type?: string | null;
    number?: string | null;
  };
  taskList: { id: string; number: string | null } | null;
  command: { id: string; number: string | null } | null;
  hasProductionOrder: boolean;
  canInvoice: boolean;
  invoiceOptions: InvoiceCreateOption[];
  currency: string | null;
  hasActiveInvoices: boolean;
};

export default function DocumentNextStep({
  doc,
  taskList,
  command,
  hasProductionOrder,
  canInvoice,
  invoiceOptions,
  currency,
  hasActiveInvoices,
}: Props) {
  const status = doc.status;
  const kindLower = documentKindLower(doc.type);
  const kind = documentKindLabel(doc.type);
  const deposit = invoiceOptions.find((o) => o.key === "deposit") ?? null;
  const balance = invoiceOptions.find((o) => o.key === "balance") ?? null;
  const inProduction = hasProductionOrder || !!taskList;

  // Invoicing is decoupled from "Won" (owner 2026-07-03): a deposit invoice is
  // a financial document available as soon as the proforma is sent — never
  // bound to the commercial "Won" decision. Same rule as the server guard.
  const showInvoiceActions = canInvoice && canInvoiceDocument(doc.type, status);
  const isWon = status === "won";
  const depositAvail = showInvoiceActions && !hasActiveInvoices && !!deposit?.enabled;
  const balanceAvail = showInvoiceActions && hasActiveInvoices && !!balance?.enabled;
  const terminal = status === "lost" || status === "cancelled";

  // Status + role title, and one line of coaching. This is the "no training
  // required" copy the owner asked for.
  let title = "";
  let help = "";
  switch (status) {
    case "draft":
      title = `Draft ${kindLower} — your move`;
      help = `Finish it and download the PDF (top-right) to send to the client. Already have the client's agreement? You can create a deposit invoice right now, or mark it Won directly — no need to mark it "Sent" first.`;
      break;
    case "sent":
      title = `${kind} sent — awaiting the client`;
      help = `Mark it Won when you consider the deal secured — or revise it. The client needs a deposit invoice now? You can create one here without marking it Won.`;
      break;
    case "negotiating":
      title = `In negotiation`;
      help = `Mark it Won when the deal is secured — or revise it. You can still issue a deposit invoice at any time, independently of Won.`;
      break;
    case "won":
      if (inProduction) {
        title = `Won — in production`;
        help = `Production has started (below). Create the balance invoice when it's due.`;
      } else if (hasActiveInvoices) {
        title = `Won — deposit invoiced`;
        help = `Send the deposit invoice to the client, create the balance invoice when it's due, or launch production.`;
      } else {
        title = `Won — invoice the deposit & start production`;
        help = `A deposit invoice is usually created once the client confirms the order. Then launch production to start manufacturing.`;
      }
      break;
    case "lost":
      title = `Lost`;
      help = `This deal is closed. You can revise it into a new version if it comes back.`;
      break;
    case "cancelled":
      title = `Cancelled`;
      help = `This deal is closed.`;
      break;
    default:
      title = kind;
  }

  return (
    <section className="panel p-4 sm:p-5">
      <div className="eyebrow">Next step</div>
      <div className="mt-1 text-[15px] font-semibold text-neutral-900">
        {title}
      </div>
      {help && (
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-neutral-500">
          {help}
        </p>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {/* PRIMARY invoice action — at Won only: deposit first, then balance.
            Explicit labels + amounts, never a generic "Create invoice". */}
        {isWon && depositAvail && (
          <InvoiceCreateMenu
            documentId={doc.id}
            currency={currency}
            options={invoiceOptions}
            only="deposit"
            oneClick
            variant="primary"
            label="Create deposit invoice"
          />
        )}
        {isWon && !depositAvail && balanceAvail && (
          <InvoiceCreateMenu
            documentId={doc.id}
            currency={currency}
            options={invoiceOptions}
            only="balance"
            oneClick
            variant="primary"
            label="Create balance invoice"
          />
        )}

        {/* Status transitions + Launch Production — reused, tested logic
            (Mark Won confirm, draft→won-in-one-step, etc.). Mark Won stays the
            primary commercial action while the deal is still in play. */}
        <QuotationActionBar
          doc={{ id: doc.id, status, type: doc.type ?? undefined }}
          taskList={taskList}
          command={command}
        />

        {/* DECOUPLED deposit — a financial document available from "sent"
            onward, WITHOUT marking the deal Won (owner 2026-07-03). Quiet
            secondary so it never competes with the deliberate Mark-Won. */}
        {!isWon && depositAvail && (
          <InvoiceCreateMenu
            documentId={doc.id}
            currency={currency}
            options={invoiceOptions}
            only="deposit"
            oneClick
            variant="light"
            label="Create deposit invoice"
          />
        )}

        {/* Any existing invoices → the full menu for the next one. */}
        {showInvoiceActions && hasActiveInvoices && (
          <InvoiceCreateMenu
            documentId={doc.id}
            currency={currency}
            options={invoiceOptions}
            variant="light"
            label="+ Another invoice"
          />
        )}
      </div>

      {/* Less-common status moves (Cancelled / Lost / Negotiating) — quiet,
          in-context, so they never compete with the primary action. */}
      {!terminal && (
        <div className="mt-3.5 border-t border-neutral-100 pt-3">
          <DocStatusActions docId={doc.id} current={status as DocStatus} />
        </div>
      )}
    </section>
  );
}
