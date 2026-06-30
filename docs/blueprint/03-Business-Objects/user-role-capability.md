# Objet — Utilisateur · Rôle · Capability · Équipe · Grant

## Définition
Les objets de **gouvernance** qui décident *qui peut faire quoi* (capabilities) et *qui voit quoi* (rôles, équipes, grants). Détail complet : [../07-Roles-and-Permissions.md](../07-Roles-and-Permissions.md).

## Utilisateur / Rôle (`user_roles`)
- 1 ligne par utilisateur : `role` (6 valeurs : admin, sales, task_list_manager, operations, finance, sales_director) + `super_admin` (booléen séparé).
- **Lecture RLS = sa propre ligne uniquement** → un user ne peut pas lire le rôle des autres (d'où l'importance des display_names).
- Assignation : RPC `admin_set_user_role` (**super_admin only**, refuse l'auto-édition).

## Capability (`permissions` + `role_permissions`)
- `permissions` = catalogue (~40 clés, ex. `quotation.create`, `task_list.validate`).
- `role_permissions` = la **matrice** (role × capability → enabled).
- **Lecture** = tout authentifié ; **écriture = super_admin only** (RLS).
- Vérifiée par `requireCapability` (rôle réel) dans chaque server action ; cache 30s.

## Équipe (`teams` + `team_members`)
- `teams` : kind team/region/department, hiérarchie via `parent_team_id`.
- `team_members` : `member_role` member/manager. Un **manager** voit les clients/affaires de ses membres (m105).

## Grant de visibilité (`access_grants`, m067)
- `scope_type` : `self` / `team` / `region` / `lens(production|finance|logistics)` / `all`.
- `expires_at` : délégation temporaire (⚠️ lu par l'engine mais **jamais écrit** par l'UI — TO BE VALIDATED).
- Traduit en scope par `getVisibilityScope` (`lib/visibility.ts`). Fallback sans grant : technique/`canSupervise` → all, sinon self.

## Cycle de vie
Pas de machine à états ; ce sont des configurations éditées par le super_admin (matrice, rôles) ou le management (équipes, grants).

## Dépendances
- **Tous les modules** (gardés par les capabilities), **Visibility** (grants → RLS app), **Events** (`admin.permissions_changed`, `admin.user_role_changed`).

## Règles clés
- Matrice en écriture super_admin only ; dernier super_admin indésactivable.
- `super_admin` = flag, pas une valeur de `role` (le CHECK DB rejette la chaîne).
- View-As (super_admin) simule un rôle au **rendu** seulement (la sécurité utilise le vrai rôle).
- **Vulnérabilité historique** (priv-esc TLM, résolue 2026-06-20) : la matrice **live** peut diverger du seed — vérifier sur la base.
</content>
