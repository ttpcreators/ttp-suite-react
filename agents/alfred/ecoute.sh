#!/bin/zsh
# Écoute Telegram d'Alfred, en continu (launchd : com.ttp.alfred.ecoute, relancée si elle s'arrête).
# Dès que Marc écrit au bot d'Alfred, lance alfred.sh --reponse. Aucun secret ici.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"
cd "$HOME/Code/TTPAlfred" || exit 1
mkdir -p etat
exec node telegram.mjs ecoute >> etat/ecoute.log 2>&1
