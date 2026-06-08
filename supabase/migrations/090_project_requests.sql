-- =====================================================================
-- m090 — Project Requests: the project lifecycle spine.
--
-- WHY (owner decision 2026-06-05):
--   Custom/tender projects need centralized RFQ → cost → logistics →
--   pricing → quotation, instead of email/WeChat/WhatsApp/Excel. A
--   Project Request carries general + technical info, moves through a
--   role-gated status workflow, spawns a Factory Cost Request and a
--   Logistics Request, gets priced by the Sales Director, then one-click
--   generates a quotation (reusing the existing documents pipeline).
--
-- THIS MIGRATION (additive, idempotent — safe to re-run):
--   1. New storable role `sales_director` (mirrors how m042 added
--      `operations`): widen user_roles CHECK + update admin_set_user_role.
--   2. Six `project.*` capabilities (catalog + role matrix), mirroring
--      m033's add-a-capability pattern.
--   3. Four tables: project_requests (parent), factory_cost_requests,
--      logistics_requests, project_request_files — all RLS-scoped.
--
-- Does NOT touch any existing role, capability, policy, or table. The
-- only change to shared infra is WIDENING the role CHECK + RPC accept
-- list (both reproduce the current set and only ADD the new value).
-- =====================================================================

begin;

-- =====================================================================
-- 1. New role: sales_director
-- =====================================================================

-- 1a. Widen the user_roles.role CHECK to ACCEPT the new value. Reproduce
--     the current set (m084) verbatim and append 'sales_director'.
alter table user_roles drop constraint if exists user_roles_role_check;
alter table user_roles
  add constraint user_roles_role_check
  check (role in (
    'admin', 'super_admin', 'sales', 'task_list_manager',
    'operations', 'finance', 'sales_director'
  ));

