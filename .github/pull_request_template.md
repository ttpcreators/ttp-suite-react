## Ce qui change

<!-- Une ou deux phrases, en français : ce que l'utilisateur verra de différent. -->

## Vérifications

- [ ] `npm run build` est vert (oxlint + vitest + tsc + vite build), ou contrôle « build » de la PR vert (session en ligne de Gianni, qui ne peut pas lancer le build)
- [ ] PR qui touche `supabase/functions` : contrôle « fonctions » vert aussi
- [ ] Nouvel outil du connecteur : classé pour Alfred dans `agents/alfred/alfred.sh` (`docs/RECETTES.md`, recette 5)
- [ ] Textes : « créateurs » (jamais « créatrices »), pas de tiret long ni demi-tiret dans l'interface
- [ ] Espace créateur touché : traductions ajoutées dans `src/lib/i18n/en-*.ts`
- [ ] Aucun secret, aucune donnée personnelle dans le diff (le dépôt est public)

## À appliquer en prod, après le « oui » de Marc ou de Gianni

<!-- Laisser « Rien » si rien n'est à faire. Dire l'ordre : SQL avant ou après la fusion. Une seule personne à la fois touche la prod. -->

- SQL à lancer dans Supabase (fichier `supabase/sql/…`, déjà foldé dans `SETUP.sql`), avant ou après la fusion :
- Edge Functions à déployer après la fusion, par « Déploiement des fonctions » (onglet Actions, depuis `main`) :
- Réglage à changer dans un tableau de bord (Supabase, Google, Meta…), par Marc :

- [ ] Le tableau d'état `supabase/sql/README.md` est à jour (ligne ⏳ À faire ajoutée)

## Captures

<!-- Si le changement est visuel : avant / après, ordinateur et iPhone si possible. -->
