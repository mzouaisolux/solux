# Scalability pattern — fetch-all → SQL aggregate + paginated list

Established on **My Requests** (`app/(app)/projects/page.tsx`, migration `127_project_request_status_counts.sql`, `lib/project-queue.ts`) and meant to be **reused** on the other critical pages flagged by the 2026-06-17 audit (Clients list, documents/new, operations, business, prospects/pipeline).

## The anti-pattern it replaces
A server component that:
1. `select(...)` **all rows** of a table (no `.range()`), then
2. computes KPIs / status buckets / counts **in JS** (`rows.filter().length`, `reduce`), and
3. **filters/sorts the list in JS** and renders **every** row (no pagination/virtualization).

This ships the whole table to the server on every load and is silently wrong once capped (`.limit(5000)`), or just slow/heavy at volume.

## The pattern (3 moves)

### 1. Counts / KPIs → one grouped SQL aggregate (RPC)
Create a **`security invoker`** SQL function that returns the grouped counts. `invoker` means it runs under the **caller's RLS**, so the numbers are role-scoped automatically — no scoping to replicate, no leak.

```sql
create or replace function project_request_status_counts()
returns table (status text, total bigint, mine bigint)
language sql security invoker stable as $$
  select status,
         count(*)::bigint as total,
         count(*) filter (where owner_id = auth.uid())::bigint as mine
    from project_requests
   where archived_at is null
   group by status;
$$;
grant execute on function project_request_status_counts() to authenticated;
```

Call it with `supabase.rpc("...")`. **Always** keep a **defensive fallback** to the old JS path so the page never breaks before the migration is applied (migrations here are applied manually):

```ts
const { data, error } = await supabase.rpc("project_request_status_counts");
if (!error && data) { /* build maps from data */ }
else { /* fallback: lightweight projection + the existing pure summarize() */ }
```

### 2. List → server-side filtered + paginated, one round-trip
Push every filter to SQL (`.eq/.in/.is/.not/.ilike`), order in SQL, and page with `.range()`. Ask for the total in the **same** query via `{ count: "exact" }`:

```ts
let q = supabase.from("project_requests")
  .select("…cols…, clients:client_id(company_name)", { count: "exact" })
  .order("created_at", { ascending: false });
if (scope === "active") q = q.is("archived_at", null);
if (mine && userId)     q = q.eq("owner_id", userId);
if (statusSet)          q = q.in("status", [...statusSet]);
const { data: rows, count } = await q.range((page-1)*PAGE, page*PAGE - 1);
const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
```

Render pagination controls **only when `totalPages > 1`** — so small datasets look byte-for-byte identical to before (no visual change until the data actually grows).

### 3. Joins / labels → resolve only for the current page
Resolve owner labels / lookups for the **page's** rows, not the whole table:
```ts
const ownerIds = [...new Set(rows.map(r => r.owner_id).filter(Boolean))];
const ownerLabels = await resolveUserLabelStrings(ownerIds);
```

## Reuse note
The same RPC can power more than one surface. Example: `lib/project-queue.getProjectActions` (the nav badge + Action-Required widget) was rewritten to consume `project_request_status_counts()` instead of its own fetch-all — same query, two consumers.

## Verification checklist (run for every page you convert)
- `tsc -p tsconfig.json --noEmit` → no new errors.
- `npm test` → all green (keep the pure `summarize`/helpers + their tests as the fallback).
- Playwright **before/after**: the counts, tabs, buckets and visible rows must be **identical** at current volume.
- Measure `main_doc` bytes + TTFB before/after (the win shows at volume; at small volume it's flat — that's expected).
- **Indexes**: ensure the filter/sort columns are indexed (see `126_perf_indexes.sql`). On an already-large table, build new indexes with `CREATE INDEX CONCURRENTLY` (outside a transaction).
