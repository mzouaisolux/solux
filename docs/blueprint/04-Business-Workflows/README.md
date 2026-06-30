# 04 — Workflows métier

> Chaque workflow est fourni en **3 formes** : diagramme **Mermaid**, **tableau** des transitions, et **explication en français clair**.
> Pour chaque transition : rôle responsable, déclencheur, validations, conditions, actions, événements, changement de propriétaire.

## Liste des workflows

| Workflow | Fichier | Objet pivot |
|---|---|---|
| Pipeline de bout en bout | [end-to-end-pipeline.md](end-to-end-pipeline.md) | toute la chaîne |
| Cycle de vie du Devis | [quotation-lifecycle.md](quotation-lifecycle.md) | Quotation |
| Launch Production (devis → proforma + task list) | [launch-production.md](launch-production.md) | Quotation → Proforma |
| Validation & révision de Task List | [task-list-validation.md](task-list-validation.md) | Task List |
| Cycle de vie du Production Order | [production-order-lifecycle.md](production-order-lifecycle.md) | Production Order |
| Cycle de vie du Service Request | [service-request-lifecycle.md](service-request-lifecycle.md) | Service Request |
| Flux Dépôt → Production | [payment-deposit-flow.md](payment-deposit-flow.md) | Paiement |
| Demande d'info BL (Ops ↔ Sales) | [bl-info-request-flow.md](bl-info-request-flow.md) | Production Order / Client |

## Convention de lecture
- **Rôle responsable** = qui déclenche la transition (capability requise).
- **Événement** = ce qui est inscrit dans le journal `events` (voir [../08-Events.md](../08-Events.md)).
- **Changement de propriétaire** = la plupart des transitions n'en provoquent **aucun** ; les exceptions sont signalées.
- Les diagrammes Mermaid s'affichent sur GitHub et la plupart des viewers Markdown.
</content>
