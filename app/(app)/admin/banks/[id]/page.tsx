import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateBankAccount } from "../actions";
import { CURRENCIES } from "@/lib/types";

export default async function EditBankAccountPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  // Defensive select: business_account_name is new (m038). If the
  // column isn't there yet, retry with the legacy shape so admin can
  // still load the edit page before the migration is applied.
  let row: any = null;
  {
    const full = await supabase
      .from("bank_accounts")
      .select(
        "id, account_name, business_account_name, currency, bank_name, bank_address, account_number, swift, is_default"
      )
      .eq("id", params.id)
      .maybeSingle();
    if (full.error) {
      const fallback = await supabase
        .from("bank_accounts")
        .select(
          "id, account_name, currency, bank_name, bank_address, account_number, swift, is_default"
        )
        .eq("id", params.id)
        .maybeSingle();
      row = fallback.data
        ? { ...fallback.data, business_account_name: null }
        : null;
    } else {
      row = full.data;
    }
  }

  if (!row) notFound();

  return (
    <div className="mx-auto max-w-2xl p-8 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Edit bank account</h1>
        <Link href="/admin/banks" className="text-sm hover:underline">
          ← Back
        </Link>
      </div>

      <form action={updateBankAccount} className="panel p-5 space-y-3">
        <input type="hidden" name="id" value={row.id} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium">
              Account name *{" "}
              <span className="text-xs text-neutral-500">(internal label)</span>
            </span>
            <input
              name="account_name"
              defaultValue={row.account_name ?? ""}
              required
              className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Currency *</span>
            <select
              name="currency"
              defaultValue={row.currency}
              required
              className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
        {/* Business account name = legal entity printed on the PDF.
            Distinct from the internal label so sales can have a short
            human-friendly dropdown name without changing what shows on
            the wire transfer line. */}
        <label className="block">
          <span className="text-sm font-medium">
            Business account name{" "}
            <span className="text-xs text-neutral-500">
              (printed on PDF — legal entity on the wire transfer)
            </span>
          </span>
          <input
            name="business_account_name"
            defaultValue={row.business_account_name ?? ""}
            placeholder="e.g. CHANGZHOU SOLUX TECHNOLOGY CO., LTD"
            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Bank name</span>
          <input
            name="bank_name"
            defaultValue={row.bank_name ?? ""}
            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Bank address</span>
          <input
            name="bank_address"
            defaultValue={row.bank_address ?? ""}
            className="mt-1 w-full rounded border border-neutral-200 px-3 py-2"
          />
        </label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-medium">Account number / IBAN</span>
            <input
              name="account_number"
              defaultValue={row.account_number ?? ""}
              className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">SWIFT / BIC</span>
            <input
              name="swift"
              defaultValue={row.swift ?? ""}
              className="mt-1 w-full rounded border border-neutral-200 px-3 py-2 font-mono text-sm uppercase"
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="is_default"
            defaultChecked={row.is_default}
          />
          Default for this currency
        </label>
        <div className="pt-1">
          <button className="rounded bg-solux px-4 py-2 text-white font-medium hover:bg-solux-dark">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
