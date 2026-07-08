-- =====================================================================
-- m158 — Forecast: standardized probabilities + immutable audit trail.
-- =====================================================================
--
-- Two changes, one commercial policy:
--
-- 1. CONTROLLED PROBABILITY VALUES.
--    forecast_probability may only be 10,20,30,40,50,60,70,80,90,95,100.
--    No free values (33, 45, 67…), no ranges, no qualitative buckets.
--    100 = won / confirmed order; 95 = almost certain, not confirmed.
--    Weighted forecast = amount × probability. The old m050 ladder
--    (10/25/50/75/90) is remapped: 25 → 30, 75 → 80 (nearest standard
--    value; edit below before applying if you prefer 25 → 20).
--    The old forecast_category (pipeline / best_case / commit / upside
--    / at_risk) is REMOVED — probability is the only dial.
--
-- 2. APPEND-ONLY FORECAST AUDIT TRAIL (management only).
--    Every create / change of a forecast-relevant field on a forecasted
--    quotation writes one immutable event per changed field into
--    forecast_audit_events, captured by a DB trigger — so Excel
--    imports, bulk updates, status flips (won/lost) and amount edits
--    are ALL captured, not just the forecast panel.
--
--    - The writing app declares its origin via the new
--      documents.forecast_change_source column (consumed + reset by
--      the trigger; NULL ⇒ 'manual_edit').
--    - Events are IMMUTABLE: no UPDATE/DELETE policies, privileges
--      revoked, plus a guard trigger that raises on any attempt.
--    - Reading requires the 'forecast.view_audit' capability
--      (super_admin + admin by default) — sales users keep a simple
--      forecast surface and never see the trail.
--    - RETENTION: nothing is ever deleted by default. If a retention
--      period is needed later, add an admin setting + a scheduled
--      job that first drops the immutability trigger. Do NOT hand-
--      delete events.
--    - PRIVACY: only meaningful forecast field changes are logged —
--      no navigation, no timing, no keystrokes.
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Change-source column on documents (consumed by the audit trigger).
--    App writes set it alongside the update ('manual_edit',
--    'excel_import', 'bulk_update', 'erp_sync', 'quotation_link',
--    'admin_correction', 'system'); the trigger records + resets it.
-- ---------------------------------------------------------------------
alter table documents
  add column if not exists forecast_change_source text;

-- ---------------------------------------------------------------------
-- 2. The audit table. Denormalized snapshots (number, client, country,
--    project name) so history stays readable even if the quotation or
--    client is later deleted — hence document_id has NO cascading FK.
-- ---------------------------------------------------------------------
create table if not exists forecast_audit_events (
  id                       uuid primary key default gen_random_uuid(),
  created_at               timestamptz not null default now(),

  -- What the event is about (the "forecast line" = the quotation)
  document_id              uuid,
  quotation_number         text,
  affair_id                uuid,
  project_name             text,
  client_id                uuid,
  client_name              text,
  country                  text,
  currency                 text,
  owner_id                 uuid,

  -- Who did it
  changed_by               uuid,
  changed_by_role          text,
  change_source            text not null default 'manual_edit'
    check (change_source in (
      'manual_edit', 'excel_import', 'bulk_update', 'erp_sync',
      'quotation_link', 'admin_correction', 'migration', 'system'
    )),

  -- What changed
  field                    text not null,
  old_value                text,
  new_value                text,

  -- Structured snapshots for the analytics (no re-parsing old_value)
  old_probability          integer,
  new_probability          integer,
  old_expected_close_date  date,
  new_expected_close_date  date,
  old_amount               numeric,
  new_amount               numeric,
  old_weighted             numeric,
  new_weighted             numeric,
  old_status               text,
  new_status               text
);

create index if not exists forecast_audit_events_doc_idx
  on forecast_audit_events (document_id, created_at desc);
create index if not exists forecast_audit_events_created_idx
  on forecast_audit_events (created_at desc);
create index if not exists forecast_audit_events_owner_idx
  on forecast_audit_events (owner_id, created_at desc);

