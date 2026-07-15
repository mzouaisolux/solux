# Analyse des fichiers sources — Module Packing List

> Analyse préalable exigée (section 26). Aucun code métier écrit avant validation de l'architecture.
> Originaux préservés (SHA-256) dans `originals/` :
> - `packing_list_all.xlsx` → `0c021d04…4a7b`
> - `Packing_List_Calculation.docx` → `80b2e186…03b9`

---

## 1. Structure de l'Excel `packing list all.xlsx`

- **1 seule feuille** : `产品数据` (« Données produits »). Auteur fichier : « Shirley » (fournisseur usine).
- **Plage** : `A1:O161` → 2 lignes d'en-tête + **160 lignes de données** (ligne 3 à 161).
- **45 fichiers image** embarqués, **57 ancrages** (des variantes partagent la même image).

### Colonnes (en-têtes fusionnés sur 2 lignes)

| Col | En-tête | Contenu réel | Remarque |
|-----|---------|--------------|----------|
| A | Product No. | Référence **+** nom mélangés | ⚠️ PAS un ID fiable ni unique |
| B | Picture | Image **OU** texte de variante | Surchargée : « 60W », « 100W », « for PL(M16) », « M24 », « ONLY FOR SSLXPRO » |
| C / D / E | Inner Carton Size (mm) | L / W / H carton individuel | |
| F / G / H | Outside Carton Size | L / W / H carton maître | Vide pour ~60 % des lignes |
| I | Packing Method | « 4pcs/carton », « 1pc/carton », « 1pcs », « 1set », « 1pcs (WITH ANCHOR)» | Encode la **qté / carton maître** |
| J | Net Wet. (kgs) | Poids net | Parfois manquant |
| K | Gross Wet. | Poids brut | ⚠️ parfois **2 valeurs** « 4.6/24.45 » |
| L | VolumeWeight (inner) | = CBM_inner × 200 | **calculé** |
| M | Volume (inner) | = C·D·E / 1e9 (CBM) | **calculé** |
| N | VolumeWeight (outside) | = CBM_outside × 200 | **calculé** |
| O | Volume (outside) | = F·G·H / 1e9 (CBM) | **calculé** |

## 2. Formules (77)

- `M = C·D·E / 1000000000` → CBM carton intérieur
- `L = C·D·E / 1000000000 * 1000 / 5` → **CBM × 200** = poids volumétrique
- `O = F·G·H / 1000000000` → CBM carton extérieur
- `N = G·H·F / 1000000000 * 1000 / 5` → CBM × 200
- 1 anomalie : `J83 = 6.044 - 0.872` (poids net saisi comme soustraction manuelle).

➡️ **Facteur volumétrique = 200 (= 1000/5). À rendre configurable** (exigence §7).
➡️ **CBM = L×W×H / 1 000 000 000** confirmé (dimensions en mm).

## 3. Images

