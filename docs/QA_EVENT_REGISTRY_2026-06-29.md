# RAPPORT QA — Module Admin · Event Registry (`/admin/events`, m136)

> Date : 2026-06-29 · Méthode : vrais comptes / vrais JWT (**jamais View-As**), harness `e2e/audit/*`, baseline DB **0/0** vérifiée puis **restaurée à 0/0** après test (script `e2e/audit/qa-evt-cleanup.ts`).
> Convention : **[V]** vérifié runtime/DB · **[C]** prouvé par lecture du code · **[NT]** non testé.

---

## 0. Verdict en une ligne

La console est l'**Étape 1** d'une architecture cible. Elle présente **6 consumers + 7 champs d'identité** comme configurables, mais au runtime **un seul a un effet réel : la Notification (canal `bell/feed/off` par rôle)**. Tout le reste — **Dashboard, KPI, visibilité Audit, override de Severity, Enabled, Requires action** — est **persisté en base mais lu par aucun code**. C'est le principe assumé « *config route / code projette* », sauf qu'aujourd'hui seul le code de la cloche projette depuis la config.

**Note module : Identité/persistance 9/10 · Câblage runtime 2/6 consumers · Fidélité UI↔réalité 4/10 (badges trompeurs).**

---

## ✅ Corrections appliquées & vérifiées (2026-06-30)

Passe de correction ciblée (**UI honnête + audit + anti-fantôme**), **sans** câbler Dashboard/KPI/Audit runtime. Tous gates verts : `npm test` **247/247** · `check:schema` **OK** · `e2e:regression` **23/23** · baseline DB **0/0** après test.

| # | Correctif | Fichier(s) | Vérif |
|---|---|---|---|
| 1 | **Audit de `saveEventConfig` réparé** — `entity_id` = UUID de l'acteur (nil-uuid en fallback) au lieu de `event_config:<key>` → chaque modif de registre crée une ligne `events`. `bestEffort` conservé (le save n'est jamais bloqué) ; `emitEvent` log toujours en cas d'échec (trace dev). | `admin/events/actions.ts` | [V] ligne `events` créée : `"Event registry: client.deleted configuration updated"`, `entity_id` UUID valide |
| 2 | **Badge Audit `live`→`described`** + descriptions honnêtes (dashboard/kpi/audit = « STORED ONLY — not consumed yet »). | `lib/event-registry.ts` | [V] index affiche `described` + caption « Today only Notification is live » |
| 3 | **Micro-textes explicites** sur la page Configure (notif enforced ; dashboard/kpi/audit stored-not-consumed ; enabled/severity/requires-action stored-only). | `admin/events/[eventKey]/page.tsx` | [V] 6 textes présents |
| 4 | **`note.added` retiré** du registre (union `EventType` + 3 maps `Record<EventType>` + label page projet) — event fantôme éliminé. | `lib/events-shared.ts`, `lib/events.ts`, `lib/notification-catalog.ts`, `projects/[id]/page.tsx` | [V] index « **64 events** », « Note added » absent |
| 5 | **Note Admin vs Super admin** sur la page Configure. | `admin/events/[eventKey]/page.tsx` | [V] « separate notification channels… » présent |
| — | **Notification non régressée** | — | [V] `pr.* sales=off` → cloche Sales : items absents |

**Restant (non fait volontairement)** : câblage runtime Dashboard/KPI/Audit (= Étape 2). Les badges disent désormais la vérité ; le câblage reste à faire. Modifs **non commitées** (cohérent avec la WIP de `freeze/core-metier`).

---

## 1. Cartographie technique (Phase 1)

