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

cp "$SRC/CLAUDE.md" "$SRC/alfred.sh" "$SRC/ecoute.sh" "$SRC/installer-whatsapp.sh" "$SRC/telegram.mjs" "$SRC/whatsapp.mjs" "$SRC/spark.mjs" "$SRC/passage.mjs" "$SRC/contrats.mjs" "$SRC/texte.mjs" "$SRC/araignee.mjs" "$SRC/mise-a-jour.sh" "$DEST/"
chmod +x "$DEST/alfred.sh" "$DEST/ecoute.sh" "$DEST/mise-a-jour.sh"
# Ses fiches (consignes détaillées par sujet, lues à la demande) : toujours la version du dépôt.
[ -d "$SRC/fiches" ] && rsync -a --delete "$SRC/fiches/" "$DEST/fiches/"
# L'examen du dimanche (questions et réponses attendues, noms fictifs) : toujours la version du dépôt.
[ -d "$SRC/examen" ] && rsync -a --delete "$SRC/examen/" "$DEST/examen/"
# Ses skills (skills/<nom>/SKILL.md) : chargées par Claude depuis .claude/skills du dossier d'Alfred.
# Chaque skill du dépôt remplace sa copie ; une skill ajoutée à la main sur le Mac n'est pas touchée.
if [ -d "$SRC/skills" ]; then
  mkdir -p "$DEST/.claude/skills"
  for d in "$SRC"/skills/*(/N); do rsync -a --delete "$d/" "$DEST/.claude/skills/${d:t}/"; done
fi
# Légifrance et Judilibre (demande de Marc le 2026-11-23, voir legifrance/LISEZ-MOI.md) : branché
# seulement si les clés PISTE sont dans config.env et qu'un Python 3.10+ existe. Un échec ne bloque
# jamais l'installation (la mise à jour de 4 h passe par ici).
legifrance=0
mkdir -p "$DEST/legifrance"
rsync -a --delete --exclude .venv "$SRC/legifrance/" "$DEST/legifrance/"
chmod +x "$DEST/legifrance/lancer.sh"
if grep -q '^PISTE_CLIENT_ID=.' "$DEST/config.env" 2>/dev/null && grep -q '^PISTE_CLIENT_SECRET=.' "$DEST/config.env" 2>/dev/null; then
  py=""
  for c in /opt/homebrew/bin/python3.13 /opt/homebrew/bin/python3.12 /opt/homebrew/bin/python3.11 /opt/homebrew/bin/python3 /usr/local/bin/python3 python3.13 python3.12 python3.11 python3.10 python3; do
    p=$(command -v "$c" 2>/dev/null) || continue
    if "$p" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then py=$p; break; fi
  done
  if [[ -z "$py" ]]; then
    echo "Légifrance : il faut Python 3.10 ou plus (brew install python@3.12), pas branché." >&2
  elif { [ -x "$DEST/legifrance/.venv/bin/python" ] || "$py" -m venv "$DEST/legifrance/.venv"; } \
       && "$DEST/legifrance/.venv/bin/pip" install -q -r "$DEST/legifrance/requirements.txt"; then
    legifrance=1
  else
    echo "Légifrance : installation des dépendances ratée, pas branché." >&2
  fi
fi
# Le connecteur TTP Suite propre à Alfred (sécurité, 27 novembre 2026, voir LISEZ-MOI.md) : branché
# seulement si ALFRED_CONNECTEUR est dans config.env. Il s'autorise une fois à la main (claude, /mcp)
# avec la case « Agent autonome » cochée ; alfred.sh l'utilise alors à la place de celui de Marc.
connecteur=$(grep -m1 '^ALFRED_CONNECTEUR=' "$DEST/config.env" 2>/dev/null | cut -d= -f2- | tr -d "\"' ")
[[ "$connecteur" =~ '^[A-Za-z0-9_-]+$' ]] || connecteur=""
export ALFRED_LEGIFRANCE=$legifrance ALFRED_DEST=$DEST ALFRED_CONNECTEUR=$connecteur
/usr/bin/python3 - "$DEST/.mcp.json" <<'PY'
import json, os, sys
p = sys.argv[1]
try:
    d = json.load(open(p))
except (OSError, ValueError):
    d = {}
s = d.setdefault("mcpServers", {})
if os.environ.get("ALFRED_LEGIFRANCE") == "1":
    s["legifrance"] = {"command": os.environ["ALFRED_DEST"] + "/legifrance/lancer.sh", "args": []}
else:
    s.pop("legifrance", None)
TTP = "https://zizvggziggswhrbuyhuo.supabase.co/functions/v1/ttp-mcp"
nom = os.environ.get("ALFRED_CONNECTEUR", "")
for k in [k for k, v in s.items() if isinstance(v, dict) and v.get("url") == TTP and k != nom]:
    s.pop(k)
if nom:
    s[nom] = {"type": "http", "url": TTP}
json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
PY
# Le dossier reste propre (demande de Marc le 2026-11-24) : ce qui traîne à la racine et n'est plus
# au programme (anciennes versions, essais) part dans archives/rangement-<date>, jamais supprimé ;
# les fichiers temporaires oubliés dans etat/ depuis plus d'un jour sont retirés.
garde=(CLAUDE.md alfred.sh ecoute.sh installer-whatsapp.sh telegram.mjs whatsapp.mjs spark.mjs passage.mjs
  contrats.mjs texte.mjs araignee.mjs mise-a-jour.sh config.env REDACTION.md .mcp.json .claude
  etat fiches examen legifrance archives)
rangement="$DEST/archives/rangement-$(date +%Y-%m-%d)"
for f in "$DEST"/*(DN); do
  (( ${garde[(Ie)${f:t}]} )) && continue
  [[ ${f:t} == .DS_Store ]] && { rm -f "$f"; continue; }
  [[ ${f:t} == .* ]] && continue
  mkdir -p "$rangement" && mv "$f" "$rangement/" && echo "Rangé dans archives : ${f:t}"
done
find "$DEST/etat" -maxdepth 2 -type f \( -name '*.tmp' -o -name '.DS_Store' \) -mtime +1 -delete 2>/dev/null || true
# La salle de l'araignée (choix de Marc le 2026-11-16) : chaque passage d'Alfred y apparaît. Alfred ne
# charge pas les réglages globaux du Mac (--setting-sources project,local) : le hook de l'araignée est
# donc branché dans .claude/settings.json de son dossier. Il ne fait rien tant que l'araignée n'est pas
# installée sur ce Mac (iCloud Drive › Araignée › « Installer l'araignée sur ce Mac »).
/usr/bin/python3 - "$DEST/.claude/settings.json" <<'PY'
import json, os, sys
p = sys.argv[1]
os.makedirs(os.path.dirname(p), exist_ok=True)
try:
    d = json.load(open(p))
except (OSError, ValueError):
    d = {}
cmd = 'f="$HOME/.claude/skills/web-crawler/scripts/araignee_hook.py"; [ -f "$f" ] && python3 "$f"; exit 0'
h = d.setdefault("hooks", {})
for ev, matcher in (("PostToolUse", "*"), ("UserPromptSubmit", None), ("Notification", None), ("Stop", None)):
    lst = h.setdefault(ev, [])
    if not any("araignee_hook.py" in json.dumps(e) for e in lst):
        e = {"hooks": [{"type": "command", "command": cmd, "timeout": 5}]}
        if matcher:
            e["matcher"] = matcher
        lst.append(e)
# Le serveur Légifrance du dossier (.mcp.json) est accepté sans question.
servers = [x for x in d.get("enabledMcpjsonServers", []) if x != "legifrance"]
if os.environ.get("ALFRED_LEGIFRANCE") == "1":
    servers.append("legifrance")
# Le connecteur TTP Suite propre à Alfred, s'il est réglé dans config.env.
nom = os.environ.get("ALFRED_CONNECTEUR", "")
if nom and nom not in servers:
    servers.append(nom)
d["enabledMcpjsonServers"] = servers
json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
PY
if ! grep -q '^ALFRED_BOT_TOKEN=' "$DEST/config.env" 2>/dev/null; then
  echo "Il manque le bot d'Alfred : ./installer.sh --bot <chat_id>" >&2
  exit 1
fi
if [[ "$1" == "--sans-horaires" ]]; then
  echo "Alfred copié dans $DEST (rien de programmé)."
  exit 0
fi
for nom in com.ttp.alfred com.ttp.alfred.ecoute com.ttp.alfred.maj; do
  sed "s#__HOME__#$HOME#g" "$SRC/lancement/$nom.plist" > "$AGENTS/$nom.plist"
  # Lancé par la mise à jour automatique elle même : elle ne se relance pas en cours de route
  # (sa nouvelle version sera prise au prochain démarrage).
  [[ "$nom" == com.ttp.alfred.maj && -n "$ALFRED_MAJ" ]] && continue
  launchctl bootout "gui/$(id -u)/$nom" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$AGENTS/$nom.plist"
done
echo "Alfred installé : il écoute Telegram en continu, fait le point à 9 h et 17 h en semaine, envoie tes rappels à l'heure, et se met à jour tout seul chaque nuit."
