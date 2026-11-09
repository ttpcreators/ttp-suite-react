#!/bin/zsh
# Installe (ou met à jour) Alfred sur ce Mac, dans ~/Code/TTPAlfred, et programme :
#   com.ttp.alfred         toutes les heures (rappels, points de 9 h et 17 h en semaine)
#   com.ttp.alfred.ecoute  l'écoute Telegram continue (réponse tout de suite quand Marc écrit)
#   com.ttp.alfred.maj     la mise à jour automatique depuis GitHub (chaque nuit à 4 h et au démarrage)
# Alfred lit TTP Suite par le connecteur « TTP Suite » du compte Claude de Marc (claude.ai) :
# il suffit que `claude` soit connecté (/login). Relançable : ne touche ni à etat/ (son suivi,
# sa mémoire), ni à config.env, ni à REDACTION.md (consignes de rédaction de Marc, locales).
#
#   ./installer.sh --bot <chat_id>   enregistre le jeton du bot d'Alfred (demandé, caché) et
#                                    l'identifiant Telegram de Marc
#   ./installer.sh                   copie le programme et programme les passages
#   ./installer.sh --sans-horaires   copie seulement, sans rien programmer
set -e
SRC=${0:A:h}
DEST="$HOME/Code/TTPAlfred"
AGENTS="$HOME/Library/LaunchAgents"

mkdir -p "$DEST/etat/envoi"
if [[ "$1" == "--bot" ]]; then
  [[ -n "$2" ]] || { echo "Usage : ./installer.sh --bot <chat_id_telegram_de_Marc>" >&2; exit 1; }
  read -rs "jeton?Colle le jeton du bot Alfred (donné par @BotFather), puis Entrée : "
  echo
  [[ "$jeton" == <->:* ]] || { echo "Ce n'est pas un jeton de bot Telegram." >&2; exit 1; }
  print -r -- "TELEGRAM_CHAT_ID=$2" > "$DEST/config.env"
  print -r -- "ALFRED_BOT_TOKEN=$jeton" >> "$DEST/config.env"
  chmod 600 "$DEST/config.env"
  echo "Bot d'Alfred enregistré."
  exit 0
fi

cp "$SRC/CLAUDE.md" "$SRC/alfred.sh" "$SRC/ecoute.sh" "$SRC/telegram.mjs" "$SRC/mise-a-jour.sh" "$DEST/"
chmod +x "$DEST/alfred.sh" "$DEST/ecoute.sh" "$DEST/mise-a-jour.sh"
# Ses skills (skills/<nom>/SKILL.md) : chargées par Claude depuis .claude/skills du dossier d'Alfred.
# Chaque skill du dépôt remplace sa copie ; une skill ajoutée à la main sur le Mac n'est pas touchée.
if [ -d "$SRC/skills" ]; then
  mkdir -p "$DEST/.claude/skills"
  for d in "$SRC"/skills/*(/N); do rsync -a --delete "$d/" "$DEST/.claude/skills/${d:t}/"; done
fi
if ! grep -q '^ALFRED_BOT_TOKEN=' "$DEST/config.env" 2>/dev/null; then
  echo "Il manque le bot d'Alfred : ./installer.sh --bot <chat_id>" >&2
  exit 1
fi
if [[ "$1" == "--sans-horaires" ]]; then
  echo "Alfred copié dans $DEST (rien de programmé)."
  exit 0
fi
for nom in com.ttp.alfred com.ttp.alfred.ecoute com.ttp.alfred.maj; do
  sed "s#__HOME__#$HOME#g" "$SRC/$nom.plist" > "$AGENTS/$nom.plist"
  # Lancé par la mise à jour automatique elle même : elle ne se relance pas en cours de route
  # (sa nouvelle version sera prise au prochain démarrage).
  [[ "$nom" == com.ttp.alfred.maj && -n "$ALFRED_MAJ" ]] && continue
  launchctl bootout "gui/$(id -u)/$nom" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$nom.plist"
done
echo "Alfred installé : il écoute Telegram en continu, fait le point à 9 h et 17 h en semaine, envoie tes rappels à l'heure, et se met à jour tout seul chaque nuit."
