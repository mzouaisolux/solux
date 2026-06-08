-- SOLUX Quotation Tool — schema + RLS + numbering
-- Run in the Supabase SQL editor.

create extension if not exists "pgcrypto";

-- ---------- TABLES ----------

create table if not exists user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade unique,
  role text check (role in ('admin','sales','task_list_manager')) not null
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  base_price numeric not null default 0,
  image_url text,
  active boolean default true,
  created_at timestamptz default now()
);

create table if not exists options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  option_type text not null,
  option_value text not null,
  price_modifier numeric not null default 0
);

create table if not exists prices_version (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id) on delete cascade,
  price numeric not null,
  valid_from date not null default current_date
);

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  contact_name text,
  email text,
  country text,
  address text,
  vat_number text,
  default_attention_to text,
  created_at timestamptz default now(),
  archived_at timestamptz
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  number text unique,
  client_id uuid references clients(id),
  type text check (type in ('quotation','proforma')) not null,
  date timestamptz default now(),
  total_price numeric default 0,
  status text default 'draft',
  incoterm text,
  freight_type text,
  freight_cost numeric default 0,
  manual_pricing boolean default false,
  pdf_url text,
  created_by uuid references auth.users(id)
);

create table if not exists document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  product_id uuid references products(id),
  quantity integer not null default 1,
  selected_options jsonb default '{}'::jsonb,
  unit_price numeric not null default 0,
  total_price numeric not null default 0,
  pricing_mode text check (pricing_mode in ('auto','manual')) default 'auto'
);

create index if not exists idx_options_product on options(product_id);
create index if not exists idx_prices_product_valid on prices_version(product_id, valid_from desc);
create index if not exists idx_lines_doc on document_lines(document_id);
create index if not exists idx_docs_created_by on documents(created_by);

-- ---------- DOCUMENT NUMBERING ----------

create or replace function next_document_number(doc_type text) returns text
language plpgsql as $$
declare
  prefix text := case doc_type when 'quotation' then 'QUO' when 'proforma' then 'PRO' else 'DOC' end;
  yr text := to_char(now(), 'YYYY');
  n int;
begin
  select coalesce(max((regexp_match(number, '-(\d+)$'))[1]::int), 0) + 1
  into n
  from documents
  where number like prefix || '-' || yr || '-%';
  return prefix || '-' || yr || '-' || lpad(n::text, 4, '0');
end; $$;

-- ---------- RLS ----------

alter table user_roles enable row level security;
alter table products enable row level security;
alter table options enable row level security;
alter table prices_version enable row level security;
alter table clients enable row level security;
alter table documents enable row level security;
alter table document_lines enable row level security;

-- Any authenticated user can read the catalog
create policy "read catalog" on products for select using (auth.role() = 'authenticated');
create policy "read options" on options for select using (auth.role() = 'authenticated');
create policy "read prices" on prices_version for select using (auth.role() = 'authenticated');

-- Admins can write the catalog
create policy "admin write products" on products for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'));
create policy "admin write options" on options for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'));
create policy "admin write prices" on prices_version for all
  using (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'))
  with check (exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin'));

-- Clients: any authenticated user
create policy "clients rw" on clients for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Documents: only the creator (or admin)
create policy "docs select" on documents for select using (
  created_by = auth.uid()
  or exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
);
create policy "docs insert" on documents for insert with check (created_by = auth.uid());
create policy "docs update" on documents for update using (
  created_by = auth.uid()
  or exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
);

create policy "lines rw" on document_lines for all using (
  exists(select 1 from documents d where d.id = document_id and (
    d.created_by = auth.uid()
    or exists(select 1 from user_roles r where r.user_id = auth.uid() and r.role = 'admin')
  ))
) with check (
  exists(select 1 from documents d where d.id = document_id and d.created_by = auth.uid())
);

-- User roles: user can read own
create policy "roles self" on user_roles for select using (user_id = auth.uid());

-- ---------- STORAGE ----------
-- Create a bucket named "documents" (private). In the SQL editor:
-- insert into storage.buckets (id, name, public) values ('documents','documents', false);
-- Policies (authenticated users can read/write their own PDFs):
-- create policy "docs storage rw" on storage.objects for all
--   using (bucket_id = 'documents' and auth.role() = 'authenticated')
--   with check (bucket_id = 'documents' and auth.role() = 'authenticated');
