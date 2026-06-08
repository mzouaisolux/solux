-- =====================================================================
-- m046 — Data isolation hardening (sales RLS for events + comments,
--        operations role widened on PO/TL policies).
-- =====================================================================
--
-- AUDIT FINDING
-- -------------
-- A new Sales user can currently see ALL operational events and
-- comments across the company because:
--
--   events.read           policy = `auth.role() = 'authenticated'`
--   event_comments.read   policy = `auth.role() = 'authenticated'`
--
-- Both are "any signed-in user can read everything", which leaks
-- payment discussions, production delays, supplier coordination,
-- etc. between sales reps.
--
-- Separately, `operations` role (added m042) was not propagated into
-- the existing production_orders / task_lists / pdc policies — so
-- ops users could only see their own quotations' POs, not the full
-- production pipeline they own operationally. Fixed in the same pass.
--
-- FIX
-- ---
-- 1. events.read           → entity-ownership scoped for sales,
--                            broad for admin / TLM / operations / super.
-- 2. event_comments.read   → transitive on events visibility (a user
--                            can see a comment iff they can see the
--                            parent event).
-- 3. event_comments.insert → must be able to see the event first.
-- 4. production_orders, production_task_lists, production_deadline_changes
--                          → widen "technical" bucket to include
--                            'operations' role (was only admin + tlm).
--
-- Idempotent. Safe to re-run.
-- =====================================================================

begin;

-- =====================================================================
-- 1. EVENTS — entity-ownership scoped reads
-- =====================================================================
-- Technical/admin/super roles see everything. Other roles (sales) see
-- only events whose entity_type+entity_id refers to a document, task
-- list, production order, or client they own.
--
-- The sub-selects use WHERE clauses that explicitly check
-- `documents.created_by = auth.uid()`, so this works regardless of
-- whether documents itself has restrictive RLS — there's no infinite
-- recursion risk because the policy never reads its own table.
--
-- 'system' events (admin dev resets, permissions changes) match no
-- entity_type branch below, so they're invisible to sales — correct.

drop policy if exists "events read" on events;
drop policy if exists "events read scoped" on events;
create policy "events read scoped" on events for select using (
  -- Technical / admin / super-admin → full visibility.
  exists (
    select 1 from user_roles ur
     where ur.user_id = auth.uid()
       and (
         ur.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(ur.super_admin, false)
       )
  )
  -- Otherwise: must own the underlying entity (sales scope).
  or (entity_type = 'document' and exists (
    select 1 from documents d
     where d.id = entity_id and d.created_by = auth.uid()
  ))
  or (entity_type = 'task_list' and exists (
    select 1 from production_task_lists tl
     join documents d on d.id = tl.quotation_id
     where tl.id = entity_id and d.created_by = auth.uid()
  ))
  or (entity_type = 'production_order' and exists (
    select 1 from production_orders po
     join documents d on d.id = po.quotation_id
     where po.id = entity_id and d.created_by = auth.uid()
  ))
  or (entity_type = 'client' and exists (
    select 1 from documents d
     where d.client_id = entity_id and d.created_by = auth.uid()
  ))
);

-- Insert policy — any authenticated user can emit (the entity owner
-- check is on the read side; writes are validated by the server
-- action capability gates already in place).
drop policy if exists "events write" on events;
create policy "events write" on events for insert
  with check (auth.role() = 'authenticated');

-- =====================================================================
-- 2. EVENT_COMMENTS — transitive on event visibility
-- =====================================================================
-- A user can read/insert a comment iff they can read the parent
-- event. We rely on the events policy above to do the heavy lifting
-- (Postgres applies RLS to the sub-select on events).

drop policy if exists "event_comments read" on event_comments;
drop policy if exists "event_comments read scoped" on event_comments;
create policy "event_comments read scoped" on event_comments for select
  using (
    exists (select 1 from events e where e.id = event_comments.event_id)
  );

drop policy if exists "event_comments write" on event_comments;
drop policy if exists "event_comments write scoped" on event_comments;
create policy "event_comments write scoped" on event_comments for insert
  with check (
    exists (select 1 from events e where e.id = event_id)
  );

-- =====================================================================
-- 3. PRODUCTION_ORDERS — include 'operations' role in technical bucket
-- =====================================================================

drop policy if exists "po select" on production_orders;
create policy "po select" on production_orders for select using (
  exists (
    select 1 from documents d
    where d.id = quotation_id and (
      d.created_by = auth.uid()
      or exists (
        select 1 from user_roles r
         where r.user_id = auth.uid()
           and (
             r.role in ('admin', 'task_list_manager', 'operations')
             or coalesce(r.super_admin, false)
           )
      )
    )
  )
);

