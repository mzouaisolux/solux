# PLAN CRM SOLUX — Document de référence avant build

*À relire en entier avant de lancer quoi que ce soit. C'est la carte. On s'y réfère à chaque étape.*

---

## 0. PHILOSOPHIE PRODUIT (lire en premier — gouverne tout le reste)

**Solux Hub n'est PAS un CRM traditionnel** (pas HubSpot, pas Pipedrive). C'est une plateforme de projet et d'exécution construite autour de projets d'éclairage solaire complexes.

**Le vrai problème métier :** pas les commandes simples de distributeurs (100 AOSPRO, 50 VANDAL — peu de suivi, ça doit juste passer vite). Le vrai défi = les projets longs et complexes : études, devis, négociations, demandes techniques, suivi client, production, logistique, livraison — sur des mois, avec des dizaines d'interactions. **Le logiciel est optimisé pour CES situations.**

**Le modèle central :**
`Client → Affaire → Devis → Tâches → Ordre(s) de production → Expédition`

**Une Affaire n'est PAS qu'une opportunité commerciale. C'est le DOSSIER PROJET CENTRAL** — elle commence comme une opportunité commerciale mais continue tout au long de l'exécution du projet. Le projet **grandit** par couches (Commercial → Technique → Production → Shipping), il ne change jamais de monde. On ne parle pas de « bascule » mais d'**enrichissement**. Elle commence avec notes, discussions, contacts, devis, documents, actions ; une fois gagnée, elle continue avec production, logistique, expédition, mises à jour client, suivi d'exécution.

## ⛔ RÈGLE PRODUIT #0 — UNE INFORMATION N'EXISTE QU'À UN SEUL ENDROIT

C'est la règle au-dessus de toutes les autres, parce que c'est le risque n°1 constaté dans le repo (Dashboard, Business, Forecast, Orders, Client Hub, Affair Workspace — six surfaces qui peuvent toutes afficher les mêmes données) :

- une action a UNE seule source ;
- une valeur de pipeline a UNE seule source ;
- un owner a UNE seule source ;
- un statut a UNE seule source.

**Une vue peut AFFICHER l'information. Elle n'en devient JAMAIS propriétaire.** Toute nouvelle vue qui veut montrer une donnée la lit à la source — elle ne crée jamais sa propre copie, son propre champ, sa propre version du statut. Si deux écrans montrent un chiffre différent pour la même chose, c'est un bug de conception, pas un bug d'affichage.

**Événements financiers (décision produit) :** pas de module Finance. Mais les événements financiers sont des événements MAJEURS du cycle de vie chez Solux : proforma envoyée, **acompte reçu ?**, **balance reçue ?**, **blocage d'expédition pour impayé**. La règle : **les événements financiers qui bloquent l'exécution sont des actions opérationnelles** — ils vivent dans le Dashboard (côté Operations) et dans la couche de l'affaire concernée, comme n'importe quel retard de prod. Comme ça, dans 6 mois, on ne se demande pas où les mettre.

**Documents = citoyens de première classe.** Les documents sont un élément central du travail chez Solux. Une affaire contient souvent : devis, études, appels d'offres, contrats, photos terrain, fiches techniques, documents logistiques, échanges clients. **L'utilisateur ne doit pas être obligé de télécharger un document pour comprendre ce qu'il contient.** Principe produit : PDF → aperçu immédiat ; Images → aperçu immédiat ; Documents Office → métadonnées et aperçu lorsque possible ; **téléchargement = option, jamais obligation**. L'objectif : comprendre le contenu d'un document en quelques secondes sans quitter l'Affair Workspace. Le système documentaire doit se rapprocher de Notion, Google Drive ou Dropbox — pas d'une simple liste de fichiers téléchargeables. Les documents sont une composante majeure du suivi de projet et doivent être traités comme tels.

