import Link from "next/link";
import type {
  NextAction,
  NextActionItem,
  NaTone,
} from "@/lib/production-next-action";
import { PremiumPill } from "@/components/production/premium-ui";

/**
 * OrderCockpitSpine — the cognition layer of the Operations Cockpit.
 *
 * Turns the ranked output of `computeNextAction` into the two surfaces that
 * open the Production Order page: ONE hero "Next action" and the ranked
 * "Needs attention" queue. Unlike the old /v2 read-only prototype, these CTAs
 * act IN PLACE: each links back to this same page with `?open=<section>` so the
 * matching work-area editor is expanded on arrival (and `#area-<section>`
 * scrolls to it). No view/edit mode switch — editing happens right here.
 *
 * Pure server component: no state, no DB. Values are computed upstream.
 */

/** Which work-area each next-action key edits. Drives the deep-link target. */
const KEY_TO_SECTION: Record<string, string> = {
  deposit: "payment",
  "balance-overdue": "payment",
  "balance-due": "payment",
  lc: "payment",
  override: "payment",
  start: "production",
  delay: "production",
  "in-production": "production",
  bl: "shipping",
  book: "shipping",
  etd: "shipping",
  deliver: "shipping",
  docs: "documents",
};

/** Resolve the work-area section a next-action key points at (or null). */
export function naSectionFor(key: string | null | undefined): string | null {
  if (!key) return null;
  return KEY_TO_SECTION[key] ?? null;
}

function sectionHref(base: string, key: string): string {
  const section = KEY_TO_SECTION[key] ?? "production";
  return `${base}?open=${section}#area-${section}`;
}

const TONE_TAG: Record<NaTone, { variant: "pos" | "ink" | "line"; label: string }> = {
  blocked: { variant: "ink", label: "Blocked" },
  action: { variant: "line", label: "To do" },
  at_risk: { variant: "line", label: "At risk" },
  info: { variant: "line", label: "Info" },
  good: { variant: "pos", label: "On track" },
};

function ToneTag({ tone }: { tone: NaTone }) {
  const t = TONE_TAG[tone];
  return <PremiumPill variant={t.variant}>{t.label}</PremiumPill>;
}

/**
 * The single hero action for the current state. Blocked actions get the Hazard
 * rail. `closed` orders render nothing here (the page shows a terminal banner).
 */
export function NextActionBand({
  na,
  baseHref,
}: {
  na: NextAction;
  baseHref: string;
}) {
  if (na.closed) return null;

  if (!na.primary) {
    return (
      <section className="panel px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="po-dot po-dot--green" aria-hidden />
          <span className="text-sm font-medium text-[color:var(--ink)]">
            All clear
          </span>
        </div>
        <p className="text-sm text-neutral-600 mt-1">
          Nothing needs you on this order right now.
        </p>
      </section>
    );
  }

  const p = na.primary;
  return (
    <section
      className={`panel px-6 py-5 ${p.tone === "blocked" ? "po-attention" : ""}`}
      style={{ background: "#fafafa", borderColor: "var(--line-2)" }}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="eyebrow" style={{ color: "var(--ink)" }}>
              Next action
            </div>
            <ToneTag tone={p.tone} />
          </div>
          <div
            className="mt-2 font-medium text-[color:var(--ink)]"
            style={{ fontSize: "21px", letterSpacing: "-0.01em" }}
          >
            {p.title}
          </div>
          <p className="text-sm text-neutral-600 mt-1 max-w-xl">{p.detail}</p>
        </div>
        <Link href={sectionHref(baseHref, p.key)} className="btn-primary shrink-0">
          {p.ctaLabel ?? "Open"} →
        </Link>
      </div>
    </section>
  );
}

/** Everything else outstanding, ranked most-urgent first. */
export function AttentionQueue({
  na,
  baseHref,
}: {
  na: NextAction;
  baseHref: string;
}) {
  if (!na.queue.length) return null;
  return (
    <section className="panel overflow-hidden">
      <div className="px-5 py-3 border-b border-[color:var(--line)]">
        <div className="eyebrow">Needs attention</div>
      </div>
      {na.queue.map((item: NextActionItem, i: number) => (
        <div
          key={item.key}
          className={`flex items-center gap-3 px-5 py-3.5 ${
            i === na.queue.length - 1
              ? ""
              : "border-b border-[color:var(--line)]"
          }`}
        >
          <ToneTag tone={item.tone} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-[color:var(--ink)]">
              {item.title}
            </div>
            <div className="text-xs text-neutral-500">{item.detail}</div>
          </div>
          {item.ctaLabel && (
            <Link
              href={sectionHref(baseHref, item.key)}
              className="btn-secondary !py-1.5 !px-3 !text-xs shrink-0"
            >
              {item.ctaLabel}
            </Link>
          )}
        </div>
      ))}
    </section>
  );
}
