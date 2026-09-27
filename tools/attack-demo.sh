#!/bin/sh
# Démonstration : rejoue des requêtes hostiles contre un serveur local (limites par défaut) et affiche les réponses.
# Usage : sh tools/attack-demo.sh   (démarre son propre serveur sur le port 8125, sans accès réseau externe)
cd "$(dirname "$0")/.." || exit 1
PORT=8125 NO_REFRESH=1 node server.js > /tmp/attack-demo.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
sleep 3
B=http://127.0.0.1:8125
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
echo "POST /api/screener            -> $(code -X POST $B/api/screener)   (attendu 405)"
echo "DELETE /market/gold           -> $(code -X DELETE $B/market/gold)   (attendu 405)"
echo "URL de 3000 caractères        -> $(code "$B/api/cot?code=$(head -c 3000 /dev/zero | tr '\0' 'a')")   (attendu 414)"
echo "injection dans code=          -> $(code "$B/api/cot?code=%27%20OR%201%3D1--")   (attendu 400)"
echo "lecture de server.js          -> $(code $B/server.js)   (attendu 404)"
echo "lecture du cache              -> $(code $B/data/cache.json)   (attendu 404)"
echo "en-têtes de sécurité          -> $(curl -sI $B/market/gold | grep -ci 'content-security-policy\|x-frame-options\|x-content-type-options') sur 3 présents"
echo
echo "Rafale de 150 requêtes sur /api/screener (limite : 120 par minute) :"
for i in $(seq 1 150); do code $B/api/screener; echo; done | sort | uniq -c | sed 's/^/   /'
echo "   dernière réponse : $(curl -s -D - -o /dev/null $B/api/screener | grep -i 'HTTP/\|retry-after' | tr -d '\r' | tr '\n' ' ')"
echo "/health pendant le blocage    -> $(code $B/health)   (attendu 200)"
echo "pages du site pendant le blocage -> $(code $B/shared.css)   (attendu 200 : compteur séparé)"
