-- =====================================================================
-- Development data reset — preview + execute RPCs.
-- =====================================================================
--
-- Lets a super-admin wipe ALL operational/business data (clients,
-- documents, task lists, production orders, payment changes, events)
-- WITHOUT touching:
--   - migrations
--   - auth.users / user_roles
--   - permissions / role_permissions
--   - products / options / prices_version / product_costs
--   - product_categories (formerly product_families, renamed in m011)
--     / config_fields / config_field_options
--   - factory_mappings / component_mappings
--   - sales_conditions / bank_accounts
--
-- FK chain (all CASCADE → deleting documents wipes 6 child tables):
--   documents
--     ├─ document_lines             (CASCADE)
--     ├─ document_containers        (CASCADE)
--     └─ production_task_lists      (CASCADE)
--          ├─ production_task_list_lines (CASCADE)
--          └─ production_orders     (CASCADE)
--               └─ production_deadline_changes (CASCADE)
--
-- `events` is polymorphic (no FK) so we delete it explicitly.
-- `clients` is the FK target of documents/task_lists/orders so it
-- must be deleted AFTER documents (otherwise Postgres refuses).
--
-- Numbering counters
-- ------------------
-- next_document_number() and next_task_list_number() compute the next
-- value via max(regexp_match(number, ...)). When the table is empty,
-- max() is NULL, coalesce(0)+1 = 1 — counters auto-reset on their own.
-- No sequence touch needed.
--
-- Two functions
-- -------------
--   admin_reset_preview()  — read-only counts of what WOULD be deleted.
--                            Safe to call from the UI any time. Tables
--                            are looked up via to_regclass() so a
--                            missing optional table doesn't crash the
--                            whole preview.
--   admin_reset_execute()  — the actual wipe. Wrapped in BEGIN/COMMIT
--                            so a single FK violation rolls back all.
--                            Emits a single audit event AFTER the
--                            deletes (so it survives the events wipe).
--
-- Both gated to super-admins via internal check + GRANT to authenticated.
-- The UI also gates via requireCapability("admin.diagnostics").
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- ---------- helper: count a table only if it exists ----------
-- Returns 0 (not NULL, not an error) when the table is missing. Lets
-- the preview keep working across environments where some optional
-- migrations might not have landed yet (e.g. fresh dev DB without the
-- categories rename, or a project that skipped the production module).
drop function if exists _safe_count(text);

