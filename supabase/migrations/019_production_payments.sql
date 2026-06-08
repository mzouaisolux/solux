-- Payment tracking on production orders.
--
-- The expected amounts (deposit + balance) are *always* computed at render
-- time from the linked quotation's `documents.payment_terms` JSONB and
-- `documents.total_price`. We don't duplicate them here — when the
-- quotation changes, the expected amounts on the production order change
-- automatically.
--
-- What we store is the actual receipts: how much has been received so far
-- and when. The production team flips the order from "awaiting_deposit"
-- to "deposit_received" via the existing status workflow once the deposit
-- is fully in (auto-advanced by the app when the received amount meets
-- the expected amount).
--
-- Run in Supabase SQL Editor. Idempotent.

begin;

alter table production_orders
  add column if not exists deposit_received_amount numeric not null default 0,
  add column if not exists deposit_received_at date,
  add column if not exists balance_received_amount numeric not null default 0,
  add column if not exists balance_received_at date,
  add column if not exists payment_notes text;

notify pgrst, 'reload schema';

commit;
