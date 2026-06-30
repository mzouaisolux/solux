# Module — Admin & Permissions

> La **gouvernance** : utilisateurs & rôles, matrice de capabilities, équipes & grants de visibilité, règles de notification, diagnostics système, et la simulation « View As ».

## Objectif métier
Configurer **qui peut faire quoi** (capabilities) et **qui voit quoi** (rôles, équipes, grants), gérer les comptes, surveiller la santé du système, et permettre au super-admin de **simuler** n'importe quel rôle pour vérifier l'expérience.

## Utilisateurs (rôles)
- **Super Admin** : seul à pouvoir éditer la matrice de permissions, assigner les rôles, accéder aux diagnostics/reset, simuler des rôles.
- **Admin** : master-data (voir [catalog-pricing.md](catalog-pricing.md)) ; **PAS** users/permissions/diagnostics par défaut.

## Écrans / Routes
| Route | Objectif | Accès |
|---|---|---|
| `/admin/users` | Assigner rôles + super_admin + display_name | `admin.manage_users` (super_admin en pratique) |
| `/permissions/actions` | Matrice rôle × capability (édition) | `admin.manage_permissions` (super_admin) |
| `/permissions/teams` | Équipes, membres (manager/member), grants (self/team/region/lens/all) | `admin.manage_permissions` |
| `/admin/notifications` | Matrice cloche rôle × event (bell/feed/off) | `isAdminLike` (non délégable) |
| `/admin/diagnostics` (+ `/reset`, `/tender-merge`) | Santé, ledger migrations, lifecycle, inspector, dev reset | `admin.diagnostics` (super_admin) |
| `/view-as` (action) | Bascule de rôle simulé | super_admin |

## Données manipulées (tables)
- **`user_roles`** : `role` (6 valeurs) + `super_admin` (booléen). Lecture RLS = **sa propre ligne uniquement**.
- **`permissions`** (catalogue) + **`role_permissions`** (la matrice ; PK (role, permission_key), `enabled`). RLS : lecture = tout authentifié ; **écriture = super_admin only**.
- **`teams`**, **`team_members`** (member_role member/manager), **`access_grants`** (scope_type self/team/region/lens/all, `expires_at`).
- **`notification_rules`** (m123), **`app_settings`** (m120), **`schema_migrations`** (ledger m113).

## Mécaniques clés
- **Matrice de permissions** : éditée d'un bloc (état complet) ; super_admin × `admin.manage_permissions` **verrouillé ON** (anti-lockout) ; au save : `clearCapabilityCache()` (effet immédiat) + event `admin.permissions_changed`. Cache 30 s par rôle.
- **Assignation de rôle** : RPC `admin_set_user_role` (super_admin only, refuse l'auto-édition) ; `admin_toggle_super_admin` (garde « dernier super_admin »).
- **Visibilité** : `getVisibilityScope` (`lib/visibility.ts`) traduit les `access_grants` en scope (owner/region/lens/all) ; fallback legacy (technique/`canSupervise` → all, sinon self). Voir [../07-Roles-and-Permissions.md](../07-Roles-and-Permissions.md) §5.
- **Diagnostics** : RPC `admin_diagnostics_health` (6 sondes d'incohérence), `admin_migration_probes` (preuve live des migrations), ledger + disk. Dev reset = double-gate super_admin (préserve toute la config).
- **View As** : cookie `solux_view_as_role` ; n'affecte **que le rendu** ; toutes les actions serveur + la RLS utilisent le **vrai** rôle (du super_admin) → conclusions de sécurité tirées sous View-As **invalides**.

## Règles clés
- Matrice en écriture **super_admin only** (RLS) — même si on accordait `admin.manage_permissions` à un admin, il ne pourrait pas écrire.
- Dernier super_admin indésactivable ; auto-édition refusée.
- `requireCapabilityOrAdmin` = plancher admin/super_admin + délégation matrice.

## Événements émis
`admin.permissions_changed`, `admin.user_role_changed`, `system.dev_reset`. (Aucun event pour teams/grants/master-data.)

## Dépendances & modules concernés
- **Tous les modules** (la matrice gouverne leurs gardes), **Events/Notifications** (notification_rules), **Visibility** (grants → RLS app).

## UNKNOWN / TO BE VALIDATED
- **Gating page-vs-action incohérent** sur plusieurs pages admin (page `isAdminLike` vs action capability).
- **Matrice vs RLS non alignées** (pricing.manage, admin.manage_banks/sales_conditions délégables mais RLS plus strictes).
- RPC `admin_set_user_role` (m029) : CHECK 3 rôles vs 6 `ASSIGNABLE_ROLES` — assignation des rôles tardifs à vérifier en prod.
- `access_grants.expires_at` lu par l'engine mais **jamais écrit** par l'UI (délégation temporaire morte).
- Asymétrie `/permissions/teams` : page gardée `admin.manage_permissions` mais actions exigent `isTechnicalRole`.
- Vulnérabilité historique résolue (priv-esc TLM 2026-06-20) : la **matrice live peut diverger du seed** — vérifier sur la base.
</content>