create or replace function _safe_count(qualified_table_name text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  n bigint;
begin
  if to_regclass(qualified_table_name) is null then
    return 0;
  end if;
  execute format('select count(*) from %s', qualified_table_name) into n;
  return n;
end;
$$;

-- Not granted to authenticated directly — only callable internally by
-- the wrapper functions below.


-- ---------- 1. Preview (read-only) ----------
drop function if exists admin_reset_preview();

create or replace function admin_reset_preview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  caller_is_super boolean;
begin
  select super_admin into caller_is_super
    from user_roles where user_id = auth.uid() limit 1;
  if coalesce(caller_is_super, false) is not true then
    raise exception 'admin_reset_preview: super-admin only' using errcode = '42501';
  end if;

  result := jsonb_build_object(
    -- Business data — will be wiped.
    'clients',                      _safe_count('public.clients'),
    'documents',                    _safe_count('public.documents'),
    'document_lines',               _safe_count('public.document_lines'),
    'document_containers',          _safe_count('public.document_containers'),
    'production_task_lists',        _safe_count('public.production_task_lists'),
    'production_task_list_lines',   _safe_count('public.production_task_list_lines'),
    'production_orders',            _safe_count('public.production_orders'),
    'production_deadline_changes',  _safe_count('public.production_deadline_changes'),
    'events',                       _safe_count('public.events'),
    -- Preserved — confirms the reset is non-destructive for these.
    -- product_families was renamed to product_categories in m011 — we
    -- read the canonical name; missing tables silently return 0.
    'preserved', jsonb_build_object(
      'user_roles',           _safe_count('public.user_roles'),
      'permissions',          _safe_count('public.permissions'),
      'role_permissions',     _safe_count('public.role_permissions'),
      'products',             _safe_count('public.products'),
      'options',              _safe_count('public.options'),
      'prices_version',       _safe_count('public.prices_version'),
      'product_costs',        _safe_count('public.product_costs'),
      'product_categories',   _safe_count('public.product_categories'),
      'config_fields',        _safe_count('public.config_fields'),
      'config_field_options', _safe_count('public.config_field_options'),
      'factory_mappings',     _safe_count('public.factory_mappings'),
      'component_mappings',   _safe_count('public.component_mappings'),
      'sales_conditions',     _safe_count('public.sales_conditions'),
      'bank_accounts',        _safe_count('public.bank_accounts')
    )
  );

  return result;
end;
$$;

grant execute on function admin_reset_preview() to authenticated;


-- ---------- 2. Execute (destructive) ----------
drop function if exists admin_reset_execute();

create or replace function admin_reset_execute()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_super boolean;
  actor_id        uuid := auth.uid();
  n_events        bigint;
  n_documents     bigint;
  n_task_lists    bigint;
  n_pos           bigint;
  n_clients       bigint;
  result          jsonb;
begin
  select super_admin into caller_is_super
    from user_roles where user_id = actor_id limit 1;
  if coalesce(caller_is_super, false) is not true then
    raise exception 'admin_reset_execute: super-admin only' using errcode = '42501';
  end if;

  -- Snapshot counts BEFORE the wipe (for the audit event + UI summary).
  n_events     := _safe_count('public.events');
  n_documents  := _safe_count('public.documents');
  n_task_lists := _safe_count('public.production_task_lists');
  n_pos        := _safe_count('public.production_orders');
  n_clients    := _safe_count('public.clients');

  -- Order matters even with CASCADE:
  --   1. events first — wipe BEFORE the audit event so it doesn't
  --      survive in the timeline (we re-emit a single fresh event
  --      below to mark the reset).
  --   2. documents — CASCADE handles lines/containers/PTLs/POs/deadlines.
  --   3. clients — FK target of documents/PTLs/POs; safe now that
  --      every referent is gone.
  --
  -- `WHERE true` is intentional: Supabase ships a safeguard that
  -- rejects unconditional DELETEs ("DELETE requires a WHERE clause"),
  -- and that guard fires even inside SECURITY DEFINER RPCs. Adding an
  -- always-true predicate satisfies the check without changing the
  -- semantics — every row still matches.
  if to_regclass('public.events')    is not null then delete from events    where true; end if;
  if to_regclass('public.documents') is not null then delete from documents where true; end if;
  if to_regclass('public.clients')   is not null then delete from clients   where true; end if;

  -- Re-emit a single audit row marking the reset.
  if to_regclass('public.events') is not null then
    insert into events (entity_type, entity_id, event_type, severity, message, payload, actor_id)
    values (
      'system',
      gen_random_uuid(),
      'system.dev_reset',
      'critical',
      format(
        'Development data reset — wiped %s document(s), %s task list(s), %s production order(s), %s client(s), %s prior event(s).',
        n_documents, n_task_lists, n_pos, n_clients, n_events
      ),
      jsonb_build_object(
        'before', jsonb_build_object(
          'events', n_events,
          'documents', n_documents,
          'task_lists', n_task_lists,
          'production_orders', n_pos,
          'clients', n_clients
        ),
        'actor_id', actor_id
      ),
      actor_id
    );
  end if;

  result := jsonb_build_object(
    'ok',                        true,
    'deleted_events',            n_events,
    'deleted_documents',         n_documents,
    'deleted_task_lists',        n_task_lists,
    'deleted_production_orders', n_pos,
    'deleted_clients',           n_clients,
    'reset_at',                  now()
  );

  return result;
end;
$$;

grant execute on function admin_reset_execute() to authenticated;


notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Manual smoke (run separately as super-admin):
--
--   select admin_reset_preview();
--   -- inspect the counts, decide
--
--   select admin_reset_execute();
--   -- expected: every business count becomes 0 except the one new
--   -- system.dev_reset event we just emitted.
-- ---------------------------------------------------------------------
