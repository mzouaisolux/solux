# Module — Notifications · Conversations · Attachments

> La couche **collaborative transverse** : la cloche de notifications, les fils de discussion par entité, les pièces jointes, l'i18n et le shell de navigation.

## Objectif métier
Permettre aux équipes de **suivre ce qui bouge** (notifications), de **discuter au niveau de chaque objet** (conversations), d'**attacher des fichiers** aux affaires, le tout dans une UI multilingue. Aucun de ces sous-systèmes n'a de stockage matérialisé de notification — **tout est dérivé à la lecture**.

## Sous-modules

### Notifications (cloche)
Voir [../09-Notifications.md](../09-Notifications.md) en détail. **Pas de table `notifications`** : `getNotificationSummary` fusionne 3 sources (task lists à valider, events au canal bell non lus, messages non lus), triées et plafonnées. Règles par rôle dans `notification_rules` (m123), éditables en `/admin/notifications`. Composant `NotificationBell.tsx` (snapshot serveur, pas de polling).

### Conversations (`entity_messages`, m049)
- Fil de discussion par entité : `document`, `task_list`, `production_order`, `client`.
- L'app n'écrit que des messages de type `comment` ; les types `request`/`reply`/`structured_reply` (en schéma) servent la **boucle de révision** des task lists.
- API : `GET /api/conversations/[entity_type]/[entity_id]` (RLS sécurise). Drawer `ConversationDrawer` (mark-read immédiat, optimistic, **pas de polling/realtime**). Launcher flottant ; `?chat=1` ouvre la conversation.
- Mutations : `postEntityComment` / `markEntityRead`. **N'émet pas d'event** — la cloche lit `entity_messages` directement.

### Attachments (m060)
- Fichiers **au niveau affaire** ; table `attachments` (13 types, visibilité sales/ops/factory/client) ; bucket Storage `documents` (préfixe `attachments/<affair_id>/`), max 50 MB.
- RLS lecture : uploader + owner de l'affaire (l'élargissement aux rôles techniques est **TO BE VALIDATED**). Download : `GET /api/attachments/[id]/download` (URL signée 5 min).

### i18n (`lib/i18n/`)
- Système maison léger : **EN (défaut, source de vérité)** + FR (parité) + **ES (~28 %, partiel)**.
- Cookie `solux_locale` ; résolution serveur (cookie → Accept-Language → en) ; `I18nProvider` côté client ; switcher EN/FR/ES. Le menu EN est traduit par reverse-lookup sans le modifier.

### App shell / Nav
- `middleware.ts` : redirige les non-authentifiés vers `/login`. Layout `app/(app)/layout.tsx` : garde auth, **rôle effectif** pour le Nav (View-As), `NoRoleNotice` si sans rôle, monte Nav + Launcher + Toaster + I18nProvider.
- `Nav.tsx` : résout toutes les capabilities en batch (rôle effectif) → `buildVisibleNavigation` (prune ce que l'user ne voit pas). `MegaMenu.tsx` : présentation pure. Badges nav (`lib/nav-badges.ts`) : orders en retard, task lists à valider — RLS-scopés, soft-fail → 0.

## Utilisateurs (rôles)
Tous les rôles connectés (le contenu est RLS-scopé).

## Règles clés
- **Aucune notification stockée / aucun email / aucun cron** : tout est read-time.
- Conversations et notifications scopées par RLS de l'entité.
- Attachments : écriture réservée à l'uploader (RLS).

## Dépendances & modules concernés
- **Events** (source des notifications), **tous les modules** (entités commentables/attachables), **Permissions** (Nav, visibilité).

## UNKNOWN / TO BE VALIDATED
- Élargissement RLS attachments aux rôles techniques (commentaire de route vs policy lue).
- `action_notes` (m075) : table legacy, plus écrite (les notes vont dans `entity_messages`).
- Couverture ES partielle (~28 %) → fallback EN visible.
</content>
