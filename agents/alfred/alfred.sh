#!/bin/zsh
# Alfred, le bras droit et talent manager de Marc. Deux façons de le lancer :
#   alfred.sh --reponse : lancé par l'écoute Telegram (telegram.mjs ecoute) dès que Marc écrit,
#                         Alfred lui répond tout de suite.
#   alfred.sh           : launchd, toutes les heures pile. Envoie les rappels arrivés à
#                         l'heure ; du lundi au vendredi à 9 h et 17 h, fait le POINT (mails
#                         des marques, DM, devis, relances, créateurs, argent à aller chercher).
#   alfred.sh --point   : un point tout de suite (test).
# Alfred lit TTP Suite par le connecteur « TTP Suite » du compte Claude de Marc, prépare des
# brouillons, tient la to-do et dépose ses messages pour Marc dans etat/envoi/ ; ce script les
# envoie ensuite par le bot Telegram d'Alfred, à Marc seul. Un mail ne part que sur un « oui »
# de Marc reçu pendant CE passage, ou dans une délégation où Marc a autorisé l'envoi.
# Aucun secret ici.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"
export LC_TIME=fr_FR.UTF-8
# Un motif sans fichier (etat/envoi/ vide) donne une liste vide, pas une erreur.
setopt null_glob
cd "$HOME/Code/TTPAlfred" || exit 1
mkdir -p etat/envoi
touch etat/suivi.md etat/conversation.md etat/memoire.md etat/rappels.md etat/delegations.md
LOG=etat/passages.log

if [ ! -f config.env ]; then
  echo "$(date) : config.env manquant, passage sauté" >> "$LOG"
  exit 0
fi

# Un seul Alfred à la fois : on attend la fin du passage en cours (20 minutes au plus).
for i in {1..120}; do
  mkdir etat/verrou 2>/dev/null && break
  (( i == 120 )) && { echo "$(date) : verrou toujours pris, passage sauté" >> "$LOG"; exit 0; }
  sleep 10
done
trap 'rmdir etat/verrou 2>/dev/null' EXIT

# Les fichiers restent légers : on ne garde que la fin.
garder() { [ -f "$1" ] && (( $(wc -l < "$1") > $2 )) && { tail -n "$2" "$1" > "$1.tmp" && mv "$1.tmp" "$1"; } }
garder "$LOG" 3000
garder etat/conversation.md 400
garder etat/suivi.md 600
# Les previews analysées ne sont gardées que 14 jours.
[ -d etat/previews ] && find etat/previews -mindepth 1 -maxdepth 1 -mtime +14 -exec rm -rf {} +

# Rappels arrivés à l'heure : envoyés tels quels, sans réveiller Claude.
[[ "$1" != "--reponse" ]] && node telegram.mjs rappels >> "$LOG" 2>&1

# Messages de Marc en attente : la file passe dans etat/recu.txt pour ce passage (et leurs
# numéros dans etat/recu-ids.txt, pour que la réponse cite son dernier message).
: > etat/recu.txt
: > etat/recu-ids.txt
if [ -s etat/file-recue.txt ]; then
  mv etat/file-recue.txt etat/recu.txt
  [ -f etat/file-recue-ids.txt ] && mv etat/file-recue-ids.txt etat/recu-ids.txt
fi
recus=$(grep -c '^\[' etat/recu.txt)

