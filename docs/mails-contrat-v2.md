# Mails v2 : contrat entre l'app et les fonctions Gmail (2026-10-14)

Référence partagée par les trois chantiers (serveur, page Mails agence, mails côté créateur).
Tout est rétrocompatible : un client ancien continue de marcher avec les fonctions nouvelles.

## gmail-trash : inchangé
Entrée `{ threadId, box?, undo? }` (corbeille / sortie de corbeille). On n'y ajoute RIEN : une
ancienne version déployée mettrait à la corbeille tout appel inconnu.

## gmail-thread : actions lu / non lu / archiver (jeton « modify »)
Entrée : `{ threadId, box?, action: "read"|"unread"|"archive"|"unarchive" }`
- `read` → `threads/{id}/modify {removeLabelIds:["UNREAD"]}` ; `unread` → `addLabelIds:["UNREAD"]`
- `archive` → `removeLabelIds:["INBOX"]` ; `unarchive` → `addLabelIds:["INBOX"]`
Sortie : `{ ok: true, action }` (l'écho de `action` prouve que la version déployée sait le faire :
une ancienne version renverrait le fil sans `action` et sans rien modifier → l'app n'affiche
alors pas le changement). Erreurs : `gmail_scope_manquant` 403, `limite_gmail` 429,
`google_non_connecte` 401, `action_echouee` 502.
Sans `action` : lecture du fil (comportement actuel, voir plus bas).

## gmail-history
### Boîte de réception (`inbox: true`)
Entrée : `{ inbox: true, box: "all"|"partnerships"|"talent", folder?: "inbox"|"sent", q?: string (≤ 200 car., recherche Gmail), pageTokens?: { partnerships?: string; talent?: string } }`
Sortie : `{ ok, threads: Thread[], nextPageTokens?: { partnerships?: string; talent?: string }, partial?: true, failedBoxes?: ("partnerships"|"talent")[] }`
- `Thread` = champs actuels + `to: string[]` (adresses To/Cc/Delivered-To de tous les messages du fil, en minuscules, uniques, 20 max) + `archived: boolean` (fil sans le label INBOX, utile en recherche).
- Avec `q` : recherche dans tout Gmail (`in:anywhere` ajouté si le dossier est « inbox »), sans exclure promotions/réseaux.
- Un fil illisible après nouvelles tentatives → absent + `partial: true` (jamais en silence).
### Coup d'œil (`peek: true`) — 1 appel léger par boîte
Entrée : `{ peek: true, box: "all"|"partnerships"|"talent" }`
Sortie : `{ ok, boxes: { partnerships?: { historyId: string; unread: number }, talent?: {…} } }` (`unread` = `threadsUnread` du label INBOX).
### Historique d'un contact (`contact`) : inchangé.

## gmail-thread
Chaque message ajoute : `messageIdHeader` (Message-ID), `inReplyTo`, `references`, `replyTo` (en-tête Reply-To, vide si absent).
- `direction` décidée par le domaine de l'agence (expéditeur hors @ttpcreators.pro = "in").
- Corps décodés selon le `charset` de chaque partie (windows-1252, iso-8859-1…).
- Pièces : `inline: true` + `cid` pour les images intégrées ; dans `html`, les `cid:` des images ≤ 200 Ko (5 max) sont remplacés par des `data:` ; les pièces `inline` ne doivent pas être listées comme pièces jointes par l'app.

## gmail-send
Entrée actuelle + `references?: string` (chaîne de Message-ID, CR/LF retirés, 2 Ko max). En-têtes `In-Reply-To` et `References` posés quand fournis. Corps HTML encodé en base64 (lignes de 76).
Erreurs : `limite_gmail` (429 / quotas), `pieces_trop_lourdes` (> 18 Mo bruts ou 413/400 « too large »), `google_non_connecte` (401 / invalid_grant), `gmail_scope_manquant` (403 insufficientPermissions), `envoi_echoue`.
Limite côté app : 18 Mo bruts de pièces jointes.

## creator-mail
- `thread` / `attachment` (créateur ou aperçu agence) : seuls les messages qui concernent l'alias du créateur (ou le label, qui vaut pour tout le fil) ; les autres adresses @ttpcreators.pro dans To/Cc sont remplacées par « TTP Creators ».
- Alias refusé (= talent@, boîte partagée, ou utilisé par un autre créateur) → `configured: false`.
- Section désactivée : toute action autre que `list` → 403 `{ error: "section_desactivee" }`.
- `list` accepte `fresh: true` (ignore le cache) ; liste incomplète → `partial: true`, jamais mise en cache.
- Notes renvoyées avec `by_role` et `author_name`.

## Fonctions sans changement d'interface
gmail-poll (relève : ne plante plus, les deux boîtes, sans écraser les réglages), send-email, gmail-reconcile.