-- 1b. admin_set_user_role RPC (last defined in m042) — same shape, just a
--     complete accept-list. m042's list dropped 'finance'; restore it and
--     add 'sales_director' so every storable role is assignable from
--     /admin/users. Super-admin gate + self-edit guard unchanged.
drop function if exists admin_set_user_role(uuid, text);
create or replace function admin_set_user_role(
  target_user_id uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_super boolean;
begin
  select super_admin into caller_is_super
    from user_roles where user_id = auth.uid() limit 1;
  if coalesce(caller_is_super, false) is not true then
    raise exception 'admin_set_user_role: super-admin only' using errcode = '42501';
  end if;

  if new_role not in (
    'admin', 'sales', 'task_list_manager', 'operations', 'finance', 'sales_director'
  ) then
    raise exception
      'admin_set_user_role: invalid role %', new_role
      using errcode = '22023';
  end if;

  if target_user_id = auth.uid() then
    raise exception
      'admin_set_user_role: cannot edit your own role'
      using errcode = '42501';
  end if;

  insert into user_roles (user_id, role)
  values (target_user_id, new_role)
  on conflict (user_id) do update set role = excluded.role;
end;
$$;
grant execute on function admin_set_user_role(uuid, text) to authenticated;

-- 1c. Seed sales_director's capability matrix from `sales` as a baseline
--     (so it inherits e.g. quotation.create), then the project.* grants
--     below add the director's extras. ON CONFLICT DO NOTHING so a re-run
--     never tramples manual edits made via /permissions/actions.
insert into role_permissions (role, permission_key, enabled)
select 'sales_director', permission_key, enabled
  from role_permissions
 where role = 'sales'
on conflict (role, permission_key) do nothing;

-- =====================================================================
-- 2. Capabilities: project.* (catalog + role matrix)
-- =====================================================================

insert into permissions (key, category, label, description, sort_order) values
  ('project.create',             'Projects', 'Create project requests',   'Create and submit project requests.',                 70),
  ('project.approve',            'Projects', 'Approve project requests',   'Approve / reject / request info on project requests (Sales Director).', 71),
  ('project.enter_cost',         'Projects', 'Enter factory cost',         'Fill the factory cost request (cost per unit + notes).', 72),
  ('project.enter_logistics',    'Projects', 'Enter logistics',            'Fill the logistics request (containers, CBM, weight, lead time).', 73),
  ('project.set_pricing',        'Projects', 'Set project pricing',        'Set the selling price and approve project pricing (Sales Director).', 74),
  ('project.generate_quotation', 'Projects', 'Generate quotation',         'Generate a quotation from a priced project request.',  75)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

-- Role × capability defaults. ON CONFLICT DO NOTHING preserves manual
-- tweaks. admin/super_admin get everything (full access).
insert into role_permissions (role, permission_key, enabled) values
  -- project.create
  ('super_admin','project.create',true), ('admin','project.create',true),
  ('sales','project.create',true), ('sales_director','project.create',true),
  ('task_list_manager','project.create',false), ('operations','project.create',false),
  ('finance','project.create',false),
  -- project.approve
  ('super_admin','project.approve',true), ('admin','project.approve',true),
  ('sales','project.approve',false), ('sales_director','project.approve',true),
  ('task_list_manager','project.approve',false), ('operations','project.approve',false),
  ('finance','project.approve',false),
  -- project.enter_cost
  ('super_admin','project.enter_cost',true), ('admin','project.enter_cost',true),
  ('sales','project.enter_cost',false), ('sales_director','project.enter_cost',false),
  ('task_list_manager','project.enter_cost',false), ('operations','project.enter_cost',true),
  ('finance','project.enter_cost',false),
  -- project.enter_logistics
  ('super_admin','project.enter_logistics',true), ('admin','project.enter_logistics',true),
  ('sales','project.enter_logistics',false), ('sales_director','project.enter_logistics',false),
  ('task_list_manager','project.enter_logistics',false), ('operations','project.enter_logistics',true),
  ('finance','project.enter_logistics',false),
  -- project.set_pricing
  ('super_admin','project.set_pricing',true), ('admin','project.set_pricing',true),
  ('sales','project.set_pricing',false), ('sales_director','project.set_pricing',true),
  ('task_list_manager','project.set_pricing',false), ('operations','project.set_pricing',false),
  ('finance','project.set_pricing',false),
  -- project.generate_quotation
  ('super_admin','project.generate_quotation',true), ('admin','project.generate_quotation',true),
  ('sales','project.generate_quotation',true), ('sales_director','project.generate_quotation',true),
  ('task_list_manager','project.generate_quotation',false), ('operations','project.generate_quotation',false),
  ('finance','project.generate_quotation',false)
on conflict (role, permission_key) do nothing;

-- =====================================================================
-- 3. Tables
-- =====================================================================

-- 3a. project_requests — the parent / spine.
create table if not exists project_requests (
  id                     uuid primary key default gen_random_uuid(),
  -- general
  name                   text not null,
  client_id              uuid references clients(id) on delete set null,
  country                text,
  quantity               integer,
  opportunity_value      numeric,
  owner_id               uuid references auth.users(id) on delete set null,
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  archived_at            timestamptz,
  -- technical (main specs only — no BOM)
  led_power              text,
  solar_panel_size       text,
  battery_spec           text,
  controller             text,
  pole_height            text,
  iot_required           boolean not null default false,
  additional_notes       text,
  -- pricing (Sales Director)
  selling_price_per_unit numeric,
  margin_notes           text,
  -- workflow
  status                 text not null default 'draft'
    check (status in (
      'draft','submitted','waiting_director_approval','waiting_factory_cost',
      'waiting_logistics','ready_for_pricing','priced','quotation_generated',
      'won','lost','cancelled'
    )),
  generated_document_id  uuid references documents(id) on delete set null
);

create index if not exists idx_project_requests_client on project_requests(client_id);
create index if not exists idx_project_requests_owner  on project_requests(owner_id);
create index if not exists idx_project_requests_status on project_requests(status);

-- 3b. factory_cost_requests — child (one per project, but modeled 1-to-many).
create table if not exists factory_cost_requests (
  id                 uuid primary key default gen_random_uuid(),
  project_request_id uuid not null references project_requests(id) on delete cascade,
  status             text not null default 'pending'
    check (status in ('pending','completed','cancelled')),
  cost_per_unit      numeric,
  cost_notes         text,
  completed_by       uuid references auth.users(id) on delete set null,
  completed_at       timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists idx_fcr_project on factory_cost_requests(project_request_id);

-- 3c. logistics_requests — child.
create table if not exists logistics_requests (
  id                 uuid primary key default gen_random_uuid(),
  project_request_id uuid not null references project_requests(id) on delete cascade,
  status             text not null default 'pending'
    check (status in ('pending','completed','cancelled')),
  num_containers     integer,
  container_type     text,
  total_cbm          numeric,
  total_weight       numeric,
  lead_time_days     integer,
  logistics_notes    text,
  completed_by       uuid references auth.users(id) on delete set null,
  completed_at       timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists idx_lr_project on logistics_requests(project_request_id);

-- 3d. project_request_files — multi-file uploads (own table to avoid
--     coupling with the documents/attachments flow). Stored in the
--     existing `documents` storage bucket under project-requests/{id}/.
create table if not exists project_request_files (
  id                 uuid primary key default gen_random_uuid(),
  project_request_id uuid not null references project_requests(id) on delete cascade,
  storage_path       text not null,
  file_name          text not null,
  file_size          bigint,
  mime_type          text,
  category           text not null default 'other'
    check (category in ('tender','spec','drawing','image','requirement','other')),
  uploaded_by        uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists idx_prf_project on project_request_files(project_request_id);

-- =====================================================================
-- 4. RLS — owner/creator + Director/Ops/Admin see all (mirror m046).
-- =====================================================================

alter table project_requests      enable row level security;
alter table factory_cost_requests enable row level security;
alter table logistics_requests    enable row level security;
alter table project_request_files enable row level security;

-- Reusable visibility predicate: owner, creator, or a broad role.
-- (sales_director sees all projects; ops/admin/tlm too.)
drop policy if exists "project_requests read"   on project_requests;
create policy "project_requests read" on project_requests for select using (
  owner_id = auth.uid()
  or created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin','task_list_manager','operations','sales_director')
            or coalesce(r.super_admin, false))
  )
);

drop policy if exists "project_requests insert" on project_requests;
create policy "project_requests insert" on project_requests for insert with check (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin','task_list_manager','operations','sales_director')
            or coalesce(r.super_admin, false))
  )
);

