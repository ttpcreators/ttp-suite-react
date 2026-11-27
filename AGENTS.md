# Consignes pour les assistants de code (IA)

Ce fichier sert aux outils d'IA autres que Claude Code (Codex, Cursor, Copilot…). Les règles
sont les mêmes pour tous : elles sont écrites dans **[`CLAUDE.md`](CLAUDE.md)**, à lire en
entier avant toute modification.

À lire ensuite, selon la tâche :

1. [`supabase/sql/README.md`](supabase/sql/README.md) : état de la prod (SQL et fonctions
   appliqués ou à faire). À lire en premier pour reprendre le fil.
2. [`docs/CARTE-DU-CODE.md`](docs/CARTE-DU-CODE.md) : où vit chaque chose.
3. [`docs/RECETTES.md`](docs/RECETTES.md) : les changements courants pas à pas.

L'essentiel, en bref :

- `main` est la production (app.ttpcreators.pro), protégée : pas de push direct. Tout passe par
  une PR, et le contrôle « build » doit être vert avant la fusion. Une PR fusionnée est en ligne
  en 1 à 2 minutes.
- `npm run build` (lint, tests, types, build) doit être vert avant chaque commit.
- La base et les Edge Functions : la session prépare (SQL daté, code de la fonction, ligne ⏳
  dans `supabase/sql/README.md`). Elle n'applique le SQL ou ne déploie qu'après le « oui » de
  Marc ou de Gianni pour ce SQL ou ce déploiement précis, une seule personne à la fois.
- Un nouvel outil du connecteur (`supabase/functions/ttp-mcp`) se classe aussi pour l'agent
  Alfred, dans `agents/alfred/alfred.sh` (voir `docs/RECETTES.md`, recette 5).
- Le dépôt est public : aucun secret, aucune donnée personnelle dans un fichier commité.
- Textes de l'app en français, « créateurs » (jamais « créatrices »), sans tiret long ;
  l'espace créateur est traduit via `src/lib/i18n`.
