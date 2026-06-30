import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { listEventsForEntities, type EventEntityType } from "@/lib/events";
import { Timeline } from "@/components/Timeline";

/**
 * Entity inspector for /admin/diagnostics.
 *
 * Takes a free-form string from `searchParams.q` and tries to resolve
 * it against the operational entities:
 *
 *   1. UUID match across documents / production_task_lists /
 *      production_orders / clients (in that order).
 *   2. Fallback to a `number` text match in the three numbered tables
 *      (case-insensitive, exact).
 *
 * Once resolved, fetches everything related "around" that entity so
 * the super-admin can answer "why is this in this state?" without
 * navigating to four different pages:
 *
 *   - Document       → its task lists + their POs + the client
 *   - Task list      → its doc + its PO + the client
 *   - Production ord → its task list + the doc + the client
 *   - Client         → all docs/TLs/POs for the client (recent)
 *
 * Finally, the events table is queried for ALL linked entity_ids so
 * the timeline tells the full story across the chain (e.g. "doc was
 * cancelled, then PO was auto-cancelled by the trigger 12s later").
 *
 * Why no SECURITY DEFINER
 * -----------------------
 * Super-admin has the admin role, which existing RLS policies on
 * documents / PTLs / POs / clients bypass via the
 * `exists(select 1 from user_roles where role='admin')` clause. So
 * standard supabase queries already give us company-wide visibility
 * for this caller. Saves a migration.
 */

type InspectEntityKind =
  | "document"
  | "task_list"
  | "production_order"
  | "client";

