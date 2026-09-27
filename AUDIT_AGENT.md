# AUDIT_AGENT.md — Phase 1 : audit de lisibilité

Rapport pour Marc. Objectif : dire précisément ce que l'agent pourra **lire**, ce qui sera **masqué**, et ce qui **manque** avant de brancher un agent IA en sécurité.

Méthode : lecture du schéma de référence `supabase/SETUP.sql` (la source de vérité du projet). Aucune donnée n'a été modifiée. Aucune migration n'a été lancée.

---

## 0. Deux points d'architecture à connaître d'abord

1. **Hébergement.** La spec parle de Vercel, mais l'app est en réalité déployée sur **GitHub Pages** (`app.ttpcreators.pro`, branche `main`). Ça ne change rien à la sécurité base de données, mais autant le savoir : l'agent, lui, parlera **directement à Postgres** (Supabase), pas au front.

2. **Beaucoup de données ne sont PAS dans des tables.** Une grande partie de l'app est stockée dans **un seul gros blob JSON** : la table `module_rows`, ligne `module = '__app_state__'`. On y trouve, pêle-mêle : coordonnées bancaires, comptes bancaires, détails de facture (lignes, TVA, commission), reversements aux créatrices, commissions par créatrice, échéances de contrat, historique des contrats, notes internes, contenu des media kits, suivi du scouting, réglages de notifications, historique du diagnostic, etc.
   **Conséquence directe pour l'agent :** un rôle « lecture seule sur les tables » ne verra **pas** ces données. C'est **voulu** pour tout ce qui est bancaire (parfait, on ne veut pas l'exposer), mais **problématique** pour deux besoins de l'agent : le **statut de paiement côté créatrice** (reversements) et les **échéances de contrat**, qui vivent dans le blob. Voir la section 4.

---

## 1. Tables lisibles (schéma `public`)

| Table | Ce que c'est | Alimentée par l'app ? | Utile à l'agent ? |
|---|---|---|---|
| `creators` | Le **roster** : créatrices, réseaux, audience, ER, CA, statut, univers | Oui (Roster) | **Oui** (cœur) |
| `contacts` | **Contacts marques / agences / médias** (marque, personne, rôle, email, tel, @insta, ville, dernier contact) | Oui (Contacts) | **Oui** |
| `briefs` | **Briefs de collab** (marque, créatrice, livrables, échéance, statut, budget, objectif) | Oui (Briefs) | **Oui** (c'est le plus proche d'une « collab ») |
| `invoices` | **Factures** (réf, marque × créatrice, montant, date, statut) | Oui (Facturation) | **Oui** (statut de paiement **côté marque**) |
| `gifting` | **Cadeaux / dotations** reçus par les créatrices | Oui (Gifting) | Oui |
| `ideas` | Idées de contenu (par créatrice ou générales) | Oui (Idées) | Moyen |
| `todos` | Tâches à faire (agence + demandes créatrices) | Oui (To-do) | Oui (ce qui stagne) |
| `events` | **Planning** (RDV, tournages, dates), synchro Google Agenda | Oui (Planning) | **Oui** (échéances de contenu) |
| `prospects` | Prospection simple (marque, contact, valeur, étape) | Oui (Prospection) | Oui |
| `creator_pool` | **Scouting** : créatrices hors roster à solliciter (handle, email, tag, note, dernier contact) | Oui (Scouting) | Oui |
| `creator_roadmap` | **Feuille de route éditoriale** partagée agence ↔ créatrice | Oui (Feuille de route) | Oui |
| `documents` | Métadonnées des fichiers (le binaire est dans le Storage) | Oui (Documents) | Faible (métadonnées) |
| `messages` | Fils de messages internes (corps de message) | Oui (Mails / historique) | **À exclure** (contenu privé, cf. section 2) |
| `agency_mediakit` | Deck media kit **de l'agence** (contenu public) | Oui (Media kit agence) | Faible |
| `module_rows` | **Le grand blob** `__app_state__` + lignes de modules divers | Oui (partout) | **À exclure** (voir section 3) |

**Tables techniques / internes** (jamais exposées à l'agent) : `profiles` (rattachement compte ↔ créatrice + rôle agence), `push_subscriptions` (appareils), `email_sequences` / `sequence_enrollments` / `email_activity` (automation mail), `error_log`, `app_state_backups` (sauvegardes du blob), `sync_state`, et surtout `google_tokens` (**jetons OAuth Google** — critique).

---

## 2. Colonnes et tables **sensibles** — à ne JAMAIS exposer à l'agent

Repérées ligne par ligne dans le schéma :

- **`creators`** : `birth` (date de naissance), `phone` (téléphone perso), `address` (adresse perso), `siren` (identifiant), `email` (perso). → **Masquer.** On garde ce qui est **pro** : nom, @, réseaux, audience/ER, niche, statut, ville (grande maille), date d'arrivée, `email_pro`.
  - Cas limite à trancher avec toi : `ca` (chiffre d'affaires) et `commission` (taux) sont financiers. L'agent en a peu besoin ; je propose de les **masquer** par défaut.
- **`contacts`** / **`gifting`** : emails et téléphones de contacts marques. Ce sont des **coordonnées pro** (un contact marque), donc a priori OK pour l'agent (il doit pouvoir préparer un mail). À valider : veux-tu que l'agent voie les emails/tels des contacts marques ? (Je pense **oui**, c'est son métier.)
- **`messages`** : `body` = **contenu de messages** (potentiellement privé). → **Exclure la table entière** du périmètre agent.
- **`invoices`** : le **montant** est financier. L'agent a besoin du **statut de paiement**, pas forcément du montant exact. Proposition : exposer réf, marque, créatrice, **statut** et date ; **masquer le montant** (ou l'exposer en tranche si tu préfères).
- **`profiles`**, **`google_tokens`**, **`push_subscriptions`**, **`app_state_backups`**, `auth.*` : **jamais**. (Le rôle `ttp_agent` n'aura aucun droit sur le schéma `auth` ni sur ces tables.)
- **Le blob `__app_state__`** (dans `module_rows`) : contient **IBAN/BIC, comptes bancaires, reversements, commissions**. → **Exclure `module_rows` entièrement** du périmètre agent.

---

## 3. Le blob `__app_state__` : la grande zone d'ombre

C'est le point le plus important de cet audit. Vivent **hors tables**, dans ce blob JSON :

- `invoiceIssuer`, `invoiceBankAccounts`, `invoiceDetails` → **coordonnées bancaires, IBAN, BIC, lignes de facture** (sensible, on **exclut**, tant mieux).
- `creatorPayouts`, `creatorCommission` → **reversements et commissions par créatrice** (l'état « créatrice payée » est **ici**, pas dans une table).
- `contractDeadlines` → **échéances de contrat** (fin de contrat, alertes).
- `contractHistory` / `brandContractHistory` → historique des contrats générés.
- `itemNotes` → commentaires internes sur tâches/idées.
- `poolTracking` → suivi d'abonnés du scouting + statut de pipeline.
- `notifTexts`, `notifPrefs`, `pinnedPages`, `diagnosticHistory`, `objByMonth`, `mailTemplates`, etc. → réglages et divers.

**Ce que ça implique :** l'agent, en lecture-seule-sur-tables, **ne verra pas** : l'état « créatrice payée » (reversements), ni les **échéances de contrat**. Or la spec les demande explicitement (statut de paiement côté créatrice, échéances). Il faudra **décider** en Phase 4 comment les exposer proprement, sans jamais toucher au bancaire (voir recommandations).

---

## 4. Manques par rapport aux besoins de l'agent

La spec veut, pour chaque collab : une **étape courante** + une **date par étape franchie** (les 11 étapes), et un **lien clair** collab ↔ marque ↔ contact ↔ créatrice.

État actuel :

1. **Aucune table « collabs » avec cycle de vie.** Le concept de collab est **éclaté** entre `briefs` (le plus proche), `invoices` (facturation) et `gifting`. Il n'y a **ni étape courante, ni historique d'étapes, ni dates par étape**. → **C'est tout l'objet de la Phase 2.** À créer (en ajout, sans rien casser).
2. **Liens faibles (par nom, pas par clé).** `briefs.creator`, `invoices.creator`, `contacts.brand`… sont des **chaînes de texte** (le nom / la marque), pas des clés étrangères. L'agent peut relier « par nom », mais c'est fragile (fautes de frappe, casse, homonymes). → Recommandation : au minimum **normaliser le rapprochement dans les vues** `agent_lecture` (par nom nettoyé), et idéalement rattacher la future table collabs aux `creators.id`.
3. **Statut de paiement côté créatrice = dans le blob** (`creatorPayouts`). → À exposer proprement en Phase 4.
4. **Échéances de contrat = dans le blob** (`contractDeadlines`). → Idem.
5. **Historique des contacts marques** : partiellement là (`contacts.last_contacted` + table `messages` + synchro Gmail), mais dispersé. → Une vue `agent_lecture` peut le consolider (sans exposer le corps des messages).

---

## 5. Recommandations et suite

**Ce qui est prêt et sain :** le socle RLS de l'app est solide (agence vs créatrice, écriture stricte). Créer un rôle Postgres dédié `ttp_agent` + un schéma de **vues** `agent_lecture` (sans colonnes sensibles) + un schéma `agent` en écriture est **la bonne approche** et se greffe proprement.

**Décisions que j'attends de toi avant la Phase 2 :**
- (a) **Montants de facture** exposés à l'agent : oui / non / en tranche ?
- (b) **CA et commission** des créatrices : masqués (recommandé) ou visibles ?
- (c) **Emails/téléphones des contacts marques** : visibles pour l'agent (recommandé, c'est son métier) ?
- (d) Les **reversements créatrices** et **échéances de contrat** vivant dans le blob : veux-tu qu'on les **migre vers de vraies tables** (plus propre, l'agent les lit) ou qu'on les laisse hors périmètre agent pour l'instant ?

**Plan des phases suivantes (rappel, à valider une par une) :**
- **Phase 2** : table `collabs` (étape courante) + `collab_steps` (historique des 11 étapes avec dates) + bouton « avancer d'une étape » dans le suivi. *Migration en AJOUT, aucune suppression.*
- **Phase 3** : vues `agent_lecture` (sans sensible).
- **Phase 4** : schéma `agent` (cockpits, actions, prospects, cercle, mémoire créatrices, leçons, journal).
- **Phase 5** : rôle `ttp_agent` + droits minimaux + tests de sécurité (lecture vues OK, écriture `agent` OK, lecture `public` KO, colonne sensible KO, DELETE KO). Chaîne de connexion remise à toi hors dépôt.
- **Phase 6** : page « Agent » dans l'Espace Agence.

---

**Aucune action n'a été effectuée sur la base.** J'attends ta validation de cet audit (et tes réponses aux points a, b, c, d) avant de passer à la Phase 2.
