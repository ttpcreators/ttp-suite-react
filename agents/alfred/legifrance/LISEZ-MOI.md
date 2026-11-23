# Légifrance et Judilibre pour Alfred

Le serveur MCP de [jmtanguy/droit-francais-mcp](https://github.com/jmtanguy/droit-francais-mcp) (licence MIT, voir `LICENSE`, version du 21 novembre 2025, commit `f79a9ae`), copié sans modification à part `requirements.txt` (réécrit en UTF-8) et `lancer.sh` (ajouté). Il lit les codes, lois et décrets en vigueur (Légifrance) et les décisions de justice (Judilibre) par les API publiques de l'État (PISTE). Il ne parle qu'à `piste.gouv.fr`.

Outils pour Alfred : `rechercher_legifrance`, `consulter_legifrance`, `rechercher_jurisprudence_judilibre`, `consulter_decision_judilibre`, `obtenir_taxonomie_judilibre` (voir `fiches/juridique.md`, « Le raisonnement juridique »).

## Mise en route (facultative, une fois, sur l'iMac)

Sans clés, Alfred vérifie déjà les textes par une recherche web limitée à `legifrance.gouv.fr` (choix de Marc, 23 novembre 2026 : pas de compte PISTE). Le serveur n'apporte en plus que le texte complet et les décisions de Judilibre.

1. Marc crée son compte sur https://piste.gouv.fr, crée une application, et l'abonne aux API « Légifrance » et « JUDILIBRE » (production). Il note la clé (client ID) et le secret.
2. Il les ajoute à `~/Code/TTPAlfred/config.env`, deux lignes :
   `PISTE_CLIENT_ID=...` et `PISTE_CLIENT_SECRET=...`
3. Il faut Python 3.10 ou plus (`brew install python@3.12` si besoin).
4. `installer.sh` (ou la mise à jour de 4 h) crée l'environnement Python, installe les dépendances et branche le serveur. Sans les clés, rien n'est branché et Alfred écrit « article à vérifier ».
