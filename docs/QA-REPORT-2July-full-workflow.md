# Rapport QA — Test workflow réel complet « Full real-user workflow test — 2 July »

**Méthode :** comptes réels, vraies sessions JWT par rôle (login/logout réels via Playwright headless), **jamais** en « View As ». 6 rôles réels : `testsales@`, `testdir@` (sales_director), `testoperation@`, `testlm@` (task_list_manager) + console Factory Mapping. Chaque étape : capture DOM (labels, champs, obligatoires, boutons, alertes) + screenshots pleine page.

**Objet créé :** Client **Test du 2 July** (code **TJY**) → SR **Eclairage Paris 2 July** → Devis **SLX-TJY-26-001** → Task list **PTL-SLX-TJY-26-002** → Commande **PO-SLX-TJY-26-002**.

> ⚠️ Écart de scénario assumé : le brief demandait de créer le client « Test du 29 juin », **mais ce nom existe déjà 2 fois** dans le système (doublons) et rejoue le risque connu de crash `client_code` en doublon. J'ai donc créé un client daté unique « **Test du 2 July** » (code TJY) et je le signale comme problème d'hygiène de données.

---

## A. Résumé exécutif

- **Le workflow complet fonctionne de bout en bout** — les 9 étapes ont abouti à une **commande de production réelle** (PO-SLX-TJY-26-002, « Awaiting deposit », acompte 11 009,40 $ = 30 % de 36 698 $). **Aucun blocage définitif.**
- **Intégrité des données : parfaite** sur toute la chaîne (config produit, mâts, transport Paris, marges, montants, liens devis↔task list↔commande).
- **Qualité UX globale : élevée.** Design SOLUX cohérent, steppers de statut clairs par entité, tableaux de bord « action-first » qui remontent très bien à chaque rôle ce qui l'attend, validations inline pertinentes, écrans de récapitulatif avant soumission, calculateur de marge live excellent.

**Principaux problèmes UX**
1. Une **demande de modification** du Directeur renvoie la SR au statut **« Draft »** — pas de statut distinct « Modifications demandées ». Côté Sales, la SR se confond avec un brouillon ordinaire (risque de rater le message).
2. Le message de modif du Directeur **n'apparaît pas dans l'assistant d'édition** — le Sales édite « à l'aveugle ».
3. Cartes **« PACKING LIST not requested / FREIGHT COST not requested »** affichées alors que l'en-tête dit « Requested: Cost · Packing · Freight » → **contradiction sur la même page** (risque : croire que le transport n'a pas été demandé).
4. **Tableau de bord Operations ne remonte pas** la SR à chiffrer (aucune carte « SR à coûter ») — risque que le chiffrage ne démarre jamais.
5. **Écart de vocabulaire SR → task list** : specs libres (« Panel 120Wp », « Battery 12.8V 100Ah », « MPPT 20A ») vs listes déroulantes catalogue (Wh, SKU chinois) sans correspondance → **risque de mauvaise config de production**. En plus, **Optic\*/CCT\*** sont obligatoires en task list mais jamais demandés en amont.

**Principaux bugs fonctionnels**
1. **[HIGH — à revérifier manuellement]** L'enregistrement **inline** d'une instruction usine sur la task list (« Save · Order only / For client ») **n'a pas persisté** dans mon test automatisé (affichage optimiste « THIS ORDER » puis retour à « MISSING » au rechargement). La console **globale** persiste, elle, sans souci.
2. **[MED]** Cliquer **« Validate → »** quand des mappings manquent **ne renvoie aucun feedback** (le bouton ne fait rien, la raison est seulement dans le bandeau au-dessus).
3. **[MED]** Le **bandeau « Not ready — N items » n'est pas réactif** (il affichait 2 pendant que le compteur inline affichait 1).
4. **[LOW/BUG]** Liste **Controller** avec une **option en double** (EH120…×2), présente aussi bien dans la task list que dans la console de mapping.
5. **[LOW]** Timeline du **document devis** affiche l'acteur comme fragment d'UUID « a5e93040 » au lieu de « Sam Sales » (les logs SR affichent bien les noms).

