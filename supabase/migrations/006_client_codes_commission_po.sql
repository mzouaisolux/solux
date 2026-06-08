-- Client codes + per-client numbering, commission, PO, client product names,
-- and per-client custom tax/registration fields.
-- Run in Supabase SQL Editor. Idempotent.

begin;

-- ---------- 1. CLIENTS: code + starting seq + custom fields ----------
alter table clients
  add column if not exists client_code text
    check (client_code is null or client_code ~ '^[A-Z]{3}$');

alter table clients
  add column if not exists starting_sequence_number integer
    not null default 0
    check (starting_sequence_number >= 0);

-- Free-form custom fields: [{ "label": "VAT", "value": "FR123456" }, ...]
alter table clients
  add column if not exists custom_fields jsonb
    not null default '[]'::jsonb;

-- Codes are typed by the operator; should be unique per company. Allow nulls.
create unique index if not exists clients_client_code_unique_idx
  on clients(client_code) where client_code is not null;

-- ---------- 2. DOCUMENTS: PO + commission ----------
alter table documents
  add column if not exists purchase_order_number text;

alter table documents
  add column if not exists commission_enabled boolean not null default false;
alter table documents
  add column if not exists commission_percentage numeric not null default 0;
alter table documents
  add column if not exists commission_amount numeric not null default 0;
alter table documents
  add column if not exists commission_description text;
alter table documents
  add column if not exists show_commission_in_pdf boolean not null default false;

-- ---------- 3. DOCUMENT LINES: client product name ----------
alter table document_lines
  add column if not exists client_product_name text;

-- ---------- 4. PER-CLIENT NUMBERING RPC ----------
-- Format: SLX-{client_code}-{YY}-{NNN}
-- Sequence = starting_sequence_number + count_for_this_client_year + 1
create or replace function next_client_document_number(client_id_in uuid)
returns text language plpgsql as $$
declare
  code text;
  start_seq int;
  yr text := to_char(now(), 'YY');
  prior_count int;
  prefix text;
  highest int;
  next_seq int;
begin
  select client_code, coalesce(starting_sequence_number, 0)
    into code, start_seq
    from clients
   where id = client_id_in;

  if code is null then
    raise exception 'Client has no client_code — please set a 3-letter code on the client first.';
  end if;

  prefix := 'SLX-' || code || '-' || yr || '-';

  -- Highest existing sequence already in our system for this client+year
  select coalesce(max((regexp_match(number, '-([0-9]+)$'))[1]::int), 0)
    into highest
    from documents
   where client_id = client_id_in
     and number like prefix || '%';

  -- Count of existing (defensive: regexp_match could miss legacy formats)
  select count(*) into prior_count
    from documents
   where client_id = client_id_in
     and number like prefix || '%';

  next_seq := greatest(highest, start_seq + prior_count) + 1;

  return prefix || lpad(next_seq::text, 3, '0');
end; $$;

notify pgrst, 'reload schema';

commit;