jour=$(date +%u)
heure=$((10#$(date +%H)))
if [[ "$1" == "--point" ]] || { [[ "$1" != "--reponse" ]] && (( jour <= 5 )) && (( heure == 9 || heure == 17 )); }; then
  (( heure < 13 )) && mode="le point du matin" || mode="le point du soir"
elif (( recus > 0 )); then
  mode="la réponse à Marc"
else
  exit 0
fi

now=$(date +%s)
last=$(cat etat/dernier-passage 2>/dev/null)
[[ "$last" == <-> ]] || last=$((now - 86400))
# 15 minutes de marge pour ne rater aucun mail arrivé pendant le point précédent.
after=$((last - 900))
requete="after:$after -in:sent -category:promotions -category:social"

# Délégation en cours où Marc a autorisé l'envoi (ligne « jusqu'au AAAA-MM-JJ · … · envoi autorisé »).
aujourdhui=$(date +%Y-%m-%d)
delegue=0
while IFS= read -r ligne; do
  [[ "$ligne" == *"envoi autorisé"* && "$ligne" =~ "jusqu'au ([0-9]{4}-[0-9]{2}-[0-9]{2})" ]] || continue
  [[ ! "${match[1]}" < "$aujourdhui" ]] && delegue=1
done < etat/delegations.md

# Ce que l'agent a le droit de faire : lire TTP Suite et les media kits du site, préparer des
# brouillons de mails et des devis, tenir la to-do, les collabs (création, étapes, briefs,
# contacts, échanges, rendez-vous ; choix de Marc le 2026-11-06 : il le fait et le dit), la
# mémoire des créateurs, lire ses fichiers et écrire dans etat/ (Edit couvre aussi Write).
# Sans message de Marc : jamais supprimer, régler l'app, toucher aux factures, ni envoyer.
# Quand Marc écrit : tous les outils de TTP Suite, pour faire ce qu'il demande. Envoyer un brouillon et retenir une leçon :
# seulement quand Marc vient d'écrire, ou pendant une délégation avec envoi autorisé.
ttp="mcp__claude_ai_TTP_Suite__"
lire="brouillons_claude journal_agents lire_agent point_du_jour rechercher lister_createurs fiche_createur contrats verifier_exclusivite rechercher_mails lire_mail dm_instagram contacts pipeline collabs planning taches factures reversements methode_tarif memoire_createur lire_brief notifications checklist bilans sourcing stats journal_activite lire_donnees a_valider"
agir="noter_journal creer_meet creer_brouillon_mail supprimer_brouillon preparer_devis creer_tache cocher_tache avancer_collab creer_element modifier_element ajouter_contact noter_echange_contact creer_evenement"
sur_oui="envoyer_brouillon noter_lecon"
interdits="envoyer_mail envoyer_dm supprimer_element reglages_app preparer_facture ecarter_proposition proposer_action preparer_reponse_mail ajouter_au_scouting changer_statut_scouting resumer_brief"
# Seule commande permise : télécharger et découper une vidéo dont le lien est dans un mail.
allowed=("Read" "Edit(./etat/**)" "WebFetch" "WebSearch" "Bash(node telegram.mjs telecharger:*)")
denied=("mcp__claude_ai_Gmail" "mcp__plugin_telegram_telegram")
if (( recus > 0 )); then
  # Marc vient d'écrire : Alfred gère toute l'app sur sa demande (choix de Marc le 2026-11-06).
  # Ses consignes gardent la règle : un mail ou un DM ne part que sur un « oui » explicite.
  allowed+=("mcp__claude_ai_TTP_Suite")
else
  for t in ${=lire} ${=agir}; do allowed+=("$ttp$t"); done
  for t in ${=interdits}; do denied+=("$ttp$t"); done
  if (( delegue )); then
    for t in ${=sur_oui}; do allowed+=("$ttp$t"); done
  else
    for t in ${=sur_oui}; do denied+=("$ttp$t"); done
  fi
fi
if (( recus > 0 )); then
  messages="Marc t'a écrit $recus message(s) sur Telegram : ils sont dans etat/recu.txt (le fil complet est dans etat/conversation.md). Réponds-lui en premier."
else
  messages="Marc ne t'a rien écrit depuis la dernière fois."
fi
(( delegue )) && messages="$messages Une délégation avec envoi autorisé est en cours (etat/delegations.md) : tu peux envoyer ce qu'elle couvre, et seulement ça."
(( recus == 0 && ! delegue )) && messages="$messages Tu ne peux envoyer aucun mail pendant ce passage."

rm -f etat/envoi/*
{
  echo "===== $(date) · $mode ($recus message(s) de Marc) ====="
  claude -p "Il est $(date '+%H:%M') ce $(date '+%A %d %B %Y'). C'est $mode. $messages Dernier point fait : $(date -r "$last" '+%A %d %B à %H:%M'). Requête Gmail pour les mails reçus depuis : « $requete ». Fais ce passage selon ton CLAUDE.md, puis dépose tes messages pour Marc dans etat/envoi/." \
    --allowedTools "${allowed[@]}" \
    --disallowedTools "${denied[@]}" \
    --max-turns 150
  code=$?
  echo "===== fin $(date) · code $code ====="
} >> "$LOG" 2>&1

envois=(etat/envoi/*)
if [ "$code" -eq 0 ] && (( ${#envois} > 0 )); then
  if node telegram.mjs dossier etat/envoi >> "$LOG" 2>&1; then
    [[ "$mode" == "le point"* ]] && echo "$now" > etat/dernier-passage
  fi
else
  # Passage raté (souvent la connexion de Claude) : les messages de Marc restent en file pour
  # le prochain passage, et Marc est prévenu.
  [ -s etat/recu.txt ] && { cat etat/recu.txt; [ -f etat/file-recue.txt ] && cat etat/file-recue.txt; } > etat/file-recue.tmp && mv etat/file-recue.tmp etat/file-recue.txt
  [ -s etat/recu-ids.txt ] && { cat etat/recu-ids.txt; [ -f etat/file-recue-ids.txt ] && cat etat/file-recue-ids.txt; } > etat/file-recue-ids.tmp && mv etat/file-recue-ids.tmp etat/file-recue-ids.txt
  raison=$(tail -n 4 "$LOG" | grep -i -m1 "authenticate\|login\|error\|erreur")
  node telegram.mjs texte "Alfred n'a pas pu faire $mode. ${raison:+Raison : $raison. }Si c'est la connexion : ouvre le Terminal, tape claude puis /login." >> "$LOG" 2>&1
fi
