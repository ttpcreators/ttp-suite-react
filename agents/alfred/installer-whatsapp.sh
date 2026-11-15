#!/bin/zsh
# Branche le WhatsApp de Marc à Alfred pour ENVOYER (choix de Marc le 2026-11-15), sur l'iMac.
# Le pont est celui de github.com/lharries/whatsapp-mcp (whatsapp-bridge, Go, whatsmeow), épinglé à
# un commit précis. Il se connecte comme un « appareil lié » (comme WhatsApp Web) : Marc scanne un
# QR code une fois avec son téléphone. Ce n'est pas un outil officiel de WhatsApp : petit risque que
# WhatsApp bloque le compte s'il juge l'usage anormal (Alfred n'envoie que sur un « oui » de Marc).
#
# Sécurité :
#   - le pont n'écoute que l'iMac lui même (127.0.0.1:8080), jamais le réseau (le code d'origine
#     écoute partout : il est corrigé ici avant la compilation, et le script vérifie la correction) ;
#   - il vit dans ~/Code/TTPAlfred-whatsapp, HORS du dossier d'Alfred : Alfred ne lit pas sa base
#     (tout l'historique du téléphone), il lit ses discussions autorisées par whatsapp.mjs ;
#   - Alfred n'envoie qu'avec `node whatsapp.mjs envoyer <id>` : le texte que Marc a vu, à un
#     contact de la liste autorisée, pendant un passage où Marc a écrit (voir alfred.sh).
#
#   À lancer par Marc dans l'app Terminal de l'iMac (le QR code s'affiche dans la fenêtre).
#   zsh ~/Code/TTPAlfred/installer-whatsapp.sh          installe, QR code la première fois, démarre
#   zsh ~/Code/TTPAlfred/installer-whatsapp.sh --qr     refait le QR code (téléphone changé, déconnecté)
#   zsh ~/Code/TTPAlfred/installer-whatsapp.sh --arret  arrête le pont et retire le bouton Envoyer
# Aucun secret ici : la session WhatsApp reste dans ~/Code/TTPAlfred-whatsapp/…/store (sur l'iMac).
set -e
export PATH="$HOME/.local/go/bin:$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/go/bin"
COMMIT=7d6a06dcdce1f01dfb24f60e1030d5efba9f3b88
DEST="$HOME/Code/TTPAlfred-whatsapp"
PONT="$DEST/whatsapp-mcp/whatsapp-bridge"
ALFRED="$HOME/Code/TTPAlfred"
NOM=com.ttp.alfred.whatsapp
PLIST="$HOME/Library/LaunchAgents/$NOM.plist"

# Le bouton « Envoyer » sous les textes WhatsApp (ALFRED_WA_ENVOI dans config.env d'Alfred).
reglage() {
  [ -f "$ALFRED/config.env" ] || { echo "Alfred n'est pas installé ($ALFRED/config.env manquant)." >&2; exit 1; }
  grep -v '^ALFRED_WA_ENVOI=' "$ALFRED/config.env" > "$ALFRED/config.env.tmp" || true
  print -r -- "ALFRED_WA_ENVOI=$1" >> "$ALFRED/config.env.tmp"
  mv "$ALFRED/config.env.tmp" "$ALFRED/config.env"
  chmod 600 "$ALFRED/config.env"
}

if [[ "$1" == "--arret" ]]; then
  launchctl bootout "gui/$(id -u)/$NOM" 2>/dev/null || true
  rm -f "$PLIST"
  reglage 0
  echo "Pont WhatsApp arrêté : Alfred ne peut plus envoyer (il lit toujours ses discussions autorisées)."
  exit 0
fi

