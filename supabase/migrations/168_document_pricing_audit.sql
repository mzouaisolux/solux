-- =====================================================================
-- m168 — Pricing History audit + Director notification (feature #2)
-- =====================================================================
-- After the Sales Director approves a pricing (document lines carry
-- pricing_source='approved_service_request'), any later modification by Sales
-- of the product price, transport price or a discount must be:
--   1. recorded in an append-only, VISIBLE audit (document_pricing_audit), and
--   2. notified to the Sales Director (event doc.approved_price_changed
--      routed to the bell, m136/m162 registry pattern).
-- Nothing blocks the edit — no silent change, full traceability.
-- Idempotent — safe to run in the Supabase SQL Editor.
-- =====================================================================

create table if not exists public.document_pricing_audit (
  id               uuid primary key default gen_random_uuid(),
  document_id      uuid not null references public.documents(id) on delete cascade,
  -- what changed: 'product_unit_price' | 'pole_unit_price' | 'freight_cost'
  --               | 'discount' | 'line_removed' | 'total_price' …
  field            text not null,
  line_label       text,          -- human label of the line (client_product_name)
  old_value        numeric,
  new_value        numeric,
  pricing_source   text,          -- provenance of the touched line (lock class)
  approved_by      uuid,          -- who had approved the original price
  changed_by       uuid references auth.users(id) on delete set null,
  changed_at       timestamptz not null default now()
);

create index if not exists idx_doc_pricing_audit_doc
  on public.document_pricing_audit(document_id, changed_at desc);

alter table public.document_pricing_audit enable row level security;

-- Append-only: anyone who can work on documents can write an audit row;
-- nobody updates/deletes (no policies for those verbs). Read follows the
-- document visibility model (authenticated read — the card lives on the
-- document page which is already RLS-scoped by documents).
drop policy if exists "pricing audit insert" on public.document_pricing_audit;
create policy "pricing audit insert" on public.document_pricing_audit
  for insert to authenticated with check (auth.uid() is not null);
drop policy if exists "pricing audit read" on public.document_pricing_audit;
create policy "pricing audit read" on public.document_pricing_audit
  for select to authenticated using (true);

-- Event routing (m136 opt-in registry, m162 pattern):
-- master '*' row switches the event ON; the sales_director row rings the bell.
insert into public.event_routing (event_key, consumer, role, config, enabled)
values
  ('doc.approved_price_changed', 'notification', '*',              '{}'::jsonb,                   true),
  ('doc.approved_price_changed', 'notification', 'sales_director', '{"channel":"bell"}'::jsonb,   true)
on conflict do nothing;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('168_document_pricing_audit.sql',
        'Pricing History audit (document_pricing_audit, append-only) + doc.approved_price_changed event routed to the Sales Director bell — no silent modification of Director-approved prices (product/transport/discount).')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';
