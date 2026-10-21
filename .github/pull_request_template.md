## Ce qui change

<!-- Une ou deux phrases, en français : ce que l'utilisateur verra de différent. -->

## Vérifications

- [ ] `npm run build` est vert (oxlint + vitest + tsc + vite build)
- [ ] Textes : « créateurs » (jamais « créatrices »), pas de tiret long ni demi-tiret dans l'interface
- [ ] Espace créateur touché : traductions ajoutées dans `src/lib/i18n/en-*.ts`
- [ ] Aucun secret, aucune donnée personnelle dans le diff (le dépôt est public)

## À appliquer à la main après la fusion

<!-- Laisser « Rien » si rien n'est à faire. -->

- SQL à lancer dans Supabase (fichier `supabase/sql/…`, déjà foldé dans `SETUP.sql`) :
- Edge Functions à déployer (`supabase functions deploy <noms> --project-ref zizvggziggswhrbuyhuo`) :
- Réglage à changer dans un tableau de bord (Supabase, Google, Meta…) :

- [ ] Le tableau d'état `supabase/sql/README.md` est à jour (ligne ⏳ À faire ajoutée)

## Captures

<!-- Si le changement est visuel : avant / après, ordinateur et iPhone si possible. -->