export async function InspectorSection({ q }: { q: string | null }) {
  // No query — just render the search form.
  if (!q) return <InspectorShell />;

  const trimmed = q.trim();
  if (!trimmed) return <InspectorShell />;

  const supabase = createClient();
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      trimmed
    );

  // ----- Resolve the entity -----
  let entityKind: InspectEntityKind | null = null;
  let entity: any = null;

  if (isUuid) {
    // Try each table by id. Stop at the first hit.
    const tries: { kind: InspectEntityKind; table: string; select: string }[] =
      [
        {
          kind: "document",
          table: "documents",
          select:
            "id, number, type, status, date, total_price, currency, client_id, created_by, archived_at",
        },
        {
          kind: "task_list",
          table: "production_task_lists",
          select:
            "id, number, status, date, quotation_id, client_id, created_by, archived_at, submitted_at, factory_sent_at",
        },
        {
          kind: "production_order",
          table: "production_orders",
          select:
            "id, number, status, quotation_id, task_list_id, client_id, current_production_deadline, initial_production_deadline, archived_at, created_at",
        },
        {
          kind: "client",
          table: "clients",
          select:
            "id, company_name, client_code, contact_name, email, country, archived_at, created_at",
        },
      ];
    for (const t of tries) {
      const { data } = await supabase
        .from(t.table)
        .select(t.select)
        .eq("id", trimmed)
        .maybeSingle();
      if (data) {
        entityKind = t.kind;
        entity = data;
        break;
      }
    }
  } else {
    // Number fallback — exact match (case-insensitive) on documents,
    // PTLs, POs.
    const numberLookups: {
      kind: InspectEntityKind;
      table: string;
      select: string;
    }[] = [
      {
        kind: "document",
        table: "documents",
        select:
          "id, number, type, status, date, total_price, currency, client_id, created_by, archived_at",
      },
      {
        kind: "task_list",
        table: "production_task_lists",
        select:
          "id, number, status, date, quotation_id, client_id, created_by, archived_at, submitted_at, factory_sent_at",
      },
      {
        kind: "production_order",
        table: "production_orders",
        select:
          "id, number, status, quotation_id, task_list_id, client_id, current_production_deadline, initial_production_deadline, archived_at, created_at",
      },
    ];
    for (const t of numberLookups) {
      const { data } = await supabase
        .from(t.table)
        .select(t.select)
        .ilike("number", trimmed)
        .maybeSingle();
      if (data) {
        entityKind = t.kind;
        entity = data;
        break;
      }
    }
  }

  if (!entityKind || !entity) {
    return (
      <InspectorShell q={trimmed}>
        <div className="rounded-md border border-amber-300 bg-amber-50/60 px-3 py-3 text-xs text-amber-900">
          <div className="font-semibold mb-1">Not found</div>
          <p>
            No document, task list, production order or client matches{" "}
            <code className="font-mono">{trimmed}</code>. Check the
            format ({isUuid ? "UUID" : "number"}) and try again.
          </p>
        </div>
      </InspectorShell>
    );
  }

  // ----- Fetch related entities -----
  // Build a list of "what to fetch" depending on the resolved kind.
  const docId =
    entityKind === "document"
      ? entity.id
      : entity.quotation_id ?? null;
  const taskListId =
    entityKind === "task_list"
      ? entity.id
      : entityKind === "production_order"
        ? entity.task_list_id
        : null;
  const poId = entityKind === "production_order" ? entity.id : null;
  const clientId = entity.client_id ?? null;

  const [
    { data: doc },
    { data: relatedTaskLists },
    { data: relatedPOs },
    { data: client },
  ] = await Promise.all([
    docId
      ? supabase
          .from("documents")
          .select(
            "id, number, type, status, date, total_price, currency, client_id, archived_at"
          )
          .eq("id", docId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    docId
      ? supabase
          .from("production_task_lists")
          .select(
            "id, number, status, date, quotation_id, archived_at, submitted_at"
          )
          .eq("quotation_id", docId)
          .order("date", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    docId
      ? supabase
          .from("production_orders")
          .select(
            "id, number, status, quotation_id, task_list_id, current_production_deadline, archived_at"
          )
          .eq("quotation_id", docId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as any[] }),
    clientId
      ? supabase
          .from("clients")
          .select(
            "id, company_name, client_code, contact_name, email, country, archived_at"
          )
          .eq("id", clientId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // For client-rooted lookups, fall back to fetching docs/TLs/POs FOR
  // this client (their pipeline).
  let clientDocs: any[] = [];
  let clientTLs: any[] = [];
  let clientPOs: any[] = [];
  if (entityKind === "client") {
    const [{ data: d }, { data: t }, { data: p }] = await Promise.all([
      supabase
        .from("documents")
        .select("id, number, type, status, date")
        .eq("client_id", entity.id)
        .order("date", { ascending: false })
        .limit(20),
      supabase
        .from("production_task_lists")
        .select("id, number, status, date")
        .eq("client_id", entity.id)
        .order("date", { ascending: false })
        .limit(20),
      supabase
        .from("production_orders")
        .select("id, number, status, current_production_deadline")
        .eq("client_id", entity.id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    clientDocs = d ?? [];
    clientTLs = t ?? [];
    clientPOs = p ?? [];
  }

  // ----- Fetch unified event timeline for all linked entities -----
  // Collect every entity_id we care about and bulk-fetch events.
  const eventTargets: {
    entity_type: EventEntityType;
    entity_ids: string[];
  }[] = [];
  if (doc?.id) {
    eventTargets.push({ entity_type: "document", entity_ids: [doc.id] });
  }
  const tlIds: string[] = [];
  if (entityKind === "task_list") tlIds.push(entity.id);
  for (const tl of (relatedTaskLists ?? []) as any[]) {
    if (!tlIds.includes(tl.id)) tlIds.push(tl.id);
  }
  if (taskListId && !tlIds.includes(taskListId)) tlIds.push(taskListId);
  if (tlIds.length > 0)
    eventTargets.push({ entity_type: "task_list", entity_ids: tlIds });

  const poIds: string[] = [];
  if (poId) poIds.push(poId);
  for (const p of (relatedPOs ?? []) as any[]) {
    if (!poIds.includes(p.id)) poIds.push(p.id);
  }
  if (poIds.length > 0)
    eventTargets.push({ entity_type: "production_order", entity_ids: poIds });

  if (clientId)
    eventTargets.push({ entity_type: "client", entity_ids: [clientId] });

  const events = await listEventsForEntities(eventTargets, 100);

  // Actor labels (role + UUID short prefix) — same convention as the
  // other timelines. Prop name in <Timeline> is actorLabelByUser.
  const actorIds = Array.from(
    new Set(events.map((e) => e.actor_id).filter(Boolean))
  ) as string[];
  const actorLabelByUser = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: roles } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .in("user_id", actorIds);
    for (const r of roles ?? []) {
      actorLabelByUser.set(
        r.user_id,
        `${r.role} · ${String(r.user_id).slice(0, 8)}`
      );
    }
  }

  return (
    <InspectorShell q={trimmed}>
      <div className="space-y-4">
        {/* Resolved entity card */}
        <ResolvedEntityCard kind={entityKind} entity={entity} />

        {/* Relationship graph — laid out as 4 columns for the chain
            doc → TL → PO + client on the side. Each column shows the
            row(s) we found, with links to their own pages. */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <RelatedColumn
            title="Quotation"
            rows={doc ? [doc] : []}
            renderRow={(d: any) => (
              <SmallEntityCard
                href={`/documents/${d.id}`}
                title={d.number ?? d.id.slice(0, 8)}
                badges={[
                  d.type,
                  d.status,
                  d.archived_at ? "archived" : null,
                ].filter(Boolean) as string[]}
                meta={
                  d.date
                    ? new Date(d.date).toLocaleDateString("en-GB")
                    : null
                }
                highlighted={entityKind === "document"}
              />
            )}
            keyFor={(d: any) => d.id}
            empty="No quotation linked."
          />
          <RelatedColumn
            title="Task list(s)"
            rows={
              entityKind === "client"
                ? clientTLs
                : (relatedTaskLists ?? []).length > 0
                  ? (relatedTaskLists as any[])
                  : entityKind === "task_list"
                    ? [entity]
                    : []
            }
            renderRow={(tl: any) => (
              <SmallEntityCard
                href={`/task-lists/${tl.id}`}
                title={tl.number ?? tl.id.slice(0, 8)}
                badges={[
                  tl.status,
                  tl.archived_at ? "archived" : null,
                ].filter(Boolean) as string[]}
                meta={
                  tl.submitted_at
                    ? `submitted ${new Date(tl.submitted_at).toLocaleDateString("en-GB")}`
                    : tl.date
                      ? new Date(tl.date).toLocaleDateString("en-GB")
                      : null
                }
                highlighted={
                  entityKind === "task_list" && tl.id === entity.id
                }
              />
            )}
            keyFor={(tl: any) => tl.id}
            empty="No task list linked."
          />
          <RelatedColumn
            title="Production order(s)"
            rows={
              entityKind === "client"
                ? clientPOs
                : (relatedPOs ?? []).length > 0
                  ? (relatedPOs as any[])
                  : entityKind === "production_order"
                    ? [entity]
                    : []
            }
            renderRow={(po: any) => (
              <SmallEntityCard
                href={`/production/orders/${po.id}`}
                title={po.number ?? po.id.slice(0, 8)}
                badges={[
                  po.status,
                  po.archived_at ? "archived" : null,
                ].filter(Boolean) as string[]}
                meta={
                  po.current_production_deadline
                    ? `due ${new Date(po.current_production_deadline).toLocaleDateString("en-GB")}`
                    : null
                }
                highlighted={
                  entityKind === "production_order" &&
                  po.id === entity.id
                }
              />
            )}
            keyFor={(po: any) => po.id}
            empty="No production order linked."
          />
          <RelatedColumn
            title="Client"
            rows={client ? [client] : entityKind === "client" ? [entity] : []}
            renderRow={(c: any) => (
              <SmallEntityCard
                href={`/clients/${c.id}`}
                title={c.company_name}
                badges={[
                  c.client_code,
                  c.country,
                  c.archived_at ? "archived" : null,
                ].filter(Boolean) as string[]}
                meta={c.contact_name ?? c.email ?? null}
                highlighted={entityKind === "client"}
              />
            )}
            keyFor={(c: any) => c.id}
            empty="No client linked."
          />
        </div>

        {/* Extra: when the inspected entity IS a client, also show
            their docs panel below (we already have TLs and POs in the
            grid above). */}
        {entityKind === "client" && clientDocs.length > 0 && (
          <div className="rounded-lg border border-neutral-200 bg-white p-3">
            <div className="eyebrow mb-2">
              Quotations for this client · {clientDocs.length}
            </div>
            <ul className="space-y-1">
              {clientDocs.map((d: any) => (
                <li key={d.id} className="text-[11px] text-neutral-700">
                  <Link
                    href={`/documents/${d.id}`}
                    className="hover:underline hover:text-neutral-900"
                  >
                    <span className="font-mono">
                      {d.number ?? d.id.slice(0, 8)}
                    </span>
                    {" · "}
                    {d.type}
                    {" · "}
                    {d.status}
                    {" · "}
                    {new Date(d.date).toLocaleDateString("en-GB")}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Unified timeline across every linked entity. */}
        <div className="rounded-lg border border-neutral-200 bg-white p-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
            <div>
              <div className="eyebrow">Unified timeline</div>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Events from the doc, task lists, POs and client merged
                newest-first. Helps explain how the entity reached its
                current state.
              </p>
            </div>
            <span className="text-[11px] text-neutral-500 tabular-nums">
              {events.length} event{events.length === 1 ? "" : "s"}
            </span>
          </div>
          <Timeline events={events} actorLabelByUser={actorLabelByUser} />
        </div>
      </div>
    </InspectorShell>
  );
}

/* ===========================================================================
   Internals
   =========================================================================== */

/** Search form + section frame. Always visible. */
function InspectorShell({
  q,
  children,
}: {
  q?: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className="sx-micro" style={{ margin: "22px 0 8px" }}>
        Entity inspector
      </div>
      <p className="ad-lead" style={{ marginBottom: 10 }}>
        Paste an ID — a UUID or a number (e.g. <code>SLX-ETF-26-001</code>) — and the inspector resolves the
        entity, its related rows across docs / task lists / POs / client, and the unified event timeline.
      </p>

      {/* GET form — no JS, browser-native navigation. The ?q= param
          re-renders the section with the result. */}
      <div className="card ad-sub-block">
        <form method="GET" action="/admin/diagnostics" className="ad-insp-row">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Paste an entity ID (UUID or reference, e.g. SLX-ETF-26-001)"
            className="ad-mono"
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="sx-btn sx-btn-ink">
            Inspect
          </button>
          {q && (
            <Link href="/admin/diagnostics" className="sx-btn">
              Clear
            </Link>
          )}
        </form>
      </div>

      <div style={{ marginTop: 14 }}>{children}</div>
    </>
  );
}

/** Renders the top "you searched for X, here it is" card. */
function ResolvedEntityCard({
  kind,
  entity,
}: {
  kind: InspectEntityKind;
  entity: any;
}) {
  const kindLabel = (
    {
      document: "Quotation",
      task_list: "Task list",
      production_order: "Production order",
      client: "Client",
    } as const
  )[kind];

  const title =
    kind === "client"
      ? entity.company_name
      : entity.number ?? entity.id.slice(0, 8);
  const detailHref =
    kind === "document"
      ? `/documents/${entity.id}`
      : kind === "task_list"
        ? `/task-lists/${entity.id}`
        : kind === "production_order"
          ? `/production/orders/${entity.id}`
          : `/clients/${entity.id}`;

  return (
    <div className="rounded-lg border border-neutral-900 bg-neutral-900 text-white p-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[10px] uppercase tracking-widerx font-semibold opacity-70">
            Resolved · {kindLabel}
          </div>
          <div className="text-lg font-semibold font-mono mt-0.5">
            {title}
          </div>
          <div className="text-[11px] opacity-60 mt-0.5 font-mono break-all">
            {entity.id}
          </div>
        </div>
        <Link
          href={detailHref}
          className="rounded-md border border-white/40 bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20 transition-colors"
        >
          Open page →
        </Link>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-[11px]">
        {Object.entries(entity)
          .filter(
            ([k]) => k !== "id" && k !== "number" && k !== "company_name"
          )
          .slice(0, 8)
          .map(([k, v]) => (
            <div key={k} className="min-w-0">
              <div className="opacity-50 uppercase text-[9px] tracking-widerx">
                {k}
              </div>
              <div className="opacity-90 truncate">
                {v === null || v === undefined || v === ""
                  ? "—"
                  : typeof v === "object"
                    ? JSON.stringify(v)
                    : String(v)}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

/** A column in the relationship grid. */
function RelatedColumn<T>({
  title,
  rows,
  renderRow,
  keyFor,
  empty,
}: {
  title: string;
  rows: T[];
  renderRow: (row: T) => React.ReactNode;
  keyFor: (row: T) => string;
  empty: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-3 space-y-2">
      <div className="eyebrow">{title}</div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-neutral-400 italic">{empty}</div>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={keyFor(r)}>{renderRow(r)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Single entity tile inside a RelatedColumn. */
function SmallEntityCard({
  href,
  title,
  badges,
  meta,
  highlighted,
}: {
  href: string;
  title: string;
  badges: string[];
  meta: string | null;
  highlighted?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`block rounded-md border px-2.5 py-2 transition-colors ${
        highlighted
          ? "border-neutral-900 bg-neutral-50"
          : "border-neutral-200 bg-white hover:bg-neutral-50"
      }`}
    >
      <div className="text-xs font-semibold text-neutral-900 truncate font-mono">
        {title}
      </div>
      {badges.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1">
          {badges.map((b, i) => (
            <span
              key={i}
              className="inline-flex items-center rounded-md border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 text-[10px] text-neutral-700 font-mono"
            >
              {b}
            </span>
          ))}
        </div>
      )}
      {meta && (
        <div className="text-[10px] text-neutral-500 mt-1 truncate">
          {meta}
        </div>
      )}
    </Link>
  );
}
