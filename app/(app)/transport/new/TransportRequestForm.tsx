"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { pushToast } from "@/components/feedback/toast-store";
import { quickCreateAffair } from "@/app/(app)/affairs/actions";
import { CountrySelect } from "@/components/forms/CountrySelect";
import {
  type ConfigField,
  type Incoterm,
  TRANSPORT_MODES,
  TRANSPORT_MODE_LABEL,
  CUSTOM_OPTION_SENTINEL,
  customValueKey,
} from "@/lib/types";
import { DEFAULT_INCOTERM, DEFAULT_PORT_OF_LOADING } from "@/lib/incoterm";
import {
  transportKindLabel,
  TRANSPORT_UPDATE_REASONS,
  SOLAR_PANEL_FALLBACK_OPTIONS,
  type TransportRequestKind,
  type TransportRequestLineDraft,
  isSolarPanelField,
  lineHasPanelSize,
  mapDocumentLineToRequestLine,
  versionedHistory,
} from "@/lib/transport-request";
import { createTransportRequest } from "./actions";

// lib/incoterm.ts exports helpers, not the list — the canonical array lives
// unexported in the quotation builder, so declare it locally from the type.
const INCOTERMS: Incoterm[] = ["EXW", "FOB", "CFR", "CIF", "DDP", "DDU"];

type ClientRow = { id: string; company_name: string };
type AffairRow = { id: string; name: string | null; client_id: string | null };
type ProductRow = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  category_id: string | null;
  image_url?: string | null;
};
type QuotationRow = {
  id: string;
  number: string | null;
  version: number | null;
  date: string | null;
  type: string;
  status: string;
};
type HistoryRow = {
  id: string;
  kind: string;
  status: string;
  freight_cost: number | null;
  insurance_cost: number | null;
  cbm: number | null;
  incoterm: string | null;
  transport_mode: string | null;
  destination_country: string | null;
  destination_port: string | null;
  valid_until: string | null;
  ops_comments: string | null;
  reason: string | null;
  requested_by: string | null;
  requested_at: string | null;
  completed_by: string | null;
  completed_at: string | null;
  gross_weight_kg: number | null;
  net_weight_kg: number | null;
  cartons_count: number | null;
  pallets_count: number | null;
};

type LineState = TransportRequestLineDraft & { localId: number };

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm";
const labelCls = "block text-xs font-medium text-neutral-600";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return `${Number(n).toLocaleString()} USD`;
}

