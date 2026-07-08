# Attachments orphelins — inventaire du 2026-07-08

Contexte : bug « documents disparus des affaires » (rapport owner, OIM Malanville).
La convention d'ancrage de `attachments.affair_id` a changé (racine de chaîne
documentaire → vraie `affairs.id`). Le fix app-side fait matcher toutes les
conventions, et m156 backfille les lignes résolubles.

**Restent 8 ancres (15 fichiers) NON résolubles** : leur document d'ancrage a été
supprimé avant tout lien avec une affaire. Aucune jointure ne permet de retrouver
l'affaire automatiquement. Ils ne sont perdus ni en base ni en Storage — ils ne
sont juste rattachés à aucune affaire visible.

| Ancre (8 hex) | Fichiers | Piste manuelle |
|---|---|---|
| `63cb0c2c` | Screenshot 2026-05-23 21.44.47.png · Screenshot 2026-05-25 15.55.59.png | screenshots d'essai (mai) |
| `b73be4c8` | Screenshot 2026-05-25 16.38.14.png · SLX JD_Revenue & Sales Operations Manager.pdf | RH / essai |
| `52456326` | Panneau Solaire 285W.pdf · PLAN MAT.pdf | même paire que `e46d585b` — projet mât 285W |
| `e46d585b` | PLAN MAT.pdf · Panneau Solaire 285W.pdf · Screenshot 2026-05-28 15.47.27.png | idem |
| `4a78cc28` | SP8M4D-300X300X16-200X114-60X750-TZ241220001A1-Layout1.pdf · NEM285PD15 8 angles - SSLXPRO 100/120 - 285W.pdf | drawings mât + panneau 285W |
| `85fde86c` | QUOTATION_AFRICA_ENERGY_SARL_TEST_1_FADEL.pdf | devis TEST (Fadel) |
| `68f12dac` | SOLUX I Spec Sheet I SSLX Pro 80-EN.pdf | fiche catalogue |
| `198759ea` | SP8MD-300X300X16-200X89X3.5-60X750-0-TZ251008041.pdf · SOLUX I Fiche Technique I SSLX Perf 80-FR (Top).pdf | mêmes fichiers ré-uploadés sur OIM Malanville le 2026-07-06 (ancre `40352bf8`, résolue) — doublons probables |

Réassignation manuelle possible (admin, DML simple) :

```sql
update attachments set affair_id = '<affairs.id>' where affair_id = '<ancre complète>';
```

Garde-fou ajouté pour l'avenir : la suppression d'un document ne supprime pas
ses attachments (pas de FK), mais l'écriture ancre désormais sur la vraie
`affairs.id` (post-m156), qui survit à la suppression de n'importe quel document.
