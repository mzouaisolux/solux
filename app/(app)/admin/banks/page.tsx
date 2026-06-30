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
import { canAccessOrAdmin } from "@/lib/permissions";

export default async function BanksPage() {
  // Master data — admin-only. Access Denied (not a silent redirect) on miss.
  const { effectiveRole } = await getEffectiveRole();
  if (!(await canAccessOrAdmin(["admin.manage_banks"]))) {
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
    <div className="solux-pro sx-page">
      <div className="sx-wrap">
        <section className="card sec ad-section">
          <div className="eyebrow">Admin</div>
          <h2 className="ad-doc-title">Bank accounts</h2>
          <p className="ad-lead">
            One default per currency. When a quotation is created in USD the default USD account is
            auto-selected; same for EUR and CNY. The sales rep can still override per quotation.
          </p>

          {/* New account.
              Two distinct names:
                · Account name = internal label (shown in dropdowns / lists)
                · Business account name = legal entity, printed on the PDF
              If the second is empty the PDF falls back to the first. */}
          <form action={createBankAccount} className="card ad-subform ad-form-narrow">
            <div className="st">New account</div>
            <div className="ad-field-grid">
              <div className="ad-field">
                <label className="ad-fl">
                  Account name <span className="req">*</span> <span className="int">(internal label)</span>
                </label>
                <input name="account_name" type="text" placeholder="e.g. Solux China USD" required />
              </div>
              <div className="ad-field">
                <label className="ad-fl">
                  Business account name <span className="int">(printed on PDF)</span>
                </label>
                <input
                  name="business_account_name"
                  type="text"
                  placeholder="e.g. CHANGZHOU SOLUX TECHNOLOGY CO., LTD"
                />
              </div>
            </div>
            <div className="ad-field-grid">
              <div className="ad-field">
                <label className="ad-fl">
                  Currency <span className="req">*</span>
                </label>
                <select name="currency" defaultValue="USD" required>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div className="ad-field">
                <label className="ad-fl">Bank name</label>
                <input name="bank_name" type="text" placeholder="Bank name" />
              </div>
            </div>
            <div className="ad-field">
              <label className="ad-fl">Bank address</label>
              <input name="bank_address" type="text" placeholder="Bank address" />
            </div>
            <div className="ad-field-grid">
              <div className="ad-field">
                <label className="ad-fl">Account number / IBAN</label>
                <input name="account_number" type="text" className="ad-mono" placeholder="Account number / IBAN" />
              </div>
              <div className="ad-field">
                <label className="ad-fl">SWIFT / BIC</label>
                <input
                  name="swift"
                  type="text"
                  className="ad-mono"
                  placeholder="SWIFT / BIC"
                  style={{ textTransform: "uppercase" }}
                />
              </div>
            </div>
            <label
              style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, marginBottom: 13, cursor: "pointer" }}
            >
              <input type="checkbox" name="is_default" />
              Set as default for the selected currency
            </label>
            <button className="sx-btn sx-btn-go">Add account</button>
          </form>

          {CURRENCIES.map((cur) => {
            const list = groups.get(cur) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={cur}>
                <div className="ad-cur-head">
                  <div className="eyebrow">Currency</div>
                  <h3>{cur}</h3>
                  <span style={{ fontSize: 12, color: "var(--sx-mute)" }}>
                    {list.length} account{list.length === 1 ? "" : "s"}
                  </span>
                </div>
                {list.map((r) => (
                  <div key={r.id} className="ad-bank-card">
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
                      <div>
                        <div className="ad-bank-top">
                          <span className="ad-bank-name">{r.account_name}</span>
                          {r.is_default && <span className="ad-tag dft">Default {r.currency}</span>}
                        </div>
                        {/* Business account name appears on the PDF; surface it here too so
                            admin can spot accounts where it's missing (PDF then falls back
                            to the internal account_name). */}
                        {r.business_account_name ? (
                          <div className="ad-bank-pdf">PDF: {r.business_account_name}</div>
                        ) : (
                          <div className="ad-bank-pdf warn">PDF: ⚠ missing business account name</div>
                        )}
                        {r.bank_name && <div className="ad-bank-meta">{r.bank_name}</div>}
                        {r.bank_address && (
                          <div style={{ fontSize: 11, color: "var(--sx-mute)", marginTop: 3 }}>{r.bank_address}</div>
                        )}
                        <div className="ad-bank-mono">
                          {r.account_number && <span>A/C {r.account_number}</span>}
                          {r.swift && <span>SWIFT {r.swift}</span>}
                        </div>
                      </div>
                      <div className="ad-acts">
                        {!r.is_default && (
                          <form action={setDefaultBankAccount}>
                            <input type="hidden" name="id" value={r.id} />
                            <button className="sx-btn sx-btn-sm">Set default</button>
                          </form>
                        )}
                        <Link href={`/admin/banks/${r.id}`} className="sx-btn sx-btn-sm">
                          Edit
                        </Link>
                        <form action={deleteBankAccount}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="sx-btn sx-btn-danger sx-btn-sm">Delete</button>
                        </form>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}

          {(!rows || rows.length === 0) && (
            <div className="ad-bank-card" style={{ textAlign: "center", color: "var(--sx-mute)", fontSize: 13 }}>
              No bank accounts yet. Add one above.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