**Correctifs prioritaires** (détaillés en G) : (1) vérifier/fixer la persistance du save inline factory ; (2) statut « Modifications demandées » distinct + badge côté Sales ; (3) corriger le libellé « not requested » ; (4) remonter les SR à chiffrer sur le dashboard Operations ; (5) pont de correspondance specs SR → options task list (+ rendre Optic/CCT capturables en amont).

---

## B. Journal de test étape par étape

| # | Rôle / compte | Action | Résultat attendu | Résultat réel | Verdict |
|---|---|---|---|---|---|
| 1 | Sales `testsales@` | Créer client + SR (devis lambda + mâts + produit + transport Paris) puis soumettre | SR soumise pour approbation | Client TJY créé (redirect + toast « ✓ Client created »). SR « Eclairage Paris 2 July » créée (SSLXPRO, mâts 150/8m/1,5m, Product+Packing+Freight Sea→Paris) → **Waiting director review** | **PASS** |
| 2 | Directeur `testdir@` | Ouvrir SR, revoir, renvoyer une demande de modif | Modif renvoyée à Sales, message visible | Dashboard « SERVICE REQUESTS TO APPROVE » → « Request info » avec message attribué « Changes requested by Dana Director: … » + activité loguée | **PASS** |
| 3 | Sales | Ouvrir la SR à modifier, modifier, resoumettre | Resoumission au Directeur | Bannière « Changes requested by … » sur le détail ; édition (finition mâts + note réponse) ; Save → Submit → **Waiting director review**. Données préservées | **PASS** (voir frictions) |
| 4 | Directeur | Revoir la SR modifiée, envoyer à Operations | Statut → Operations | « Send to Operations » (cases Factory/Packing/Freight) → **Operations in progress** | **PASS** |
| 5 | Operations `testoperation@` | Saisir prix produit + prix transport Paris, soumettre | Coûts saisis, retour Directeur | Factory cost 850/320 RMB → Packing 2×40HQ/130 CBM → Freight Sea·CFR·Paris 2×40HQ @2 800 $ = **5 600 $** → auto **Ready for pricing** | **PASS** |
| 6 | Directeur | Ouvrir la réponse, valider le pricing, renvoyer Sales | Pricing validé, retour Sales | Calculateur marge live (Produit 30 %, Mât 12 %, Fret pass-through) → « Approve pricing » → **Priced** | **PASS** (voir « Start pricing » ci-dessous) |
| 7 | Sales | Générer le devis depuis la SR, marquer Sent puis Won | Devis correct, Sent/Won | Dashboard « READY TO GENERATE QUOTATION » → devis **SLX-TJY-26-001** (36 698 $) → **Sent** → confirm « Mark this quotation as WON? » → **Won** | **PASS** |
| 8 | Sales | Launch Production, remplir task list, soumettre au TLM | Task list soumise | « 🚀 Launch Production » → proforma + **PTL-SLX-TJY-26-002** ; config remplie ; « Submit for production validation » → **Under validation** | **PASS** (voir écart vocabulaire) |
| 9 | TLM `testlm@` | Valider task list + Factory Mapping + créer commande | Commande créée, données correctes | Gate « 2 factory mappings missing » ; résolution via console globale (persisté) ; **Validate → Release to Production** → **PO-SLX-TJY-26-002** (Awaiting deposit, acompte 11 009,40 $, liens devis+task list corrects) | **PASS** (save inline non persistant : à revérifier) |

Screenshots archivés (pleine page) pour chaque écran clé : dashboards par rôle, assistant SR 4 étapes, écran freight, config task list, panneau pricing, devis, task list TLM + gate factory mapping, éditeur de mapping, commande finale.

---

## C. Bugs