| Élément | Emplacement |
|---|---|
| Déclaration des 65 events (union figée) | `lib/events-shared.ts` (`EventType`) — **code** |
| Identité de référence (label/catégorie/severity-miroir) | `lib/notification-catalog.ts` (`NOTIFICATION_CATALOG`) |
| Severity **autoritaire** (stampée à l'emit) | `lib/events.ts` (`DEFAULT_SEVERITY`) → `emitEvent()` |
| Defaults | = catalogue code (aucune ligne DB) |
| Overrides (m136, **appliquée**) | tables `event_catalog_overrides` (identité) + `event_routing` (consumer×rôle) |
| Écriture overrides | `app/(app)/admin/events/actions.ts` (`saveEventConfig`) |
| **Lecture cloche (seul lecteur runtime)** | `lib/notifications.ts` (`loadNotificationRules` → `event_routing` où `consumer='notification'`, `role=<rôle>`) |

**65 events** confirmés [V], 7 catégories (production 8 · money 9 · shipping 4 · workflow 20 · bookkeeping 8 · crm 13 · governance 3).

### Tableau de vérité des consumers

| Consumer / champ | Badge UI | Persisté | **Lu au runtime** | Effet réel |
|---|---|:--:|:--:|---|
| **Notification** (bell/feed/off par rôle) | `live` | ✅ | ✅ **OUI** [V] | **RÉEL** — change la cloche d'un vrai rôle |
| **Audit** (Visible / Internal only) | `live` ⚠️ | ✅ | ❌ **NON** [C] | Aucun. « Internal only » ne cache rien |
| **Dashboard** (section + rôles) | `described` | ✅ | ❌ **NON** [C] | Aucun. Stocké, jamais projeté |
| **KPI / Counters** | `described` | ✅ | ❌ **NON** [C] | Aucun. Stocké, jamais agrégé |
| **Automations** | `reserved` | — | ❌ | Placeholder |
| Identity → **Severity** | — | ✅ | ❌ [C] | Affichage console only (emit = code) |
| Identity → **Enabled** | — | ✅ | ❌ [V] | Cosmétique (badge « disabled » index). N'empêche **pas** l'émission |
| Identity → **Requires action** | — | ✅ | ❌ [C] | Cosmétique (cloche = `eventRaisesBell`) |
| Identity → **Label/Icon/Desc** | — | ✅ | ⚠️ console only | N'apparaissent que sur `/admin/events` |

Preuve [C] : recherche exhaustive — seuls `lib/notifications.ts` (consumer='notification') + les 3 fichiers de la console touchent les 2 tables. Aucun dashboard / compteur / timeline d'audit ne les lit.

---

## 2. Résultats par phase

### Phase 2 — Defaults — **PASS** [V]
- `/admin/events` rend en 200 (login réel `testadmin@`), « 65 events », 7 catégories, clés techniques, badge `defaults` partout (tables vides). Zéro erreur JS / page blanche.
- 7 pages Configure rendent le formulaire complet (Identity 7 · Notification 7 rôles · Dashboard section+7 · KPI 4 · Audit · Automations · Save). Severities/catégories par défaut **exactes**.
- Clé inconnue → **404 propre** (pas de crash).

### Phase 3 — Override `client.deleted` + persistance + lecture — **PASS** [V]
- Override appliqué (label « Client deleted — QA TEST », icon 🧨, desc, severity critical, requires yes ; notif super/admin/dir/sales=bell, ops/tlm/finance=off ; dashboard super/admin/dir/sales).
- **Persistance DB exacte** : `event_catalog_overrides` 1 row (`category:null, severity:null` car = baseline → **override-only model OK**), `event_routing` 11 rows (7 notif + 4 dashboard).
- **Index bascule `defaults` → `overrides`** : affiche « 🧨 Client deleted — QA TEST » + icônes consumers.
- **Lecture notif live PROUVÉE par A/B sur la vraie cloche Sales** : avec `pr.quotation_generated`/`pr.ready_for_pricing` passés à `sales=off`, ces items **disparaissent** de la cloche Sales (les autres restent). → la cloche lit bien `event_routing` par rôle. Captures : `e2e/.runs/drive-sales/bell-sales-after-create.png` (avant) vs `bell-sales-after-off.png` (après). **Confirmé aussi sur le vrai Super admin** (`mzouai@`) : `super_admin=off` retire les items de SA cloche **sans** affecter celle d'un admin → canaux `admin`/`super_admin` séparés (`drive-superadmin/sa-bell-{before,after}.png`).

### Phase 4 — `enabled=false` — **emission NON bloquée** [V]
- `note.added` est **non déclenchable** (event fantôme, cf. §3.4) → test mené sur `client.created` (émis par la création de client).
- `client.created` mis à `enabled=false`, puis **création réelle d'un client par un vrai Sales** → l'event `client.created` **est bien inséré** dans `events` (`created_at 16:44:10`, vu par admin/operations sees-all). **Conclusion : `enabled=false` ne bloque pas l'émission** (et ne masque pas la cloche). C'est une décision produit à clarifier : aujourd'hui, désactiver un event = purement cosmétique.

### Phases 5 & 6 — réinterprétées
La matrice de routage attendue (notif/dashboard/KPI/audit par rôle) **ne peut être validée que pour la Notification** : c'est le seul consumer câblé. Le routage notif peut être posé **exactement** comme spécifié (il persiste et est lu) ; les volets Dashboard/KPI/Audit de la même spec **n'ont aucun effet runtime**. Le drive complet des 65 events sur 6 rôles (Phase 6) a été écarté d'un commun accord (il re-prouverait le pipeline, pas le registre).

---

## 3. BUGS / INCOHÉRENCES / TROUS FONCTIONNELS

1. 🔴 **5/6 consumers + 4 champs d'identité non câblés** — Dashboard, KPI, visibilité Audit, Severity, Enabled, Requires action sont configurables mais **sans effet**. Écart majeur entre ce que l'UI promet et ce qui agit. *(décision assumée « Étape 1 », mais invisible pour l'utilisateur de la console.)*
2. 🔴 **Badge `live` sur Audit trompeur** — il signifie « l'event est toujours audité » (vrai), pas « le toggle Visible/Internal marche » (faux : aucun lecteur). Une config « Internal only » laisse l'event pleinement visible dans toutes les timelines.
3. 🟠 **L'audit de la config elle-même est cassé** — `saveEventConfig` tente d'émettre `admin.permissions_changed` avec `entity_id:"event_config:<key>"` (non-UUID) → rejeté **22P02** (`events.entity_id uuid not null`, m022) → avalé par `bestEffort:true` → **aucune trace d'un changement de config**. Ironique pour un module de gouvernance.
4. 🟠 **`note.added` = event fantôme** — déclaré + configurable dans le registre, mais **jamais émis** (vérifié exhaustivement ; les « notes » de la cloche viennent de `entity_messages`, système distinct). *(Les autres « orphelins » apparents — tl.validated, doc.won, pr.won… — sont émis dynamiquement via un helper statut→event ; non fantômes.)*
5. 🟡 **« Super admin » & « Admin » = canaux SÉPARÉS** [V — vrai login `mzouai@`] — `getCurrentUserRole()` **virtualise** le rôle (`super_admin` si le booléen est vrai, `lib/auth.ts:43`), donc la cloche d'un vrai super_admin lit bien les lignes `role='super_admin'` : **la colonne fonctionne** (prouvé — `super_admin=off` retire les items de la cloche de `mzouai@`, sans toucher celle d'un admin). *Nuance UX à connaître* : configurer « Admin » **ne couvre PAS** l'owner (super_admin), et inversement — un opérateur peut croire que « Admin » vaut pour tous les admins. *(Hypothèse initiale « colonne jamais lue » → infirmée par le test réel.)*
6. 🟡 **Rôles personnalisés non supportés** — enum figé `{admin, sales, task_list_manager, operations, finance, sales_director}` + booléen `super_admin`. Impossible de créer *Sales Junior, Sales Senior, Operations Manager, Finance Viewer/Manager, Task List Reviewer, Read Only Auditor* (la RPC `admin_set_user_role` rejette toute valeur hors enum).
7. 🟡 **Interaction RLS = plafond (piège de config)** — router un canal vers un (event, rôle) que la RLS masque est **sans effet**. Prouvé : un Sales ne voit pas le `client.created` de son **propre** client neuf (m092 exige un document liant le rôle au client). Pas un bug, mais à signaler dans l'UI (sinon « j'ai mis bell pour Sales et il ne reçoit rien »).
8. 🟡 **Severity / Enabled / Requires action présentés comme configurables** alors qu'ils sont display-only / non appliqués. Un petit libellé l'indique pour Severity ; rien pour Enabled/Requires action.
9. ⚪ **UX mineure** — après Save, le bouton reste sur « Saving… » ~2-3 s (redirect serveur lent) ; et le modal « New client » reste ouvert après création réussie.