drop policy if exists "project_requests update" on project_requests;
create policy "project_requests update" on project_requests for update using (
  owner_id = auth.uid()
  or created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin','task_list_manager','operations','sales_director')
            or coalesce(r.super_admin, false))
  )
);

drop policy if exists "project_requests delete" on project_requests;
create policy "project_requests delete" on project_requests for delete using (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role in ('admin','sales_director') or coalesce(r.super_admin, false))
  )
);

-- Child tables + files inherit the parent's visibility.
drop policy if exists "factory_cost_requests rw" on factory_cost_requests;
create policy "factory_cost_requests rw" on factory_cost_requests for all using (
  exists (
    select 1 from project_requests pr
     where pr.id = factory_cost_requests.project_request_id
       and (pr.owner_id = auth.uid() or pr.created_by = auth.uid()
            or exists (
              select 1 from user_roles r
               where r.user_id = auth.uid()
                 and (r.role in ('admin','task_list_manager','operations','sales_director')
                      or coalesce(r.super_admin, false))
            ))
  )
);

drop policy if exists "logistics_requests rw" on logistics_requests;
create policy "logistics_requests rw" on logistics_requests for all using (
  exists (
    select 1 from project_requests pr
     where pr.id = logistics_requests.project_request_id
       and (pr.owner_id = auth.uid() or pr.created_by = auth.uid()
            or exists (
              select 1 from user_roles r
               where r.user_id = auth.uid()
                 and (r.role in ('admin','task_list_manager','operations','sales_director')
                      or coalesce(r.super_admin, false))
            ))
  )
);

drop policy if exists "project_request_files rw" on project_request_files;
create policy "project_request_files rw" on project_request_files for all using (
  exists (
    select 1 from project_requests pr
     where pr.id = project_request_files.project_request_id
       and (pr.owner_id = auth.uid() or pr.created_by = auth.uid()
            or exists (
              select 1 from user_roles r
               where r.user_id = auth.uid()
                 and (r.role in ('admin','task_list_manager','operations','sales_director')
                      or coalesce(r.super_admin, false))
            ))
  )
);

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately):
--   -- 1. CHECK accepts the new role
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.user_roles'::regclass and contype='c';
--   -- 2. Capabilities seeded
--   select key from permissions where category='Projects' order by sort_order;
--   select role, permission_key, enabled from role_permissions
--    where permission_key like 'project.%' order by permission_key, role;
--   -- 3. RPC accepts sales_director
--   select admin_set_user_role('00000000-0000-0000-0000-000000000000','sales_director');
--   --   -> NOT 'invalid role' (confirms accept-list); other errors are fine here.
-- ---------------------------------------------------------------------
