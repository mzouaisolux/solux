-- =====================================================================
-- m180 — Webhook delivery idempotency: one outbox row per (endpoint, event).
-- =====================================================================
-- Package go-live hardening (Figma_Datasheet_Project_Status.md, open item #4):
-- "dedupe on event_id (dispatcher retries -> avoid double-email/double-row)".
--
-- The dispatcher already sends a stable per-row `x-solux-delivery` header, so a
-- RETRY of the same delivery row is dedupe-able downstream. This migration
-- closes the other vector: if `emitEvent` (and thus `enqueueWebhookDeliveries`)
-- runs twice for the SAME logical event — a server retry, a double-submit —
-- today that inserts a SECOND delivery row with the same `event_id`, so n8n
-- emails the customer twice and appends two tracker rows.
--
-- A partial unique index on (endpoint_id, event_id) makes the second insert a
-- no-op (the enqueue path upserts with on-conflict-do-nothing). event_id is
-- nullable, so the index is partial (null event_ids — legacy / unknown — are
-- left un-deduped rather than collapsed into one).
--
-- Additive + idempotent. Note: numbered 180 because 178/179 (quotation_packages
-- / attach_datasheets, PRD-006) are already applied on `main`.
-- =====================================================================

begin;

-- Defensive: collapse any pre-existing duplicates so the unique index can be
-- built. Keep the earliest row per (endpoint_id, event_id); drop the rest.
-- (Low volume + single operator today, so this is expected to be a no-op.)
delete from webhook_deliveries d
using webhook_deliveries keep
where d.endpoint_id = keep.endpoint_id
  and d.event_id   = keep.event_id
  and d.event_id is not null
  and (keep.created_at, keep.id) < (d.created_at, d.id);

create unique index if not exists uq_webhook_deliveries_endpoint_event
  on webhook_deliveries(endpoint_id, event_id)
  where event_id is not null;

insert into schema_migrations (filename, note)
values ('203_webhook_delivery_dedupe.sql',
        'Webhook delivery idempotency: partial unique index on (endpoint_id, event_id) so a re-emitted event cannot enqueue a duplicate outbox row (dispatcher/emit retry dedupe).')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
