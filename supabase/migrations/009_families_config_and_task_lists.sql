-- Dynamic product configuration engine + Production Task Lists.
-- Run in Supabase SQL Editor. Idempotent.

begin;

-- ---------- 1. PRODUCT FAMILIES ----------
create table if not exists product_families (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  position integer not null default 0,
  created_at timestamptz default now()
);

alter table product_families enable row level security;
drop policy if exists "read families" on product_families;
create policy "read families" on product_families for select
  using (auth.role() = 'authenticated');
drop policy if exists "admin write families" on product_families;
create policy "admin write families" on product_families for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'));

-- ---------- 2. CONFIGURATION FIELDS ----------
create table if not exists config_fields (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references product_families(id) on delete cascade,
  field_name text not null,
  field_type text not null check (field_type in ('dropdown','text','number','checkbox','textarea')),
  required boolean not null default false,
  default_value text,
  placeholder text,
  field_order integer not null default 0,
  visible_in_quotation boolean not null default true,
  visible_in_task_list boolean not null default true,
  internal_only boolean not null default false,
  active boolean not null default true,
  created_at timestamptz default now(),
  unique (family_id, field_name)
);

create index if not exists idx_config_fields_family on config_fields(family_id, field_order);

alter table config_fields enable row level security;
drop policy if exists "read config_fields" on config_fields;
create policy "read config_fields" on config_fields for select
  using (auth.role() = 'authenticated');
drop policy if exists "admin write config_fields" on config_fields;
create policy "admin write config_fields" on config_fields for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'));

-- ---------- 3. CONFIG FIELD OPTIONS ----------
create table if not exists config_field_options (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references config_fields(id) on delete cascade,
  option_value text not null,
  option_order integer not null default 0,
  created_at timestamptz default now()
);

create index if not exists idx_config_field_options_field on config_field_options(field_id, option_order);

alter table config_field_options enable row level security;
drop policy if exists "read field options" on config_field_options;
create policy "read field options" on config_field_options for select
  using (auth.role() = 'authenticated');
drop policy if exists "admin write field options" on config_field_options;
create policy "admin write field options" on config_field_options for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'));

-- ---------- 4. PRODUCTS → FAMILY ----------
alter table products add column if not exists family_id uuid
  references product_families(id) on delete set null;

create index if not exists idx_products_family on products(family_id);

-- ---------- 5. PER-LINE CONFIGURATION VALUES ----------
alter table document_lines add column if not exists config_values jsonb
  not null default '{}'::jsonb;

-- ---------- 6. PRODUCTION TASK LISTS ----------
create table if not exists production_task_lists (
  id uuid primary key default gen_random_uuid(),
  number text unique,
  quotation_id uuid not null references documents(id) on delete cascade,
  client_id uuid references clients(id),
  date timestamptz not null default now(),
  production_notes text,
  shipping_method text,
  status text not null default 'open'
    check (status in ('open','in_production','completed','cancelled')),
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);

create index if not exists idx_task_lists_quotation on production_task_lists(quotation_id);
create index if not exists idx_task_lists_status on production_task_lists(status, date desc);

alter table production_task_lists enable row level security;
drop policy if exists "tasks select" on production_task_lists;
create policy "tasks select" on production_task_lists for select using (
  exists(select 1 from documents d where d.id = quotation_id and (
    d.created_by = auth.uid()
    or exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  ))
);
drop policy if exists "tasks insert" on production_task_lists;
create policy "tasks insert" on production_task_lists for insert with check (created_by = auth.uid());
drop policy if exists "tasks update" on production_task_lists;
create policy "tasks update" on production_task_lists for update using (
  exists(select 1 from documents d where d.id = quotation_id and (
    d.created_by = auth.uid()
    or exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  ))
);
drop policy if exists "tasks delete" on production_task_lists;
create policy "tasks delete" on production_task_lists for delete using (
  exists(select 1 from documents d where d.id = quotation_id and (
    d.created_by = auth.uid()
    or exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  ))
);

-- ---------- 7. PRODUCTION TASK LIST LINES ----------
create table if not exists production_task_list_lines (
  id uuid primary key default gen_random_uuid(),
  task_list_id uuid not null references production_task_lists(id) on delete cascade,
  product_id uuid references products(id),
  quantity integer not null default 1,
  config_values jsonb not null default '{}'::jsonb,
  internal_notes text,
  position integer not null default 0,
  created_at timestamptz default now()
);

create index if not exists idx_task_lines_list on production_task_list_lines(task_list_id, position);

alter table production_task_list_lines enable row level security;
drop policy if exists "task lines rw" on production_task_list_lines;
create policy "task lines rw" on production_task_list_lines for all using (
  exists(select 1
    from production_task_lists t
    join documents d on d.id = t.quotation_id
    where t.id = task_list_id and (
      d.created_by = auth.uid()
      or exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
    ))
) with check (
  exists(select 1
    from production_task_lists t
    join documents d on d.id = t.quotation_id
    where t.id = task_list_id and d.created_by = auth.uid())
);

-- ---------- 8. NUMBERING RPC ----------
-- Format: PTL-YY-NNNN
create or replace function next_task_list_number() returns text language plpgsql as $$
declare
  yr text := to_char(now(), 'YY');
  n int;
begin
  select coalesce(max((regexp_match(number, '-([0-9]+)$'))[1]::int), 0) + 1
  into n
  from production_task_lists
  where number like 'PTL-' || yr || '-%';
  return 'PTL-' || yr || '-' || lpad(n::text, 4, '0');
end; $$;

notify pgrst, 'reload schema';

commit;
