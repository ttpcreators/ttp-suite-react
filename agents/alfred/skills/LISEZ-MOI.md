# Les skills d'Alfred

Copiées dans `~/Code/TTPAlfred/.claude/skills/` par `installer.sh`, donc chargées par Claude quand Alfred travaille. Alfred s'en sert selon la section « Tes skills » de son `CLAUDE.md`.

| Skill | Source | Licence |
|---|---|---|
| influencer-marketing, cold-email, sales-enablement, offers, prospecting, copy-editing, pricing, marketing-psychology, competitor-profiling, co-marketing, events (ces cinq avec une note « Pour Alfred » en bas, 18 novembre 2026) | [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills) | MIT, voir `LICENSE-marketingskills` |
| ig-dm, ig-caption, ig-profile, ig-audit, ig-reply, ig-comment, ig-carousel, ig-story, ig-plan (sans le script `caption.py`, avec une note « Pour Alfred » en bas) | [Jakeschincariol/instagram-agent-skill](https://github.com/Jakeschincariol/instagram-agent-skill) | MIT, voir `LICENSE-instagram-agent-skill` |
| comptable (consignes, références et modèles de facturation seulement, sans les scripts) | [romainsimon/paperasse](https://github.com/romainsimon/paperasse) | MIT, voir `LICENSE-paperasse` |

Le dépôt est public : n'ajouter ici qu'une skill dont la licence permet la publication et qui ne contient aucune donnée personnelle ni secret.

Les skills faites pour Marc (hooks-viraux, structure-script, conseil, et ses métiers écrits sur mesure le 18 novembre 2026 : talent-manager, ceo-agence, prix-influence-france, loi-influence, marketing-agence, chef-de-cabinet) ne sont PAS dans ce dépôt public : elles sont rangées dans la base (table `agent.skills_privees`, lisible du seul serveur) et le pont `alfred-pont` les remet à l'iMac, qui les écrit dans `.claude/skills/`.
