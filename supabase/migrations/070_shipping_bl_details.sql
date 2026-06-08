-- =====================================================================
-- m070 — Shipping / BL operational details on production orders.
-- =====================================================================
--
-- Until now shipping data was scattered: ports + incoterm on the quote,
-- ETD/ETA + booking on the order, consignee/notify (a reusable template) on
-- the client's bl_profile (m054), and file uploads on the task list. The
-- order had no home for the EXECUTION fields that appear on the actual Bill
-- of Lading — BL number, forwarder, vessel/voyage, weights, CBM, packages,
-- HS code.
--
-- This adds a single `shipping_details` jsonb on production_orders for those
-- essential fields (v1). ETD/ETA/shipment_booked/shipping_notes stay as their
-- existing columns; the Shipping/BL section on the order page edits both.
-- jsonb (not columns) keeps it cheap to extend later without a migration.
--
-- Shape (lib/shipping.ts → ShippingDetails):
--   { bl_number, forwarder, vessel, voyage, gross_weight, net_weight,
--     cbm, packages, hs_code }
--
-- Idempotent.
-- =====================================================================

alter table production_orders
  add column if not exists shipping_details jsonb;

notify pgrst, 'reload schema';
