-- =====================================================================
-- m072 — Categorize deadline changes by responsibility axis.
-- =====================================================================
--
-- Operationally, not every deadline slip is a factory problem. A vessel
-- cancellation, a customer change request, or a balance not yet received
-- all push the project ETA — but counting them as "production late" would
-- unfairly inflate the factory KPI and mis-direct internal follow-up.
--
-- We add a single column to `production_deadline_changes` that tags every
-- adjustment with WHO is responsible. The pill / action-center / KPI code
-- then splits the total delay into:
--
--     factory_delay_days   = Σ Δ days where delay_type = 'production'
--     external_delay_days  = Σ Δ days where delay_type ≠ 'production'
--
-- Only factory_delay_days drives the "Production delayed" red pill and
-- the `production_late` sensor. External delays surface separately as an
-- amber operational badge so the cause is unambiguous.
--
-- Legacy rows (created before m072) carry NULL — treated as 'production'
-- by the app so existing KPIs don't silently shift. Operators can re-tag
-- legacy entries by editing them through the history UI.
--
-- Idempotent.
-- =====================================================================

alter table production_deadline_changes
  add column if not exists delay_type text;

-- App-level enum, enforced by a CHECK so unknown values can't sneak in.
-- NULL stays allowed for backward compatibility with rows from m018.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pdc_delay_type_chk'
  ) then
    alter table production_deadline_changes
      add constraint pdc_delay_type_chk check (
        delay_type is null or delay_type in (
          'production',
          'payment',
          'shipping',
          'client_change',
          'client_waiting',
          'supplier',
          'customs',
          'other'
        )
      );
  end if;
end$$;

-- Index for the common "what's the factory delay on this PO?" lookup.
create index if not exists idx_pdc_order_delay_type
  on production_deadline_changes (production_order_id, delay_type);

notify pgrst, 'reload schema';
