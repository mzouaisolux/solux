# SOLUX QUOTATION TOOL — FULL SPEC

## OBJECTIVE

Build a web application for SOLUX (solar lighting company) to generate quotations and proforma invoices.

The tool must be:
- Simple for sales team
- Flexible (manual pricing + real-world scenarios)
- Independent from accounting
- Connected to Supabase (database, auth, storage)

---

## TECH STACK

- Frontend: Next.js (React)
- Backend: Supabase
- Database: PostgreSQL (Supabase)
- Auth: Supabase Auth
- Storage: Supabase Storage (PDFs)
- PDF generation: client-side (React PDF or similar)

---

## CORE FEATURES

### 1. Authentication
- Email / password login
- Roles:
  - admin
  - sales

---

### 2. Dashboard
- Create new quotation
- View history
- Duplicate quotation

---

### 3. Product Configurator

User can:
- Select product
- See product image
- Select options:
  - CCT
  - bracket
  - pole diameter
  - etc.
- Enter quantity

---

### 4. Pricing System (CRITICAL)

Two modes:

#### AUTO MODE
- Price comes from latest `prices_version`
- Add option modifiers

#### MANUAL MODE
- User can override unit price

Add toggle:
- "Automatic pricing"
- "Manual pricing"

---

### 5. Transport Module

Fields:
- Freight type:
  - LCL
  - 20ft
  - 40ft HC
- Freight cost (manual input)

---

### 6. Incoterms

Dropdown:
- EXW
- FOB
- CFR
- CIF
- DDP
- DDU

Must be displayed in PDF

---

### 7. Client Management

- Select existing client
- Or create new client

---

### 8. Document Generation

- Type:
  - quotation
  - proforma invoice
- Auto number generation

---

### 9. PDF Generation

Include:
- SOLUX logo
- Client info
- Product table:
  - name
  - configuration
  - quantity
  - unit price
  - total
- Incoterm
- Freight details
- Grand total

Store PDF in Supabase Storage

---

## DATABASE SCHEMA (SQL)

```sql
-- USERS ROLES
create table user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  role text check (role in ('admin', 'sales')) not null
);

-- PRODUCTS
create table products (
  id uuid primary key default gen_random_uuid(),
  name text,
  category text,
  base_price numeric,
  image_url text,
  active boolean default true
);

-- OPTIONS
create table options (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id),
  option_type text,
  option_value text,
  price_modifier numeric
);

-- PRICES VERSION
create table prices_version (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id),
  price numeric,
  valid_from date
);

-- CLIENTS
create table clients (
  id uuid primary key default gen_random_uuid(),
  company_name text,
  contact_name text,
  email text,
  country text
);

-- DOCUMENTS
create table documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  type text check (type in ('quotation', 'proforma')),
  date timestamp default now(),
  total_price numeric,
  status text,
  incoterm text,
  freight_type text,
  freight_cost numeric,
  manual_pricing boolean,
  pdf_url text
);

-- DOCUMENT LINES
create table document_lines (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id),
  product_id uuid references products(id),
  quantity integer,
  selected_options jsonb,
  unit_price numeric,
  total_price numeric,
  pricing_mode text check (pricing_mode in ('auto','manual'))
);