export default function TransportRequestForm({
  clients,
  affairs,
  products,
  categories,
  configFields,
  configFieldOptions,
  ctxAffair,
  ctxClientId,
  initialKind,
  sourceParam = null,
  initialQuotations,
  initialHistory,
  userLabels,
}: {
  clients: ClientRow[];
  affairs: AffairRow[];
  products: ProductRow[];
  categories: { id: string; name: string }[];
  configFields: any[];
  configFieldOptions: { id: string; field_id: string; option_value: string; option_order: number }[];
  ctxAffair: AffairRow | null;
  ctxClientId: string | null;
  initialKind: string | null;
  /** ?source=<docId> — auto-import that document's products on load. */
  sourceParam?: string | null;
  initialQuotations: QuotationRow[];
  initialHistory: HistoryRow[];
  userLabels: Record<string, string>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // ---- Mode ------------------------------------------------------------
  // ONE main workflow: the Packing List Request, with an optional
  // "Request Transport Quotation as well" checkbox (checked → kind 'price').
  // PRICE UPDATES never start blank: they arrive from the Transport
  // Quotations list or the affair card via ?kind=price_update, pre-loaded.
  const isUpdate = initialKind === "price_update";
  const [transportAlso, setTransportAlso] = useState(isUpdate);

  // ---- Client → Opportunity (mandatory, creatable INLINE) --------------
  const [clientId, setClientId] = useState(
    ctxAffair?.client_id ?? ctxClientId ?? ""
  );
  const [affairId, setAffairId] = useState(ctxAffair?.id ?? "");
  const lockContext = !!ctxAffair;
  // Opportunities created inline land here so the select updates instantly.
  // De-duplicated against the server list: quickCreateAffair revalidates the
  // route, so the fresh `affairs` prop may already contain the new one.
  const [extraAffairs, setExtraAffairs] = useState<AffairRow[]>([]);
  const clientAffairs = useMemo(() => {
    const serverIds = new Set(affairs.map((a) => a.id));
    return [
      ...extraAffairs.filter((a) => !serverIds.has(a.id)),
      ...affairs,
    ].filter((a) => a.client_id === clientId);
  }, [affairs, extraAffairs, clientId]);
  const [creatingOpp, setCreatingOpp] = useState(false);
  const [newOppName, setNewOppName] = useState("");
  const [oppPending, startOpp] = useTransition();

  function createOpportunityInline() {
    const name = newOppName.trim();
    if (!name || !clientId) return;
    startOpp(async () => {
      try {
        const { id } = await quickCreateAffair({ clientId, name });
        setExtraAffairs((prev) => [{ id, name, client_id: clientId }, ...prev]);
        setAffairId(id);
        setCreatingOpp(false);
        setNewOppName("");
        pushToast(`Opportunity “${name}” created — continue your request`);
      } catch (e: any) {
        pushToast(e?.message ?? "Could not create the opportunity", "error");
      }
    });
  }

  // ---- Solar panel options per category (data-driven + fallback) -------
  // Packing depends on ONE thing: the solar panel size. The dropdown offers
  // the category's real SOLAR PANEL field options when they exist.
  const solarByCategory = useMemo(() => {
    const optionsByField = new Map<string, string[]>();
    for (const o of configFieldOptions) {
      const arr = optionsByField.get(o.field_id) ?? [];
      arr.push(o.option_value);
      optionsByField.set(o.field_id, arr);
    }
    const map = new Map<string, { fieldName: string; options: string[] }>();
    for (const f of configFields as ConfigField[]) {
      if (!isSolarPanelField(f.field_name)) continue;
      if (map.has((f as any).category_id)) continue;
      map.set((f as any).category_id, {
        fieldName: f.field_name,
        options: optionsByField.get(f.id) ?? [],
      });
    }
    return map;
  }, [configFields, configFieldOptions]);

  function solarSpec(categoryId: string | null) {
    const hit = categoryId ? solarByCategory.get(categoryId) : undefined;
    return {
      fieldName: hit?.fieldName ?? "SOLAR PANEL",
      options:
        hit && hit.options.length > 0
          ? hit.options
          : [...SOLAR_PANEL_FALLBACK_OPTIONS],
    };
  }
  /** Read the line's panel value (resolving an imported custom sentinel). */
  function solarValue(l: LineState): string {
    const { fieldName } = solarSpec(l.category_id);
    const raw = l.config_values[fieldName];
    if (raw === CUSTOM_OPTION_SENTINEL)
      return l.config_values[customValueKey(fieldName)] ?? "";
    return raw ?? "";
  }

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  // ---- Product lines ----------------------------------------------------
  const [lines, setLines] = useState<LineState[]>([]);
  const [nextLocalId, setNextLocalId] = useState(1);
  // Family-first picker — the SAME interaction as the quotation cart
  // (category chips → only that family's products, plus name/SKU search).
  const [familyFilter, setFamilyFilter] = useState<string | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const familiesWithProducts = useMemo(
    () => categories.filter((c) => products.some((p) => p.category_id === c.id)),
    [categories, products]
  );
  const pickerProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    return products.filter((p) => {
      if (familyFilter && p.category_id !== familyFilter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, familyFilter, productSearch]);

  function addProduct(productId: string) {
    const p = productById.get(productId);
    if (!p) return;
    setLines((prev) => [
      ...prev,
      {
        localId: nextLocalId,
        product_id: p.id,
        category_id: p.category_id,
        product_name: p.name,
        client_product_name: null,
        quantity: 1,
        config_values: {},
      },
    ]);
    setNextLocalId((n) => n + 1);
  }
  function patchLine(localId: number, patch: Partial<LineState>) {
    setLines((prev) =>
      prev.map((l) => (l.localId === localId ? { ...l, ...patch } : l))
    );
  }
  function setLinePanel(l: LineState, value: string) {
    const { fieldName } = solarSpec(l.category_id);
    const next = { ...l.config_values };
    delete next[customValueKey(fieldName)];
    next[fieldName] = value;
    patchLine(l.localId, { config_values: next });
  }
  function removeLine(localId: number) {
    setLines((prev) => prev.filter((l) => l.localId !== localId));
  }

  // ---- Quotations of the selected opportunity (import source) ----------
  const [quotations, setQuotations] = useState<QuotationRow[]>(initialQuotations);
  const [importPick, setImportPick] = useState("");
  const [importing, setImporting] = useState(false);

  // ---- Transport history (update flow) ---------------------------------
  const [history, setHistory] = useState<HistoryRow[]>(initialHistory);
  const versions = useMemo(() => versionedHistory(history), [history]);
  const currentQuote = versions.length > 0 ? versions[versions.length - 1] : null;

  // Refetch affair-scoped data when the user changes the opportunity
  // manually. Deep-linked visits already have the initial payload.
  useEffect(() => {
    if (!affairId || affairId === ctxAffair?.id) {
      setQuotations(affairId ? initialQuotations : []);
      setHistory(affairId ? initialHistory : []);
      return;
    }
    // A just-created opportunity has no quotations/history — skip the fetch.
    if (extraAffairs.some((a) => a.id === affairId)) {
      setQuotations([]);
      setHistory([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [qRes, hRes] = await Promise.all([
        supabase
          .from("documents")
          .select("id, number, version, date, type, status")
          .eq("affair_id", affairId)
          .in("type", ["quotation", "proforma"])
          .order("date", { ascending: false }),
        supabase
          .from("transport_requests")
          .select(
            "id, kind, status, freight_cost, insurance_cost, cbm, incoterm, transport_mode, destination_country, destination_port, valid_until, ops_comments, reason, requested_by, requested_at, completed_by, completed_at, gross_weight_kg, net_weight_kg, cartons_count, pallets_count"
          )
          .eq("affair_id", affairId)
          .order("requested_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setQuotations((qRes.data ?? []) as QuotationRow[]);
      setHistory(hRes.error ? [] : ((hRes.data ?? []) as HistoryRow[]));
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [affairId]);

  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);

  // ---- CONTEXT ANALYSIS (owner 2026-07-10: enter information ONCE) ------
  // As soon as a project is selected the system looks at what's already
  // attached (proformas/quotations, transport requests) and recommends the
  // most logical action instead of a blank form.
  const [importDismissed, setImportDismissed] = useState(false);
  const [existingDismissed, setExistingDismissed] = useState(false);
  const openRequests = useMemo(
    () => history.filter((h) => h.status === "waiting" || h.status === "in_progress"),
    [history]
  );
  const importedFrom = useMemo(
    () => quotations.find((q) => q.id === sourceDocumentId) ?? null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quotations, sourceDocumentId]
  );
  // Deep-link auto-import (?source=… from a document's "Request Transport").
  const [autoImported, setAutoImported] = useState(false);
  useEffect(() => {
    if (!sourceParam || autoImported || lines.length > 0) return;
    setAutoImported(true);
    importFromQuotation(sourceParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceParam, autoImported]);

  // ---- Transport information --------------------------------------------
  const [destinationCountry, setDestinationCountry] = useState("");
  const [destinationPort, setDestinationPort] = useState("");
  const [portOfLoading, setPortOfLoading] = useState(DEFAULT_PORT_OF_LOADING);
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [incoterm, setIncoterm] = useState<string>(DEFAULT_INCOTERM);
  const [transportMode, setTransportMode] = useState("sea");
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState("");

  // Update flow: prefill transport info + lines from the latest completed
  // quote (products usually unchanged — everything stays editable).
  const [prefilled, setPrefilled] = useState(false);
  useEffect(() => {
    if (!isUpdate || !currentQuote || prefilled) return;
    setPrefilled(true);
    setDestinationCountry((v) => v || (currentQuote.destination_country ?? ""));
    setDestinationPort((v) => v || (currentQuote.destination_port ?? ""));
    setIncoterm((v) => (v === DEFAULT_INCOTERM ? currentQuote.incoterm ?? v : v));
    setTransportMode((v) => (v === "sea" ? currentQuote.transport_mode ?? v : v));
    if (lines.length === 0) {
      (async () => {
        const { data } = await createClient()
          .from("transport_request_lines")
          .select("product_id, category_id, product_name, client_product_name, quantity, config_values")
          .eq("transport_request_id", currentQuote.id)
          .order("position");
        if (!data) return;
        setLines(
          (data as any[]).map((l, i) => ({
            localId: i + 1,
            product_id: l.product_id ?? null,
            category_id: l.category_id ?? null,
            product_name: l.product_name ?? null,
            client_product_name: l.client_product_name ?? null,
            quantity: Number(l.quantity ?? 1),
            config_values: l.config_values ?? {},
          }))
        );
        setNextLocalId((data as any[]).length + 1);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUpdate, currentQuote?.id]);

  // ---- Import products from a quotation ---------------------------------
  async function importFromQuotation(docId?: string) {
    const sourceId = docId ?? importPick;
    if (!sourceId) return;
    setImporting(true);
    try {
      const { data, error: qErr } = await createClient()
        .from("document_lines")
        .select("product_id, category_id, quantity, config_values, client_product_name")
        .eq("document_id", sourceId);
      if (qErr) throw new Error(qErr.message);
      const drafts = (data ?? [])
        .map((l: any) =>
          mapDocumentLineToRequestLine(
            l,
            l.product_id ? productById.get(l.product_id)?.name ?? null : null
          )
        )
        .filter((d): d is TransportRequestLineDraft => d !== null);
      if (drafts.length === 0) {
        pushToast("This quotation has no importable product lines", "info");
        return;
      }
      let id = nextLocalId;
      setLines(drafts.map((d) => ({ ...d, localId: id++ })));
      setNextLocalId(id);
      setSourceDocumentId(sourceId);
      setImportDismissed(true);
      pushToast(
        `${drafts.length} product${drafts.length > 1 ? "s" : ""} imported — check the panel sizes`
      );
    } catch (e: any) {
      pushToast(e?.message ?? "Import failed", "error");
    } finally {
      setImporting(false);
    }
  }

  // ---- Submit ------------------------------------------------------------
  const effectiveKind: TransportRequestKind = isUpdate
    ? "price_update"
    : transportAlso
    ? "price"
    : "packing_list";
  const linesRequired = !isUpdate;
  // MANDATORY PANEL SIZE (owner 2026-07-11): every product line must carry
  // its solar panel size before the request may reach Operations — the same
  // shared rule is enforced server-side in createTransportRequest.
  const missingPanelCount = lines.filter(
    (l) => !lineHasPanelSize(l.config_values)
  ).length;
  const canSubmit =
    !!clientId &&
    !!affairId &&
    (!linesRequired || lines.length > 0) &&
    missingPanelCount === 0 &&
    !pending;

  function submit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await createTransportRequest({
          kind: effectiveKind,
          affairId,
          clientId,
          destinationCountry: destinationCountry.trim() || null,
          destinationPort: destinationPort.trim() || null,
          portOfLoading: portOfLoading.trim() || null,
          deliveryAddress: deliveryAddress.trim() || null,
          incoterm,
          transportMode,
          notes: notes.trim() || null,
          reason: reason.trim() || null,
          sourceDocumentId,
          previousRequestId: isUpdate ? currentQuote?.id ?? null : null,
          lines: lines.map((l, i) => ({
            product_id: l.product_id,
            category_id: l.category_id,
            product_name: l.product_name,
            client_product_name: l.client_product_name,
            quantity: l.quantity,
            config_values: l.config_values,
            position: i,
          })),
        });
        // HONEST feedback (owner 2026-07-11): claim a notification ONLY when
        // the event registry actually delivered one to Operations.
        pushToast(
          res?.notified
            ? "✅ Transport request submitted — Operations notified"
            : "✅ Transport request submitted — now in the Operations queue"
        );
        // Hard navigation on purpose: the action revalidates paths and the
        // triggered client refresh can swallow a router.push issued in the
        // same window (Next 14 race — same fix as RequestHub).
        window.location.assign(`/affairs/${affairId}`);
      } catch (e: any) {
        setError(e?.message ?? "Could not submit the transport request");
      }
    });
  }

  /* ======================== render ======================== */

  // ---- Live summary data (recomputed on every keystroke — that's the point)
  const totalUnits = lines.reduce((s, l) => s + (l.quantity || 0), 0);
  const panelBreakdown = useMemo(() => {
    const acc = new Map<string, number>();
    let missing = 0;
    for (const l of lines) {
      const v = solarValue(l);
      if (!v) {
        missing += l.quantity || 0;
        continue;
      }
      acc.set(v, (acc.get(v) ?? 0) + (l.quantity || 0));
    }
    return { sizes: [...acc.entries()], missing };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);

  return (
    <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_290px]">
    <div className="min-w-0 space-y-5">
      {/* Mode header — the wizard IS the packing-list workflow; updates
          arrive pre-loaded from an existing quotation. */}
      {isUpdate ? (
        <section className="rounded-lg border border-sky-200 bg-sky-50/60 px-4 py-3">
          <div className="text-[13px] font-semibold text-sky-900">
            🔄 Updating the transport quotation
          </div>
          <p className="mt-0.5 text-[12px] text-sky-800">
            The previous quotation is loaded below — adjust what changed and
            submit. A new version is created; the history is never overwritten.
          </p>
        </section>
      ) : (
        <section className="panel p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[15px]">📦</div>
              <div className="mt-0.5 text-[13.5px] font-semibold text-neutral-900">
                New Packing List Request
              </div>
              <p className="text-[11.5px] text-neutral-500">
                Operations calculates cartons, pallets, weights and CBM from
                the panel sizes below.
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50/60 px-3 py-2">
              <input
                type="checkbox"
                checked={transportAlso}
                onChange={(e) => setTransportAlso(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-[12.5px] font-medium text-neutral-800">
                🚢 Request Transport Quotation as well
              </span>
            </label>
          </div>
        </section>
      )}

      {/* Client → Opportunity */}
      <section className="panel p-4">
        <div className="eyebrow mb-2">General information</div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className={labelCls}>
            Client *
            {lockContext || ctxClientId ? (
              <input
                value={clients.find((c) => c.id === clientId)?.company_name ?? ""}
                disabled
                className={`${inputCls} mt-1 bg-neutral-50`}
              />
            ) : (
              <select
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setAffairId("");
                  setCreatingOpp(false);
                }}
                className={`${inputCls} mt-1`}
              >
                <option value="">— Select a client —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
            )}
          </label>
          <label className={labelCls}>
            Project / Opportunity *
            {lockContext ? (
              <input
                value={ctxAffair?.name ?? ""}
                disabled
                className={`${inputCls} mt-1 bg-neutral-50`}
              />
            ) : (
              <select
                value={affairId}
                onChange={(e) => setAffairId(e.target.value)}
                disabled={!clientId}
                className={`${inputCls} mt-1 disabled:bg-neutral-50`}
              >
                <option value="">
                  {clientId ? "— Select an opportunity —" : "— Select a client first —"}
                </option>
                {clientAffairs.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name ?? a.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            )}
          </label>
        </div>

        {/* Create Opportunity INLINE — the salesperson never leaves this
            workflow (customer on the phone → packing answer in 2 minutes). */}
        {!lockContext && clientId && (
          <div className="mt-2">
            {!creatingOpp ? (
              <button
                type="button"
                onClick={() => setCreatingOpp(true)}
                className="text-[12px] font-semibold text-neutral-700 underline decoration-dotted underline-offset-2 hover:text-neutral-900"
              >
                + Create New Opportunity
              </button>
            ) : (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-neutral-300 p-2.5">
                <input
                  value={newOppName}
                  onChange={(e) => setNewOppName(e.target.value)}
                  placeholder="Opportunity name — e.g. SONABEL highway lighting 2027"
                  className={`${inputCls} max-w-md flex-1`}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={createOpportunityInline}
                  disabled={oppPending || !newOppName.trim()}
                  className="rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-black disabled:opacity-50"
                >
                  {oppPending ? "Creating…" : "Create & Continue →"}
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingOpp(false)}
                  className="text-[12px] text-neutral-500 hover:text-neutral-800"
                >
                  Cancel
                </button>
              </div>
            )}
            {clientAffairs.length === 0 && !creatingOpp && (
              <span className="ml-2 text-[11px] text-amber-700">
                This client has no opportunity yet — create one to continue.
              </span>
            )}
          </div>
        )}
      </section>

      {/* ---- CONTEXT: a Transport Request already exists (owner §5) ---- */}
      {!isUpdate && !existingDismissed && affairId && openRequests.length > 0 && (
        <section className="rounded-lg border border-amber-300 bg-amber-50/70 p-4">
          <div className="text-[13px] font-semibold text-amber-900">
            ⚠ A Transport Request already exists for this project
          </div>
          <p className="mt-0.5 text-[12px] text-amber-800">
            {transportKindLabel(openRequests[0].kind)} —{" "}
            {openRequests[0].status === "waiting" ? "waiting" : "in progress"} at
            Operations (requested {fmtDate(openRequests[0].requested_at)}).
            Creating a duplicate would split the answer across two threads.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <a
              href="/transport"
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-black"
            >
              Open Transport Request →
            </a>
            {versions.length > 0 && (
              <a
                href={`/transport/new?affair=${affairId}&kind=price_update`}
                className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-800 hover:bg-neutral-50"
              >
                🔄 Request Transport Price Update
              </a>
            )}
            <button
              type="button"
              onClick={() => setExistingDismissed(true)}
              className="text-[12px] font-medium text-amber-800 underline decoration-dotted underline-offset-2 hover:text-amber-950"
            >
              Create another request anyway
            </button>
          </div>
        </section>
      )}

      {/* ---- CONTEXT: importable documents found (owner §3/§4) ---- */}
      {!isUpdate &&
        affairId &&
        lines.length === 0 &&
        !importDismissed &&
        quotations.length > 0 && (
          <section className="rounded-lg border border-emerald-300 bg-emerald-50/60 p-4">
            {quotations.length === 1 ? (
              <>
                <div className="text-[13px] font-semibold text-emerald-900">
                  ✓ A {quotations[0].type === "proforma" ? "Proforma Invoice" : "Quotation"}{" "}
                  has been found for this project
                </div>
                <p className="mt-0.5 text-[12px] text-emerald-800">
                  <span className="font-mono">{quotations[0].number}</span> ·{" "}
                  {quotations[0].status} — import its products, variants and
                  quantities instead of re-entering them.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => importFromQuotation(quotations[0].id)}
                    disabled={importing}
                    className="rounded-md bg-solux px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-solux-dark disabled:opacity-50"
                  >
                    {importing ? "Importing…" : "Import Products (Recommended)"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setImportDismissed(true)}
                    className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    Start from Product Catalog
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="text-[13px] font-semibold text-emerald-900">
                  ✓ {quotations.length} documents found for this project — import from:
                </div>
                <ul className="mt-2 space-y-1">
                  {quotations.map((q) => (
                    <li key={q.id}>
                      <button
                        type="button"
                        onClick={() => importFromQuotation(q.id)}
                        disabled={importing}
                        className="flex w-full items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-1.5 text-left text-[12.5px] hover:border-solux hover:bg-neutral-50 disabled:opacity-50"
                      >
                        <span aria-hidden>📄</span>
                        <span className="font-medium text-neutral-900">
                          {q.type === "proforma" ? "Proforma Invoice" : "Quotation"}{" "}
                          <span className="font-mono">{q.number}</span>
                        </span>
                        <span className="ml-auto text-[11px] uppercase text-neutral-400">
                          {q.status}
                        </span>
                      </button>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      onClick={() => setImportDismissed(true)}
                      className="flex w-full items-center gap-2 rounded-md border border-dashed border-neutral-300 bg-white px-3 py-1.5 text-left text-[12.5px] text-neutral-600 hover:bg-neutral-50"
                    >
                      <span aria-hidden>🗂</span> Product Catalog (manual)
                    </button>
                  </li>
                </ul>
              </>
            )}
          </section>
        )}

      {/* Current quotation + history (update flow) */}
      {isUpdate && affairId && (
        <section className="panel p-4">
          <div className="eyebrow mb-2">Current transport quotation</div>
          {currentQuote ? (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
                <span className="text-lg font-semibold text-neutral-900">
                  {fmtMoney(currentQuote.freight_cost)}
                </span>
                <span className="text-[12px] text-neutral-600">
                  {currentQuote.incoterm ?? "—"} ·{" "}
                  {currentQuote.destination_port ||
                    currentQuote.destination_country ||
                    "—"}
                </span>
                <span className="text-[12px] text-neutral-500">
                  CBM {currentQuote.cbm ?? "—"}
                </span>
                <span className="text-[12px] text-neutral-500">
                  Valid until {fmtDate(currentQuote.valid_until)}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-neutral-500">
                Calculated on {fmtDate(currentQuote.completed_at)}
                {currentQuote.completed_by && userLabels[currentQuote.completed_by]
                  ? ` by ${userLabels[currentQuote.completed_by]}`
                  : ""}
                {" · "}
                {TRANSPORT_MODE_LABEL[
                  (currentQuote.transport_mode ?? "") as keyof typeof TRANSPORT_MODE_LABEL
                ] ?? currentQuote.transport_mode ?? "—"}
              </div>
              {currentQuote.ops_comments && (
                <p className="mt-1.5 text-[12px] text-neutral-600">
                  {currentQuote.ops_comments}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-neutral-500">
              No completed transport quotation for this project yet — this
              request will create version 1.
            </p>
          )}

          {versions.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                Transport price history
              </div>
              <ul className="mt-1 divide-y divide-neutral-100">
                {[...versions].reverse().map((v) => (
                  <li key={v.id} className="flex items-baseline gap-3 py-1.5">
                    <span className="inline-flex h-5 min-w-[2rem] items-center justify-center rounded bg-neutral-100 px-1.5 text-[10px] font-semibold text-neutral-700">
                      V{v.version}
                    </span>
                    <span className="text-[12.5px] font-medium text-neutral-800">
                      {fmtMoney(v.freight_cost)}
                    </span>
                    <span className="text-[11px] text-neutral-500">
                      {v.incoterm ?? "—"}{" "}
                      {v.destination_port || v.destination_country || ""}
                    </span>
                    <span className="ml-auto text-[11px] tabular-nums text-neutral-400">
                      {fmtDate(v.completed_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Products — ONE question per line: the solar panel size. */}
      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="eyebrow">Products</div>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              Packing only depends on the <b>solar panel size</b> — pick it for
              each product. Nothing else to configure.
            </p>
            {sourceDocumentId && (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[10.5px] font-medium text-neutral-600">
                📎 Imported from{" "}
                <span className="font-mono">
                  {importedFrom?.number ?? sourceDocumentId.slice(0, 8)}
                </span>{" "}
                · snapshot — later changes to that document won&apos;t alter
                this request
              </p>
            )}
          </div>
          {affairId && quotations.length > 0 && (
            <div className="flex items-center gap-1.5">
              <select
                value={importPick}
                onChange={(e) => setImportPick(e.target.value)}
                className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-[12px]"
              >
                <option value="">Import from quotation…</option>
                {quotations.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.number ?? q.id.slice(0, 8)} · {q.status}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => importFromQuotation()}
                disabled={!importPick || importing}
                className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-50"
              >
                {importing ? "Importing…" : "Import Products"}
              </button>
            </div>
          )}
        </div>

        <ul className="mt-3 space-y-2">
          {lines.map((l) => {
            const spec = solarSpec(l.category_id);
            const value = solarValue(l);
            // An imported/custom size outside the catalog options must stay
            // visible — surface it as an extra option.
            const options =
              value && !spec.options.includes(value)
                ? [value, ...spec.options]
                : spec.options;
            return (
              <li
                key={l.localId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-neutral-200 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-semibold text-neutral-900">
                    {l.product_name ?? l.client_product_name ?? "—"}
                  </div>
                  {l.product_name && l.client_product_name && (
                    <div className="truncate text-[11px] text-neutral-400">
                      {l.client_product_name}
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-600">
                  ☀️ Solar panel
                  <select
                    value={value}
                    onChange={(e) => setLinePanel(l, e.target.value)}
                    className={`rounded-md border px-2 py-1 text-sm ${
                      value
                        ? "border-neutral-300 bg-white"
                        : "border-amber-300 bg-amber-50"
                    }`}
                  >
                    <option value="">— size —</option>
                    {options.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-neutral-500">
                  Qty
                  <input
                    type="number"
                    min={1}
                    value={l.quantity}
                    onChange={(e) =>
                      patchLine(l.localId, {
                        quantity: Math.max(1, Number(e.target.value) || 1),
                      })
                    }
                    className="w-20 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeLine(l.localId)}
                  className="text-[12px] text-neutral-300 hover:text-rose-600"
                  aria-label="Remove line"
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>

        {/* Family-first picker — the quotation-cart interaction: pick the
            family, see only its products, click a card to add the line. */}
        <div className="mt-3 space-y-2 border-t border-neutral-100 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFamilyFilter(null)}
              className={`rounded-full border px-3 py-1 text-xs ${
                familyFilter === null ? "bg-black text-white" : "bg-white"
              }`}
            >
              All
            </button>
            {familiesWithProducts.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() =>
                  setFamilyFilter(familyFilter === c.id ? null : c.id)
                }
                className={`rounded-full border px-3 py-1 text-xs ${
                  familyFilter === c.id ? "bg-black text-white" : "bg-white"
                }`}
              >
                {c.name}
              </button>
            ))}
            {linesRequired && lines.length === 0 && (
              <span className="ml-auto text-[11px] text-amber-700">
                Pick a family, then click a product to add it.
              </span>
            )}
          </div>
          <input
            type="search"
            placeholder="Search by name or SKU…"
            value={productSearch}
            onChange={(e) => setProductSearch(e.target.value)}
            className="w-full rounded border px-3 py-2 text-sm"
          />
          {pickerProducts.length === 0 ? (
            <p className="py-3 text-center text-sm text-neutral-500">
              No products match.
            </p>
          ) : (
            <div className="grid max-h-[300px] grid-cols-2 gap-3 overflow-y-auto pr-1 md:grid-cols-4 lg:grid-cols-5">
              {pickerProducts.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProduct(p.id)}
                  className="rounded-lg border bg-white p-2 text-left transition hover:border-solux hover:shadow-sm"
                  title={`Add ${p.name}`}
                >
                  {p.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.image_url}
                      alt={p.name}
                      loading="lazy"
                      className="aspect-square w-full rounded border bg-white object-cover"
                    />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center rounded border bg-neutral-50 text-xs text-neutral-400">
                      No image
                    </div>
                  )}
                  <div className="mt-1.5 line-clamp-2 text-[12px] font-medium leading-tight">
                    {p.name}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-neutral-500">
                    {p.sku ?? "—"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Transport information — only when a freight quotation is wanted. */}
      {(transportAlso || isUpdate) && (
        <section className="panel p-4">
          <div className="eyebrow mb-2">Transport information</div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className={labelCls}>
              Destination country
              {/* Same searchable combobox as everywhere else in the ERP —
                  canonical names, no "Benin"/"Bénin" drift. Keyed on the
                  committed value so the update-flow prefill (async) shows. */}
              <CountrySelect
                key={`cty-${destinationCountry || "empty"}`}
                name="destination_country"
                defaultValue={destinationCountry}
                onSelect={setDestinationCountry}
                className="mt-1"
              />
            </label>
            <label className={labelCls}>
              Destination port
              <input
                value={destinationPort}
                onChange={(e) => setDestinationPort(e.target.value)}
                placeholder="e.g. Port of Cotonou"
                className={`${inputCls} mt-1`}
              />
            </label>
            <label className={labelCls}>
              Port of loading
              <input
                value={portOfLoading}
                onChange={(e) => setPortOfLoading(e.target.value)}
                className={`${inputCls} mt-1`}
              />
            </label>
            <label className={labelCls}>
              Incoterm
              <select
                value={incoterm}
                onChange={(e) => setIncoterm(e.target.value)}
                className={`${inputCls} mt-1`}
              >
                {INCOTERMS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Transport mode
              <select
                value={transportMode}
                onChange={(e) => setTransportMode(e.target.value)}
                className={`${inputCls} mt-1`}
              >
                {TRANSPORT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {TRANSPORT_MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              Delivery address <span className="font-normal">(optional)</span>
              <input
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder="Final delivery point"
                className={`${inputCls} mt-1`}
              />
            </label>
          </div>
          {isUpdate && (
            <label className={`${labelCls} mt-3`}>
              Why does the price need an update?
              <input
                list="transport-update-reasons"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Freight rates changed"
                className={`${inputCls} mt-1`}
              />
              <datalist id="transport-update-reasons">
                {TRANSPORT_UPDATE_REASONS.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </label>
          )}
        </section>
      )}

      {/* Notes + submit */}
      <section className="panel p-4">
        <label className={labelCls}>
          Additional notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything Operations should know (stackability, timeline, constraints…)"
            className={`${inputCls} mt-1 resize-none`}
          />
        </label>
        <div className="mt-3 flex items-center justify-between">
          <p className="text-[11px] text-neutral-500">
            {isUpdate
              ? "Operations will refresh the quotation — a new version, the history is never overwritten."
              : transportAlso
              ? "Operations will prepare the packing list AND quote the freight in one answer."
              : "Operations will calculate cartons, pallets, weights and CBM."}
          </p>
          <div className="flex items-center gap-3">
            {missingPanelCount > 0 && lines.length > 0 && (
              <span className="text-xs font-medium text-amber-700">
                ☀️ Solar panel size is required on every line —{" "}
                {missingPanelCount} line{missingPanelCount === 1 ? "" : "s"}{" "}
                missing.
              </span>
            )}
            {error && <span className="text-xs text-rose-600">{error}</span>}
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="btn-primary disabled:opacity-50"
            >
              {pending ? "Submitting…" : "Submit request →"}
            </button>
          </div>
        </div>
      </section>
    </div>

    {/* ---- LIVE SUMMARY — a quotation-style running overview. Not an
         invoice: a mistake-catcher that updates as the request is built. ---- */}
    <aside className="h-fit lg:sticky lg:top-20">
      <section className="panel p-4">
        <div className="eyebrow mb-2">
          {isUpdate
            ? "Price update summary"
            : transportAlso
            ? "Packing + Transport Summary"
            : "Packing List Summary"}
        </div>

        <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Products
        </div>
        {lines.length === 0 ? (
          <p className="mt-1 text-[12px] text-neutral-400">
            No products yet — pick a family below the list.
          </p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {lines.map((l) => (
              <li
                key={l.localId}
                className="flex items-baseline gap-2 text-[12px] text-neutral-800"
              >
                <span className="min-w-0 flex-1 truncate">
                  {l.product_name ?? l.client_product_name ?? "—"}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  × {l.quantity}
                </span>
              </li>
            ))}
            <li className="flex items-baseline gap-2 border-t border-neutral-100 pt-1 text-[12px] font-semibold text-neutral-900">
              <span className="flex-1">Total units</span>
              <span className="tabular-nums">{totalUnits}</span>
            </li>
          </ul>
        )}

        <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          ☀️ Panels
        </div>
        {panelBreakdown.sizes.length === 0 && panelBreakdown.missing === 0 ? (
          <p className="mt-1 text-[12px] text-neutral-400">—</p>
        ) : (
          <ul className="mt-1 space-y-0.5">
            {panelBreakdown.sizes.map(([size, qty]) => (
              <li
                key={size}
                className="flex items-baseline gap-2 text-[12px] text-neutral-800"
              >
                <span className="flex-1">{size}</span>
                <span className="font-semibold tabular-nums">× {qty}</span>
              </li>
            ))}
            {panelBreakdown.missing > 0 && (
              <li className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                ⚠ {panelBreakdown.missing} unit
                {panelBreakdown.missing > 1 ? "s" : ""} without a panel size
              </li>
            )}
          </ul>
        )}

        <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Estimated
        </div>
        <ul className="mt-1 space-y-0.5 text-[12px] text-neutral-500">
          <li className="flex items-baseline gap-2">
            <span className="flex-1">Cartons</span>
            <span>—</span>
          </li>
          <li className="flex items-baseline gap-2">
            <span className="flex-1">Pallets</span>
            <span>—</span>
          </li>
          <li className="flex items-baseline gap-2">
            <span className="flex-1">CBM</span>
            <span>—</span>
          </li>
        </ul>
        <p className="mt-1 text-[10.5px] leading-snug text-neutral-400">
          Calculated by Operations after submit — automatic estimation comes
          with the product dimension data.
        </p>

        {(transportAlso || isUpdate) && (
          <>
            <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              🚢 Transport
            </div>
            <ul className="mt-1 space-y-0.5 text-[12px] text-neutral-800">
              <li className="flex items-baseline gap-2">
                <span className="flex-1 text-neutral-500">Destination</span>
                <span className="truncate">
                  {destinationPort || destinationCountry || "—"}
                </span>
              </li>
              <li className="flex items-baseline gap-2">
                <span className="flex-1 text-neutral-500">Incoterm</span>
                <span>{incoterm}</span>
              </li>
              <li className="flex items-baseline gap-2">
                <span className="flex-1 text-neutral-500">Mode</span>
                <span>
                  {TRANSPORT_MODE_LABEL[
                    transportMode as keyof typeof TRANSPORT_MODE_LABEL
                  ] ?? transportMode}
                </span>
              </li>
            </ul>
          </>
        )}
      </section>
    </aside>
    </div>
  );
}
