-- =====================================================================
-- m166 — Integrations: seed the permissions matrix for the integration.*
--        capabilities (catalog lives in lib/capabilities.ts; this seeds the
--        DB permissions + role_permissions rows the matrix + hasCapability read).
-- =====================================================================
-- Without a role_permissions row a capability is denied for EVERY role
-- (loadEnabledCapabilities has no super-admin bypass), so Phase 1 logging and
-- the Phase 2 admin sections need explicit grants. Defaults follow the role
-- matrix in docs/Solux_Integrations_User_Flows.html §3 / PLAN §3.1:
--   • log_interaction        → everyone client-visible (NOT finance)
--   • view_team_interactions → managers / director / admin
--   • manage, manage_api_keys→ admin / super_admin only
--   • send_business          → UN-GRANTED for now (the Knowledge Hub
--                              "Send to customer" hand-off stays dormant until
--                              Phase 3 ships the /integrations send route).
-- Mirrors m161's seed shape. Idempotent.
-- =====================================================================

begin;

insert into permissions (key, category, label, description, sort_order) values
  ('integration.log_interaction', 'Integrations', 'Log & see client interactions',
   'Log a chat/call/email on a client and see that client''s interaction timeline (scoped to accessible clients).', 205),
  ('integration.send_business', 'Integrations', 'Send business messages to customers',
   'Send from a company channel (Zalo OA / WhatsApp Business / email) and log it, checked against client ownership.', 206),
  ('integration.view_team_interactions', 'Integrations', 'View team interaction timelines',
   'Supervision view of interactions across a manager''s / director''s scope.', 207),
  ('integration.manage', 'Integrations', 'Manage business channel connections',
   'Settings → Integrations: connect / disconnect the workspace business channels.', 208),
  ('integration.manage_api_keys', 'Integrations', 'Manage API keys & webhooks',
   'Create / revoke API keys and manage outbound webhook endpoints.', 209)
on conflict (key) do update set
  category    = excluded.category,
  label       = excluded.label,
  description = excluded.description,
  sort_order  = excluded.sort_order;

insert into role_permissions (role, permission_key, enabled) values
  -- log_interaction — everyone who works client accounts; not finance
  ('super_admin',       'integration.log_interaction', true),
  ('admin',             'integration.log_interaction', true),
  ('task_list_manager', 'integration.log_interaction', true),
  ('operations',        'integration.log_interaction', true),
  ('sales',             'integration.log_interaction', true),
  ('sales_director',    'integration.log_interaction', true),
  ('finance',           'integration.log_interaction', false),
  -- send_business — dormant everywhere until Phase 3 (avoids a dead CTA)
  ('super_admin',       'integration.send_business', false),
  ('admin',             'integration.send_business', false),
  ('task_list_manager', 'integration.send_business', false),
  ('operations',        'integration.send_business', false),
  ('sales',             'integration.send_business', false),
  ('sales_director',    'integration.send_business', false),
  ('finance',           'integration.send_business', false),
  -- view_team_interactions — supervision roles
  ('super_admin',       'integration.view_team_interactions', true),
  ('admin',             'integration.view_team_interactions', true),
  ('task_list_manager', 'integration.view_team_interactions', true),
  ('operations',        'integration.view_team_interactions', false),
  ('sales',             'integration.view_team_interactions', false),
  ('sales_director',    'integration.view_team_interactions', true),
  ('finance',           'integration.view_team_interactions', false),
  -- manage — admin-like only
  ('super_admin',       'integration.manage', true),
  ('admin',             'integration.manage', true),
  ('task_list_manager', 'integration.manage', false),
  ('operations',        'integration.manage', false),
  ('sales',             'integration.manage', false),
  ('sales_director',    'integration.manage', false),
  ('finance',           'integration.manage', false),
  -- manage_api_keys — admin-like only
  ('super_admin',       'integration.manage_api_keys', true),
  ('admin',             'integration.manage_api_keys', true),
  ('task_list_manager', 'integration.manage_api_keys', false),
  ('operations',        'integration.manage_api_keys', false),
  ('sales',             'integration.manage_api_keys', false),
  ('sales_director',    'integration.manage_api_keys', false),
  ('finance',           'integration.manage_api_keys', false)
on conflict (role, permission_key) do nothing;

insert into schema_migrations (filename, note)
values ('189_integration_permissions_seed.sql',
        'Integrations: seed permissions + role_permissions for integration.* — log_interaction (client-facing roles), view_team_interactions (managers), manage/manage_api_keys (admin), send_business ungranted until Phase 3.')
on conflict (filename) do nothing;

notify pgrst, 'reload schema';

commit;
