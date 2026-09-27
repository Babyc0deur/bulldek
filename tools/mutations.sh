#!/bin/sh
# Contrôle de la qualité des tests : injecte des bugs de sécurité connus et vérifie que la suite échoue.
# Restaure toujours les fichiers d'origine. Usage : sh tools/mutations.sh
cd "$(dirname "$0")/.." || exit 1
cp server.js /tmp/mut.server.js; cp market.html /tmp/mut.market.html
restore() { cp /tmp/mut.server.js server.js; cp /tmp/mut.market.html market.html; }
trap restore EXIT
run() {  # $1 = description ; les commandes de mutation sont passées via la variable MUT
  eval "$MUT"
  out=$(node --test test/server.test.js 2>&1)
  fails=$(echo "$out" | grep -E "^✖ [^f]" | grep -v "failing" | sed 's/ ([0-9.]*ms)//' | sort -u | head -3)
  if [ -n "$fails" ]; then echo "ATTRAPÉ  $1"; echo "$fails" | sed 's/^/           → /'; else echo "MANQUÉ   $1  (aucun test n'a échoué !)"; fi
  restore
}
MUT="sed -i 's/const TRUST_PROXY = +process.env.TRUST_PROXY || 0;/const TRUST_PROXY = 1;/' server.js"
run "X-Forwarded-For cru aveuglément (limite contournable)"
MUT="sed -i \"s/if (req.method !== 'GET' \&\& req.method !== 'HEAD')/if (false)/\" server.js"
run "méthodes POST/DELETE acceptées"
MUT="sed -i \"s/script-src 'self';/script-src 'self' 'unsafe-inline';/\" server.js"
run "CSP affaiblie (scripts en ligne autorisés)"
MUT="sed -i \"s/if (u.pathname !== '\/health') {/if (true) {/\" server.js"
run "/health soumis à la limite de débit"
MUT="sed -i 's/const MAX_URL = 2048;/const MAX_URL = 999999;/' server.js"
run "longueur d'URL non limitée"
MUT="sed -i 's#<script src=\"/market.js\"></script>#<script>alert(1)</script>#' market.html"
run "script en ligne réintroduit dans une page"
MUT="sed -i \"s/res.setHeader('Retry-After', r.retryAfter); //\" server.js"
run "429 sans en-tête Retry-After"
echo "--- restauré :"; cmp server.js /tmp/mut.server.js && cmp market.html /tmp/mut.market.html && echo "fichiers identiques à l'original"
