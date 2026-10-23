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

## gmail-thread : supprimer un brouillon (2026-10-21, jeton « modify »)
Entrée : `{ action: "draft-delete", draftId, box? }` (`draftId` : lettres, chiffres, tiret, 64 max, sinon 400 `draft_requis`).
→ `DELETE drafts/{id}`. Sortie : `{ ok: true, action }` ; brouillon déjà absent (envoyé, supprimé) → `{ ok: true, action, gone: true }`.
Une ancienne version répond `action_inconnue` (400) sans rien faire : l'app garde le brouillon et le dit.
Appelé par l'app après un envoi réussi depuis un brouillon Gmail (échec : le mail envoyé reste envoyé, simple message), ou par « Supprimer le brouillon » (avec confirmation ; suppression définitive dans Gmail).

## gmail-history
### Boîte de réception (`inbox: true`)
Entrée : `{ inbox: true, box: "all"|"partnerships"|"talent", folder?: "inbox"|"sent", q?: string (≤ 200 car., recherche Gmail), pageTokens?: { partnerships?: string; talent?: string } }`
Sortie : `{ ok, threads: Thread[], nextPageTokens?: { partnerships?: string; talent?: string }, partial?: true, failedBoxes?: ("partnerships"|"talent")[] }`
- `Thread` = champs actuels + `to: string[]` (adresses To/Cc/Delivered-To de tous les messages du fil, en minuscules, uniques, 20 max) + `archived: boolean` (fil sans le label INBOX, utile en recherche).
- Avec `q` : recherche dans tout Gmail (`in:anywhere` ajouté si le dossier est « inbox »), sans exclure promotions/réseaux.
- Un fil illisible après nouvelles tentatives → absent + `partial: true` (jamais en silence).
### Brouillons (`inbox: true, folder: "drafts"`) (2026-10-21)
Entrée : `{ inbox: true, box: "all"|"partnerships"|"talent", folder: "drafts" }` (jeton de lecture suffisant).
Sortie : `{ ok, folder: "drafts", threads: DraftRow[], partial?: true, failedBoxes?: (…)[] }`
- 50 brouillons max par boîte : `drafts.list` puis `drafts.get?format=full` (8 lectures à la fois).
- `DraftRow` = forme d'un fil (`subject`, `name`/`email` = premier destinataire, `snippet`, `ts` = internalDate, `count: 1`, `direction: "out"`, `unread: false`, `archived: false`, `box`) + `draftId`, `messageId`, `threadId` (fil de la réponse, ou fil propre d'un nouveau mail), `to`/`cc`/`bcc` (adresses), `reply` (en-tête In-Reply-To présent), `inReplyTo`, `references`, `byClaude` (en-tête `X-TTP-Source: claude`, posé par `ttp-mcp` / `creer_brouillon_mail`), `html`/`text` (60 000 car. max chacun, `bodyCut: true` si coupé), `attachments` (noms, non repris par l'app).
- L'écho `folder: "drafts"` est obligatoire : une ancienne version renvoie la boîte de réception sans lui, l'app affiche alors « Brouillons pas encore installés… » (et les brouillons gardés sur l'appareil).
- App : une réponse (`reply` + `threadId`) s'ouvre dans son fil, zone de réponse pré-remplie (la copie locale garde `gdraft: { id, box }`) ; un nouveau mail s'ouvre dans « Nouveau mail » (copie locale `gdraft:<boîte>:<id>` seulement si modifié). Envoi par `gmail-send` comme d'habitude, puis `draft-delete`. Jamais d'envoi automatique.
### Coup d'œil (`peek: true`) — 1 appel léger par boîte
Entrée : `{ peek: true, box: "all"|"partnerships"|"talent" }`
Sortie : `{ ok, boxes: { partnerships?: { historyId: string; unread: number }, talent?: {…} } }` (`unread` = `threadsUnread` du label INBOX).
### Historique d'un contact (`contact`) : inchangé.

## gmail-thread
Chaque message ajoute : `messageIdHeader` (Message-ID), `inReplyTo`, `references`, `replyTo` (en-tête Reply-To, vide si absent).
- `draft: true` (2026-10-21) sur un message brouillon (libellé DRAFT) : l'app ne l'affiche pas dans le fil (ni pour calculer la réponse) et propose « Reprendre » dans la zone de réponse.
- `direction` décidée par le domaine de l'agence (expéditeur hors @ttpcreators.pro = "in").
- Corps décodés selon le `charset` de chaque partie (windows-1252, iso-8859-1…).
- Pièces : `inline: true` + `cid` pour les images intégrées ; dans `html`, les `cid:` des images ≤ 200 Ko (5 max) sont remplacés par des `data:` ; les pièces `inline` ne doivent pas être listées comme pièces jointes par l'app.

## gmail-send
Entrée actuelle + `references?: string` (chaîne de Message-ID, CR/LF retirés, 2 Ko max). En-têtes `In-Reply-To` et `References` posés quand fournis. Corps HTML encodé en base64 (lignes de 76).
Erreurs : `limite_gmail` (429 / quotas), `pieces_trop_lourdes` (> 18 Mo bruts ou 413/400 « too large »), `google_non_connecte` (401 / invalid_grant), `gmail_scope_manquant` (403 insufficientPermissions), `envoi_echoue`.
Limite côté app : 18 Mo bruts de pièces jointes.

### Réactions emoji (2026-10-23)
Entrée : `{ to, cc?, subject, inReplyTo, references?, threadId?, box?, reaction: { emoji, name? } }`, **sans `html`** (une ancienne version répond alors `contenu_requis` 400 : l'app affiche « mise à jour serveur nécessaire », rien ne part). Un seul emoji (sinon 400 `reaction_invalide`) ; `inReplyTo` obligatoire, pas de pièce jointe ni de transfert (sinon 400 `reaction_sans_message`). MIME : multipart/alternative text/plain, `text/vnd.google.email-reaction+json` (`{"emoji","version":1}`), text/html (repli « {name} a réagi avec {emoji} »). Sortie : `{ ok, id, threadId, box, reaction }` (écho obligatoire pour l'app). gmail-thread : chaque message ajoute `reaction` (emoji d'une partie de réaction valide) et `list: true` (en-tête List-Id).

## creator-mail
- `thread` / `attachment` (créateur ou aperçu agence) : seuls les messages qui concernent l'alias du créateur (ou le label, qui vaut pour tout le fil) ; les autres adresses @ttpcreators.pro dans To/Cc sont remplacées par « TTP Creators ».
- Alias refusé (= talent@, boîte partagée, ou utilisé par un autre créateur) → `configured: false`.
- Section désactivée : toute action autre que `list` → 403 `{ error: "section_desactivee" }`.
- `list` accepte `fresh: true` (ignore le cache) ; liste incomplète → `partial: true`, jamais mise en cache.
- Notes renvoyées avec `by_role` et `author_name`.

## Fonctions sans changement d'interface
gmail-poll (relève : ne plante plus, les deux boîtes, sans écraser les réglages), send-email, gmail-reconcile.
