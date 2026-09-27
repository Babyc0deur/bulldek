#!/bin/sh
# Contrôle de la qualité des tests : applique une modification (mutation) à un fichier, lance les tests, vérifie qu'ils échouent, restaure.
# Usage : sh tools/mutate.sh <fichier> <fichier de test> "<description>" '<expression sed>'  [...répéter]
# Exemple : sh tools/mutate.sh calc.js test/seasonal.test.js "année bissextile" 's/i > 59/i > 60/'
cd "$(dirname "$0")/.." || exit 1
FILE=$1; TEST=$2; shift 2
cp "$FILE" /tmp/mutate.orig; trap 'cp /tmp/mutate.orig "$FILE"' EXIT
while [ $# -ge 2 ]; do
  DESC=$1; EXPR=$2; shift 2
  sed -i "$EXPR" "$FILE"
  if cmp -s "$FILE" /tmp/mutate.orig; then echo "SANS EFFET  $DESC  (l'expression n'a rien modifié)"; continue; fi
  OUT=$(node --test "$TEST" 2>&1)
  N=$(echo "$OUT" | grep -E "^ℹ fail" | grep -o '[0-9]*')
  if [ "${N:-0}" -gt 0 ]; then echo "ATTRAPÉ     $DESC  ($N test(s) en échec)"; else echo "MANQUÉ      $DESC  (aucun échec !)"; fi
  cp /tmp/mutate.orig "$FILE"
done
cmp -s "$FILE" /tmp/mutate.orig && echo "--- $FILE restauré à l'identique"
