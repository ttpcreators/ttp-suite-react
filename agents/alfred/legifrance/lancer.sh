#!/bin/zsh
# Lance le serveur Légifrance et Judilibre d'Alfred (MCP, lecture seule), avec les seules clés
# PISTE de config.env (jamais le reste). Écrit par installer.sh dans ~/Code/TTPAlfred/.mcp.json.
cd "${0:A:h}"
while IFS='=' read -r k v; do [[ "$k" == PISTE_* ]] && export "$k=$v"; done < ../config.env
exec ./.venv/bin/python droit_francais_MCP.py
