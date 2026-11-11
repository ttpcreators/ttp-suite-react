# Audit du 11 novembre 2026 : suivi des corrections

Suite de [`AUDIT-2026-11-11.md`](AUDIT-2026-11-11.md). Tout est sur la branche
`corrections-audit-2026-11`, **pas fusionnée dans `main`** : rien n'est en ligne.
Porte de qualité verte à chaque commit (lint, 873 tests, types, build).

Rien n'a été essayé dans l'app en ligne : chaque correction est couverte par un test ou
relue, pas vue à l'écran. Les fonctions serveur n'ont pas tourné : seuls leurs tests et
leurs types passent.

## Corrigé (30 points)

| Point | Ce qui change | Où ça s'active |
|---|---|---|
| B1 | Espace créateur : le texte d'une réponse reste attaché à son échange | app |
| B2 | Une facture annulée n'est plus « à venir » chez le créateur | app |
| B3 | Outil facture de Claude : devise, taux et mandat gardés ; TVA selon Compta ; facture émise protégée ; statut contrôlé | fonction `ttp-mcp` |
| B4 | Taux de change lu comme un nombre décimal, refusé au-dessus de 100 | app |
| B5 | Contrat de représentation : la fin ne déborde plus sur le mois suivant (31 août + 6 mois = 28 février, règle validée par Marc) | app |
| B6 | Media kit : l'éditeur affiche et enregistre l'adresse que le site donne vraiment | app |
| B7 | Collab restaurée : historique des étapes, date de création et liens reviennent | app |
| B8 | Registre des contrats : un contrat signé ne sort plus jamais tout seul | app |
| B9 | Factures en devise comptées en euros dans l'espace créateur et le rapport mensuel ; relance dans la devise de la facture ; devis en devise transformé en facture en devise | app + fonction `creator-report` |
| B10 | Facture au nom du créateur : sa TVA apparaît aussi dans son espace | app + fonction `creator-report` |
| B13 | La réponse d'un créateur ne part plus en double | fonction `creator-mail` |
| B14 | « Répondre à tous » garde les copies du dernier envoi de l'agence ; l'adresse « noreply » ne passe plus en copie | app |
| B15 | Prospection : la fenêtre du mail reste ouverte tant qu'il n'est pas parti | app |
| B16 | Envoi groupé partiel : seules les marques servies sont notées contactées | app + fonction `send-email` |
| B17 | Supprimer une prise de contact remet « dernier contact » à jour | app |
| B18 | Import CSV sans doublon ; refus d'un deuxième créateur au même nom | app |
| B20 | Sous-tâches et points d'avancement : plus d'écrasement entre l'agence et le créateur ; modifier un brief n'écrase plus le résumé ni le script arrivés entre-temps | app |
| B21 | Aujourd'hui : E et R n'agissent plus sur une ligne non choisie | app |
| B22 | Notification d'une tâche : la bonne tâche s'ouvre, même cachée par un filtre | app |
| B24 | Brief réattribué : le PDF joint suit le créateur | app |
| B26 | La sauvegarde mensuelle dit ce qui lui manque | fonction `monthly-backup` |
| B28 | Seuil « pas de commission sous 100 € » jugé en euros | app + fonction `ttp-mcp` |
| B30 | Jour de paiement à l'heure de Paris (Compta, Facturation) | app + fonction `ttp-mcp` |
| B32 | Double clic sur « étape suivante » : une seule étape | app |
| B33 | Agenda en vue « Semaine » : rouvre sur la semaine d'aujourd'hui | app |
| B34 | Fins de contrat : l'écran suit de nouveau les collègues | app |
| B35 | « Événement » reconnu ; tâche d'étape en jours calendaires ; mois des Stats à l'heure locale ; durée de contrat en texte lue comme un nombre ; Fins de contrat, Planning, Aujourd'hui, fiche créateur et résumé du matin annoncent la même fin que le contrat (un jour plus tôt qu'avant) | app + fonctions `google-sync`, `daily-digest`, `ttp-mcp` |
| B36 | Avis : si le mot d'explication n'est pas gardé, l'app le dit | app |
| B39 | `CLAUDE.md` : la phrase sur l'envoi des mails est juste | doc |
| B40 (en partie) | `SETUP.sql` ne s'arrête plus à la ligne 908 quand on le relance | SQL (rien à lancer) |

Fonctions à redéployer par Marc pour que les lignes « fonction » soient actives :
`ttp-mcp` (avec `--no-verify-jwt`), `creator-mail`, `creator-report`, `send-email`,
`monthly-backup`, `google-sync`, `daily-digest`. Tant que ce n'est pas fait, l'app marche comme avant sur
ces points (elle tolère l'ancienne version).

## Pas corrigé, et pourquoi

**Attend une décision de Marc**

- **B27, arrondi au centime** : le corriger change d'un centime des montants de factures
  déjà émises quand on les rouvre (taux de 5,5 %, 10 %, 15 %, 25 % ; jamais à 20 %).
- **B31, tâche partagée entre créateurs** : cochée par l'un, faite pour tous. Voulu ou non ?
- **B11, « qui encaisse » pour une collab créée par un membre** : le réglage est réservé
  aux fondateurs, donc un membre ne peut ni le lire ni l'écrire. La bonne correction est
  un petit script SQL qui pose le réglage à la création de la collab : à valider avant de
  l'écrire.
- **B19, scouting vers roster sans commission** : demande un champ en plus dans la fenêtre
  « Ajouter au roster ». Simple, mais c'est un changement d'écran.

**Demande plus de travail ou un essai en vrai**

- **B12** (durée d'un rendez-vous Google remise à 1 h) : il faut garder l'heure de fin en
  base (colonne en plus) et l'essayer avec un vrai agenda.
- **B25** (relève des mails) : toucher au repère « déjà relevé » sans pouvoir l'essayer sur
  la vraie boîte est risqué.
- **B23** (import des fins de contrat, alerte qui reste après suppression) et **B29** (deux
  versements au même instant) : points « signalés », à revérifier d'abord.
- **B37** (post programmé en échec, connexion réseau expirée : personne n'est prévenu).
- **B40, le reste** : remettre le tableau de `supabase/sql/README.md` à jour et intégrer les
  scripts de novembre à `SETUP.sql`. Demande de savoir ce qui est réellement appliqué en base.
- **B38** : rien à faire, le numéro de facture unique est déjà imposé par la base.

Les points de sécurité sont suivis hors du dépôt.
