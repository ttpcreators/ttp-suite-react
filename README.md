# TTP Suite

L'outil de gestion de l'agence de talents **TTP Creators** (Lyon · Genève), en ligne sur
**[app.ttpcreators.pro](https://app.ttpcreators.pro)**.

Une seule app, deux espaces :

- **Agence** : roster, scouting et sourcing, contacts, collabs (11 étapes), briefs,
  contrats, facturation et reversements, planning (Google Agenda), mails (partnerships@ et
  talent@), media kits, gifting, statistiques, agents IA.
- **Créateur** : ses missions et briefs, sa boîte mail, ses gains, ses factures, son media
  kit, ses statistiques. Chaque créateur ne voit que ses propres données.

Le site vitrine (et les media kits publics) vit dans un dépôt à part,
[`websitettpcreators`](https://github.com/ttpcreators/websitettpcreators). Les deux
partagent la même base Supabase.

---

## Stack

| Couche | Outils |
|---|---|
| Interface | React 19 · Vite · TypeScript strict · Tailwind v4 · shadcn/Radix · motion · recharts |
| Données | Supabase : Postgres + RLS, Auth, Storage |
| Serveur | Edge Functions Deno (`supabase/functions/`) |
| Intégrations | Google (Agenda, Gmail, Meet) · Instagram · TikTok · YouTube · Web Push · connecteur Claude (MCP) |
| Hébergement | GitHub Pages, déployé automatiquement à chaque push sur `main` |

## Démarrer

```bash
npm install
npm run dev     # serveur local
npm run build   # porte de qualité : oxlint + vitest + tsc + vite build
```

`npm run build` doit passer avant chaque commit.

## Mettre en ligne

| Quoi | Comment |
|---|---|
| L'app | `git push` sur `main` : GitHub Actions construit et publie (1 à 2 min) |
| Une Edge Function | `supabase functions deploy <nom> --project-ref zizvggziggswhrbuyhuo` (à la main) |
| La base | SQL lancé à la main dans Supabase ; état de chaque migration dans [`supabase/sql/README.md`](supabase/sql/README.md) |

Une app ouverte pendant une mise en ligne se met à jour toute seule à la page suivante
(`version.json`, voir [`src/lib/appUpdate.ts`](src/lib/appUpdate.ts)).

## Organisation du dépôt

```
src/
  views/          une page = un fichier (Mails, Collabs, Facturation, CreatorSpace…)
  components/     composants partagés ; ui/ = briques d'interface
  lib/            logique pure et testée (*.test.ts), accès aux données, i18n
supabase/
  SETUP.sql       schéma complet + sécurité (source de vérité)
  sql/            une migration datée par changement + README = tableau d'état
  functions/      Edge Functions (gmail-*, google-*, ig-*, tt-*, yt-*, ttp-mcp…)
public/           icônes, service worker (sw.js), polices des PDF
connecteur/       page d'accord du connecteur Claude
docs/             documentation (index : docs/README.md)
```

## Conventions

- **Branches** : `main` = production. Chaque chantier se fait sur une branche courte,
  fusionnée puis supprimée.
- **Sauvegardes** : tags `sauvegarde-AAAA-MM-JJ` avant les gros changements.
- **Commits** : en français, une phrase qui dit ce qui change.
- **Base** : l'assistant prépare le SQL et les fonctions, l'équipe les applique, puis le
  tableau d'état est mis à jour ([`supabase/sql/README.md`](supabase/sql/README.md)).
- **Sécurité** : seule la clé publique `anon` est dans le code ; les données sont protégées
  par RLS (agence = tout, créateur = les siennes). Tous les secrets sont des secrets
  Supabase, jamais dans ce dépôt.

## Documentation

Voir **[`docs/README.md`](docs/README.md)** : architecture, passation, contrats des
fonctions, validations Meta et Google, archives.
