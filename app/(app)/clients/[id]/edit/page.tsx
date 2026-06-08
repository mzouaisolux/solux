import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRole } from "@/lib/auth";
import { updateClientAction, assignClientOwner } from "../../actions";
import CustomFieldsEditor from "./CustomFieldsEditor";
import { CountrySelect } from "@/components/forms/CountrySelect";
import { PhoneField } from "@/components/forms/PhoneField";
import { ClientBlEditor } from "@/components/clients/ClientBlEditor";
import { FocusOnLoad } from "@/components/FocusOnLoad";
import { OwnerAssignSelect } from "@/components/OwnerAssignSelect";
import { listAssignableOwners } from "@/lib/owner";
import { isTechnicalRole, type ClientCustomField } from "@/lib/types";

export default async function EditClientPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  // Defensive select: try the full shape including the new PDF-related
  // fields (address / vat_number / default_attention_to). If migration
  // 036 isn't applied yet, the column is missing and PostgREST errors —
  // fall back to the legacy shape so the page keeps loading.
  let client: any = null;
  {
    const full = await supabase
      .from("clients")
      .select(
        "id, company_name, contact_name, email, phone_number, phone_country_code, country, client_code, starting_sequence_number, custom_fields, address, vat_number, default_attention_to, bl_profile"
      )
      .eq("id", params.id)
      .maybeSingle();
    if (full.error) {
      const fallback = await supabase
        .from("clients")
        .select(
          "id, company_name, contact_name, email, phone_number, country, client_code, starting_sequence_number, custom_fields"
        )
        .eq("id", params.id)
        .maybeSingle();
      client = fallback.data
        ? {
            ...fallback.data,
            phone_country_code: null,
            address: null,
            vat_number: null,
            default_attention_to: null,
            bl_profile: null,
          }
        : null;
    } else {
      client = full.data;
    }
  }

  if (!client) notFound();

  const customFields = (Array.isArray(client.custom_fields)
    ? client.custom_fields
    : []) as ClientCustomField[];

  // ---- Account owner (m066) — management-only reassignment ----
  const { effectiveRole } = await getEffectiveRole();
  const canAssignOwner = isTechnicalRole(effectiveRole);
  let salesOwnerId: string | null = null;
  let ownerOptions: { id: string; name: string; role?: string | null }[] = [];
  if (canAssignOwner) {
    // Defensive read (separate query so a missing m066 column can't break
    // the whole edit page).
    const { data: ownerRow } = await supabase
      .from("clients")
      .select("sales_owner_id")
      .eq("id", params.id)
      .maybeSingle();
    salesOwnerId = (ownerRow as any)?.sales_owner_id ?? null;
    ownerOptions = await listAssignableOwners();
  }

  return (
    <div className="mx-auto max-w-3xl p-8 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit client</h1>
        <Link href="/clients" className="text-sm hover:underline">
          ← Back
        </Link>
      </div>

      {/* Account owner — who manages this account. Management-only;
          overrides the creator everywhere the owner is shown/filtered. */}
      {canAssignOwner && ownerOptions.length > 0 && (
        <div className="panel p-5">
          <div className="eyebrow">Account owner</div>
          <p className="text-xs text-neutral-500 mt-0.5 mb-3 max-w-xl">
            The salesperson who manages this account. This is what the team
            sees + filters by on the Clients page. Leave unassigned to use
            whoever created the client.
          </p>
          <OwnerAssignSelect
            action={assignClientOwner}
            id={client.id}
            currentOwnerId={salesOwnerId}
            options={ownerOptions}
          />
        </div>
      )}

      <form action={updateClientAction} className="panel p-5 space-y-5">
        <input type="hidden" name="id" value={client.id} />

        {/* ----- IDENTITY ----- */}
        <div className="space-y-3">
          <div className="eyebrow">Identity</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Company name *</span>
              <input
                name="company_name"
                defaultValue={client.company_name ?? ""}
                required
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">
                Client code{" "}
                <span className="text-xs text-neutral-500">
                  (3 letters — appears in document numbers)
                </span>
              </span>
              <input
                name="client_code"
                defaultValue={client.client_code ?? ""}
                maxLength={3}
                placeholder="ARL"
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 font-mono uppercase"
                style={{ textTransform: "uppercase" }}
              />
            </label>
          </div>
        </div>

        {/* ----- CONTACT ----- */}
        <div className="space-y-3 border-t border-neutral-100 pt-5">
          <div className="eyebrow">Contact</div>
          <label className="block">
            <span className="text-sm font-medium">Contact person</span>
            <input
              name="contact_name"
              defaultValue={client.contact_name ?? ""}
              className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">Email</span>
              <input
                name="email"
                type="email"
                defaultValue={client.email ?? ""}
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Phone number</span>
              <PhoneField
                phoneCodeName="phone_country_code"
                phoneNumberName="phone_number"
                defaultCode={client.phone_country_code ?? ""}
                defaultNumber={client.phone_number ?? ""}
                className="mt-1"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium">Country</span>
            <CountrySelect
              name="country"
              defaultValue={client.country ?? ""}
              className="mt-1 max-w-sm"
            />
          </label>
        </div>

        {/* ----- EXPORT DOCUMENT FIELDS -----
            Captured here because they're what fills the proforma / quotation
            PDF header ("Attention to", "Address", "VAT Number"). Per-doc
            overrides are also available on the document edit form. */}
        <div className="space-y-3 border-t border-neutral-100 pt-5">
          <div className="eyebrow">Export documents (PDF)</div>
          <p className="text-xs text-neutral-500 -mt-1">
            These show up in the proforma / quotation PDFs. A per-document
            override is also available if a specific quote needs a different
            recipient.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm font-medium">
                Default attention to{" "}
                <span className="text-xs text-neutral-500">
                  (e.g. Purchasing Department)
                </span>
              </span>
              <input
                name="default_attention_to"
                defaultValue={client.default_attention_to ?? ""}
                placeholder="Purchasing Department"
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">
                VAT / Tax number{" "}
                <span className="text-xs text-neutral-500">(if applicable)</span>
              </span>
              <input
                name="vat_number"
                defaultValue={client.vat_number ?? ""}
                placeholder="GB287451982"
                className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 font-mono"
              />
            </label>
          </div>
          <label className="block">
            <span className="text-sm font-medium">
              Full address{" "}
              <span className="text-xs text-neutral-500">
                (multi-line — appears under client info on the PDF)
              </span>
            </span>
            <textarea
              name="address"
              defaultValue={client.address ?? ""}
              rows={3}
              placeholder={"123 Industrial Way\nLondon, EC1A 1BB\nUnited Kingdom"}
              className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
            />
          </label>
        </div>

        {/* ----- NUMBERING ----- */}
        <div className="space-y-3 border-t border-neutral-100 pt-5">
          <div className="eyebrow">Document numbering</div>
          <label className="block">
            <span className="text-sm font-medium">Starting sequence number</span>
            <input
              name="starting_sequence_number"
              type="number"
              min={0}
              defaultValue={client.starting_sequence_number ?? 0}
              className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
            />
            <span className="text-xs text-neutral-500 mt-1 block">
              Use this if the client already had N orders before this app.
              Next quotation becomes <code>N + 1</code>. Example: 25 → next
              quotation is <code>SLX-{client.client_code ?? "XXX"}-26-026</code>.
            </span>
          </label>
        </div>

        {/* ----- CUSTOM FIELDS ----- */}
        <div className="space-y-3 border-t border-neutral-100 pt-5">
          <CustomFieldsEditor initial={customFields} />
        </div>

        <div className="pt-3 border-t border-neutral-100">
          <button className="rounded bg-solux px-4 py-2 text-white font-medium hover:bg-solux-dark">
            Save changes
          </button>
        </div>
      </form>

      {/* Deep-link target: ?focus=bl (from the Action Center "Confirm BL"
          action) scrolls here and briefly highlights the BL panel. */}
      <FocusOnLoad />

      {/* ----- SHIPPING / BL PROFILE -----
          Separate panel + its own save action (independent of the
          identity/contact form above). Reusable BL template for this
          client's shipments. */}
      <div id="bl" className="panel p-5 scroll-mt-6">
        <ClientBlEditor
          clientId={client.id}
          initialProfile={client.bl_profile ?? null}
          clientPrefill={{
            company_name: client.company_name ?? null,
            address: client.address ?? null,
            country: client.country ?? null,
            contact_name: client.contact_name ?? null,
            phone:
              [client.phone_country_code, client.phone_number]
                .filter(Boolean)
                .join(" ")
                .trim() || null,
            email: client.email ?? null,
            tax_id: client.vat_number ?? null,
          }}
        />
      </div>
    </div>
  );
}