**Les 3 zones + les répertoires (Règle Produit) :**
1. **Dashboard** — « Qu'est-ce que je dois faire aujourd'hui ? » Moteur de tâches, action uniquement. Zéro analytics, zéro forecast, zéro reporting. Côté Sales : relances en retard, dû aujourd'hui, devis sans réponse, affaires endormies/sans prochaine action. Côté Operations : infos manquantes, retards de prod, problèmes d'expédition, mises à jour client requises, paiements bloquants.
2. **Affair Workspace** — « C'est ici que je travaille. » **L'écran le plus important de l'app.** Tout ce qui touche au projet accessible d'ici : notes, contacts, devis, documents, activités, tâches, production, logistique, historique. Les utilisateurs passent l'essentiel de leur temps ici.
3. **Business** — « Comment va la boîte ? » Forecast, KPIs, pipeline, win rate, performance équipe, géographie, reporting management. Analyse uniquement, aucune action à traiter.
4. **Répertoires** — le rangement : listes clients, prospects/bac à sable, commandes, admin. Ni action, ni travail projet, ni analyse : la porte d'entrée pour retrouver les choses.

**La règle dure :** toute nouvelle fonctionnalité appartient à UNE de ces zones (Dashboard / Workspace / Business / un répertoire existant). Si elle ne rentre nulle part → on questionne sa nécessité. **On ne crée jamais de nouvelle page standalone par défaut.** Objectif : clarté, pas nombre de features.

**Priorité immédiate (réordonne le plan de build) :** 1) finaliser l'architecture du Dashboard ; 2) **renforcer l'Affair Workspace** ; 3) basculer tout le reporting/analytics dans Business ; 4) éliminer les doublons d'information entre sections. Le bac à sable prospects/tenders passe APRÈS le Workspace.

---


## 1. LE BUT (en une phrase)

Ajouter une couche CRM **dans l'application existante** (la facturation Solux, sur Supabase) — sans créer de deuxième app, sans dupliquer aucune donnée — pour répondre à : *qui est le client, qui sont les contacts, quelle est l'affaire, qui s'en occupe, et qu'est-ce qu'on doit faire ensuite.*

L'exécution (devis, chiffrage, production, livraison) reste là où elle est déjà. Le CRM ne fait qu'ajouter le **commercial** par-dessus.

---

## 2. LA DÉCISION D'ARCHITECTURE (la plus importante)

**Une seule app. Une seule base de données (ton projet Supabase actuel). Plusieurs modules dedans.**

### Pourquoi pas des apps séparées
Des apps séparées qui se parlent par des intégrations = synchronisations qui cassent, données qui se désynchronisent, et le client créé en double. C'est là que les projets meurent. On évite ça à la racine.

### Pourquoi Supabase règle tout
Supabase = une base Postgres + l'authentification + les API au même endroit. Donc :
- Le CRM = **de nouvelles tables dans le même projet Supabase** que la facturation.
- Le fichier client est **une seule table**, partagée. Le doublon devient physiquement impossible.
- Un seul login (Supabase Auth), les droits par rôle (RLS) : commercial voit le CRM, compta voit la facturation, le chef voit tout.
- **Zéro intégration, zéro synchro** entre CRM et facturation : c'est la même base.

---

## 3. CE QU'ON A DÉCOUVERT EN OUVRANT TON CODE

C'est le point clé : **ton CRM est déjà à moitié construit**. On a failli dupliquer des choses qui existent.

### Ce qui existe déjà (à RÉUTILISER, pas reconstruire)
- **`clients`** = le fichier client / la boîte. C'est notre fichier client partagé. ✅
- **`affairs`** = un deal nommé, rattaché à un client, avec `owner_id` et statut `open / won / lost / abandoned`. Se crée à la main. ✅
- **`project_requests`** = la demande technique, avec `opportunity_value`, `owner_id`, et un workflow complet `draft → submitted → waiting_director_approval → waiting_factory_cost → waiting_logistics → ready_for_pricing → priced → quotation_generated → won / lost`. ✅
- Devis (`documents`), commandes, production, forecast, et même des reminders (`quotation_reminders`) : **déjà là.** ✅

