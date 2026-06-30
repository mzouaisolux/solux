# Carte — Sécurité & Visibilité

## 1. Les deux couches de sécurité

```mermaid
flowchart TB
    User[Utilisateur authentifié JWT] --> Page[Page / Server Action]
    Page --> CapCheck{requireCapability<br/>rôle RÉEL}
    CapCheck -->|refusé| Deny[AccessDenied / throw]
    CapCheck -->|autorisé| Mutation[Mutation]
    Mutation --> RLS{RLS PostgreSQL<br/>quelles lignes ?}
    RLS -->|policy KO| Empty[0 ligne / 42501]
    RLS -->|policy OK| Data[(Données filtrées)]
    note1[Capabilities = quelles ACTIONS<br/>app-level, contournable en SQL direct]
    note2[RLS = quelles LIGNES<br/>base-level, inviolable]
    CapCheck -.- note1
    RLS -.- note2
```

## 2. Résolution du rôle (réel vs effectif)

```mermaid
flowchart LR
    JWT[JWT Supabase] --> Real[getCurrentUserRole<br/>= rôle RÉEL]
    Real -->|super_admin ?| ViewAs{cookie View-As ?}
    ViewAs -->|oui + super_admin| Eff[getEffectiveRole<br/>= rôle simulé]
    ViewAs -->|non| Eff2[getEffectiveRole = réel]
    Real --> Sec[Sécurité: requireCapability]
    Eff --> Render[Rendu UI: hasUiCapability / Nav]
    note1[View-As change le RENDU seulement.<br/>RLS + actions = rôle RÉEL du super_admin.]
    Eff -.- note1
```

## 3. Moteur de visibilité (`getVisibilityScope`)

```mermaid
flowchart TD
    U[Utilisateur] --> G{access_grants ?}
    G -->|aucun grant| FB{rôle ?}
    FB -->|technique OU canSupervise| ALL[scope = all]
    FB -->|sinon| SELF[scope = own-only]
    G -->|grants présents| UN[UNION des grants]
    UN --> SC[self / team / region / lens / all]
    SC --> Filter[Filtrage des listes par owner/lens]
    ALL --> Filter
    SELF --> Filter
```

## 4. Matrice synthétique des accès aux routes

| Route | sales | dir | tlm | ops | finance | admin | super |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Dashboard, Clients, Projects, Task Lists, Orders | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Prospects | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Finance | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Cost Entry | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Admin master-data | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ |
| Users / Permissions / Diagnostics | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |

> ✅ = page atteignable (la donnée reste filtrée par RLS). Détail + RLS par table : [../07-Roles-and-Permissions.md](../07-Roles-and-Permissions.md).

## 5. Points de vigilance sécurité (rappel)
- **View-As invalide les conclusions** de sécurité/visibilité (RLS = JWT admin) — tester avec de vrais logins.
- La **matrice live peut diverger du seed** (priv-esc TLM résolu 2026-06-20) — recouper avec la base.
- Certaines gardes métier sont **applicatives** (proforma-not-won, H1/H2) — un UPDATE SQL direct les contournerait ; les **cascades** restent garanties par trigger.
- **Matrice vs RLS** parfois non alignées (capabilities déléguées mais RLS plus strictes).
</content>
