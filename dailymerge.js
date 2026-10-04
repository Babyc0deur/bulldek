// Rafraîchissement incrémental des prix quotidiens : on ne télécharge que les dernières semaines, puis on les fusionne avec l'historique déjà stocké.
// Module serveur uniquement (jamais servi au navigateur). Lignes : [timestamp en secondes, clôture, plus haut, plus bas].
const OVERLAP_DAYS = 15, TOLERANCE = 0.005, MIN_ROWS = 300;

// Début (secondes) de la période à retélécharger, ou null si l'historique stocké est trop court ou incomplet : il faut alors tout retélécharger.
function sinceTs(old) {
  if (!Array.isArray(old) || old.length < MIN_ROWS || old[0].length < 4) return null;
  return old[old.length - 1][0] - OVERLAP_DAYS * 86400;
}

// recent : lignes téléchargées depuis sinceTs. Renvoie l'historique fusionné, ou null si la fusion n'est pas sûre (aucune ligne récente,
// ou clôtures déjà stockées qui diffèrent de plus de 0,5 % : l'historique a été corrigé chez la source, on retélécharge tout).
function merge(old, recent) {
  if (!Array.isArray(old) || !old.length || !Array.isArray(recent) || !recent.length) return null;
  const first = recent[0][0], known = new Map(old.filter(r => r[0] >= first).map(r => [r[0], r[1]]));
  if (recent.some(r => known.has(r[0]) && Math.abs(known.get(r[0]) / r[1] - 1) > TOLERANCE)) return null;
  return old.filter(r => r[0] < first).concat(recent);
}
module.exports = { sinceTs, merge, OVERLAP_DAYS };
