#!/bin/zsh
# Alfred, le bras droit et talent manager de Marc. Deux façons de le lancer :
#   alfred.sh --reponse : lancé par l'écoute Telegram (telegram.mjs ecoute) dès que Marc écrit,
#                         Alfred lui répond tout de suite (réponse rapide : modèle rapide, son propre
#                         verrou et son dossier etat/envoi-reponse, pour ne pas attendre la fin d'un
#                         point, et chaque message part dès qu'il est écrit). « --reponse reprise » :
#                         l'écoute relance une réponse remise à plus tard (limite de l'abonnement
#                         Claude, Claude surchargé), à l'heure prévue par passage.mjs.
#   alfred.sh           : launchd, toutes les heures pile. Envoie les rappels arrivés à
#                         l'heure ; du lundi au vendredi à 9 h et 17 h, fait le POINT (mails
#                         des marques, DM, devis, relances, créateurs, argent à aller chercher).
#                         Le lundi à 11 h : la prospection de la semaine ; le premier lundi
#                         du mois à 14 h : la revue des tarifs ; le mercredi à 11 h : le
#                         recrutement. Et, une heure avant chaque rendez-vous du jour, sa fiche.
#                         En mode vacances (etat/vacances.txt) : le point du matin seulement.
#   alfred.sh --point | --prospection | --tarifs | --recrutement : ce passage tout de suite (test).
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
# Une réponse à Marc a son propre verrou et son propre dossier d'envoi : elle n'attend pas la fin
# d'un point (qui peut durer un quart d'heure). Les deux peuvent tourner en même temps.
if [[ "$1" == "--reponse" ]]; then
  ENVOI=etat/envoi-reponse
  VERROU=etat/verrou-reponse
  RECU=etat/recu-reponse.txt
  RECU_IDS=etat/recu-reponse-ids.txt
else
  ENVOI=etat/envoi
  VERROU=etat/verrou
  RECU=etat/recu.txt
  RECU_IDS=etat/recu-ids.txt
fi
export ALFRED_ENVOI=$ENVOI ALFRED_RECU=$RECU ALFRED_RECU_IDS=$RECU_IDS
# D'où vient ce passage : Marc vient d'écrire (marc), launchd toutes les heures (auto), ou l'écoute
# qui relance une réponse remise à plus tard (reprise). Sert à ne pas redire à Marc ce qu'il sait.
origine=auto
[[ "$1" == "--reponse" ]] && origine=marc
[[ "$2" == "reprise" ]] && origine=reprise
mkdir -p etat/envoi etat/envoi-reponse
touch etat/suivi.md etat/conversation.md etat/memoire.md etat/rappels.md etat/delegations.md etat/vacances.txt
LOG=etat/passages.log

if [ ! -f config.env ]; then
  echo "$(date) : config.env manquant, passage sauté" >> "$LOG"
  exit 0
fi

# Un seul passage de chaque sorte à la fois : on attend la fin du précédent (20 minutes au plus).
for i in {1..120}; do
  mkdir "$VERROU" 2>/dev/null && break
  (( i == 120 )) && { echo "$(date) : verrou toujours pris, passage sauté" >> "$LOG"; exit 0; }
  sleep 10
done
trap 'rmdir "$VERROU" 2>/dev/null' EXIT

# Les fichiers restent légers : on ne garde que la fin.
garder() { [ -f "$1" ] && (( $(wc -l < "$1") > $2 )) && { tail -n "$2" "$1" > "$1.tmp" && mv "$1.tmp" "$1"; } }
# (pas pendant une réponse rapide : un point peut tourner en même temps et écrire dans ces fichiers)
if [[ "$1" != "--reponse" ]]; then
  garder "$LOG" 3000
  garder etat/conversation.md 400
  garder etat/suivi.md 600
fi
# Les previews analysées ne sont gardées que 14 jours.
[ -d etat/previews ] && find etat/previews -mindepth 1 -maxdepth 1 -mtime +14 -exec rm -rf {} +
# Les pièces jointes copiées depuis Spark (etat/pieces) aussi : 14 jours.
[ -d etat/pieces ] && find etat/pieces -type f -mtime +14 -delete

# Rappels arrivés à l'heure : envoyés tels quels, sans réveiller Claude.
[[ "$1" != "--reponse" ]] && node telegram.mjs rappels >> "$LOG" 2>&1

