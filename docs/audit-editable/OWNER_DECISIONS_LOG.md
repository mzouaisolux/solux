# Owner Decisions Log — Top-Priority (★) Questions

> **Canonical record.** These are the owner's confirmed answers to the ★ top-priority
> questions in [QUESTIONS_FOR_ME.md](./QUESTIONS_FOR_ME.md), recorded **2026-05-30**.
> This file is the **source of truth** for these decisions; the other audit docs and
> [RULES_DRAFT_EDITABLE.md](./RULES_DRAFT_EDITABLE.md) are updated to reference it.
>
> **Status of these rules:** they describe **TARGET / INTENDED behavior and policy**.
> Most are **NOT yet implemented in code** — we are still in the documentation/
> clarification phase. Nothing here authorizes a code change yet. Where a decision
> approves a future fix (e.g. G), it is marked *approved — not yet applied*.

---

## A. Task list on "Won"

**Decision:** Manual creation, but mandatory and highly visible after a quote is marked won.

**Rule:**
- Winning a quotation must **not** automatically create the production task list.
- After a quotation is marked `won`, the app must clearly show a required action: **Create Production Task List**.
- If a won quotation has no linked task list, it must appear as an alert / Action Center item until the task list is created.

**Comment:** This avoids creating production task lists too early when commercial, payment, configuration, or shipping details are not fully ready, while still preventing won deals from being forgotten.

---

## B. Won-quote editing

**Decision:** Revise-only / new version, with task-list impact control if a production task list already exists.

**Rule:**
- Once a quotation is `won`, it must **not** be edited directly in place.
- Any commercial change after `won` must be done through a **new revision / new version** linked to the original quotation.
- **If no production task list exists yet:** the new revision becomes the active commercial version once validated.
- **If a production task list already exists:**
  - the app must not silently overwrite the existing task list;
  - the app must detect and display the **differences** between the previous won version and the new revision;
  - changes affecting production, configuration, quantity, shipping, deadlines, payment terms, or BL information must trigger a **review state**;
  - the linked task list must be marked as **requiring review / update** before production continues;
  - operations or task-list manager must confirm whether the task list should be **updated, regenerated, or kept unchanged**.
- The previous won version must remain **preserved for audit and history**.
- The **Create revision / Revise quote** action must be clear and accessible from the won quotation detail page.

**Comment:** A won quotation is a commercial commitment. Direct editing creates audit, pricing, production, and customer-history risks. Revisions allow flexibility, but once production has started, changes must be controlled and reviewed before they affect the task list.

---

## C. Canonical discussion surface

**Decision:** **Entity messages** are the canonical discussion surface. **Event comments** remain only for event-specific operational comments.

**Rule:**
- The main place to discuss a quotation, client, task list, production order, or business entity must be `entity_messages`.
- `event_comments` should be used **only** to comment on a specific operational event (status change, delay, validation request, payment issue, BL/shipping issue, production issue, Action Center event).
- The UI must avoid showing two competing chat systems. From the user's perspective there is **one main conversation area** for the entity. Important events may appear inside or alongside that conversation as contextual system entries.
- If a notification is linked to an event comment, clicking it should open the related entity page and highlight/open the relevant event discussion in context.

**Comment:** Keeps the app understandable. General coordination belongs to entity messages; precise event follow-up belongs to event comments.

---

## D. Bell on event creation

**Decision:** High and critical events must raise a bell notification even if no comment exists yet.

**Rule:** The notification bell must not be limited to unread comments only.
- **Critical event:** must raise a bell notification.
- **High event:** must raise a bell notification.
- **Medium event:** raises a bell notification only if it requires action from the user or the user's role.
- **Low / informational event:** does not raise a bell notification by default.
- **Any unread comment** on a visible event or entity discussion must raise a bell notification.

**Comment:** Important operational issues should not depend on someone adding a comment before becoming visible, while avoiding noise from low-priority system events.

---

## E. Visibility = security?

**Decision:** Visibility rules should become a **real security boundary enforced by RLS**, but migration can be progressive.

