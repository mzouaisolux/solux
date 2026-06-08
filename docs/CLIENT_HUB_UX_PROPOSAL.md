# Client / Affair Architecture — Owner Decision (canonical)

> Updated 2026-06-02 to the **owner's ratified vision**. This SUPERSEDES the earlier draft that proposed a
> client card-grid — **rejected**. The dense vertical, expandable list is kept. The problem to solve is
> **hierarchy & navigation**, not layout. No code is changed by this doc; it records the architecture that
> implementation must follow.

## Status (2026-06-02) — Stages A · B · C SHIPPED
The **top-level "Affaires" module is retired**: `Clients · Task lists · Operations · Forecast · Business`
(no Affaires nav link); `/affairs` redirects to `/clients`; the affair WORKSPACE stays at `/affairs/[id]`.
The single hierarchy is now live: **Client → Client Hub (tabs) → Affair preview → Affair page (work hub)**.
The affair preview's textual timeline was replaced by the operational **progress strip**
(Quote → Task List → Payment → Production → Shipping → Delivered = `ORDER_FLIGHT_PHASES`). Create-project
moved into the Client Hub Affaires tab. (Later cleanup: delete the dead `AffairsExperimentalView` /
`ClientCard` list components; simplify the `/clients` list itself.)

## Design principle
- **Client page = relationship hub.**
- **Affair page = work hub.**
- **Expandable = preview only** (answers one question: *"do I need to pay attention to this project?"*).
- Keep **high information density**, fast scanning, minimal scrolling. **No large cards.**
- Every screen answers **"what needs my attention?"** before showing details.

## Target hierarchy
```
Client  →  Affair / Project  →  Operations
 (L1)         (L3 preview)        (L4 Affair page)
   └─ Client Hub (L2 tabs)
```

---

## Level 1 — Client (the main list)
Dense, vertical, **expandable** rows (current density preserved — NOT cards). Each client row shows:
**name · country · main contact · # affairs · total business value · open alerts · last activity.**
**The client header becomes CLICKABLE → opens the Client Hub (L2).** Expanding the row reveals the
client's affairs as **light previews (L3)**.

→ Code: `components/affairs/ClientCard.tsx` (add **open-alerts** rollup; make the header a link to the
Hub). Page: `app/(app)/affairs/page.tsx` + `AffairsExperimentalView.tsx` (unchanged list shell).

## Level 2 — Client Hub (relationship workspace)
A tabbed customer page — the home for **the whole relationship**, not one project. Tabs:
**Overview · Affairs · Documents · Messages · Contacts · Activity.** (All active affairs, contacts,
shared documents, communication + commercial history, total revenue.)

→ Code: the Client Hub is the **client detail page** (`app/(app)/clients/[id]/page.tsx` upgraded to tabs).
Much of it already exists there (Overview KPIs, Documents/quotation table, Activity timeline, Contacts via
`/clients/[id]/edit`); the **new** tabs are **Affairs** (the L3 previews → Affair page) and **Messages**
(`entity_messages`).

## Level 3 — Affairs (expandable PREVIEW only)
Inside a client, the expandable affair list is kept but made **much lighter — a preview, not a page.**
Target: an expanded affair is **≤ ~250px**. Show ONLY:
**Status · Owner · Next action · key operational indicators · attachment count · conversation status ·
"Open Affair →" button.**

**Move OUT of the expandable → to the Affair page:** Timeline · full status history · project settings ·
cleanup actions · ownership history · detailed conversations · detailed operations · audit logs.

→ Code: `components/affairs/AffairRow.tsx` — strip the expanded body down to the preview; remove the
documents table, the 3 detail panels, the timeline, and `AffairSettings` from it.

## Level 4 — Affair page (the work hub)
`/affairs/[id]` is where users actually work; **all complexity lives here**: Timeline · Documents ·
Operations · Messages · Task lists · Production status · Shipping · Audit history · Settings.

→ Code: `app/(app)/affairs/[id]/page.tsx` + `components/affairs/AffairDetail.tsx` — already holds most of
this; absorb anything removed from the L3 expandable that isn't already present.

---

## Implementation — architecture FIRST (then refine screens)
Per the owner: *do not keep optimizing individual expandables until the hierarchy is implemented.*

**Stage A — fix the hierarchy skeleton (priority):**
- A1. Slim `AffairRow` expanded view to the **preview** (≤250px): Status · Owner · Next action · key
  indicators (stage / task-list / PO) · attachment count · conversation status · **Open Affair →**.
  Remove the documents table, the Operations/Files/Conversation detail panels, the Timeline, and
  `AffairSettings` from the expandable.
- A2. Ensure the **Affair page** (`AffairDetail`) holds everything removed (timeline, settings, cleanup,
  ownership, detailed ops/conversation, audit) — add any gaps so nothing becomes unreachable.
- A3. Make the **client header clickable → Client Hub**, and add the **open-alerts** count to the client
  row.

**Stage B — build the Client Hub (L2 tabs):** Overview · Affairs · Documents · Messages · Contacts ·
Activity — reusing `/clients/[id]` content; wire the L1 client link to it.

**Stage C — consolidation/cleanup (later):** reconcile the `/clients` vs `/affairs` entry points and nav
once L1+L2 are in place. (`/affairs/[id]` and the order lifecycle are untouched throughout.)

## Rule of thumb
If an expandable grows past ~250px, the extra information is in the wrong level — it belongs on the Affair
page (L4) or the Client Hub (L2), not the preview.