# Messages de Marc en attente : la file passe dans $RECU pour ce passage (et leurs numéros dans
# $RECU_IDS, pour que la réponse cite son dernier message). Une réponse rapide et un point ont
# chacun leurs fichiers : le premier lancé prend la file.
: > "$RECU"
: > "$RECU_IDS"
if [ -s etat/file-recue.txt ]; then
  mv etat/file-recue.txt "$RECU"
  [ -f etat/file-recue-ids.txt ] && mv etat/file-recue-ids.txt "$RECU_IDS"
fi
recus=$(grep -c '^\[' "$RECU")

jour=$(date +%u)
heure=$((10#$(date +%H)))
quantieme=$((10#$(date +%d)))
auto=0
[[ "$1" != "--reponse" ]] && auto=1
aujourdhui=$(date +%Y-%m-%d)

# Mode vacances : etat/vacances.txt commence par « AAAA-MM-JJ », le dernier jour d'absence de
# Marc (écrit par Alfred quand Marc dit « je pars jusqu'au … »). Pendant l'absence : le point du
# matin seulement (l'urgent), pas de point du soir, de prospection, de revue ni de recrutement.
# Le premier point après : le résumé du retour, puis le fichier est vidé.
vacances=""
retour=0
fin_vacances=$(head -n 1 etat/vacances.txt | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -n 1)
if [[ -n "$fin_vacances" ]]; then
  if [[ "$aujourdhui" > "$fin_vacances" ]]; then retour=1; else vacances="$fin_vacances"; fi
fi

# Rendez-vous du jour (notés par Alfred dans etat/rdv-du-jour.txt, « AAAA-MM-JJ HH:MM · titre ») :
# ceux qui commencent dans 45 à 105 minutes reçoivent leur fiche de préparation, une seule fois.
touch etat/rdv-du-jour.txt etat/rdv-prepares.txt
rdv_dus=()
if (( auto )); then
  maintenant=$(( 10#$(date +%H) * 60 + 10#$(date +%M) ))
  aujourdhui_rdv=$(date +%Y-%m-%d)
  while IFS= read -r ligne; do
    [[ "$ligne" =~ "^([0-9]{4}-[0-9]{2}-[0-9]{2}) ([0-9]{1,2}):([0-9]{2})" ]] || continue
    [[ "${match[1]}" == "$aujourdhui_rdv" ]] || continue
    dans=$(( 10#${match[2]} * 60 + 10#${match[3]} - maintenant ))
    (( dans >= 45 && dans < 105 )) || continue
    grep -qxF -- "$ligne" etat/rdv-prepares.txt || rdv_dus+=("$ligne")
  done < etat/rdv-du-jour.txt
fi
if [[ "$1" == "--point" ]] || (( auto && jour <= 5 && heure == 9 )) || (( auto && jour <= 5 && heure == 17 && ! ${#vacances} )); then
  (( heure < 13 )) && mode="le point du matin" || mode="le point du soir"
# Le lundi à 11 h : la prospection de la semaine, créateur par créateur.
elif [[ "$1" == "--prospection" ]] || (( auto && ! ${#vacances} && jour == 1 && heure == 11 )); then
  mode="la prospection de la semaine"
# Le premier lundi du mois à 14 h : la revue des tarifs.
elif [[ "$1" == "--tarifs" ]] || (( auto && ! ${#vacances} && jour == 1 && quantieme <= 7 && heure == 14 )); then
  mode="la revue des tarifs du mois"
# Le mercredi à 11 h : le recrutement de la semaine (scouting).
elif [[ "$1" == "--recrutement" ]] || (( auto && ! ${#vacances} && jour == 3 && heure == 11 )); then
  mode="le recrutement de la semaine"
elif (( recus > 0 )); then
  mode="la réponse à Marc"
elif (( ${#rdv_dus} > 0 )); then
  mode="la préparation des rendez-vous"
else
  exit 0
fi

# Le modèle : rapide pour répondre à Marc, le plus fort pour les points, la prospection, les
# revues et les rendez-vous. Réglables dans config.env (ALFRED_MODELE_REPONSE, ALFRED_MODELE_POINT).
reglage() { grep -m1 "^$1=" config.env | cut -d= -f2- | tr -d "\"' " }
if [[ "$mode" == "la réponse à Marc" ]]; then
  modele=$(reglage ALFRED_MODELE_REPONSE)
  modele=${modele:-sonnet}
else
  modele=$(reglage ALFRED_MODELE_POINT)
  modele=${modele:-opus}
fi

now=$(date +%s)
last=$(cat etat/dernier-passage 2>/dev/null)
[[ "$last" == <-> ]] || last=$((now - 86400))
# 15 minutes de marge pour ne rater aucun mail arrivé pendant le point précédent.
after=$((last - 900))
requete="after:$after -in:sent -category:promotions -category:social"

# Délégation en cours où Marc a autorisé l'envoi (ligne « jusqu'au AAAA-MM-JJ · … · envoi autorisé »,
# ou « permanent · … · envoi autorisé » pour une délégation sans fin, comme les relances automatiques).
delegue=0
while IFS= read -r ligne; do
  [[ "$ligne" == *"envoi autorisé"* ]] || continue
  # Délégation permanente (ex. relances automatiques activées par Marc) : sans date de fin.
  if [[ "$ligne" == *"permanent"* ]]; then delegue=1; continue; fi
  [[ "$ligne" =~ "jusqu'au ([0-9]{4}-[0-9]{2}-[0-9]{2})" ]] || continue
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
lire="droits_usage posts_createur brouillons_claude journal_agents stats_collab compta lire_agent point_du_jour rechercher lister_createurs fiche_createur contrats verifier_exclusivite rechercher_mails lire_mail dm_instagram contacts pipeline collabs planning taches factures reversements methode_tarif memoire_createur lire_brief notifications checklist bilans sourcing stats journal_activite lire_donnees a_valider"
agir="noter_droits noter_journal creer_meet ajouter_au_scouting changer_statut_scouting creer_brouillon_mail supprimer_brouillon preparer_devis creer_tache cocher_tache avancer_collab creer_element modifier_element ajouter_contact noter_echange_contact creer_evenement"
sur_oui="envoyer_brouillon noter_lecon"
interdits="envoyer_mail envoyer_dm supprimer_element reglages_app preparer_facture ecarter_proposition proposer_action preparer_reponse_mail resumer_brief"
# Seule commande permise : télécharger et découper une vidéo dont le lien est dans un mail.
# Skill : ses skills (.claude/skills, voir skills/LISEZ-MOI.md du dépôt), des consignes à lire.
# WhatsApp (choix de Marc le 2026-11-10) : lecture seule des discussions de etat/whatsapp-autorises.txt
# (whatsapp.mjs refuse les autres ; Alfred ne peut pas modifier cette liste). Spark (choix de Marc le
# 2026-11-10) : lire les boîtes des créateurs gérées dans Spark Desktop et y préparer des brouillons,
# seulement par spark.mjs, qui refuse toute boîte hors de TTP Creators (ALFRED_SPARK_BOITES dans config.env).
# Jamais d'envoi, de suppression ni d'action.
# Cloisonnement (choix de Marc le 2026-11-11 : Alfred reste dans TTP, rien d'un autre projet) :
# il ne lit que son dossier (Read sur son dossier), n'appelle jamais `spark` directement, et ne
# charge pas les réglages, skills et consignes globaux du Mac (--setting-sources plus bas).
# Chemins complets (« //… ») : une règle en « ./ » se lit depuis le dossier courant, et après un
# « cd etat » d'Alfred elle visait etat/etat, d'où « écriture refusée » et des réponses perdues
# (trouvé le 2026-11-12). En plus, chaque commande Bash le ramène dans son dossier (plus bas).
ici="/$PWD"
allowed=("Read($ici/**)" "Edit($ici/etat/**)" "WebFetch" "WebSearch" "Skill" "Bash(node telegram.mjs telecharger:*)" "Bash(node telegram.mjs joindre:*)"
  "Bash(node spark.mjs:*)" "Bash(node whatsapp.mjs:*)")
denied=("mcp__claude_ai_Gmail" "mcp__plugin_telegram_telegram" "Bash(spark:*)"
  "Edit($ici/etat/whatsapp-autorises.txt)")
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
if [[ "$mode" == "la réponse à Marc" ]]; then
  messages="RÉPONSE RAPIDE (voir « La réponse rapide ») : Marc t'a écrit $recus message(s) sur Telegram, ils sont dans $RECU (le fil complet est dans etat/conversation.md). Réponds-lui seulement à ça, vite : chaque fichier de $ENVOI/ lui part dès que tu l'as écrit."
elif (( recus > 0 )); then
  messages="Marc t'a écrit $recus message(s) sur Telegram : ils sont dans $RECU (le fil complet est dans etat/conversation.md). Réponds-lui en premier."
else
  messages="Marc ne t'a rien écrit depuis la dernière fois."
fi
(( delegue )) && messages="$messages Une délégation avec envoi autorisé est en cours (etat/delegations.md) : tu peux envoyer ce qu'elle couvre, et seulement ça."
(( ${#rdv_dus} > 0 )) && messages="$messages Rendez-vous dans environ une heure, à préparer (voir « La fiche avant chaque rendez-vous ») : ${(j:; :)rdv_dus}."
(( recus == 0 && ! delegue )) && messages="$messages Tu ne peux envoyer aucun mail pendant ce passage."
[[ -n "$vacances" ]] && messages="$messages MODE VACANCES : Marc est absent jusqu'au $vacances inclus (voir « Le mode vacances ») : seulement l'urgent, très court."
[[ "$mode" == "le point du matin" ]] && (( retour )) && messages="$messages Marc rentre de vacances (absent jusqu'au $fin_vacances) : commence par le résumé de son absence (voir « Le mode vacances »)."

# Limite de l'abonnement Claude atteinte (notée dans etat/reprise.json au passage raté) : pas de
# passage avant qu'elle reparte. Les messages de Marc restent en file, il est prévenu, et l'écoute
# lui répond toute seule à l'heure dite (passage.mjs).
attente=$(node passage.mjs attente "$mode" "$origine" 2>> "$LOG")
if (( $? == 3 )); then
  [[ -n "$attente" ]] && node telegram.mjs texte "$attente" >> "$LOG" 2>&1
  echo "$(date) : $mode reporté, limite de l'abonnement Claude" >> "$LOG"
  exit 0
fi

# Après chaque commande Bash, Alfred revient dans son dossier : un « cd » ne change rien pour la suite.
export CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1
# Si le modèle choisi est surchargé ou indisponible, Claude passe tout seul à l'autre.
[[ "$modele" == *opus* ]] && secours=sonnet || secours=opus
consigne="Il est $(date '+%H:%M') ce $(date '+%A %d %B %Y'). C'est $mode. $messages Dernier point fait : $(date -r "$last" '+%A %d %B à %H:%M'). Requête Gmail pour les mails reçus depuis : « $requete ». Fais ce passage selon ton CLAUDE.md et tes fiches, puis dépose tes messages pour Marc dans $ENVOI/ avec l'outil Write (jamais Bash pour écrire un fichier : echo, printf, cat et mkdir te sont refusés, et le dossier existe déjà). Si un outil t'est refusé, prends l'outil prévu sans demander d'autorisation : personne ne peut t'en donner pendant le passage."
# La sortie de Claude (JSON : réussi ou raté, et pourquoi) : etat/sortie.json, ou etat/sortie-reponse.json.
SORTIE="etat/sortie${ENVOI#etat/envoi}.json"
lancer() {
  rm -f "$SORTIE"
  echo "===== $(date) · $mode ($recus message(s) de Marc, modèle $modele) =====" >> "$LOG"
  claude -p "$consigne" \
    --model "$modele" \
    --fallback-model "$secours" \
    --setting-sources project,local \
    --allowedTools "${allowed[@]}" \
    --disallowedTools "${denied[@]}" \
    --max-turns 150 \
    --output-format json < /dev/null > "$SORTIE" 2>> "$LOG" &
  cpid=$!
  # Réponse rapide : chaque message part dès qu'il est écrit, pendant que Claude travaille encore.
  spid=""
  if [[ "$mode" == "la réponse à Marc" ]]; then
    node telegram.mjs suivre "$ENVOI" "$cpid" >> "$LOG" 2>&1 &
    spid=$!
  fi
  wait "$cpid"
  code=$?
  [[ -n "$spid" ]] && wait "$spid"
  # Le bilan : « ok », ou le type d'échec (limite, connexion, surcharge, tours, autre) et sa raison.
  bilan=$(node passage.mjs bilan "$SORTIE" "$code" 2>> "$LOG")
  etat=${bilan%%$'\t'*}
  echo "===== fin $(date) · code $code · ${bilan//$'\t'/ · } =====" >> "$LOG"
  envois=("$ENVOI"/*)
  # Déjà envoyé au fil de l'eau : Marc a eu sa réponse (au moins en partie).
  deja=0
  [ -f "$ENVOI/.deja-cite" ] && deja=1
}

rm -f "$ENVOI"/* "$ENVOI"/.deja-cite
lancer
# Raté sans avoir rien envoyé, pour une raison passagère (Claude surchargé, coupure) : un nouvel
# essai 20 secondes plus tard, sans déranger Marc.
if [[ "$etat" == (surcharge|autre) ]] && (( ${#envois} == 0 && ! deja )); then
  echo "$(date) : nouvel essai dans 20 s" >> "$LOG"
  sleep 20
  lancer
fi
# Claude a répondu sans déposer de fichier : sa réponse part quand même, telle quelle.
if [[ "$etat" == ok ]] && (( ${#envois} == 0 && ! deja )); then
  node passage.mjs texte "$SORTIE" > "$ENVOI/01-resume.txt" 2>> "$LOG"
  [ -s "$ENVOI/01-resume.txt" ] || rm -f "$ENVOI/01-resume.txt"
  envois=("$ENVOI"/*)
fi

if [[ "$etat" == ok ]] && (( ${#envois} > 0 || deja )); then
  node passage.mjs reussi 2>> "$LOG"
  if (( ${#envois} == 0 )) || node telegram.mjs dossier "$ENVOI" >> "$LOG" 2>&1; then
    [[ "$mode" == "le point"* ]] && echo "$now" > etat/dernier-passage
    [[ "$mode" == "la prospection"* ]] && date +%Y-%m-%d > etat/derniere-prospection
    [[ "$mode" == "la revue des tarifs"* ]] && date +%Y-%m-%d > etat/derniere-revue-tarifs
    # Retour de vacances fait : le mode vacances s'arrête.
    [[ "$mode" == "le point du matin" ]] && (( retour )) && : > etat/vacances.txt
    for r in "${rdv_dus[@]}"; do print -r -- "$r" >> etat/rdv-prepares.txt; done
    garder etat/rdv-prepares.txt 200
  fi
elif (( deja )); then
  # Claude s'est arrêté après avoir déjà répondu en partie : on envoie ce qui reste, sans remettre
  # les messages de Marc en file (il aurait sa réponse deux fois), et on lui dit pourquoi.
  (( ${#envois} > 0 )) && node telegram.mjs dossier "$ENVOI" >> "$LOG" 2>&1
  message=$(node passage.mjs echec "$SORTIE" "$mode" "$origine" "$code" partiel 2>> "$LOG")
  node telegram.mjs texte "${message:-Je me suis arrêté avant la fin de ma réponse. Redemande-moi ce qui manque.}" >> "$LOG" 2>&1
else
  # Passage raté : passage.mjs remet les messages de Marc en file (sauf une demande trop longue),
  # prévoit la reprise (fin de la limite, ou nouvel essai dans 10 minutes) et dit à Marc la vraie
  # raison, une seule fois tant que c'est la même.
  message=$(node passage.mjs echec "$SORTIE" "$mode" "$origine" "$code" 2>> "$LOG")
  if (( $? != 0 )); then
    # passage.mjs illisible : on garde au moins les messages de Marc et on le prévient.
    [ -s "$RECU" ] && { cat "$RECU"; [ -f etat/file-recue.txt ] && cat etat/file-recue.txt; } > etat/file-recue.tmp && mv etat/file-recue.tmp etat/file-recue.txt
    [ -s "$RECU_IDS" ] && { cat "$RECU_IDS"; [ -f etat/file-recue-ids.txt ] && cat etat/file-recue-ids.txt; } > etat/file-recue-ids.tmp && mv etat/file-recue-ids.tmp etat/file-recue-ids.txt
    message="Je n'ai pas pu faire $mode (${bilan//$'\t'/ : }). Ton message est gardé."
  fi
  [[ -n "$message" ]] && node telegram.mjs texte "$message" >> "$LOG" 2>&1
fi