### C1 — Save inline « instruction usine » non persistant sur la task list
- **Sévérité : HIGH** (à revérifier manuellement — possiblement artefact d'automatisation)
- **Rôle : TLM** · **Étape 9**
- **Repro :** Task list `PTL-SLX-TJY-26-002` → onglet Factory instructions → sur une ligne « MISSING FACTORY MAPPING » (Battery = 1152Wh), taper une instruction → « Save · For client » (ou « Save · Order only ») → recharger la page.
- **Attendu :** l'instruction reste, le champ passe à « THIS ORDER / FOR CLIENT », le compteur « missing » décrémente durablement.
- **Réel :** affichage **optimiste** correct (« THIS ORDER », compteur 2→1) mais **retour à « MISSING » après rechargement** (même après attente de 4 s et rechargement dans la même session). La console **globale** (Configure → Save mapping) persiste parfaitement (compteur MAPPED 17→20). Le bandeau oriente pourtant l'utilisateur vers la voie inline **en premier** (« resolve on the lines below »).
- **Fix suggéré :** vérifier l'action serveur du save inline (order/client override) et son rechargement ; si confirmé, corriger la persistance ou masquer la voie inline tant qu'elle n'est pas fiable ; ajouter un toast de confirmation « Instruction enregistrée ».

### C2 — « Validate → » bloqué sans feedback
- **Sévérité : MEDIUM** · **Rôle : TLM** · **Étape 9**
- **Repro :** task list avec mappings manquants → cliquer « Validate → ».
- **Attendu :** message expliquant le blocage.
- **Réel :** rien ne se passe (bouton inerte), la seule explication est le bandeau au-dessus.
- **Fix :** au clic, afficher un toast « N mappings usine manquants — résolvez-les avant validation » et/ou désactiver visiblement le bouton avec tooltip.

### C3 — Bandeau « Not ready — N items » non réactif
- **Sévérité : MEDIUM** · **Rôle : TLM** · **Étape 9**
- **Réel :** après résolution d'un mapping, le compteur **inline** passe à « 1 MISSING » mais le **bandeau** en haut reste « 2 items ». Incohérence pendant la résolution.
- **Fix :** recalculer le bandeau de façon réactive (même source que le compteur inline).

### C4 — Cartes « PACKING LIST / FREIGHT COST not requested » contredisant l'en-tête
- **Sévérité : MEDIUM** · **Rôles : Sales, Directeur** · **Étapes 1–4**
- **Repro :** détail SR (statut Draft/Waiting) alors que Packing + Freight ont été demandés.
- **Réel :** en-tête « Requested: Cost · Packing · Freight » + Freight Brief renseigné, **mais** cartes en bas « ② PACKING LIST — not requested », « ③ FREIGHT COST — not requested ». Cause : `app/(app)/projects/[id]/page.tsx:575/631/681` → `{x?.status ?? "not requested"}` (fallback quand l'enregistrement de coût n'existe pas encore). Commentaire dev à la ligne 260 reconnaît la tension.
- **Risque :** un lecteur (Directeur/Operations) peut croire que le **transport n'a pas été demandé** → l'oublier.
- **Fix :** remplacer le fallback par « En attente / Pending operations » (jamais « not requested » quand la demande existe).

### C5 — Option « Controller » en double
- **Sévérité : LOW** · **Rôles : Sales (task list), TLM** · **Étapes 8–9**
- **Réel :** « EH120-W-ES(MIRCOWAVE) &XLG-75-12A ( HYBRID ) » apparaît **deux fois** dans la liste Controller (task list + console mapping).
- **Fix :** dédoublonner l'option catalogue.

### C6 — Acteur affiché en fragment d'UUID sur la timeline du devis
- **Sévérité : LOW** · **Rôle : Sales** · **Étape 7**
- **Réel :** timeline du document → « sales · **a5e93040** · just now » au lieu de « Sam Sales » (les logs SR affichent bien les noms).
- **Fix :** résoudre l'acteur en nom d'affichage sur la timeline document.

### C7 — Deep-link `?new=1` n'ouvre pas la modale client
- **Sévérité : LOW** · **Rôle : Sales** · **Étape 1**
- **Réel :** `/clients?new=1` charge la page sans ouvrir la modale « New client » (il faut cliquer le bouton).
- **Fix :** honorer `?new=1` (ou retirer le paramètre documenté).

---

## D. Points d'amélioration UX

| Titre | Rôle | Où | Pourquoi c'est confus | Amélioration | Priorité |
|---|---|---|---|---|---|
| Pas de statut « Modifications demandées » | Sales/Dir | SR après « Request info » | La SR repasse « Draft » ; côté Sales elle se confond avec les autres brouillons sous « DRAFT SERVICE REQUESTS — SUBMIT OR EDIT » ; rien ne signale « le Directeur a demandé des changements » | Statut/badge dédié (« Changes requested ») + carte dashboard distincte | **Haute** |
| Message de modif absent de l'éditeur | Sales | Assistant d'édition SR | On édite sans voir ce que le Directeur a demandé (message seulement sur le détail) | Rappeler la bannière « Changes requested by … » en tête de l'assistant | **Haute** |
| Dashboard Operations ne montre pas les SR à chiffrer | Operations | Dashboard | Uniquement des ordres de prod ; aucune carte « SR à coûter » → risque d'oubli complet du chiffrage | Ajouter « Service requests to cost (N) » | **Haute** |
| Écart specs libres ↔ options catalogue | Sales/TLM | Task list, config produit | « 120Wp/12.8V 100Ah/MPPT 20A » sans correspondance directe avec « 18V/125W », « 1152Wh », SKU chinois → interprétation/devinette | Panneau de correspondance guidé (specs SR → option suggérée) ; capturer Optic/CCT en amont | **Haute** |
| « Create order » implicite | TLM | Task list | L'ordre naît de « Release to Production » après « Validate → » (2 étapes) ; aucun bouton « Créer la commande » | Libeller l'étape finale « Valider & créer la commande » ; annoncer les 2 étapes | **Moyenne** |
| Double CTA « Start pricing » / « Approve pricing » | Dir | Panneau pricing | « Start pricing → » (action « DIRECTOR ACTION » en tête) ne change rien de visible ; le vrai bouton est « Approve pricing → » plus bas | Fusionner ou renommer (« Défiler vers le pricing » vs « Approuver le pricing ») | **Moyenne** |
| Création → soumission en 2 temps (SR & task list) | Sales | Assistants | « Create service request » / « Save changes » **n'enregistre qu'un brouillon** ; il faut ensuite « Submit for review » sur le détail | Bouton unique « Créer et soumettre » ou rappel visuel de l'étape 2 | **Moyenne** |
| Confirm « Won » en dialog natif | Sales | Devis | `window.confirm()` natif, dissonant avec les modales in-app soignées | Modale in-app cohérente | **Basse** |
| Champ « Country » avec indicatif « +33 » | Sales | Assistant SR étape 1 | Un indicatif téléphonique sur un champ *pays* (SR) prête à confusion | Retirer l'indicatif du sélecteur pays SR | **Basse** |
| Terminologie fluctuante d'une même action | Tous | SR | « Request info » / « More information requested » / « Changes requested » ; « submit for the Sales Director's approval » vs « Submit for review » | Uniformiser les libellés | **Basse** |

---

## Revue spécifique — Factory Mapping (pont production critique)

- **Se sent-il naturellement connecté au workflow TLM ?** **Oui.** Il est **inline sur la task list** : bandeau bloquant « ⚠ Not ready to release — N factory mappings missing », résolution **par champ** (one-off / client / « Configure it → » global), modèle en couches expliqué (global → override client → cette commande). Ce n'est pas une étape cachée.
- **Ressemble-t-il à une étape technique/admin qu'on oublie ?** **En partie** : la console globale est estampillée « Admin → Factory mapping ». Mais la task list **impose** la résolution avant validation, donc difficile à oublier.
- **Le TLM comprend-il quand le mapping est requis avant la commande ?** **Oui, sans ambiguïté** : le gate **bloque la validation** (« resolve before validation ») ; la commande naît de la validation, donc mapping obligatoire **avant** commande.
- **Faut-il rappels/avertissements/checklist avant création de commande ?** Le gate + bandeau + compteur « MAPPED/MISSING » remplissent déjà ce rôle. À ajouter : **feedback au clic** quand « Validate » est bloqué (C2), **bandeau réactif** (C3), et **fiabiliser/confirmer** le save inline (C1).
- **Risque de mapper le mauvais produit/mât/réf ?** Faible : l'éditeur montre la **SALES VALUE** (option ciblée) + « Factory instruction* » + « Factory code », scoping par famille. Le mât est un **item manuel** distinct (pas mappé via ces dropdowns). Risque résiduel = l'**écart de vocabulaire** en amont (mauvaise option choisie en task list, qui sera alors correctement mappée… mais fausse).
- **Le save préserve-t-il les données de la task list ?** Oui côté console globale (persisté, auto-résolu sur la ligne, task list intacte). **Save inline : non vérifié** (C1).
- **Confirmation claire après save ?** Console globale : oui (compteur MAPPED incrémente, option passe « Edit »). Inline : **pas de toast**, seulement l'état optimiste.
- **Peut-on enchaîner « Create Order » facilement ?** Oui : gate levé → « Validate → » puis « Release to Production » → commande créée automatiquement.

---

## E. Revue statuts & notifications

**Ce que chaque rôle voit clairement (action / reçu / prochaine étape) :**
- **Sales** : dashboard « Needs your action » → sections dédiées « DRAFT SR — SUBMIT OR EDIT », « READY TO GENERATE QUOTATION », « WON — READY TO LAUNCH PRODUCTION ». Très clair — **sauf** le cas « modifications demandées » qui se noie dans les brouillons (D, C-connexe).
- **Directeur** : « SERVICE REQUESTS TO APPROVE » + vue `/projects/approvals` + cockpit « Approvals & pricing ». Excellent.
- **Operations** : ouverture SR claire et séquencée ; **mais le dashboard ne pousse pas les SR à chiffrer** (D — Haute).
- **TLM** : « TASK LISTS — NEEDS YOUR REVIEW » + Urgent + Waiting-for-me + Orders-in-flight. Excellent.

**Noms de statuts :** globalement clairs et cohérents dans le pipeline SR (Draft → Waiting director review → Operations in progress → Ready for pricing → Priced → Quotation generated → Won/Lost) et le lifecycle commande (Quotation → Won → Task list → Validated → Production → Shipped → Delivered). **Le workflow paraît naturel.**

**Factory Mapping requis/recommandé avant commande :** **oui, visible et bloquant** (bandeau + gate). **Manque :** feedback au clic sur « Validate » bloqué (C2) et bandeau réactif (C3).

**Changements de statut après validation / mapping / commande :** clairs — task list « Under validation » → « Validated » ; commande créée « Awaiting deposit » ; lifecycle tracker mis à jour (« TASK LIST Validated », « VALIDATED — Production order created »). **Aucune notification manquante** hormis le retour visuel du save mapping inline (C1) et du clic Validate (C2).

---

## F. Revue intégrité des données

| Élément | Vérifié | Preuve |
|---|---|---|
| Client créé correctement | ✅ | « Test du 2 July » (TJY), redirect + toast |
| Données SR préservées | ✅ | SSLXPRO/LED 60W/Panel 120Wp/Battery 12.8V 100Ah/MPPT 20A, mâts 150/8m/1,5m — inchangées à chaque étape |
| Demande de modification préservée | ✅ | Log d'activité « More information requested — … · Dana Director » |
| Prix produit (coût usine) préservé | ✅ | Product 850 RMB / Pole 320 RMB (≈124,09 $ / 46,72 $) |
| Prix transport → Paris préservé | ✅ | Sea·CFR·Paris (France) 2×40HQ @2 800 $ = **5 600 $** (SR → devis → task list → commande) |
| Validation Directeur préservée | ✅ | Marges 30 %/12 %, fret pass-through, total **36 698 $**, note de marge |
| Devis avec bonnes données | ✅ | SLX-TJY-26-001 : 2 lignes (159,54 $ / 47,78 $) + Shipping CFR Paris 5 600 $ + config (incl. « thermolaque RAL 7016 » de l'étape 3) |
| Statuts Sent/Won enregistrés | ✅ | draft→sent→won (timeline) |
| Task list générée correcte | ✅ | PTL-SLX-TJY-26-002 depuis SLX-TJY-26-002 ; rappel SR read-only ; mât en item manuel |
| Factory Mapping créé/modifié | ✅ (console) / ⚠️ (inline) | Console globale : MAPPED 17→20, auto-résolu (« SLX-BAT-12V100 DEFAULT »). Inline : non persistant (C1) |
| Mapping préserve la réf. task list | ✅ | Auto-résolution sur la **ligne** SSLXPRO concernée |
| Mapping préserve produit/mât/config/exigences | ✅ | Ligne produit + item mât + config inchangés après mapping |
| Mapping n'écrase pas SR/devis/task list | ✅ | Aucune perte constatée après saves globaux + validation |
| Commande après mapping = bonnes infos mappées | ✅ | PO-SLX-TJY-26-002 : client TJY, Sales Sam Sales, liens devis+task list, lifecycle « Validated » |
| Commande créée avec bonnes données | ✅ | Balance 36 698 $, acompte 11 009,40 $ (30 %), gating dépôt correct |

**Conclusion F : intégrité de bout en bout préservée.** Seul point à confirmer manuellement : la persistance du **save inline** de mapping (le chemin global est prouvé).

---

## G. Recommandations finales

**Top 5 correctifs avant test par de vrais utilisateurs**
1. **Vérifier/fixer la persistance du save inline Factory Mapping** (C1) — le chemin poussé en premier ; aujourd'hui non prouvé + aucun toast.
2. **Corriger le libellé « not requested »** (C4) — remplacer par « Pending / En attente Operations » (évite de croire que le transport n'a pas été demandé).
3. **Statut « Modifications demandées » distinct + badge côté Sales** (D) — éviter que la SR renvoyée se noie dans les brouillons.
4. **Remonter les SR à chiffrer sur le dashboard Operations** (D) — éviter l'oubli du chiffrage.
5. **Feedback au clic sur « Validate » bloqué + bandeau réactif** (C2, C3).

**Top 5 améliorations UX**
1. Afficher le message de modif du Directeur **dans l'assistant d'édition** SR.
2. **Pont de correspondance** specs SR (texte libre) → options catalogue task list (suggestion auto Panel/Battery/Controller) + capturer **Optic/CCT** dès la SR.
3. Clarifier l'étape finale TLM : **« Valider & créer la commande »** (annoncer les 2 temps Validate → Release).
4. Résoudre l'acteur en nom sur la **timeline devis** (C6) + confirm « Won » en modale in-app.
5. Uniformiser la terminologie d'une même action (Request info / Changes requested / Submit for review / approval) et retirer l'indicatif « +33 » du champ pays SR.

**Logique de workflow à simplifier**
- Les **doubles étapes create→submit** (SR et task list) et **Validate→Release** gagneraient à être fusionnées ou clairement annoncées.
- Le double bouton **« Start pricing » / « Approve pricing »** (le premier sans effet visible) prête à confusion.

**Validation / champ obligatoire manquant**
- Sur la task list, **Battery et Controller ne sont pas obligatoires** (`*`) alors qu'ils sont critiques → rendre obligatoires, ou au moins bloquer la soumission si vides.
- En SR, on peut cocher **« Pole required »** et laisser quantité/hauteur vides → ajouter un minimum de garde.
- **Optic\*/CCT\*** obligatoires en task list mais **jamais demandés** en amont → les capturer côté SR/devis pour éviter un choix « sorti de nulle part ».

**Rappel / panneau de contexte manquant qui éviterait des erreurs**
- Rappeler le message de modif du Directeur pendant l'édition (Sales).
- Rappeler côté Operations, sur le dashboard, les SR en attente de chiffrage.

**Rappel / garde-fou Factory Mapping manquant avant commande**
- Le gate bloquant existe déjà (bon). À ajouter : **toast au clic Validate bloqué**, **bandeau réactif**, **confirmation de save** (surtout inline), et idéalement une **mini-checklist** « Mappings résolus (N/N) · Config validée · Prêt à créer la commande » juste avant « Release to Production ».

---

### Note de propreté
Deux mappings usine **globaux** ont été créés pendant le test (SSLXPRO Battery = 1152Wh → `SLX-BAT-12V100` ; Controller = MES60-4G-ZHAGA → `SLX-CTRL-MES60-4G`). Ce sont des données de configuration légitimes et réutilisables ; à conserver ou nettoyer selon votre préférence. Objets de test créés : client TJY, SR/devis/task list/commande TJY-26 (voir refs en tête).
