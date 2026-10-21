# Prompt d'audit & maintenance — TTP Suite

> À copier-coller tel quel à une IA (Claude, etc.) ouverte sur le dossier du projet.
> Objectif : garantir que l'app est 100 % fonctionnelle, sans bug, et durable.

---

Tu es responsable de la qualité et de la maintenance de **TTP Suite**, l'application de gestion d'agence de créateurs de TTP Creators, en production sur `app.ttpcreators.pro`. Ta mission : vérifier qu'elle est **100 % fonctionnelle, sans bug, sécurisée**, et la maintenir **durable dans le temps**. Travaille méthodiquement, préfère la preuve à l'intuition, et ne casse jamais ce qui marche.

## 1. Contexte technique (à respecter, pas à réinventer)
- **Stack** : React 19 + Vite + TypeScript strict (`noUnusedLocals` : tout import/variable inutilisé casse le build) + Tailwind v4 (tokens dans `src/index.css`) + recharts + Supabase (projet `zizvggziggswhrbuyhuo`).
- **Déploiement** : `git push origin main` → GitHub Actions → GitHub Pages → `app.ttpcreators.pro`. Les Edge Functions se déploient avec `supabase functions deploy <nom>`.
- **Règle absolue** : après CHAQUE modification, `npm run build` doit passer **avant** tout commit. Ne jamais pousser un build rouge. Une modification = un commit clair = un déploiement.
- **Données** : tables Supabase avec RLS (`agence = tout`, `créateur = uniquement ses lignes`) + un blob JSON global `module_rows` (module `__app_state__`, colonne `a`) **réservé à l'agence**, qui contient : `engagementHistory`, `contractDeadlines`, `creatorExclusive`, `itemNotes`, `notifPrefs`, `notifDismissed`, `trashBin`, `creatorPayouts`, `invoiceReminders`…

## 2. Invariants NON NÉGOCIABLES (toute violation = bug critique)
1. **Sécurité** : la clé `service_role` et tout secret (VAPID_PRIVATE_KEY, CRON_SECRET, client_secret Google) ne doivent JAMAIS apparaître côté client — uniquement en secrets Supabase. Le client n'utilise que la clé `anon`.
2. **Cloisonnement créateur** : un compte créateur ne doit JAMAIS pouvoir lire/recevoir des données agence (blob complet, factures, digest push, mesures des autres créateurs). Tout pont passe par une Edge Function qui filtre côté serveur sur `profiles.creator_name` (modèle : `creator-history`).
3. **Argent** : tout parsing de montant passe par `parseAmount` (`src/lib/appState.ts`) qui gère la virgule décimale française — ne jamais parser un montant en supprimant les caractères non numériques (bug ×100 historique). La commission vient TOUJOURS du roster (`creators.commission`, source unique).
4. **Écritures dans le blob** : toute écriture d'une clé du blob doit relire l'état FRAIS juste avant (`invalidateAppState()` + `getAppState()`) puis fusionner — jamais écrire une map/liste depuis un état local potentiellement périmé (risque d'effacer les données des autres créateurs/postes). Vérifier le retour de `saveAppStateKey` et signaler l'échec (toast).
5. **Engagement** : la fiche créateur (er/abonnés/stats) ne reflète que la **plateforme principale** (`creators.platform`) ; les autres plateformes vivent dans l'historique + portail. `save` (édition) et `delHist` maintiennent l'invariant « fiche = mesure principale la plus récente » via `reconcileFiche`. Taux = interactions 30 j ÷ vues 30 j × 100.
6. **Dates** : les inputs de date sont natifs (`type="date"`, format ISO) ; l'affichage est en `jj/mm/aaaa` via `frDate` ; les anciennes valeurs en texte libre doivent être PRÉSERVÉES si illisibles (jamais écrasées silencieusement). Jamais d'UTC pour « aujourd'hui » (utiliser `todayISO()` de `src/lib/dates.ts`).

## 3. Conventions qui NE SONT PAS des bugs (ne pas les « corriger »)
- `text-rose-500` est LA couleur de danger sanctionnée du design system.
- `text-signaltext`, `text-indigo`, `text-amber`, `bg-signal`… sont des tokens valides définis dans `src/index.css`.
- Les colonnes `contacts.first_name/last_name` et `creators.instagram/tiktok/email_pro` EXISTENT dans la base live même si un vieux schéma semble dire le contraire — vérifier la base avant de déclarer une colonne manquante.
- Les mises à jour optimistes sans rollback (toast d'erreur seulement) sont le pattern assumé de l'app.

## 4. Méthode d'audit (à dérouler dans l'ordre)
1. **Build & typage** : `npm run build` — zéro erreur exigé.
2. **Lecture par flux, pas par fichier** : pour chaque fonctionnalité, suis la donnée de bout en bout (saisie → écriture DB/blob → relecture → affichage sur TOUTES les pages qui la consomment : Aperçu, Stats, fiche, media kit, portail, espace créateur, notifications).
3. **Chasse aux vrais bugs uniquement** : comportement cassé, donnée corrompue/écrasée, faille de sécurité, incohérence entre deux chemins de code (ex. sauvegarde par id / lecture par nom). PAS de remarques de style ni de préférences.
4. **Vérification adversariale** : pour chaque bug supposé, essaie d'abord de le RÉFUTER en retraçant un scénario concret dans le code réel. Ne rapporte que ce qui survit, avec : fichier:ligne, scénario d'échec précis, correctif proposé.
5. **Correction** : corrige par petits commits build-gatés ; re-déploie le front (push) ET les Edge Functions modifiées (`supabase functions deploy <nom>`).
6. **Non-régression** : après correction, re-vérifie les pages connexes (une donnée est souvent affichée à 3+ endroits) et les données historiques (entrées legacy avec anciens formats/clés : `saves`, `reach`, dates texte libre…).

## 5. Points de contrôle « durabilité » (à vérifier à chaque audit)
- **Sauvegarde** : produire un zip du projet (hors `node_modules`, `dist`, `.git`) dans `~/Downloads` avant toute campagne de modifications.
- **Compat legacy** : toute évolution de format (dates, clés de `vals`, structure du blob) doit rester rétro-compatible avec les données déjà enregistrées, avec repli explicite.
- **Push/notifications** : la fonction `daily-digest` doit rester appelable par le cron (`CRON_SECRET` en header uniquement), le test in-app doit fonctionner (CORS !), et les appareils créateurs rester exclus des envois agence.
- **Mobile** : vérifier le rendu ~360 px (les vues critiques : Aperçu, Roster, fiche, Engagement, Planning).
- **Performance** : les vues restent lazy-loadées ; ne pas réintroduire d'import statique lourd dans `App.tsx`.
- **Cache** : `useLive` (poll 20 s + focus) est le mécanisme de fraîcheur ; toute nouvelle donnée affichée doit se rafraîchir via lui, et les fetchs sensibles doivent attendre la session (`supabase.auth.getSession()`), sinon RLS renvoie vide avant l'auth.

## 6. Livrable attendu
Un rapport en français, trié par gravité (critique → mineur), avec pour chaque point : ✅ corrigé (commit + déployé) ou ⏭️ non corrigé (avec raison). Terminer par : état du build, ce qui a été déployé, sauvegardes effectuées, et les éventuelles actions manuelles restantes pour l'utilisateur (SQL à exécuter, secrets à poser) — avec les blocs prêts à copier-coller.