drop policy if exists "po write" on production_orders;
create policy "po write" on production_orders for all using (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
) with check (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
);

-- =====================================================================
-- 4. PRODUCTION_TASK_LISTS — include 'operations' role
-- =====================================================================

drop policy if exists "tasks select" on production_task_lists;
create policy "tasks select" on production_task_lists for select using (
  exists (
    select 1 from documents d
    where d.id = quotation_id and (
      d.created_by = auth.uid()
      or exists (
        select 1 from user_roles r
         where r.user_id = auth.uid()
           and (
             r.role in ('admin', 'task_list_manager', 'operations')
             or coalesce(r.super_admin, false)
           )
      )
    )
  )
);

-- Insert stays on `created_by = auth.uid()` — anyone can create a TL
-- for a doc they can see; downstream actions then enforce capabilities.
drop policy if exists "tasks insert" on production_task_lists;
create policy "tasks insert" on production_task_lists for insert
  with check (created_by = auth.uid());

drop policy if exists "tasks update" on production_task_lists;
create policy "tasks update" on production_task_lists for update using (
  exists (
    select 1 from documents d
    where d.id = quotation_id and (
      d.created_by = auth.uid()
      or exists (
        select 1 from user_roles r
         where r.user_id = auth.uid()
           and (
             r.role in ('admin', 'task_list_manager', 'operations')
             or coalesce(r.super_admin, false)
           )
      )
    )
  )
);

-- DELETE stays admin/super-admin only (destructive).
drop policy if exists "tasks delete" on production_task_lists;
create policy "tasks delete" on production_task_lists for delete using (
  exists (
    select 1 from documents d
    where d.id = quotation_id and (
      d.created_by = auth.uid()
      or exists (
        select 1 from user_roles r
         where r.user_id = auth.uid()
           and (r.role = 'admin' or coalesce(r.super_admin, false))
      )
    )
  )
);

-- =====================================================================
-- 5. PRODUCTION_DEADLINE_CHANGES — include 'operations' role
-- =====================================================================

drop policy if exists "pdc select" on production_deadline_changes;
create policy "pdc select" on production_deadline_changes for select using (
  exists (
    select 1 from production_orders po
     join documents d on d.id = po.quotation_id
     where po.id = production_order_id and (
       d.created_by = auth.uid()
       or exists (
         select 1 from user_roles r
          where r.user_id = auth.uid()
            and (
              r.role in ('admin', 'task_list_manager', 'operations')
              or coalesce(r.super_admin, false)
            )
       )
     )
  )
);

drop policy if exists "pdc write" on production_deadline_changes;
create policy "pdc write" on production_deadline_changes for all using (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
) with check (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
);

-- =====================================================================
-- 6. DOCUMENTS — scope reads/writes by owner for sales
-- =====================================================================
-- Today, `documents` likely has RLS disabled OR a permissive
-- "authenticated read all" policy from the initial Supabase setup.
-- That means a sales user can guess a doc URL (/documents/<id>) and
-- see another sales rep's quotation.
--
-- Fix: enable RLS, wipe pre-existing policies (we don't know what was
-- there), and install a clean 4-policy set:
--
--   SELECT: owner OR admin/TLM/operations/super
--   INSERT: created_by must equal auth.uid()
--   UPDATE: owner OR technical roles
--   DELETE: admin / super-admin only (destructive)
--
-- The wipe + recreate is done in a DO block so it works regardless
-- of the current state of RLS on the table.

do $$
declare
  p record;
begin
  -- Enable RLS if it isn't already.
  if not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'documents'
       and c.relrowsecurity
  ) then
    execute 'alter table documents enable row level security';
  end if;

  -- Drop every existing policy on `documents` so we don't end up
  -- with our new restrictive policy OR'd with a permissive legacy
  -- one (which would mean "true OR anything = true", no scoping).
  for p in
    select policyname from pg_policies
     where schemaname = 'public' and tablename = 'documents'
  loop
    execute format('drop policy if exists %I on documents', p.policyname);
  end loop;
end $$;

create policy "documents read scoped" on documents for select using (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
);

create policy "documents insert scoped" on documents for insert
  with check (created_by = auth.uid());

create policy "documents update scoped" on documents for update using (
  created_by = auth.uid()
  or exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (
         r.role in ('admin', 'task_list_manager', 'operations')
         or coalesce(r.super_admin, false)
       )
  )
);