**Rule:**
- Team, region, lens, ownership, and role-based visibility must not remain only advisory at the application level in the long term.
- Application-level filtering may be used for UX/convenience, but sensitive data access must eventually be enforced at the **database level through RLS**.
- Current app-level visibility may remain temporarily, but must be documented as an **interim state**, not the final security model.
- **Target:** UI filtering = user experience; RLS filtering = real security. Any sensitive visibility restriction must be enforced by RLS before the app is considered production-secure.

**Comment:** Prevents accidental data exposure if a UI filter fails, a route is accessed directly, or a server action queries too broadly. RLS changes must be **progressive and tested with real user accounts, not View-As**.

---

## F. Owner delete at any status + Archive

**Decision:** Deletion must be restricted after a quotation is won. Archived records must require an archive reason.

**Rule (deletion):**
- **Draft** quotations may be deleted by authorized users.
- **Sent / negotiating** quotations may be deleted only if **no downstream** production task list or production order exists.
- Once a quotation is `won`, it must **not** be freely deleted.
- Won quote with **no linked task list yet:** deletion may be allowed only for **admin / super admin**, with strong confirmation, and preferably recorded in an audit log.
- Won quote with a **linked task list or production order:** deletion is **blocked by default**; use cancellation or archive instead; cascade deletion of production data must not happen silently.

**Rule (archive):** When a quotation, task list, or production order is archived, the user must provide an **archive reason**. The archive action must store: archive reason, archived by, archived at, optional internal note/comment. Archived records must remain searchable/readable for history, be visually separated from active records, and not appear in active workflow dashboards unless a filter is enabled.

**Comment:** A won quotation is a commercial commitment, often linked to production/payment/shipment/customer history. The correct behavior is usually **cancel / archive, not destructive deletion**. Archiving must not be silent.

---

## G. `shipping_details` key fix

**Decision:** **Approved** — align `blIsFilled` with the keys actually stored in `shipping_details`. *(Approved fix — NOT yet applied; we are still in the documentation phase.)*

**Rule:**
- Do **not** rename existing stored keys unless a proper migration is planned.
- `blIsFilled` must read the keys currently stored in `shipping_details`, especially `forwarder` and `vessel`.
- The "BL missing" Action Center item should self-clear when the required BL/shipping fields are filled.
- Minimum field required to clear the BL-missing alert: **`forwarder`**. If a BL number is available it should also be stored, but `bl_number` must **not** be mandatory to clear the first BL follow-up alert (BL number may only arrive later).

**Comment:** A bug fix, not a redesign. Align detection logic with the data shape already stored. Stored jsonb keys must not be renamed silently (would break existing records).

---

## H. Pricing

### H.1 Pricing modes
**Decision:** Catalogue / price-list pricing by default, with controlled manual override. Directors/authorized managers can assign a default price list by sales user, region, or market.

**Rule:**
- Product prices default from the **active product price list**.
- Support multiple price lists (e.g. high, medium, low, distributor, regional, special-project).
- A director/authorized manager can assign a default price list to: a sales user, a region, a country/market, or a specific client.
- On quotation creation the app proposes the default price list by **priority**: (1) client-specific, (2) sales-user assigned, (3) region/country assigned, (4) company default.
- A quotation line may use: (1) default catalogue price, (2) selected price-list/tier price, (3) client-specific price, (4) manual override.
- Manual override must be **visible and traceable**, storing: original price, selected price list, overridden price, override reason (if required), overridden by, overridden at.

**Comment:** SOLUX uses different prices by region/market/strategy. Management controls which price list is assigned to each sales user/region, while allowing controlled exceptions.

### H.2 Discounts / Remises
**Decision:** Allowed, but controlled, visible, and traceable.

