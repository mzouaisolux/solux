import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  createBankAccount,
  deleteBankAccount,
  setDefaultBankAccount,
} from "./actions";
import { CURRENCIES, type Currency, isAdminLike } from "@/lib/types";
import { getEffectiveRole } from "@/lib/auth";
import AccessDenied from "@/components/AccessDenied";

export default async function BanksPage() {
  // Master data — admin-only. Access Denied (not a silent redirect) on miss.
  const { effectiveRole } = await getEffectiveRole();
  if (!isAdminLike(effectiveRole)) {
    return (
      <AccessDenied
        title="Administrators only"
        message="Master-data management is restricted to administrators."
      />
    );
  }

  const supabase = createClient();
  const { data: rows } = await supabase
    .from("bank_accounts")
    .select(
      "id, account_name, business_account_name, currency, bank_name, bank_address, account_number, swift, is_default"
    )
    .order("currency")
    .order("is_default", { ascending: false })
    .order("account_name");

  // Group by currency for display.
  const groups = new Map<Currency, typeof rows>();
  for (const cur of CURRENCIES) groups.set(cur, [] as any);
  for (const r of rows ?? []) {
    if (!groups.has(r.currency as Currency))
      groups.set(r.currency as Currency, [] as any);
    groups.get(r.currency as Currency)!.push(r);
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-8 space-y-8">
      <div className="flex items-end justify-between pb-4 border-b border-neutral-200">
        <div>
          <div className="eyebrow">Admin</div>
          <h1 className="doc-title mt-1">Bank accounts</h1>
          <p className="text-xs text-neutral-500 mt-2">
            One default per currency. When a quotation is created in USD the
            default USD account is auto-selected; same for EUR and CNY. The
            sales rep can still override per quotation.
          </p>
        </div>
      </div>

      {/* New account */}
      <section className="panel p-5 space-y-3">
        <h2 className="text-lg font-semibold">New account</h2>
        <form action={createBankAccount} className="space-y-3">
          {/* Two distinct names:
                · Account name = internal label (shown in dropdowns / lists)
                · Business account name = legal entity, printed on the PDF
              If the second is empty the PDF falls back to the first. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-neutral-500 mb-1 block">
                Account name <span className="text-rose-600">*</span>{" "}
                <span className="text-neutral-400">(internal label)</span>
              </span>
              <input
                name="account_name"
                placeholder="e.g. Solux China USD"
                required
                className="w-full rounded border border-neutral-200 px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-xs text-neutral-500 mb-1 block">
                Business account name{" "}
                <span className="text-neutral-400">(printed on PDF)</span>
              </span>
              <input
                name="business_account_name"
                placeholder="e.g. CHANGZHOU SOLUX TECHNOLOGY CO., LTD"
                className="w-full rounded border border-neutral-200 px-3 py-2"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <select
              name="currency"
              defaultValue="USD"
              required
              className="rounded border border-neutral-200 px-3 py-2"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              name="bank_name"
              placeholder="Bank name"
              className="rounded border border-neutral-200 px-3 py-2"
            />
          </div>
          <input
            name="bank_address"
            placeholder="Bank address"
            className="w-full rounded border border-neutral-200 px-3 py-2"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              name="account_number"
              placeholder="Account number / IBAN"
              className="rounded border border-neutral-200 px-3 py-2 font-mono text-sm"
            />
            <input
              name="swift"
              placeholder="SWIFT / BIC"
              className="rounded border border-neutral-200 px-3 py-2 font-mono text-sm uppercase"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_default" />
            Set as default for the selected currency
          </label>
          <div>
            <button className="rounded bg-solux px-4 py-2 text-white font-medium hover:bg-solux-dark">
              Add account
            </button>
          </div>
        </form>
      </section>

      {CURRENCIES.map((cur) => {
        const list = groups.get(cur) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={cur} className="space-y-3">
            <div className="flex items-baseline gap-3">
              <div className="eyebrow">Currency</div>
              <h2 className="text-lg font-semibold">{cur}</h2>
              <span className="text-xs text-neutral-500">
                {list.length} account{list.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="space-y-2">
              {list.map((r) => (
                <div key={r.id} className="panel p-4 space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{r.account_name}</h3>
                        {r.is_default && (
                          <span className="rounded bg-solux-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widerx text-neutral-700">
                            Default {r.currency}
                          </span>
                        )}
                      </div>
                      {/* Business account name appears on the PDF; surface it
                          here too so admin can spot accounts where it's
                          missing (and the PDF would fall back to the
                          internal account_name). */}
                      {r.business_account_name ? (
                        <p className="text-[11px] uppercase tracking-widerx text-neutral-500 font-mono">
                          PDF: {r.business_account_name}
                        </p>
                      ) : (
                        <p className="text-[11px] uppercase tracking-widerx text-amber-700 font-mono">
                          PDF: ⚠ missing business account name
                        </p>
                      )}
                      {r.bank_name && (
                        <p className="text-sm text-neutral-700">{r.bank_name}</p>
                      )}
                      {r.bank_address && (
                        <p className="text-xs text-neutral-500">
                          {r.bank_address}
                        </p>
                      )}
                      <div className="text-xs font-mono text-neutral-700 mt-1 space-x-3">
                        {r.account_number && <span>A/C {r.account_number}</span>}
                        {r.swift && <span>SWIFT {r.swift}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {!r.is_default && (
                        <form action={setDefaultBankAccount}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="rounded border border-neutral-200 px-3 py-1.5 hover:bg-neutral-50">
                            Set default
                          </button>
                        </form>
                      )}
                      <Link
                        href={`/admin/banks/${r.id}`}
                        className="rounded border border-neutral-200 px-3 py-1.5 hover:bg-neutral-50"
                      >
                        Edit
                      </Link>
                      <form action={deleteBankAccount}>
                        <input type="hidden" name="id" value={r.id} />
                        <button className="rounded border border-neutral-200 px-3 py-1.5 text-red-600 hover:bg-red-50">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      {(!rows || rows.length === 0) && (
        <div className="panel p-8 text-center text-sm text-neutral-500">
          No bank accounts yet. Add one above.
        </div>
      )}
    </div>
  );
}
