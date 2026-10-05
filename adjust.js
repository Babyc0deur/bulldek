// Ajustement des changements de contrat (module serveur uniquement, jamais servi au navigateur).
// Les futures continus de Yahoo ne sont pas ajustés : à chaque échéance, la série passe au contrat suivant, qui cote avec un écart (la « base »).
// Ce saut n'est pas un mouvement du marché, mais il entre dans les variations et fausse la saisonnalité et les rendements.
// Pour les quatre indices, on le mesure exactement en comparant le future à l'indice au comptant : la base (future / comptant) ne bouge presque pas
// d'un jour à l'autre, sauf le jour du changement de contrat, où elle saute. On repère ce saut autour de chaque échéance trimestrielle
// (3e vendredi de mars, juin, septembre, décembre) et on corrige l'historique par un coefficient (ajustement « ratio », vers l'arrière) :
// la dernière valeur reste égale au prix coté ; les séances antérieures sont mises à l'échelle du contrat actuel.
// Les autres marchés n'ont pas d'équivalent au comptant gratuit et fiable : leur série reste brute (voir la page « À propos »).

const CASH = { sp500: '^GSPC', 'nasdaq-100': '^NDX', 'dow-jones': '^DJI', 'russell-2000': '^RUT' };
const MIN_GAP = 0.0015;                 // saut de base minimal pris pour un changement de contrat (0,15 %) ; le bruit quotidien de la base est d'environ 0,05 %
const MAX_GAP = 0.04;                   // au-delà de 4 % : pas un changement de contrat (le portage d'un trimestre ne dépasse pas 2 % environ)
const ROBUST_SESSIONS = 5;              // séances de part et d'autre de la bascule pour mesurer le saut par des médianes
const BEFORE_DAYS = 3, AFTER_DAYS = 4;  // fenêtre de recherche autour de l'échéance (jours calendaires) : Yahoo bascule le jour de l'échéance ou la séance suivante

const DAY = 864e5;
const iso = t => new Date(t * 1e3).toISOString().slice(0, 10);
// 3e vendredi du mois (mois 0-11), en ms UTC.
function thirdFriday(y, m) {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay(), d = 1 + ((5 - first + 7) % 7) + 14;
  return Date.UTC(y, m, d);
}
// Échéances trimestrielles des futures sur indices entre deux années incluses (ms UTC).
const quarterlyExpiries = (y0, y1) => { const out = []; for (let y = y0; y <= y1; y++) for (const m of [2, 5, 8, 11]) out.push(thirdFriday(y, m)); return out; };

// fut : [[t (s), clôture, plus haut, plus bas]] ; cash : [[t (s), clôture, …]].
// Renvoie { rows, rolls } : rows = série ajustée (même format, même longueur) ; rolls = [{ date, gapPct }] changements de contrat corrigés.
// Sans série au comptant : la série d'origine, sans correction.
function rollAdjust(fut, cash, { minGap = MIN_GAP } = {}) {
  if (!Array.isArray(fut) || fut.length < 2 || !Array.isArray(cash) || !cash.length) return { rows: fut, rolls: [] };
  const C = new Map(cash.map(r => [iso(r[0]), r[1]]));
  const days = fut.map(r => iso(r[0]));
  // Variation quotidienne de la base (en log) ; null si le comptant manque l'un des deux jours.
  const lb = fut.map((r, i) => {
    if (!i) return null;
    const a = C.get(days[i]), b = C.get(days[i - 1]);
    return a && b && r[1] > 0 && fut[i - 1][1] > 0 ? Math.log(r[1] / a) - Math.log(fut[i - 1][1] / b) : null;
  });
  // Niveau de la base (en log) chaque jour où les deux cotent : sert à mesurer le saut de façon robuste.
  const lvl = fut.map((r, i) => { const c = C.get(days[i]); return c && r[1] > 0 ? Math.log(r[1] / c) : null; });
  const median = v => { const s = v.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const side = (from, step) => { const v = []; for (let i = from; i >= 0 && i < fut.length && v.length < ROBUST_SESSIONS; i += step) if (lvl[i] != null) v.push(lvl[i]); return v; };
  const y0 = new Date(fut[0][0] * 1e3).getUTCFullYear(), y1 = new Date(fut[fut.length - 1][0] * 1e3).getUTCFullYear();
  const rolls = [];
  let k = 1;
  for (const e of quarterlyExpiries(y0, y1)) {
    const lo = (e - BEFORE_DAYS * DAY) / 1e3, hi = (e + AFTER_DAYS * DAY) / 1e3 + 86399;
    while (k < fut.length && fut[k][0] < lo) k++;
    // Jour de la bascule : le plus fort saut de base de la fenêtre. Son ampleur, elle, est mesurée par l'écart entre la base médiane des 5 séances
    // qui suivent (bascule comprise) et celle des 5 séances qui précèdent : les clôtures du future et du comptant ne tombent pas à la même heure,
    // et un jour très agité peut fausser la base d'un seul jour de plusieurs pour cent (ex. 23 mars 2020).
    let best = -1;
    for (let i = k; i < fut.length && fut[i][0] <= hi; i++) if (lb[i] != null && (best < 0 || Math.abs(lb[i]) > Math.abs(lb[best]))) best = i;
    if (best <= 0) continue;
    const before = side(best - 1, -1), after = side(best, 1);
    if (before.length < 2 || after.length < 2) continue;
    const gap = median(after) - median(before);
    if (Math.abs(gap) >= minGap && Math.abs(gap) <= MAX_GAP) rolls.push({ i: best, gap });
  }
  if (!rolls.length) return { rows: fut, rolls: [] };
  // Ajustement vers l'arrière : les séances antérieures à un changement sont multipliées par le saut de ce changement (et des suivants).
  const at = new Map(rolls.map(r => [r.i, Math.exp(r.gap)]));
  const out = new Array(fut.length);
  let f = 1;
  for (let i = fut.length - 1; i >= 0; i--) {
    const r = fut[i];
    out[i] = f === 1 ? r : [r[0], ...r.slice(1).map(v => +(v * f).toFixed(4))];
    if (at.has(i)) f *= at.get(i);
  }
  return { rows: out, rolls: rolls.map(r => ({ date: days[r.i], gapPct: Math.round((Math.exp(r.gap) - 1) * 10000) / 100 })) };
}

module.exports = { CASH, MIN_GAP, thirdFriday, quarterlyExpiries, rollAdjust };
