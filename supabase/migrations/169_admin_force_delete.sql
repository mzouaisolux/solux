-- =====================================================================
-- m169 — SUPER-ADMIN FORCE DELETE (client / affair) + audit log.
-- =====================================================================
--
-- Owner request (2026-07-14): the Super Admin must be able to PERMANENTLY
-- delete any client or any affair regardless of its state — quotations,
-- proformas, invoices, deposits, service requests, transport requests,
-- costing, documents, comments, tasks, audit events, production & shipping
-- data included. Zero orphan rows.
--
-- Design (mirrors m128's security model, but never refuses):
--   • The role check lives INSIDE the SECURITY DEFINER function — a UI gate
--     alone is not enough since any authenticated user can call an RPC.
--     Regular admins are refused (super_admin boolean only, m090 model).
--   • One PL/pgSQL function = ONE transaction: any failure rolls the whole
--     cascade back — no partial deletes.
--   • Explicit child deletes (with counts) — the schema's SET NULL FKs would
--     otherwise orphan documents/task lists/orders, which is exactly what
--     this feature forbids. Level-2 children ride the existing CASCADEs
--     (document_lines, containers, pricing audit, SR children, order docs…).
--   • Every run writes one row into admin_force_delete_log (who / when /
--     what / per-table counts). The log is readable by SUPER-ADMINS ONLY.
--
-- Idempotent. Apply MANUALLY in the Supabase SQL editor.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Audit log — super-admin eyes only.
-- ---------------------------------------------------------------------
create table if not exists public.admin_force_delete_log (
  id             uuid primary key default gen_random_uuid(),
  performed_by   uuid,                       -- auth user id (kept even if the user is later removed)
  performed_at   timestamptz not null default now(),
  entity_type    text not null check (entity_type in ('client','affair')),
  entity_id      uuid not null,              -- id of the deleted client/affair (no FK — the row is gone)
  entity_label   text,                       -- human label snapshot: "ACME (ACM)" / affair name
  client_id      uuid,                       -- context: owning client for an affair delete
  deleted_counts jsonb not null default '{}'::jsonb,  -- per-table row counts
  total_deleted  integer not null default 0
);

alter table public.admin_force_delete_log enable row level security;

drop policy if exists "force delete log super admin read" on public.admin_force_delete_log;
create policy "force delete log super admin read" on public.admin_force_delete_log
  for select to authenticated
  using (
    coalesce((select bool_or(super_admin) from public.user_roles where user_id = auth.uid()), false)
  );
-- No insert/update/delete policies: rows are written only by the SECURITY
-- DEFINER functions below (which bypass RLS) — the log is append-only.

-- ---------------------------------------------------------------------
-- 2) Core cascade for ONE affair — internal, no gate, no log.
--    Returns per-table deleted counts. NOT callable by clients (revoked).
-- ---------------------------------------------------------------------
create or replace function public.admin_force_delete_affair_core(p_affair uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_docs uuid[]; v_srs uuid[]; v_tls uuid[]; v_pos uuid[]; v_trs uuid[];
  v_all_children uuid[];
  n bigint; counts jsonb := '{}'::jsonb;
  add_count bigint;
begin
  -- Collect the id sets FIRST (events/messages cleanup needs them after the
  -- rows are gone, and task lists/orders can hang off the documents rather
  -- than carrying the affair_id themselves).
  v_docs := coalesce(array(select id from documents where affair_id = p_affair), '{}');
  v_srs  := coalesce(array(select id from project_requests where affair_id = p_affair), '{}');
  v_tls  := coalesce(array(
              select id from production_task_lists
               where affair_id = p_affair or quotation_id = any(v_docs)), '{}');
  v_pos  := coalesce(array(
              select id from production_orders
               where affair_id = p_affair or quotation_id = any(v_docs)
                  or task_list_id = any(v_tls)), '{}');
  v_trs  := coalesce(array(select id from transport_requests where affair_id = p_affair), '{}');
  v_all_children := v_docs || v_srs || v_tls || v_pos || v_trs;

  -- Children first (each DELETE cascades its own level-2 children).
  delete from production_orders where id = any(v_pos);
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('production_orders', n);

  delete from production_task_lists where id = any(v_tls);
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('production_task_lists', n);

  delete from project_requests where id = any(v_srs);
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('project_requests', n);

  -- invoices ride invoice_families (CASCADE) — count them for the log.
  select count(*) into add_count from invoices
   where family_id in (select id from invoice_families where affair_id = p_affair);
  delete from invoice_families where affair_id = p_affair;
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('invoice_families', n, 'invoices', add_count);

  delete from documents where id = any(v_docs);
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('documents', n);

  delete from transport_requests where id = any(v_trs);
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('transport_requests', n);

  delete from product_lighting_setups where affair_id = p_affair;
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('product_lighting_setups', n);

  delete from shipping_update_requests where affair_id = p_affair;
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('shipping_update_requests', n);

  delete from attachments where affair_id = p_affair;
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('attachments', n);

  delete from planned_actions where affair_id = p_affair;
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('planned_actions', n);

  -- Cross-entity data with no FK: comments + audit events of the affair AND
  -- of every deleted child (zero dangling references).
  delete from entity_messages where entity_id = p_affair or entity_id = any(v_all_children);
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('entity_messages', n);

  delete from events where entity_id = p_affair or entity_id = any(v_all_children);
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('events', n);

  delete from affairs where id = p_affair;
  get diagnostics n = row_count;
  counts := counts || jsonb_build_object('affairs', n);

  return counts;
end;
$$;

revoke execute on function public.admin_force_delete_affair_core(uuid) from public;
revoke execute on function public.admin_force_delete_affair_core(uuid) from anon;
revoke execute on function public.admin_force_delete_affair_core(uuid) from authenticated;

-- ---------------------------------------------------------------------
-- 3) Public RPC — force delete ONE AFFAIR (super-admin gate + log).
-- ---------------------------------------------------------------------
create or replace function public.admin_force_delete_affair(p_affair uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_super boolean;
  v_label text; v_client uuid;
  counts jsonb; total integer;
begin
  select coalesce(bool_or(super_admin), false) into v_super
    from user_roles where user_id = auth.uid();
  if not coalesce(v_super, false) then
    raise exception
      'Super-admin only — force deletion is reserved for system administrators.';
  end if;

  select name, client_id into v_label, v_client from affairs where id = p_affair;
  if v_label is null and v_client is null and
     not exists (select 1 from affairs where id = p_affair) then
    raise exception 'Affair % not found.', p_affair;
  end if;

  counts := admin_force_delete_affair_core(p_affair);
  select coalesce(sum(value::text::integer), 0) into total from jsonb_each(counts);

  insert into admin_force_delete_log
    (performed_by, entity_type, entity_id, entity_label, client_id, deleted_counts, total_deleted)
  values (auth.uid(), 'affair', p_affair, v_label, v_client, counts, total);

  return counts;
end;
$$;

grant execute on function public.admin_force_delete_affair(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Public RPC — force delete ONE CLIENT (all its affairs + leftovers).
-- ---------------------------------------------------------------------
create or replace function public.admin_force_delete_client(p_client uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_super boolean;
  v_label text;
  a record;
  counts jsonb := '{}'::jsonb;
  acounts jsonb;
  k text; v text;
  n bigint; add_count bigint; total integer;
  v_docs uuid[]; v_srs uuid[]; v_tls uuid[]; v_pos uuid[]; v_trs uuid[];
  v_all_children uuid[];
  n_affairs integer := 0;
begin
  select coalesce(bool_or(super_admin), false) into v_super
    from user_roles where user_id = auth.uid();
  if not coalesce(v_super, false) then
    raise exception
      'Super-admin only — force deletion is reserved for system administrators.';
  end if;

  select company_name || coalesce(' (' || client_code || ')', '') into v_label
    from clients where id = p_client;
  if v_label is null then
    raise exception 'Client % not found.', p_client;
  end if;

  -- 4a) every affair of the client, full cascade each (same core as above)
  for a in select id from affairs where client_id = p_client loop
    acounts := admin_force_delete_affair_core(a.id);
    for k, v in select key, value::text from jsonb_each(acounts) loop
      counts := jsonb_set(
        counts, array[k],
        to_jsonb(coalesce((counts->>k)::integer, 0) + v::integer));
    end loop;
    n_affairs := n_affairs + 1;
  end loop;

  -- 4b) leftovers anchored to the CLIENT with no affair (or an already-null one)
  v_docs := coalesce(array(select id from documents where client_id = p_client), '{}');
  v_srs  := coalesce(array(select id from project_requests where client_id = p_client), '{}');
  v_tls  := coalesce(array(
              select id from production_task_lists
               where client_id = p_client or quotation_id = any(v_docs)), '{}');
  v_pos  := coalesce(array(
              select id from production_orders
               where client_id = p_client or quotation_id = any(v_docs)
                  or task_list_id = any(v_tls)), '{}');
  v_trs  := coalesce(array(select id from transport_requests where client_id = p_client), '{}');
  v_all_children := v_docs || v_srs || v_tls || v_pos || v_trs;

  delete from production_orders where id = any(v_pos);
  get diagnostics n = row_count;
  counts := jsonb_set(counts, '{production_orders}',
    to_jsonb(coalesce((counts->>'production_orders')::integer, 0) + n::integer));

  delete from production_task_lists where id = any(v_tls);
  get diagnostics n = row_count;
  counts := jsonb_set(counts, '{production_task_lists}',
    to_jsonb(coalesce((counts->>'production_task_lists')::integer, 0) + n::integer));

  delete from project_requests where id = any(v_srs);
  get diagnostics n = row_count;
  counts := jsonb_set(counts, '{project_requests}',
    to_jsonb(coalesce((counts->>'project_requests')::integer, 0) + n::integer));

  select count(*) into add_count from invoices
   where family_id in (select id from invoice_families where client_id = p_client);
  delete from invoice_families where client_id = p_client;
  get diagnostics n = row_count;
  counts := jsonb_set(counts, '{invoice_families}',
    to_jsonb(coalesce((counts->>'invoice_families')::integer, 0) + n::integer));
  counts := jsonb_set(counts, '{invoices}',
    to_jsonb(coalesce((counts->>'invoices')::integer, 0) + add_count::integer));

  delete from documents where id = any(v_docs);
  get diagnostics n = row_count;
  counts := jsonb_set(counts, '{documents}',
    to_jsonb(coalesce((counts->>'documents')::integer, 0) + n::integer));

  delete from transport_requests where id = any(v_trs);
  get diagnostics n = row_count;
  counts := jsonb_set(counts, '{transport_requests}',
    to_jsonb(coalesce((counts->>'transport_requests')::integer, 0) + n::integer));

  delete from product_lighting_setups where client_id = p_client;
  get diagnostics n = row_count;
  counts := jsonb_set(counts, '{product_lighting_setups}',
    to_jsonb(coalesce((counts->>'product_lighting_setups')::integer, 0) + n::integer));

  delete from shipping_update_requests where client_id = p_client;
  get diagnostics n = row_count;
  counts := jsonb_set(counts, '{shipping_update_requests}',
    to_jsonb(coalesce((counts->>'shipping_update_requests')::integer, 0) + n::integer));

  -- Count the FK-CASCADE children before deleting the client row (so the log
  -- still reflects them): contacts, technical presets, import history.
  select count(*) into n from contacts where client_id = p_client;
  counts := jsonb_set(counts, '{contacts}', to_jsonb(n::integer));
  select count(*) into n from client_technical_presets where client_id = p_client;
  counts := jsonb_set(counts, '{client_technical_presets}', to_jsonb(n::integer));
  select count(*) into n from imported_documents where client_id = p_client;
  counts := jsonb_set(counts, '{imported_documents}', to_jsonb(n::integer));
  select count(*) into n from import_batches where client_id = p_client;
  counts := jsonb_set(counts, '{import_batches}', to_jsonb(n::integer));
  select count(*) into n from historical_product_map where client_id = p_client;
  counts := jsonb_set(counts, '{historical_product_map}', to_jsonb(n::integer));

  -- comments + audit events of the client and of the leftover children
  delete from entity_messages where entity_id = p_client or entity_id = any(v_all_children);
  get diagnostics n = row_count;
  counts := jsonb_set(counts, '{entity_messages}',
    to_jsonb(coalesce((counts->>'entity_messages')::integer, 0) + n::integer));

  delete from events where entity_id = p_client or entity_id = any(v_all_children);
  get diagnostics n = row_count;
  counts := jsonb_set(counts, '{events}',
    to_jsonb(coalesce((counts->>'events')::integer, 0) + n::integer));

  -- finally the client row (CASCADEs contacts / presets / import history)
  delete from clients where id = p_client;
  get diagnostics n = row_count;
  counts := jsonb_set(counts, '{clients}', to_jsonb(n::integer));
  counts := jsonb_set(counts, '{affairs_total}', to_jsonb(n_affairs));

  select coalesce(sum(value::text::integer), 0) into total from jsonb_each(counts);

  insert into admin_force_delete_log
    (performed_by, entity_type, entity_id, entity_label, client_id, deleted_counts, total_deleted)
  values (auth.uid(), 'client', p_client, v_label, p_client, counts, total);

  return counts;
end;
$$;

grant execute on function public.admin_force_delete_client(uuid) to authenticated;

-- Ledger (m113 rule: every migration self-inserts).
insert into schema_migrations (filename, note)
values ('169_admin_force_delete.sql',
        'Super-admin FORCE delete: admin_force_delete_affair / admin_force_delete_client (SECURITY DEFINER, super-admin gate inside, full explicit cascade, atomic, zero orphans) + admin_force_delete_log audit table (super-admin-only read).')
on conflict (filename) do nothing;

commit;

notify pgrst, 'reload schema';