- 45 fichiers (`xl/media/image1..45`), ancrés colonne B, mappés par n° de ligne.
- **Images partagées** entre variantes : `image18`→AOS40…100 ; `image44`→VDL80…100 ; `image26`→OPTI20…40 ; `image17`→AOS15/20.
- `image39.png` apparaît **3× en superposition** (badge/pictogramme, pas une photo produit) → à ne pas importer comme photo.
- Lignes **sans ancrage** (ex. B021 80/100/120cm) → image à assigner manuellement (rapport d'import).
- `image28.jpeg` = 1,3 Mo (SLK15) — à compresser en vignette.

## 4. Lignes vides & relations implicites (candidats Packaging BOM)

Un produit commercial = plusieurs colis physiques. Relations détectées (à importer **« Needs validation »**) :

- **Paires HEAD + POLE** : SGL-013, SGL-001, SGL-002, SGL021, PL004, PL005, PL006, PL007, PL008, PL009.
- **Produits multi-lignes** (colonne A vide sur lignes suivantes) :
  - `TOTEM+20 DUAL` = lignes 109-110-111 (corps + 2 sous-colis)
  - `TOTEM+40` = 112-113-114 ; `TOTEM+20` = 115-116-117
- **Variantes** (col A vide, variante en col B) : `SSLXPRO SERIES HEAD` 60W (l.87) / 100W (l.88).
- **Ensembles HEAD/ARM/panneau** : COLPRO20 (HEAD/corps/ARM l.96-98), COLPRO40 (l.99-101).
- **Accessoires/quincaillerie** (bas de tableau, variantes M16/M24 en col B) : ANCHOR, ARM, BOLT, PLATE, CAP NUT, SCREW.

⚠️ Exigence §5/§28 : **ne pas déduire les BOM uniquement de l'adjacence** → importés comme *propositions* à confirmer.

## 5. Doublons & incohérences (→ page Import Issues)

- **Noms non uniques** : « ANCHOR » (l.103,105,149-152), « new pole/NEW POLE » (l.46,51,53,57), « COLARSUN HEAD » ×2 (l.145 H=180 / l.146 H=295, packing différent), « AOS PERF 80 » ×3 (l.137/139/138).
- **Dimension suspecte** : l.14 `B005/SL-005 120CM` → **C = 1 mm** (aberrant, ~1200 attendu).
- **Symbole Φ** (diamètre, pas L×W) : « NEW POLE Φ340 » (l.46), « new pole Φ330 » (l.51,53,57).
- **2 poids dans une cellule** : K10 « 4.6/24.45 », K17 « 5.6/24 », K28 « 7.9/35.35 ».
- **Carton extérieur manquant** : ~60 % des lignes (poteaux, panneaux) → colis unique.
- **Poids manquants** : l.24 (VDL-65CM), l.43 (PL004 POLE vide), plusieurs quincailleries.
- **Poteaux / hors-gabarit** : longueur stockée en E ou H (2100…3300 mm) → flag *lamp-pole / oversized*.
- **Ligne 13** `B005/SL-005(100CM)` a O=0 et N=0 (division par carton extérieur vide).

## 6. Méthodologie Word → règles formelles

| Élément | Valeur initiale (éditable + versionnée) |
|---|---|
| **20GP** interne | 5800 × 2300 × 2300 mm ; plage 15–28 CBM |
| **40HQ** interne | 11800 × 2300 × 2600 mm ; plage 28–68 CBM ; **poteaux > 5,5 m ⇒ 40HQ imposé** |
| **40GP** | ⚠️ non documenté → créer le type, **règles marquées « À valider »**, ne rien inventer |
| **LCL** | palettes 1700×1140 / 1700×1350 / 1350×1350 / 1000×1200 / 800×1200 / 700×1350 ; hauteur gerbage ≤ 2100 mm |
| Chargement | couche 1 = debout (plus grand côté vertical) ; couche 2 = couché ; couche 3 = à plat / accessoires |
| Caisses bois poteaux | qté/niveau, niveaux, max/caisse (exemples ci-dessous) |
| Caisse Totem | fixe 420×320 mm, disposition alternée |

**Exemples poteaux (profils initiaux) :**
| Conteneur | Poteau | Bride | pcs/niveau | niveaux max | max/caisse | Contrôle |
|---|---|---|---|---|---|---|
| 40HQ | 8 m | 300 mm | 16 (8+8) | 9 | **150** | ⚠️ 16×9 = **144 ≠ 150** → à flaguer (§15) |
| 40HQ | 8 m | 320 mm | 15 (7+8) | 8 | 120 | 15×8 = 120 ✓ |
| 40HQ | 8 m | 400 mm | 14 (7+7) | 7–8 | 110 | 14×8 = 112 ≈ 110 |
| 20GP | 3,5 m | 280 mm | 18 (9+9) | 9 | 162 | 18×9 = 162 ✓ |

Formules caisse (reverse-calc) : largeur = f(2300, pcs/rangée, jeu 20-50 mm, planche 100 mm) ; longueur = poteau + 200 mm + 100 mm ; hauteur = f(2600, niveaux, +150 mm ancres/bras, +180 mm planche).

## 7. Questions métier non résolues (à trancher par Operations)

1. « 4pcs/carton » = 4 pièces / carton **extérieur** (1 pièce / carton intérieur) ? → hypothèse retenue.
2. K « 4.6/24.45 » = poids brut **unité / carton maître** ? sens exact à confirmer.
3. Traitement des cartons incomplets : arrondi supérieur au carton, ou cartons individuels résiduels ? (§11 → **configurable**, hypothèse : reste en cartons individuels).
4. Facteur volumétrique 200 : par air/mer/transporteur ? (config globale + surcharge).
5. Poteau > 5,5 m ⇒ 40HQ : et poteaux 3,3 m en 20GP autorisés ?
6. Incohérence 150 pcs/caisse (bride 300) : 144 ou 150 ? source de validation ?
7. Règles 40GP : à fournir par Operations.
8. Colonne B « 60W/100W » = variantes de puissance → dimension produit distincte ?
9. Marge de sécurité conteneur (safety margin) par défaut ? (ex. 90 % du CBM utile).
10. Quincaillerie (bolt/nut/screw) : colis propre ou incluse dans un colis parent ?

## 8. Schéma de base proposé (résumé)

**Master data (versionné, jamais écrasé) :**
- `packaging_import` (fichier original binaire, date, user, nom, version, nb lignes, rapport)
- `packaging_item` (identité produit stable `id`, ref, nom, famille, variante, composant, type, statut, image_id, statut de vérification)
- `packaging_item_version` (toutes les infos packaging §3, `valid_from`, statut Draft/NeedsValidation/Validated/Deprecated/Archived, calculés vs saisis, overrides + raison)
- `packaging_field_change` (audit champ par champ : old/new, %, user, date, source, raison)
- `packaging_bom` + `packaging_bom_line` (produit vendable → composants, qté, obligatoire, option, valid_from, version, « Needs validation »)
- `import_issue` (ligne, valeur brute, problème, interprétation proposée, statut, valeur corrigée, par, date)
- `product_image` (binaire/chemin, source, ligne d'origine, assignation manuelle)

**Config versionnée :**
- `container_type` (LCL/20GP/40GP/40HQ : L/W/H int., portes, CBM théorique/utile, charge max, marge, actif, notes)
- `packing_rule` (nom, produit/famille, conteneur, dims, orientation, couches max, réserve accessoires, priorité, valid_from, actif, statut validation)
- `pole_profile` (réf, longueur, ⌀ haut/bas, bride, platine, poids, pcs/niveau, niveaux max, alterné, caisse LxWxH+tare, bras/ancres inclus, conteneurs compatibles, capacité validée, source)
- `calc_config` (facteur volumétrique, politique arrondi cartons, marges…)

**Calculs (immutables, snapshot) :**
- `packing_calculation` (réf, source_type/id, client/projet/incoterm, statut « Auto-calculated — review required », résultat auto vs ajusté, validation user/date/notes)
- `packing_calculation_line`, `packing_package` (colis générés)
- `packing_calculation_snapshot` (versions master data utilisées → figées §9/§24)
- `packing_template` (config validée réutilisable, versionnée)

## 9. Architecture standalone → prête ERP

```
lib/packing-core/           ← MOTEUR PUR (zéro dépendance UI/DB) — réutilisable ERP tel quel
  cbm.ts                    ← CBM, poids volumétrique (facteur injecté)
  carton.ts                 ← cartons complets/incomplets, colis, poids
  container.ts              ← reco LCL/20GP/40GP/40HQ (volume + marge)
  pole.ts                   ← profils poteaux / caisses bois
  rules-engine.ts           ← règles de chargement configurables
  types.ts                  ← contrat E/S (JSON §19)
  index.ts  → calculatePackingList(input): PackingResult   ← 1 point d'entrée
lib/db/                     ← couche repository (SQLite standalone → Postgres/Supabase ERP)
app/                        ← pages Next.js (Library, Calculator, Import, History…)
data/import/                ← originaux + images extraites
tests/                      ← Vitest (14 cas exigés §27)
docs/                       ← analyse, rapport import, règles non résolues
```

**Contrat moteur (§19)** : `calculatePackingList({source_type, source_id, items[]}) → {packages, total_*, container_recommendations, warnings, requires_operations_validation, packaging_versions_used}` — **identique standalone et ERP**.

**Points d'intégration ERP futurs** : Sales Project Request, Packing List Request, Transport Request, Proforma, Quotation, Order, Factory prep → tous appellent le **même** `calculatePackingList()`, seul le repository (Supabase) change.