---

## 4. CE QUI MARCHE BIEN

- **Notification per-rôle** : lecture live prouvée (A/B), modèle **override-only** propre (seul le non-baseline est stocké ; tout-baseline ⇒ ligne supprimée), persistance DB exacte, clean-slate par event.
- **Defaults = comportement legacy** (tables vides ⇒ identique à avant m136).
- **404** sur clé inconnue, **filet « tables missing »** (bandeau si m136 absente), garde **admin-only** (RLS write = admin/super_admin).
- **Robustesse** : 0 erreur JS sur 8 pages Configure + index, formulaire générique piloté par le descripteur `CONSUMERS`.

---

## 5. RECOMMANDATIONS (priorisées)

**P0 — cohérence & confiance**
- **Fixer l'audit-emit** (§3.3) : UUID valide (`crypto.randomUUID()`) ou un `entity_type` dédié `event_config` — sinon les changements de gouvernance ne sont pas tracés.
- **Aligner les badges sur la réalité** : passer **Audit/Dashboard/KPI en `described`** tant qu'ils ne sont pas lus (et marquer Severity/Enabled/Requires action « display-only / not enforced yet »). Évite que l'admin croie configurer ce qui n'agit pas.

**P1 — câblage (la vraie valeur du module)**
- **Étape 2 : câbler 1 consumer d'état** (Today's Work / At Risk) comme 2ᵉ abonné réel — déjà la prochaine étape prévue. Le plus rapide à rendre réel est sans doute **Audit** (1 filtre de visibilité sur les timelines).
- **Désambiguïser `super_admin`** (le retirer de la grille, ou router via le flag).
- **Cohérence catalogue** : émettre `note.added` (sur ajout d'`entity_messages`) **ou** le retirer du registre.

**P2**
- **Documenter dans l'UI l'interaction RLS = plafond** (un event non visible par un rôle ne peut pas lui être notifié).
- **Rôles custom** (si réellement voulus) = chantier structurant (enum `role` → table de rôles + capacités) — gros, à arbitrer séparément.

---

## 6. Blockers de la spec QA (transparence)

- **Super admin réel : TESTÉ** [V] — login réel `mzouai@` (super_admin) : la colonne « Super admin » est bien lue par sa cloche, et **séparée** du canal « Admin » (cf. §3.5). Session owner effacée du disque après test (`e2e/.auth/superadmin.json` supprimé) ; email ajouté à `.env.e2e` (gitignored) pour les tests futurs — à retirer si tu préfères.
- **Rôles custom** : non créables (cf. §3.6).
- **Phase 6 (drive des 65 events)** : écartée d'un commun accord (faible signal sur le registre).

## 7. Artefacts
- Scénarios : `e2e/.runs/steps/qa-evt-*.json` · Captures : `e2e/.runs/drive-{admin,sales}/*.png` · Cleanup : `e2e/audit/qa-evt-cleanup.ts`.
- Round-trip DB vérifié sous vrai JWT via `e2e/audit/q.ts`.