**Rule:**
- Support **line-level** and **document-level** discounts.
- Clearly display: original unit price, discount % or amount, discounted unit price, total discount, final line total, final document total.
- Store per discount: type (percentage/fixed), value, reason, discounted by, discounted at.
- **Approval:** sales user up to an approved limit; sales manager/director approves larger; admin/super admin can override. Limits configurable later; until then, discounts above an internal threshold are marked **requiring approval**.
- **Margin warning:** if a discount brings the quote below the minimum accepted margin, show a warning or require manager approval. Never silently allow a price below the commercial safety threshold.

**Comment:** Sales need negotiation flexibility, but discounts affect margin and commission, so they must be visible and traceable.

### H.3 Tax / VAT
**Decision:** Always **tax-free**. SOLUX quotations and export documents do not include VAT/tax.

**Rule:**
- Treat quotations, proforma invoices, and export documents as **tax-free** by default.
- Do not auto-calculate or add VAT/tax.
- Show clearly when needed: "VAT / Tax: 0", "Tax-free export sale", "VAT not applicable for export".
- Any existing tax/VAT field should be hidden by default, fixed at 0, or marked not applicable.

**Comment:** SOLUX only handles export sales here; keep quotation/proforma simple, no domestic VAT logic unless the business model changes.

### H.4 Currency / conversion
**Decision:** One main currency per document. Conversion allowed but explicit, traceable, and **locked per document version**. Large orders may show the exchange rate with an adjustment rule.

**Rule:**
- Each document has one primary currency (USD, EUR, CNY), selected at document level.
- Prices may exist in a base currency (normally USD), but the final total is calculated/displayed in the document currency.
- On conversion store: source currency, target currency, exchange rate, rate date, rate source (if available), converted by, converted at.
- Do **not** silently change prices from a live rate update after creation. Once saved/sent, the rate is **locked for that version**. On revision, the user may keep the original rate or apply a new one.
- **Display:** user chooses whether the rate appears on the quotation/proforma/invoice. Large/high-risk orders may show the rate used, its date, and an **exchange-rate adjustment clause**.
- **Adjustment clause:** for very large orders, if the rate moves significantly between quotation/deposit/production/shipment/final payment, SOLUX can adjust the final amount or request a price revision. Configurable threshold; may apply before production launch or final shipment depending on terms. Mark a quote as: exchange-rate protected, adjustment-clause included, or fixed-rate.
- **Bank account:** available bank details depend on the document currency (USD doc → USD account, EUR → EUR, CNY → CNY); user may select another authorized account, default matches currency.

**Comment:** SOLUX quotes in USD/EUR/CNY depending on customer/company/bank/market. Conversion must be flexible but traceable; large orders carry currency exposure.

### H.5 Rounding / Arrondis
**Decision:** Round monetary amounts to **2 decimals at document level**, with clear calculation rules.

**Rule:**
- All monetary values on quotations/proforma/invoices show **2 decimals**, consistently for: unit prices, line totals, subtotal, discounts, grand total, deposit, balance, commission, conversion results.
- Calculate with sufficient internal precision, then round displayed/stored amounts to 2 decimals. Standard rounding: 0.005 and above rounds up; below rounds down.
- **Line vs document total:** round each line total to 2 decimals → sum rounded line totals → apply document discount → grand total → round to 2 decimals. Avoid discrepancies between sum-of-lines and document total.
- **Deposit/balance:** deposit rounded to 2 decimals; **balance = grand total − deposit** (balance absorbs any rounding difference so totals reconcile exactly).
- **Commission:** from the finalized commercial basis, rounded to 2 decimals.
- **Conversion:** converted amount rounded to 2 decimals in target currency; the exchange rate stored with more precision than 2 decimals.

**Comment:** Rounding must be predictable; the balance absorbs minor differences so the document total always reconciles.

### H.6 Default deposit
**Decision:** Default **30%**, editable per deal.

**Rule:**
- Prefill deposit 30% / balance 70%.
- Payment terms remain editable. Support: 30/70, 25/75, 20/80, 100% before production, deposit + L/C, L/C at sight, L/C 30/60/90 (if approved), no-deposit (only if explicitly authorized).
- Non-standard terms must be visible and traceable. Risky terms (low deposit, delayed balance, long credit) require management approval or at least a risk warning.

