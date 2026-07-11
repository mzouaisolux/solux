-- ============================================================================
-- m162 — Notification routes for the REQUEST workflows (owner 2026-07-11,
-- QA round 1 finding: events flowed but event_routing was empty, so nobody
-- was ever notified while the submit toast claimed "Operations notified").
--
-- The event registry stays OPT-IN (m136 / owner 2026-07-03): an event
-- notifies only when its MASTER row (consumer='notification', role='*')
-- exists. This migration opts IN the request-workflow events and pins the
-- role that must get the BELL (others fall back to the severity default,
-- i.e. the feed). All INSERTs are idempotent (WHERE NOT EXISTS) and fully
-- reversible from the admin Event Registry UI (/admin/events).
--
--   transport.requested            → Operations bell   (Sales → Ops)
--   transport.completed            → Sales bell        (Ops → Sales)
--   transport.cancelled            → Sales bell
--   transport.reopened             → Sales bell        (m162 event, reopen audit)
--   pr.submitted                   → Sales-director bell (approval request)
--   pr.approved                    → Operations bell   ("Send to Operations")
--   pr.rejected / pr.info_requested→ Sales bell        (director back to sales)
--   pr.ready_for_pricing           → Sales bell        (costing completed)
--   doc.shipping_update_requested  → Operations bell   (m149 queue)
--   doc.shipping_update_completed  → Sales bell
-- ============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('transport.requested',            'operations'),
      ('transport.completed',            'sales'),
      ('transport.cancelled',            'sales'),
      ('transport.reopened',             'sales'),
      ('pr.submitted',                   'sales_director'),
      ('pr.approved',                    'operations'),
      ('pr.rejected',                    'sales'),
      ('pr.info_requested',              'sales'),
      ('pr.ready_for_pricing',           'sales'),
      ('pr.priced',                      'sales'),
      ('doc.shipping_update_requested',  'operations'),
      ('doc.shipping_update_completed',  'sales')
    ) AS v(event_key, bell_role)
  LOOP
    -- Master switch: opt the event IN (role='*').
    INSERT INTO event_routing (event_key, consumer, role, config, enabled)
    SELECT r.event_key, 'notification', '*', '{}'::jsonb, true
    WHERE NOT EXISTS (
      SELECT 1 FROM event_routing
      WHERE event_key = r.event_key AND consumer = 'notification' AND role = '*'
    );

    -- The role that must get the BELL for this event.
    INSERT INTO event_routing (event_key, consumer, role, config, enabled)
    SELECT r.event_key, 'notification', r.bell_role, '{"channel":"bell"}'::jsonb, true
    WHERE NOT EXISTS (
      SELECT 1 FROM event_routing
      WHERE event_key = r.event_key AND consumer = 'notification' AND role = r.bell_role
    );
  END LOOP;
END $$;
