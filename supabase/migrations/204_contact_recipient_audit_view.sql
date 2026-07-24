-- =====================================================================
-- m181 — contact_recipient_audit view (package go-live hardening).
-- =====================================================================
-- Single source of truth for "will a quote package actually reach this
-- client?". Encapsulates the recipient rule the app uses — primary-contact
-- email, falling back to clients.email — and classifies every non-archived
-- client. The /api/integrations/contact-audit route selects the non-OK rows
-- from this view for the weekly n8n check; you can also query it directly in
-- the SQL editor.
--
-- Status meanings (mirrors features/Intergration/docs/contact_data_audit.sql):
--   OK            — primary contact has a valid, external email  → delivers
--   NO_PRIMARY    — contacts exist but none flagged is_primary   → misroute risk
--   FALLBACK_ONLY — no usable contact email; only clients.email  → held
--   INTERNAL      — resolved email is one of OUR domains         → held
--   INVALID       — resolved email is malformed                  → held / bounces
--   MISSING       — no usable email anywhere                     → cannot send
--
-- Read-only (a view). EDIT the internal_domains VALUES list to match your real
-- domains. Re-runnable (create or replace).
-- =====================================================================

begin;

create or replace view contact_recipient_audit as
with internal_domains(domain) as (
  values ('solux-light.com')          -- <-- edit to your real internal domain(s)
),
primary_contact as (
  select distinct on (client_id)
         client_id,
         nullif(trim(email), '') as email,
         is_primary
    from contacts
   order by client_id, is_primary desc, (nullif(trim(email),'') is not null) desc, created_at asc
),
resolved as (
  select
    cl.id           as client_id,
    cl.company_name as client_name,
    pc.is_primary   as has_primary_flag,
    (select count(*) from contacts k where k.client_id = cl.id) as contact_count,
    coalesce(pc.email, nullif(trim(cl.email), '')) as recipient_email,
    case
      when pc.email is not null then 'contact'
      when nullif(trim(cl.email), '') is not null then 'client'
      else 'none'
    end as recipient_source,
    exists (select 1 from documents d where d.client_id = cl.id) as has_quote,
    exists (select 1 from documents d
             where d.client_id = cl.id and d.status is distinct from 'draft') as has_nondraft_quote
  from clients cl
  left join primary_contact pc on pc.client_id = cl.id
  where cl.archived_at is null
)
select
  r.client_id,
  r.client_name,
  r.recipient_email,
  r.recipient_source,
  r.contact_count,
  r.has_primary_flag,
  r.has_quote,
  r.has_nondraft_quote,
  case
    when r.recipient_email is null then 'MISSING'
    when r.recipient_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then 'INVALID'
    when split_part(lower(r.recipient_email), '@', 2)
           in (select domain from internal_domains) then 'INTERNAL'
    when r.recipient_source = 'client' then 'FALLBACK_ONLY'
    when r.contact_count > 0 and coalesce(r.has_primary_flag, false) = false then 'NO_PRIMARY'
    else 'OK'
  end as audit_status
from resolved r;

insert into schema_migrations (filename, note)
values ('204_contact_recipient_audit_view.sql',
        'contact_recipient_audit view: classifies each non-archived client by whether its resolved quote-package recipient email will deliver (OK / NO_PRIMARY / FALLBACK_ONLY / INTERNAL / INVALID / MISSING).')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
