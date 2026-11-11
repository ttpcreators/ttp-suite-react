#!/bin/zsh
# Mise à jour automatique d'Alfred (launchd : com.ttp.alfred.maj, chaque nuit à 4 h et au
# démarrage du Mac). Regarde sur GitHub la dernière version du dossier agents/alfred de la
# branche main (ttpcreators/ttp-suite-react, dépôt public : seule une mise en ligne validée par
# Marc la change). Si elle est nouvelle : téléchargement, contrôle, installation, et Marc est
# prévenu sur Telegram. Ne touche jamais à config.env, REDACTION.md ni etat/. Aucun secret ici.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin"
DEST="$HOME/Code/TTPAlfred"
SRC="$HOME/Code/agents-alfred"
REPO="ttpcreators/ttp-suite-react"
mkdir -p "$DEST/etat"
LOG="$DEST/etat/mises-a-jour.log"
note() { echo "$(date '+%Y-%m-%d %H:%M') $*" >> "$LOG"; }

# Dernière version publiée du dossier agents/alfred.
info=$(curl -fsS --max-time 30 "https://api.github.com/repos/$REPO/commits?path=agents/alfred&sha=main&per_page=1") || { note "GitHub injoignable"; exit 0; }
sha=$(print -r -- "$info" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const c=JSON.parse(s)[0];console.log(c.sha)}catch{}})')
titre=$(print -r -- "$info" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s)[0].commit.message.split("\n")[0])}catch{}})')
[[ "$sha" =~ '^[0-9a-f]{40}$' ]] || { note "réponse GitHub illisible"; exit 0; }
[[ "$(cat "$DEST/etat/version-programme" 2>/dev/null)" == "$sha" ]] && exit 0

# Téléchargement de cette version précise, dans un dossier temporaire.
tmp=$(mktemp -d "${TMPDIR:-/tmp}/alfred-maj.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
if ! curl -fsSL --max-time 300 "https://codeload.github.com/$REPO/tar.gz/$sha" | tar -xz -C "$tmp" --strip-components=2 "ttp-suite-react-$sha/agents/alfred"; then
  note "téléchargement raté ($sha)"
  exit 0
fi
neuf="$tmp/alfred"
# Contrôle avant d'installer : les fichiers attendus sont là et lisibles.
for f in installer.sh alfred.sh ecoute.sh telegram.mjs spark.mjs CLAUDE.md mise-a-jour.sh fiches/points.md; do
  [ -s "$neuf/$f" ] || { note "version $sha incomplète ($f manquant), pas installée"; exit 0; }
done
zsh -n "$neuf/alfred.sh" && zsh -n "$neuf/installer.sh" && node --check "$neuf/telegram.mjs" && node --check "$neuf/spark.mjs" && { [ ! -f "$neuf/whatsapp.mjs" ] || node --check "$neuf/whatsapp.mjs"; } || { note "version $sha illisible, pas installée"; exit 0; }

# On attend qu'Alfred ait fini son passage en cours, point ou réponse rapide (30 minutes au plus).
for i in {1..180}; do
  [ -d "$DEST/etat/verrou" ] || [ -d "$DEST/etat/verrou-reponse" ] || break
  sleep 10
done

mkdir -p "$SRC"
rsync -a --delete --exclude "*.test.ts" "$neuf/" "$SRC/"
if ALFRED_MAJ=1 zsh "$SRC/installer.sh" >> "$LOG" 2>&1; then
  echo "$sha" > "$DEST/etat/version-programme"
  note "installé : $sha · $titre"
  (cd "$DEST" && node telegram.mjs texte "Je me suis mis à jour tout seul. Nouveauté : ${titre:-version du $(date '+%d/%m')}." >> "$LOG" 2>&1)
else
  note "installation ratée ($sha)"
  (cd "$DEST" && node telegram.mjs texte "Ma mise à jour automatique a échoué cette nuit. Rien n'est cassé, je tourne sur l'ancienne version. Détail dans etat/mises-a-jour.log sur l'iMac." >> "$LOG" 2>&1)
fi