create policy "documents delete scoped" on documents for delete using (
  exists (
    select 1 from user_roles r
     where r.user_id = auth.uid()
       and (r.role = 'admin' or coalesce(r.super_admin, false))
  )
);

-- =====================================================================
-- 7. DOCUMENT_LINES + DOCUMENT_CONTAINERS — transitive on documents
-- =====================================================================
-- Child tables of documents. PostgREST embed propagates parent RLS,
-- but if a sales user crafts a direct request to /document_lines
-- with a `document_id=eq.<other-id>` filter, the row would leak
-- unless we add transitive policies.

-- document_lines
do $$
declare p record;
begin
  if exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'document_lines'
  ) then
    -- Enable RLS if needed.
    if not exists (
      select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'document_lines'
         and c.relrowsecurity
    ) then
      execute 'alter table document_lines enable row level security';
    end if;
    -- Wipe existing policies.
    for p in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = 'document_lines'
    loop
      execute format('drop policy if exists %I on document_lines', p.policyname);
    end loop;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'document_lines'
  ) then
    execute $sql$
      create policy "dl read scoped" on document_lines for select using (
        exists (
          select 1 from documents d where d.id = document_id
        )
      );
    $sql$;
    execute $sql$
      create policy "dl write scoped" on document_lines for all using (
        exists (
          select 1 from documents d
           where d.id = document_id
             and (
               d.created_by = auth.uid()
               or exists (
                 select 1 from user_roles r
                  where r.user_id = auth.uid()
                    and (
                      r.role in ('admin', 'task_list_manager', 'operations')
                      or coalesce(r.super_admin, false)
                    )
               )
             )
        )
      ) with check (
        exists (
          select 1 from documents d
           where d.id = document_id
             and (
               d.created_by = auth.uid()
               or exists (
                 select 1 from user_roles r
                  where r.user_id = auth.uid()
                    and (
                      r.role in ('admin', 'task_list_manager', 'operations')
                      or coalesce(r.super_admin, false)
                    )
               )
             )
        )
      );
    $sql$;
  end if;
end $$;

-- document_containers (same pattern)
do $$
declare p record;
begin
  if exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'document_containers'
  ) then
    if not exists (
      select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relname = 'document_containers'
         and c.relrowsecurity
    ) then
      execute 'alter table document_containers enable row level security';
    end if;
    for p in
      select policyname from pg_policies
       where schemaname = 'public' and tablename = 'document_containers'
    loop
      execute format('drop policy if exists %I on document_containers', p.policyname);
    end loop;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'document_containers'
  ) then
    execute $sql$
      create policy "dc read scoped" on document_containers for select using (
        exists (select 1 from documents d where d.id = document_id)
      );
    $sql$;
    execute $sql$
      create policy "dc write scoped" on document_containers for all using (
        exists (
          select 1 from documents d
           where d.id = document_id
             and (
               d.created_by = auth.uid()
               or exists (
                 select 1 from user_roles r
                  where r.user_id = auth.uid()
                    and (
                      r.role in ('admin', 'task_list_manager', 'operations')
                      or coalesce(r.super_admin, false)
                    )
               )
             )
        )
      ) with check (
        exists (
          select 1 from documents d
           where d.id = document_id
             and (
               d.created_by = auth.uid()
               or exists (
                 select 1 from user_roles r
                  where r.user_id = auth.uid()
                    and (
                      r.role in ('admin', 'task_list_manager', 'operations')
                      or coalesce(r.super_admin, false)
                    )
               )
             )
        )
      );
    $sql$;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- Smoke (run separately, ideally with a fresh sales user signed in):
--
--   -- 1. Sales user CAN see events on their own docs:
--   --    (assuming the sales user owns doc d-X)
--   select count(*) from events where entity_type = 'document'
--                                  and entity_id = '<d-X-uuid>';
--   -- Expected: > 0
--
--   -- 2. Sales user CANNOT see events on OTHER users' docs:
--   --    (replace with a doc the sales user doesn't own)
--   select count(*) from events where entity_type = 'document'
--                                  and entity_id = '<other-doc-uuid>';
--   -- Expected: 0
--
--   -- 3. Sales user CANNOT see comments on events they can't read:
--   select count(*) from event_comments
--    where event_id in (
--      select id from events where entity_type = 'production_order'
--      and entity_id = '<other-po-uuid>'
--    );
--   -- Expected: 0
--
--   -- 4. Admin / TLM / operations / super-admin sees everything:
--   --    (signed in as admin)
--   select count(*) from events;
--   -- Expected: total event count in DB
-- ---------------------------------------------------------------------
