# Sprint 2 — Reliability tooling

Four guards against the failure classes the audit surfaced. Two run with zero
extra credentials; two need the owner's DB access to fully run.

## S2.1 — Automated E2E regression  ✅ runs now
```
npm run e2e:regression
```
Real logins (true JWT per role), asserts the permission matrix per role + the
audit fixes (F1 director visibility, F3 document pages = HTTP 200). Exit 1 on any
failure → CI-able. Source: `e2e/audit/regression.ts`. **Status: 23/23 green.**
The full pipeline (create→won→launch→validate→order, incl. the F4 affair_id
regression) is driven by `e2e/audit/drive.ts` + the step files in `e2e/.runs/steps/`.

## S2.4 — Schema ↔ code check  ✅ runs now
```
npm run check:schema            # advisory
FAIL_ON_UNKNOWN=1 npm run check:schema   # CI gate
```
Catches the **runtime-42703 class** (an untyped Supabase query referencing a
column that doesn't exist fails at runtime, not compile). Parses every column
from `supabase/schema.sql` + migrations (401 columns) and flags code column
references that match no table (typos / missing migrations). Source:
`e2e/audit/schema-check.ts`. **Status: 0 unknown refs (code is clean).** This is
the *interim* protection until generated types (S2.3) are in place.

## S2.2 — Migration runner  ⚙️ dry-run runs now · apply needs DB creds
```
npm run db:migrate                                  # dry-run: lists pending
DATABASE_URL='postgres://…@…supabase.co:5432/postgres' \
  node --env-file=.env.local --env-file=.env.e2e --experimental-strip-types \
  scripts/migrate.ts --apply                        # apply (needs `npm i pg`)
```
Replaces "paste each migration into the SQL editor". Reads `schema_migrations`
(via the anon key + a signed-in read) to find pending files, applies them in
order; each file owns its `begin/commit` + self-insert. Source: `scripts/migrate.ts`.

> **⚠ Prerequisite — backfill the ledger.** `schema_migrations` was introduced at
> **m113**, so migrations 001–112 ran but were never recorded and show as
> "pending". The runner **refuses `--apply`** while pre-ledger migrations look
> pending, and prints the exact backfill SQL. Run that one-time backfill
> (`insert into schema_migrations (filename) values (...) on conflict do nothing;`)
> after confirming 001–112 are applied; then the runner only sees genuinely-new
> migrations. (This incomplete ledger is itself an audit finding.)

## S2.3 — Generated Supabase types  📝 needs DB creds (interim: S2.4 covers it)
```
npm run gen:types     # needs `supabase login` + DB password / access token
```
Canonical typegen via the Supabase CLI → `lib/database.types.ts`, then wire it as
`createClient<Database>(…)` so column typos fail at **compile**. I can't run this
here (no service key / DB password / CLI in this environment). Until it's adopted,
**S2.4 `check:schema` is the interim safety net** for the same failure class.
Adopt incrementally (per-call-site `createClient<Database>`) to avoid a one-shot
flood of type errors against the currently-untyped client.
```