-- RLS: read requires the forecast.view_audit capability. No INSERT /
-- UPDATE / DELETE policies at all — the ONLY writer is the security-
-- definer trigger function below.
alter table forecast_audit_events enable row level security;

drop policy if exists "forecast_audit_select" on forecast_audit_events;
create policy "forecast_audit_select" on forecast_audit_events
  for select using (
    exists (
      select 1
        from user_roles ur
        join role_permissions rp
          on rp.role = case when ur.super_admin then 'super_admin'
                            else ur.role end
       where ur.user_id = auth.uid()
         and rp.permission_key = 'forecast.view_audit'
         and rp.enabled
    )
  );

revoke insert, update, delete on forecast_audit_events from anon, authenticated;
grant select on forecast_audit_events to authenticated;

-- Hard immutability: even a privileged path cannot rewrite history
-- without first dropping this trigger (deliberate, visible act).
create or replace function forecast_audit_events_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'forecast_audit_events is append-only — audit events are never updated or deleted';
end;
$$;

drop trigger if exists forecast_audit_no_rewrite on forecast_audit_events;
create trigger forecast_audit_no_rewrite
  before update or delete on forecast_audit_events
  for each row execute function forecast_audit_events_immutable();

-- ---------------------------------------------------------------------
-- 3. Remap legacy probability values BEFORE the new constraint, and
--    archive the dying category values — both logged as 'migration'
--    events (the capture trigger doesn't exist yet, so no double-log).
-- ---------------------------------------------------------------------

-- 3a. Log + remap 25 → 30 and 75 → 80.
insert into forecast_audit_events (
  document_id, quotation_number, affair_id, project_name,
  client_id, client_name, country, currency, owner_id,
  changed_by, changed_by_role, change_source,
  field, old_value, new_value,
  old_probability, new_probability,
  old_amount, new_amount, old_weighted, new_weighted,
  old_status, new_status
)
select
  d.id, d.number, d.affair_id, d.affair_name,
  d.client_id, c.company_name, c.country, d.currency,
  coalesce(d.sales_owner_id, d.created_by),
  null, null, 'migration',
  'probability',
  d.forecast_probability::text,
  (case d.forecast_probability when 25 then 30 when 75 then 80 end)::text,
  d.forecast_probability,
  case d.forecast_probability when 25 then 30 when 75 then 80 end,
  d.total_price, d.total_price,
  d.total_price * d.forecast_probability / 100.0,
  d.total_price * (case d.forecast_probability when 25 then 30 when 75 then 80 end) / 100.0,
  d.status, d.status
from documents d
left join clients c on c.id = d.client_id
where d.forecast_probability in (25, 75);

update documents
   set forecast_probability = case forecast_probability
                                when 25 then 30
                                when 75 then 80
                              end
 where forecast_probability in (25, 75);

-- 3b. Archive category values (the column dies below), then drop it.
insert into forecast_audit_events (
  document_id, quotation_number, affair_id, project_name,
  client_id, client_name, country, currency, owner_id,
  changed_by, changed_by_role, change_source,
  field, old_value, new_value,
  old_probability, new_probability, old_status, new_status
)
select
  d.id, d.number, d.affair_id, d.affair_name,
  d.client_id, c.company_name, c.country, d.currency,
  coalesce(d.sales_owner_id, d.created_by),
  null, null, 'migration',
  'category', d.forecast_category, null,
  d.forecast_probability, d.forecast_probability, d.status, d.status
from documents d
left join clients c on c.id = d.client_id
where d.forecast_category is not null;

alter table documents drop constraint if exists forecast_category_check;
alter table documents drop column if exists forecast_category;

-- 3c. The new controlled-values constraint.
alter table documents drop constraint if exists forecast_probability_check;
alter table documents
  add constraint forecast_probability_check check (
    forecast_probability is null
    or forecast_probability in (10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100)
  );

-- ---------------------------------------------------------------------
-- 4. The capture trigger. BEFORE trigger so it can consume + reset
--    NEW.forecast_change_source. One event per changed field. Only
--    quotations that carry (or just carried / just received) a
--    probability are audited — a draft nobody forecasts stays silent.
-- ---------------------------------------------------------------------
create or replace function forecast_audit_capture()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_role    text;
  v_source  text := coalesce(new.forecast_change_source, 'manual_edit');
  v_client_name    text;
  v_client_country text;
  v_old_owner uuid;
  v_new_owner uuid := coalesce(new.sales_owner_id, new.created_by);
  v_old_w numeric;
  v_new_w numeric;
begin
  -- Consume the declared source — the next write must declare its own.
  new.forecast_change_source := null;

  if new.type is distinct from 'quotation' then
    return new;
  end if;

  -- Forecast-relevant rows only.
  if tg_op = 'INSERT' then
    if new.forecast_probability is null then return new; end if;
  else
    if old.forecast_probability is null and new.forecast_probability is null then
      return new;
    end if;
  end if;

  if v_actor is not null then
    select case when ur.super_admin then 'super_admin' else ur.role end
      into v_role
      from user_roles ur
     where ur.user_id = v_actor;
  end if;

  select c.company_name, c.country
    into v_client_name, v_client_country
    from clients c
   where c.id = new.client_id;

  v_old_w := case when tg_op = 'UPDATE'
                  then old.total_price * old.forecast_probability / 100.0 end;
  v_new_w := new.total_price * new.forecast_probability / 100.0;

  if tg_op = 'INSERT' then
    insert into forecast_audit_events (
      document_id, quotation_number, affair_id, project_name,
      client_id, client_name, country, currency, owner_id,
      changed_by, changed_by_role, change_source,
      field, old_value, new_value,
      new_probability, new_expected_close_date,
      new_amount, new_weighted, new_status
    ) values (
      new.id, new.number, new.affair_id, new.affair_name,
      new.client_id, v_client_name, v_client_country, new.currency, v_new_owner,
      v_actor, v_role, v_source,
      'created', null, new.forecast_probability::text,
      new.forecast_probability, new.forecast_expected_close_date,
      new.total_price, v_new_w, new.status
    );
    return new;
  end if;

  v_old_owner := coalesce(old.sales_owner_id, old.created_by);

  -- One immutable event per changed field. Every event carries the
  -- full before/after snapshot columns so the analytics never have to
  -- reconstruct state.
  if old.forecast_probability is distinct from new.forecast_probability then
    insert into forecast_audit_events (
      document_id, quotation_number, affair_id, project_name,
      client_id, client_name, country, currency, owner_id,
      changed_by, changed_by_role, change_source,
      field, old_value, new_value,
      old_probability, new_probability,
      old_expected_close_date, new_expected_close_date,
      old_amount, new_amount, old_weighted, new_weighted,
      old_status, new_status
    ) values (
      new.id, new.number, new.affair_id, new.affair_name,
      new.client_id, v_client_name, v_client_country, new.currency, v_new_owner,
      v_actor, v_role, v_source,
      'probability', old.forecast_probability::text, new.forecast_probability::text,
      old.forecast_probability, new.forecast_probability,
      old.forecast_expected_close_date, new.forecast_expected_close_date,
      old.total_price, new.total_price, v_old_w, v_new_w,
      old.status, new.status
    );
  end if;

  if old.forecast_expected_close_date is distinct from new.forecast_expected_close_date then
    insert into forecast_audit_events (
      document_id, quotation_number, affair_id, project_name,
      client_id, client_name, country, currency, owner_id,
      changed_by, changed_by_role, change_source,
      field, old_value, new_value,
      old_probability, new_probability,
      old_expected_close_date, new_expected_close_date,
      old_amount, new_amount, old_weighted, new_weighted,
      old_status, new_status
    ) values (
      new.id, new.number, new.affair_id, new.affair_name,
      new.client_id, v_client_name, v_client_country, new.currency, v_new_owner,
      v_actor, v_role, v_source,
      'expected_close_period',
      old.forecast_expected_close_date::text, new.forecast_expected_close_date::text,
      old.forecast_probability, new.forecast_probability,
      old.forecast_expected_close_date, new.forecast_expected_close_date,
      old.total_price, new.total_price, v_old_w, v_new_w,
      old.status, new.status
    );
  end if;

  if old.total_price is distinct from new.total_price then
    insert into forecast_audit_events (
      document_id, quotation_number, affair_id, project_name,
      client_id, client_name, country, currency, owner_id,
      changed_by, changed_by_role, change_source,
      field, old_value, new_value,
      old_probability, new_probability,
      old_expected_close_date, new_expected_close_date,
      old_amount, new_amount, old_weighted, new_weighted,
      old_status, new_status
    ) values (
      new.id, new.number, new.affair_id, new.affair_name,
      new.client_id, v_client_name, v_client_country, new.currency, v_new_owner,
      v_actor, v_role, v_source,
      'amount', old.total_price::text, new.total_price::text,
      old.forecast_probability, new.forecast_probability,
      old.forecast_expected_close_date, new.forecast_expected_close_date,
      old.total_price, new.total_price, v_old_w, v_new_w,
      old.status, new.status
    );
  end if;

  if old.currency is distinct from new.currency then
    insert into forecast_audit_events (
      document_id, quotation_number, affair_id, project_name,
      client_id, client_name, country, currency, owner_id,
      changed_by, changed_by_role, change_source,
      field, old_value, new_value,
      old_probability, new_probability,
      old_amount, new_amount, old_status, new_status
    ) values (
      new.id, new.number, new.affair_id, new.affair_name,
      new.client_id, v_client_name, v_client_country, new.currency, v_new_owner,
      v_actor, v_role, v_source,
      'currency', old.currency, new.currency,
      old.forecast_probability, new.forecast_probability,
      old.total_price, new.total_price, old.status, new.status
    );
  end if;

  if old.status is distinct from new.status then
    insert into forecast_audit_events (
      document_id, quotation_number, affair_id, project_name,
      client_id, client_name, country, currency, owner_id,
      changed_by, changed_by_role, change_source,
      field, old_value, new_value,
      old_probability, new_probability,
      old_expected_close_date, new_expected_close_date,
      old_amount, new_amount, old_weighted, new_weighted,
      old_status, new_status
    ) values (
      new.id, new.number, new.affair_id, new.affair_name,
      new.client_id, v_client_name, v_client_country, new.currency, v_new_owner,
      v_actor, v_role, v_source,
      'status', old.status, new.status,
      old.forecast_probability, new.forecast_probability,
      old.forecast_expected_close_date, new.forecast_expected_close_date,
      old.total_price, new.total_price, v_old_w, v_new_w,
      old.status, new.status
    );
  end if;

  if v_old_owner is distinct from v_new_owner then
    insert into forecast_audit_events (
      document_id, quotation_number, affair_id, project_name,
      client_id, client_name, country, currency, owner_id,
      changed_by, changed_by_role, change_source,
      field, old_value, new_value,
      old_probability, new_probability, old_status, new_status
    ) values (
      new.id, new.number, new.affair_id, new.affair_name,
      new.client_id, v_client_name, v_client_country, new.currency, v_new_owner,
      v_actor, v_role, v_source,
      'owner', v_old_owner::text, v_new_owner::text,
      old.forecast_probability, new.forecast_probability,
      old.status, new.status
    );
  end if;

  if old.client_id is distinct from new.client_id then
    insert into forecast_audit_events (
      document_id, quotation_number, affair_id, project_name,
      client_id, client_name, country, currency, owner_id,
      changed_by, changed_by_role, change_source,
      field, old_value, new_value,
      old_probability, new_probability, old_status, new_status
    ) values (
      new.id, new.number, new.affair_id, new.affair_name,
      new.client_id, v_client_name, v_client_country, new.currency, v_new_owner,
      v_actor, v_role, v_source,
      'client', old.client_id::text, new.client_id::text,
      old.forecast_probability, new.forecast_probability,
      old.status, new.status
    );
  end if;

  if old.affair_id is distinct from new.affair_id then
    insert into forecast_audit_events (
      document_id, quotation_number, affair_id, project_name,
      client_id, client_name, country, currency, owner_id,
      changed_by, changed_by_role, change_source,
      field, old_value, new_value,
      old_probability, new_probability, old_status, new_status
    ) values (
      new.id, new.number, new.affair_id, new.affair_name,
      new.client_id, v_client_name, v_client_country, new.currency, v_new_owner,
      v_actor, v_role, v_source,
      'affair_link', old.affair_id::text, new.affair_id::text,
      old.forecast_probability, new.forecast_probability,
      old.status, new.status
    );
  end if;

  if old.affair_name is distinct from new.affair_name then
    insert into forecast_audit_events (
      document_id, quotation_number, affair_id, project_name,
      client_id, client_name, country, currency, owner_id,
      changed_by, changed_by_role, change_source,
      field, old_value, new_value,
      old_probability, new_probability, old_status, new_status
    ) values (
      new.id, new.number, new.affair_id, new.affair_name,
      new.client_id, v_client_name, v_client_country, new.currency, v_new_owner,
      v_actor, v_role, v_source,
      'project_name', old.affair_name, new.affair_name,
      old.forecast_probability, new.forecast_probability,
      old.status, new.status
    );
  end if;

  if (old.archived_at is null) <> (new.archived_at is null) then
    insert into forecast_audit_events (
      document_id, quotation_number, affair_id, project_name,
      client_id, client_name, country, currency, owner_id,
      changed_by, changed_by_role, change_source,
      field, old_value, new_value,
      old_probability, new_probability, old_status, new_status
    ) values (
      new.id, new.number, new.affair_id, new.affair_name,
      new.client_id, v_client_name, v_client_country, new.currency, v_new_owner,
      v_actor, v_role, v_source,
      'archived',
      case when old.archived_at is null then 'active' else 'archived' end,
      case when new.archived_at is null then 'active' else 'archived' end,
      old.forecast_probability, new.forecast_probability,
      old.status, new.status
    );
  end if;

  return new;
end;
$$;

drop trigger if exists forecast_audit_capture_tg on documents;
create trigger forecast_audit_capture_tg
  before insert or update on documents
  for each row execute function forecast_audit_capture();

-- ---------------------------------------------------------------------
-- 5. Capability: forecast.view_audit (matrix-managed; management only).
-- ---------------------------------------------------------------------
insert into permissions (key, category, label, description, sort_order) values
  (
    'forecast.view_audit',
    'Forecast',
    'View the forecast audit trail & behavior analytics',
    'Per-deal forecast change history (who changed what, when) and behavior analytics (probability reliability, close-date slippage, optimism / conservatism by rep). Management only — sales users keep a simple forecast surface.',
    41
  )
on conflict (key) do nothing;

insert into role_permissions (role, permission_key, enabled) values
  ('super_admin',       'forecast.view_audit', true),
  ('admin',             'forecast.view_audit', true),
  ('sales_director',    'forecast.view_audit', true),
  ('task_list_manager', 'forecast.view_audit', false),
  ('operations',        'forecast.view_audit', false),
  ('finance',           'forecast.view_audit', false),
  ('sales',             'forecast.view_audit', false)
on conflict (role, permission_key) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--
--   -- 1. No legacy probabilities left
--   select count(*) from documents where forecast_probability in (25, 75);
--   -- Expected: 0
--
--   -- 2. Constraint holds
--   -- update documents set forecast_probability = 33 where id = '...';
--   -- Expected: violates forecast_probability_check
--
--   -- 3. Category is gone
--   select column_name from information_schema.columns
--    where table_name = 'documents' and column_name = 'forecast_category';
--   -- Expected: no rows
--
--   -- 4. Migration events were logged
--   select field, change_source, count(*) from forecast_audit_events
--    group by 1, 2;
--
--   -- 5. Append-only guard
--   -- delete from forecast_audit_events
--   --  where id = (select id from forecast_audit_events limit 1);
--   -- Expected: "forecast_audit_events is append-only"
--
--   -- 6. Capability seeded
--   select role, enabled from role_permissions
--    where permission_key = 'forecast.view_audit' order by role;
-- ---------------------------------------------------------------------