# 1. Les outils : Go (pour compiler le pont) et git. Pas besoin de Homebrew : sans Go, la version
#    officielle est téléchargée sur go.dev dans ~/.local/go, après contrôle de son empreinte SHA-256.
if ! command -v go >/dev/null; then
  arch=$(uname -m); [[ "$arch" == x86_64 ]] && arch=amd64
  echo "Installation de Go dans ~/.local/go…"
  info=$(curl -fsS --max-time 30 "https://go.dev/dl/?mode=json")
  ligne=$(print -r -- "$info" | /usr/bin/python3 -c "import json,sys
d=json.load(sys.stdin)[0]
f=[f for f in d['files'] if f['os']=='darwin' and f['arch']=='$arch' and f['kind']=='archive'][0]
print(f['filename'], f['sha256'])")
  fichier=${ligne% *}; empreinte=${ligne#* }
  [[ "$fichier" == go*.darwin-$arch.tar.gz && "$empreinte" =~ '^[0-9a-f]{64}$' ]] || { echo "Version de Go introuvable sur go.dev." >&2; exit 1; }
  tmp=$(mktemp -d "${TMPDIR:-/tmp}/go-dl.XXXXXX")
  curl -fsSL --max-time 600 -o "$tmp/$fichier" "https://go.dev/dl/$fichier"
  echo "$empreinte  $tmp/$fichier" | shasum -a 256 -c - >/dev/null || { echo "Empreinte de Go incorrecte : rien n'est installé." >&2; rm -rf "$tmp"; exit 1; }
  mkdir -p "$HOME/.local" && rm -rf "$HOME/.local/go"
  tar -xzf "$tmp/$fichier" -C "$HOME/.local"
  rm -rf "$tmp"
fi
command -v go >/dev/null || { echo "Go introuvable après installation." >&2; exit 1; }
command -v git >/dev/null || { echo "git manque : lance « xcode-select --install », puis relance ce script." >&2; exit 1; }

# 2. Le code du pont, à la version épinglée.
mkdir -p "$DEST" && chmod 700 "$DEST"
if [ ! -d "$DEST/whatsapp-mcp/.git" ]; then
  git clone -q https://github.com/lharries/whatsapp-mcp.git "$DEST/whatsapp-mcp"
fi
cd "$DEST/whatsapp-mcp"
git fetch -q origin
git checkout -q --force "$COMMIT"

# 3. Le pont n'écoute que l'iMac (127.0.0.1), jamais le réseau.
cd "$PONT"
sed -i '' 's/fmt.Sprintf(":%d", port)/fmt.Sprintf("127.0.0.1:%d", port)/' main.go
grep -q 'fmt.Sprintf("127.0.0.1:%d", port)' main.go || { echo "Correction 127.0.0.1 impossible : rien n'est installé." >&2; exit 1; }

# 4. Compilation. D'abord avec la dernière version de whatsmeow (WhatsApp refuse les trop vieux
#    clients), sinon avec celle du commit épinglé.
echo "Compilation du pont (1 à 3 minutes la première fois)…"
if ! { go get go.mau.fi/whatsmeow@latest >/dev/null 2>&1 && go mod tidy >/dev/null 2>&1 && CGO_ENABLED=1 go build -o pont . ; }; then
  git checkout -q -- go.mod go.sum
  CGO_ENABLED=1 go build -o pont .
fi

# 5. Le QR code, la première fois (ou avec --qr) : le pont tourne ici, Marc scanne, puis Ctrl+C.
launchctl bootout "gui/$(id -u)/$NOM" 2>/dev/null || true
if [[ "$1" == "--qr" || ! -s store/whatsapp.db ]]; then
  [[ "$1" == "--qr" ]] && rm -f store/whatsapp.db
  echo
  echo "Sur ton téléphone : WhatsApp › Réglages › Appareils connectés › Connecter un appareil, puis scanne le QR code."
  echo "Quand tu vois « Connected to WhatsApp » (et quelques lignes de synchronisation), appuie sur Ctrl+C."
  echo
  trap 'true' INT
  ./pont || true
  trap - INT
  [ -s store/whatsapp.db ] || { echo "Pas de connexion enregistrée : relance le script pour refaire le QR code." >&2; exit 1; }
fi
chmod -R go-rwx store

# 6. Le pont tourne en continu (démarre avec la session, redémarre s'il s'arrête).
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Alfred : pont WhatsApp (envoi sur « oui » de Marc). Installé par installer-whatsapp.sh. -->
<plist version="1.0"><dict>
  <key>Label</key><string>$NOM</string>
  <key>ProgramArguments</key><array><string>$PONT/pont</string></array>
  <key>WorkingDirectory</key><string>$PONT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$DEST/pont.log</string>
  <key>StandardErrorPath</key><string>$DEST/pont.log</string>
</dict></plist>
EOF
launchctl bootstrap "gui/$(id -u)" "$PLIST"
reglage 1

# 7. Contrôle : le pont répond sur l'iMac.
for i in {1..15}; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8080/api/send || true)
  [[ "$code" == 400 ]] && break
  sleep 2
done
if [[ "$code" == 400 ]]; then
  echo "WhatsApp branché : sous chaque message WhatsApp d'Alfred, tu as maintenant un bouton « Envoyer » (avec confirmation)."
else
  echo "Le pont ne répond pas encore. Regarde $DEST/pont.log, ou relance avec --qr." >&2
  exit 1
fi