### La conclusion qui change tout
L'« opportunité » qu'on a passé des heures à designer **existe déjà** : c'est l'**affaire** (`affairs`). On ne crée **aucune** nouvelle table « opportunité ». On enrichit `affairs`.

Et la « validation avant d'engager le technique » (ta vieille question) existe déjà aussi : c'est le statut `waiting_director_approval` de `project_requests`.

---

## 4. LE MODÈLE CIBLE (la hiérarchie)

```
CLIENT (la boîte — table clients)
  └─ AFFAIRE (le dossier projet central — table affairs. Commence comme une opportunité commerciale, continue tout au long de l'exécution)
       └─ PROJECT_REQUEST (le travail technique — table project_requests)
            └─ DEVIS → COMMANDE → PRODUCTION → LIVRAISON
```

- Un **client** a plusieurs **affaires** (normal, business long et récurrent).
- Une **affaire** est le tiroir qui classe le business d'un client : sans ça, on accumule des factures sans savoir à quel deal elles correspondent.
- Une affaire peut donner lieu à un ou plusieurs **project_requests** (le technique).

### LE DÉFAUT À CORRIGER
Aujourd'hui, `project_request` est rattaché **au client directement, pas à l'affaire**. Du coup affaire et demande technique sont côte à côte au lieu d'être emboîtées. Si un client a 3 affaires, on ne sait pas proprement quelle demande appartient à quelle affaire.
**Le fix = ajouter `affair_id` sur `project_requests`.** C'est l'étape 1 du build.

### CYCLE DE VIE D'UNE AFFAIRE GAGNÉE
**Une affaire gagnée ne disparaît jamais.** Elle reste attachée au client et conserve tout son historique : notes, devis, documents, activités, production, expédition, échanges, problèmes rencontrés. Le statut passe simplement à `won`.

Lorsqu'un utilisateur consulte un client, il doit pouvoir retrouver l'ensemble des affaires gagnées au fil des années. **Une affaire n'est pas un objet temporaire du pipeline commercial. C'est un dossier projet qui constitue progressivement la mémoire commerciale et opérationnelle du client.** Un client peut ainsi accumuler plusieurs affaires gagnées dans le temps, chacune conservant son propre historique et son propre contexte.

---

## 5. L'ENRICHISSEMENT (le projet grandit, il ne change pas de monde)

**⚠️ Vocabulaire : ce n'est PAS une « bascule ». C'est un ENRICHISSEMENT.** Une bascule suppose qu'on quitte un monde pour un autre. Faux : l'affaire reste le même dossier du début à la fin — elle gagne des couches au fur et à mesure que le projet grandit.

```
Affaire
 ├─ Commercial   (notes, contacts, relances, négo — dès le jour 1)
 ├─ Technique    (études, chiffrages — quand on engage le premier euro technique)
 ├─ Production   (une fois gagnée)
 └─ Shipping     (jusqu'à la livraison)
```

**Règle simple :** une affaire ne porte que sa couche commerciale tant qu'elle ne coûte que du temps commercial (appels, relances, RDV). Dès qu'on demande du **travail technique** (étude, chiffrage usine), elle gagne sa couche technique.

- **L'enrichissement technique = créer un `project_request` sous l'affaire.** L'acte de demander le travail technique EST l'enrichissement. Pas de bouton « passer en projet » séparé.
- **La couche commerciale ne s'arrête jamais** pendant ce temps : la négociation et la révision arrivent **après** le devis — donc pendant que la couche technique/production tourne. Le commercial continue de travailler la même affaire.
- **Qui peut enrichir (engager le technique) :** affaire bien notée + dans la zone de confort → le commercial déclenche seul (vitesse). Affaire moyenne ou gros chiffrage coûteux → validation d'un directeur d'abord (`waiting_director_approval`). On met un humain seulement là où ça coûte cher et où la note ne tranche pas.

---

## 6. LES 3 PORTES D'ENTRÉE D'UNE AFFAIRE

