#!/bin/sh
# Vérifications rapides du serveur local (santé, compression, ETag, screener).
B=${1:-http://localhost:8123}
echo "health:    $(curl -s $B/health)"
echo "daily brut : $(curl -s "$B/api/daily?code=209742" | wc -c) octets"
echo "daily gzip : $(curl -s -H 'Accept-Encoding: gzip' "$B/api/daily?code=209742" | wc -c) octets"
E=$(curl -sI $B/cot.js | grep -i '^etag' | tr -d '\r' | cut -d' ' -f2)
echo "cot.js avec ETag : HTTP $(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $E" $B/cot.js) (attendu 304)"
curl -s $B/api/screener | node -e "
const j=JSON.parse(require('fs').readFileSync(0,'utf8')),r=j.rows;
console.log('screener :',r.length,'marchés,',r.filter(x=>x.missing).length,'manquants');
const n=r.find(x=>x.slug==='nasdaq-100');
if(n&&!n.missing)console.log('nasdaq-100 :',JSON.stringify({idx6:+n.idx6.toFixed(1),idx36:+n.idx36.toFixed(1),wr:+n.wr.toFixed(1),saison:n.season,sig:n.sig,score:n.score}));"
