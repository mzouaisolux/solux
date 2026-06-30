-- =====================================================================
-- m129 — affairs.description: optional free-text captured by the inline
-- "+ New Project" quick-create in the quotation builder (and reusable
-- elsewhere). Nullable, non-breaking. Idempotent. Apply MANUALLY in Supabase.
-- =====================================================================

begin;

alter table affairs add column if not exists description text;

insert into schema_migrations (filename, note)
values ('129_affair_description.sql',
        'affairs.description — optional notes for inline project quick-create')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- POST-CHECK: select column_name from information_schema.columns
--             where table_name='affairs' and column_name='description';
-- ROLLBACK:   alter table affairs drop column if exists description;
-- ---------------------------------------------------------------------