1. **App Tenders** (le maestro / lead manager) → affaire pré-qualifiée, notée.
2. **Commercial terrain** → un lead choppé par relation.
3. **Client existant qui revient** → il arrive avec son affaire, pas sourcée par nous → on chiffre souvent direct.

Dans tous les cas : **on crée toujours l'affaire d'abord** (même 10 secondes), puis on l'enrichit. Sinon un project_request se rattache à rien côté commercial.

**Important :** un champ `source` sur l'affaire pour mesurer, dans 6 mois, d'où vient le chiffre (tender vs terrain vs client existant). Ça dit où mettre l'énergie commerciale.

---

## 7. LE BAC À SABLE PROSPECTS (zone CRM uniquement)

Zone légère, **jamais dans la facturation**, où le lead manager et les imports déversent du brut (Excel de salon, plus tard plugin LinkedIn, et les tenders). On y trouve deux familles d'objets — à ne JAMAIS mélanger :

### A. Prospect entreprise (une boîte)
Une société qu'on veut approcher. Vient de plusieurs sources : import manuel (salon, LinkedIn) **ou** générée depuis un résultat de tender (voir plus bas).
→ bouton « switcher en client » → devient un `client` dans le fichier partagé (une **transformation**, pas un doublon).

### B. Tender (un appel d'offres brut) — DEUX TYPES, deux comportements
C'est la logique produit la plus importante du bac à sable. Le même objet « tender » se travaille de deux façons opposées selon son type :

**Type `ouvert` — l'appel d'offres qui sort (à défendre)**
On va le chercher. On l'**accroche à une boîte** (un client ou un prospect = le partenaire qui va soumissionner) et on participe à l'appel d'offres **avec lui** : le partenaire porte le dossier, Solux fournit l'éclairage solaire.
→ Tender ouvert → attaché à une boîte → **devient une AFFAIRE** sous ce client (avec `source = tender`).

**Type `résultat` — l'appel d'offres déjà attribué**
L'inverse. Les boîtes dedans (le gagnant, les participants) sont des **clients potentiels** : elles viennent de gagner ou de soumissionner sur du solaire, donc ce sont des leads chauds.
→ Tender résultat → **enregistrement d'intel concurrent** (qui a gagné, qui a participé, pourquoi virés) qui **génère des prospects entreprises** (les boîtes dedans), qu'on chasse ensuite.

### La logique en une image
```
                          ┌─ type OUVERT ──→ accroché à une boîte ──→ AFFAIRE (à défendre avec un partenaire)
TENDER (brut, bac à sable)─┤
                          └─ type RÉSULTAT ─→ intel concurrent + génère des PROSPECTS ENTREPRISES (à chasser)
```

**Les deux portes finissent dans le même pipeline `client → affaire`**, mais par des chemins opposés : l'un est une affaire à défendre, l'autre est une mine de prospects à transformer.

L'**intel concurrent** (gagnant, participants, raisons) vit sur le tender de type `résultat`. Tender après tender, ça construit gratuitement ta carte des concurrents.

---

## 8. LA FICHE OPPORTUNITÉ / AFFAIRE (un moteur de to-do, pas un formulaire)

Le but : guider le commercial le matin sur quoi faire, et faire remonter au chef ce qui est fait / pas fait.

- **Bloc 1 — vu en 3 secondes (en haut, gros) :** nom de l'affaire, valeur (€), étape, et surtout **PROCHAINE ACTION + DATE** (le truc le plus gros).
- **Bloc 2 — le moteur d'action :** prochaine action (rappeler / RDV / relancer / envoyer devis), date d'échéance, historique des activités. **C'est ce bloc qui remonte au manager** : action en retard = rouge, le chef voit direct qui traîne.
- **Bloc 3 — infos de fond (en bas, on y touche peu) :** propriétaire, client/contact, source, note de l'app, liens vers les couches d'exécution (devis, étude, commande) une fois l'affaire enrichie.

**Règle d'or :** une affaire a TOUJOURS une prochaine action avec une date. Pas de prochaine action = rouge. Aucune affaire ne dort.