**Comment:** 30% is the default, but flexibility is needed for large projects/tenders/strategic clients/bank-backed terms; non-standard terms must be visible and controlled.

### H.7 Balance reminder default
**Decision:** Created by default, editable, region-adaptive. **Africa: 20 days** before ETA / production completion.

**Rule:**
- For orders with a balance due before shipment, create a default reminder before the expected shipment / production completion date.
- Defaults: **Africa = 20 days**; **other regions = 15 days** (unless another regional rule is configured). Editable by authorized users.
- Applies when: payment term includes balance before shipment, order is in production, balance not yet received.
- Visible in: Action Center, order detail page, finance/payment follow-up area (if available).

**Comment:** Balance collection is critical before shipment; Africa follow-up takes longer, so reminders start earlier. Defaults help but don't lock the team.

### H.8 Offer validity windows
**Decision:** Product price validity **30 days**; transport/freight validity **7 days**; both editable.

**Rule:**
- Distinguish product price validity, transport price validity, and full quotation validity (if different).
- Defaults: product prices 30 days; freight/transport 7 days. Editable.
- For large projects/tenders/unstable markets/special discounts/FX-sensitive quotes, allow shorter/longer validity manually.
- Display when needed: offer-valid-until date, freight-valid-until date, exchange-rate clause (if applicable).

**Comment:** Freight rates change quickly so they get a shorter window; keep the distinction clear to avoid disputes.

### H.9 Warranty standard
**Decision:** Warranty selectable **by product** (e.g. 3 years, 5 years, longer for special offers).

**Rule:**
- Support warranty duration at product level; each product has a default (e.g. 3y, 5y, 10y if applicable, custom only if approved).
- Prefill warranty from product config when added to a quote; user may change it commercially, but special extensions must be visible/traceable.
- On manual change store: original product warranty, selected warranty, changed by, changed at, reason (if needed).
- Warranty is stored with the document version; later product-warranty changes must not alter old quotations.

**Comment:** Warranty is a commercial commitment depending on product/range/components/strategy; do not silently apply one warranty to all products.

### H.10 No deposit required
**Decision:** `no_deposit_required` is an **exceptional** condition requiring explicit authorization.

**Rule:**
- By default every order requires a deposit before production (usually 30%).
- `no_deposit_required` = SOLUX agrees to start without a deposit; only in exceptional cases (trusted long-term customer, strategic project, public tender with confirmed financing, L/C or bank-backed, internal management decision, special director/admin agreement).
- Must not be set casually by a normal sales user. **Authorization:** sales user cannot approve alone; sales manager/director can request/approve per permissions; admin/super admin can approve; finance approval may be required if risk is high.
- If selected, store: reason, approved by, approved at, payment guarantee/alternative security (if any), internal comment. UI must clearly show the order is a no-deposit exception.

**Comment:** Starting without deposit creates cash-flow/production risk; useful for strategic/bank-backed deals but must be visible, justified, and approved.

---

## I. Default role × capability matrix

**Decision:** Do **not** blindly ratify the seeded `role_permissions` matrix yet. First export it into a human-readable capability matrix for owner review.

**Rule:**
- The current seeded permissions may be used as the **technical baseline** but must not be treated as final business rules until reviewed and approved by the owner.
- Generate a readable **`/docs/CAPABILITY_MATRIX.md`** showing, per role: accessible pages; visible entities; allowed actions; restricted actions; admin permissions; document permissions; quotation permissions; task-list permissions; production-order permissions; shipping/BL permissions; pricing/discount permissions; notification/message permissions; delete/archive permissions.
- The matrix must mark each entry: **Confirmed by code / Assumed from code / Needs owner confirmation / Potentially risky permission**.
- **No permission should be changed yet.** After owner review, the confirmed matrix becomes part of `/RULES.md`.

**Comment:** The seeded permissions are a starting point, but roles/capabilities define operational control and must be reviewed in plain language before being finalized.