**Pré-rempli par l'app** (si affaire issue d'un tender) : nom, pays, valeur, source, note.
**À la main** (commercial) : prochaine action + date, activités, propriétaire.

---

## 9. LE VRAI BOULOT CRM (ce qui manque vraiment)

Pas de nouvelle app, pas d'objet « opportunité ». Juste :

1. **Le fix** : lier `project_requests` → `affairs` (`affair_id`).
2. **Enrichir `affairs`** : champ `source` + lien vers l'intel tender.
3. **Ajouter `contacts`** : plusieurs contacts par client (aujourd'hui un seul, embarqué dans `clients`).
4. **Ajouter le bac à sable `prospects`** : prospects entreprises **+** tenders bruts avec un champ `type` (`ouvert` / `résultat`). Tender ouvert → s'accroche à une boîte et devient affaire ; tender résultat → table `tender_participants` (boîte, gagnant/perdant, raison) dont chaque ligne est **promouvable en prospect** d'un clic. C'est ce qui rend la carte des concurrents requêtable.
5. **Ajouter les actions planifiées** — PAS un gros module activités. Découverte V2 : l'app a déjà `events` (timeline polymorphe, alimente les panneaux d'historique) et `action_acks`/`action_notes` (liste d'actions à traiter, vu/fait). Donc on ajoute **une seule table fine** `planned_actions` (type : appel/RDV/visite/relance, échéance, fait/pas fait, accrochée à une affaire) ; quand une action est faite → elle se loggue dans `events`. L'historique = `events`. La vue « à traiter » = même mécanique que l'existant. Zéro timeline parallèle, zéro doublon.

→ ~4 tables nouvelles (`contacts`, `prospects`, `tenders` + `tender_participants`, `planned_actions`) + 1 fix + quelques champs, le tout branché sur `events` et la mécanique d'actions existante.

**RISQUE N°1 DU PROJET — l'adoption des affaires.** Tout le CRM repose sur le fait que les commerciaux créent des affaires. S'ils ne le font pas, les project_requests restent orphelins et le CRM est mort-né. Mitigation : dans le sélecteur « Affaire » (étape 1), un bouton **« + Créer une affaire »** inline — on crée l'affaire au moment où on en a besoin, zéro friction. Règle d'équipe à poser : pas de demande technique sans affaire.

**Dimension transversale — la géographie.** Solux vend sur plusieurs continents : on veut pouvoir découper tout le CRM par géo (pipeline par continent, taux de réussite par région, affectation des commerciaux par territoire). On ne stocke PAS du texte libre. On tague le **pays** une fois (déjà présent sur `clients` et `project_requests`) et une petite table de référence `pays → région → continent` fait remonter les totaux automatiquement. Se branche dans l'enrichissement de l'affaire (étape 3) et les vues (étape 6).

**Dimension transversale — ownership & équipes (on RÉUTILISE l'existant).**
- L'attribution suit le pattern déjà en place : `sales_owner_id ?? created_by`, avec la fonction `list_assignable_owners()` pour le sélecteur. L'`owner_id` de `affairs` sera aligné sur ce même pattern. **Aucun nouveau mécanisme d'ownership.**
- La hiérarchie (qui voit quoi, qui manage qui) passe par `teams` + `team_members` (`member_role` = member/manager). Un directeur commercial voit les affaires de son équipe via ça.
- **Deux géographies à ne pas confondre :** le *territoire* (qui couvre quoi) existe déjà via `teams.kind = 'region'` (avec `parent_team_id` pour l'imbrication) ; la *géo de reporting* (le pays de l'affaire qui remonte en continent) est la nouvelle table de référence ci-dessus. Une affaire au Bénin peut être possédée par l'équipe « Afrique de l'Ouest » ET remonter dans le pipeline « Afrique ».

---

## 10. REFONTE DES NOTIFICATIONS (réduire le bruit)

### Le diagnostic (constaté dans le code)
- La table `events` fait **double emploi** : à la fois l'historique/timeline (très bien) ET le flux de notifs (cloche `NotificationBell`, feed dashboard). Résultat : tout atterrit dans la cloche → bruit.
- ~56 types d'events au catalogue (`lib/events.ts` / `lib/events-shared.ts`), dont **23 classés high/critical**. Quand 40% des événements sont des « alertes », plus rien n'est une alerte.
- Pas de ciblage « pour moi » : le feed filtre par sévérité, pas par destinataire, alors que `sales_owner_id` et `teams` existent déjà pour router.

### La règle des 3 étages
1. **Timeline** = TOUT, pour toujours. C'est l'audit. On ne touche pas à `events`.
2. **Feed dashboard** = le pouls de la boîte, consulté à la demande, jamais poussé.
3. **Cloche** = UNIQUEMENT « toi, tu dois faire quelque chose ». Rare et ciblé.

### Le test pour qu'un event sonne la cloche (3 questions)
1. C'est **pour moi** ? (owner de l'entité via `sales_owner_id ?? created_by`, ou son manager via `teams`)
2. Ça demande une **action/décision** de ma part ?
3. Si je le rate, ça **coûte de l'argent** ?

Trois oui → cloche. Sinon → timeline seulement. Cible : ~5-6 types qui sonnent (validation en attente de moi, deadline prod qui glisse, devis rejeté, demande d'info bloquante). Critical réservé à « argent/deadline en danger » : 4-5 types max.

### Le design — DYNAMIQUE, pas hardcodé
La classification est de la **configuration**, pas du code. On ne peut pas savoir ce qui est du bruit avant de l'avoir vécu en production.

- **Table `notification_rules`** : une ligne par type d'event, avec :
  - `severity` (remplace le `DEFAULT_SEVERITY` hardcodé)
  - canaux : timeline seule / feed / cloche (booléens)
  - audience : owner de l'entité / manager de l'owner / rôle(s) / équipe(s)
- **Le code garde les défauts en dur comme filet de sécurité** : pas de règle en base → comportement actuel. Une règle existe → elle gagne.
- **Table `notifications`** (fine) : `user_id`, `event_id`, `read_at`. Un event ne devient une notif que s'il passe les règles, routé au(x) bon(s) user(s). La cloche lit CETTE table, plus jamais `events` en direct.
- **Page admin** (à côté de l'admin users/teams existant) : tableau de tous les types d'events, réglage par ligne (sévérité, audience, canaux). Dégrader un event bruyant = 2 clics, sans déploiement. Cohérent avec le pattern existant (`config_fields`, `role_permissions`).

### Garde-fous
- **PAS de moteur de règles** (pas de conditions imbriquées « si valeur > X et pays = Y »). Une table simple : type → sévérité + audience + canaux. Point.
- Préférences par utilisateur (« moi je ne veux pas la cloche pour ça ») = plus tard, par-dessus le même système.

## 11. PLAN DE BUILD — ÉTAPE PAR ÉTAPE (réordonné selon la Philosophie Produit, section 0)

**Méthode de travail :** je te donne un prompt → tu le colles dans Claude Code → ça se fait → tu vérifies → tu me dis « ok » → prompt suivant. **Un seul à la fois.** On ne casse rien.

| # | Étape | Pourquoi à cette place |
|---|-------|---------------------|
| 1 | ✅ Lier `project_requests` → `affairs` (`affair_id` + sélecteur + « + Créer une affaire » inline) | Fait. Stabilise la hiérarchie. |
| 2 | 🔄 Finaliser le Dashboard selon la **SPEC DASHBOARD** ci-dessous | En cours. Une seule page d'atterrissage. |
| 3 | **AFFAIR WORKSPACE — le centre de gravité du produit** (description complète ci-dessous) | L'écran stratégique n°1 de Solux Hub. |
| 4 | Table `contacts` (plusieurs par client) — se construit DANS le Workspace | Nourrit directement l'écran central. |
| 5 | Actions planifiées (`planned_actions`) branchées sur `events` + mécanique existante — créées/visibles depuis le Workspace, remontent dans le Dashboard | Le moteur to-do. Source unique, deux surfaces (Workspace pour travailler, Dashboard pour agir). |
| 6 | Basculer tout le reporting restant dans Business + dédoublonner les infos entre sections | Règle : Business = analyse seule. |
| 7 | Champ `source` + enrichissements `affairs` + géo de reporting (table pays → continent) | Prépare la connexion à l'app tenders et le découpage géo dans Business. |
| 8 | Bac à sable `prospects` + `tenders`/`tender_participants` (type ouvert/résultat) | Répertoire. Après le Workspace : ouvert → affaire ; résultat → participants promouvables en prospects + intel. |
| 9 | Refonte notifications : `notification_rules` + `notifications`, page admin, dé-classification des sévérités (section 10) | Autonome — peut remonter dans l'ordre si le bruit te gêne trop au quotidien. |

**Plus tard (pas maintenant) :** import Excel salon, plugin LinkedIn, sync email, boucle de feedback de la note tender. Notés, pas prioritaires.

### ÉTAPE 2 EN DÉTAIL — SPEC DASHBOARD (verrouillée)

**Le Dashboard n'est pas une destination. C'est une COUCHE DE ROUTAGE.** Son but : envoyer vite l'utilisateur vers la bonne Affaire, la bonne Commande ou l'action qui demande attention. Une seule question : « Qu'est-ce que je dois faire aujourd'hui ? » Pas de reporting, KPI, forecast ou management (→ Business). Un bloc qui ne demande pas d'action n'a pas sa place ici.

**Cadre technique (Règle #0 appliquée) :** ne jamais créer de nouveau système de statuts, de champ d'ownership en double, ni de table d'actions en double. Réutiliser les sources de vérité existantes (`events`, `action_acks`, `quotation_reminders`, `planned_actions`, `sales_owner_id`, `teams`). **Toute future fonctionnalité alimente les blocs existants** — pas de nouvelle section Dashboard sans approbation explicite.

**Structure :** page d'atterrissage unique (My Morning supprimée, URL redirigée). Deux onglets : SALES / OPERATIONS.

**Règle 1 — Ordre de priorité dans chaque onglet :** Critical → Due Today → Preventive. Le critique TOUJOURS en premier.
- SALES — Critical : relances en retard · affaires sans next action · devis bloqués (**définition validée** : devis envoyé + toujours actif + AUCUNE action planifiée OU action planifiée en retard — but : détecter les devis actifs que personne ne pousse). Due Today : appels, RDV, relances du jour. Preventive : devis sans réponse · affaires endormies. (« Opportunities requiring attention » : SUPPRIMÉ — trop vague, doublonne sleeping/sans next action/bloqués. On n'ajoutera une catégorie que sur un vrai cas non couvert.)
- OPERATIONS — Critical : retards de prod · problèmes d'expédition · infos manquantes · paiements bloquant l'exécution (acompte/balance non reçus, expédition bloquée). Due Today : mises à jour client requises · commandes à traiter aujourd'hui. Preventive : ETA expédition proche · deadline prod proche · acompte reçu mais task list incomplète — **seuil CONFIGURABLE (réglage admin), défaut 7 jours, jamais hardcodé.** On ajustera après observation de l'usage réel.

**Règle 2 — Tout item est actionnable :** lien direct vers son lieu de résolution (Workspace, commande) + actions inline (Done/Acknowledge/Resolve) quand possible. Un item sur lequel on ne peut pas agir ne s'affiche pas.

**Règle 3 — Alertes croisées :** chaque onglet porte un badge d'urgence visible quand l'AUTRE onglet contient des items critiques non résolus.

**Règle 4 — Filtres :** même filtre d'ownership sur les deux onglets. Défaut « My Items », option « All Items » (`sales_owner_id ?? created_by`). Contributeurs → eux-mêmes ; managers/directeurs → vue d'ensemble.

**Règle 5 — Densité :** max 5 items par bloc + « View All → ». Un dashboard qui scrolle longuement a échoué.

**Règle 6 — États vides = états de succès :** « No overdue actions. » « All projects progressing normally. » Pas de tableaux vides ni de cartes blanches. L'utilisateur doit se sentir récompensé d'un état propre.

**Règle 7 — Test de succès :** à 8h, en <10 secondes l'utilisateur sait ce qui est en retard / dû aujourd'hui / bloqué / à surveiller. En <30 secondes il a ouvert le premier item et commencé à travailler. Les deux conditions remplies = Dashboard réussi.

**Ce qui QUITTE le Dashboard → section Business :** Commercial Forecast, KPIs mensuels, current state, pipeline 12 mois, win rate, business snapshot, tableau équipe, pipeline par géographie. Le Dashboard garde ZÉRO analytics.

### ÉTAPE 3 EN DÉTAIL — AFFAIR WORKSPACE, le centre de gravité du produit

La page affaire devient LE lieu de travail principal. Elle doit permettre à un utilisateur de **comprendre l'état complet d'un projet en moins de 30 secondes** sans naviguer dans plusieurs modules.

L'Affair Workspace regroupe : notes, contacts, devis, documents, **aperçu documentaire intégré (Document Preview)**, actions planifiées, production, logistique, historique complet.

**Document Preview.** Les documents doivent être consultables directement depuis l'Affair Workspace. L'utilisateur ne doit pas avoir à télécharger systématiquement un fichier pour savoir ce qu'il contient. Exemples : PDF → aperçu intégré ; Images → aperçu intégré ; Documents Office → aperçu ou métadonnées enrichies. L'objectif : ouvrir, parcourir et comprendre rapidement les documents liés à une affaire **sans quitter son contexte de travail**.

**Principe UX.** Si une information importante est nécessaire pour comprendre l'état d'un projet, elle doit être visible depuis l'Affair Workspace. L'utilisateur ne doit pas avoir à naviguer entre plusieurs modules pour reconstituer l'histoire d'une affaire. **L'Affair Workspace est l'écran stratégique n°1 de Solux Hub.**

---

## 12. CE QUI EST TRANCHÉ vs CE QUI RESTE OUVERT

**Tranché :**
- Une seule app / une seule base Supabase.
- Fichier client unique partagé.
- Affaire = le dossier projet central (table `affairs` réutilisée). Commence comme opportunité commerciale, continue à travers toute l'exécution. PAS « juste une opportunité CRM ».
- Vocabulaire : **enrichissement**, pas bascule. Le projet grandit (couches Commercial → Technique → Production → Shipping), il ne change pas de monde.
- Les **événements financiers qui bloquent l'exécution** (acompte, balance, proforma, blocage expédition) = des actions opérationnelles. Pas de module Finance.
- **Règle Produit #0 : une information n'existe qu'à UN seul endroit** (voir section 0). Une vue affiche, elle ne possède jamais.
- Bascule = créer un project_request sous l'affaire.
- Prospects = zone CRM séparée. Deux familles : prospects entreprises + tenders bruts.
- Tender `ouvert` → accroché à une boîte → devient une affaire à défendre. Tender `résultat` → intel concurrent + génère des prospects entreprises.
- Notifications : règle des 3 étages (timeline = tout / feed = à la demande / cloche = action requise pour moi). Classification **dynamique** via `notification_rules` + page admin, défauts en dur en filet de sécurité. Pas de moteur de règles.

**Encore ouvert (à décider en avançant) :**
- Le seuil exact (note de l'app) au-dessus duquel un commercial peut engager le travail technique sans validation.
- Comment exactement l'app tenders pousse une affaire dans le CRM (à régler quand on branchera l'app — pas maintenant).
- Les types d'activités précis des actions planifiées.
- L'ordre : refonte notifications avant ou après le cœur CRM (étape 7 est autonome).
- Préférences de notification par utilisateur (plus tard, par-dessus `notification_rules`).

---

*Fin du document. Quand tu l'as relu et que tu es OK, on lance le Prompt #1 (le fix `affair_id`).*
