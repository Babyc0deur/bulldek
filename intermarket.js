// Analyse intermarchés : comment les grandes classes d'actifs (actions, obligations, dollar, métaux, pétrole, crypto) évoluent les unes par rapport aux autres.
// Fonctions pures, sans réseau : à partir des séances quotidiennes déjà en cache, on calcule les corrélations des rendements quotidiens (matrice par fenêtre),
// on lit des relations classiques (dollar/or, cuivre/actions…) en les comparant à la théorie, et on repère les changements de régime récents.
// Une corrélation décrit un mouvement conjoint passé ; ce n'est ni une relation de cause à effet ni une prévision.

// [slug du marché, nom, abréviation de colonne, famille]
const ASSETS = [
  ['sp500', 'S&P 500', 'SPX', 'Actions'], ['nasdaq-100', 'Nasdaq 100', 'NDX', 'Actions'], ['russell-2000', 'Russell 2000', 'RUT', 'Actions'],
  ['10-year-t-note', 'T-Note 10 ans', '10A', 'Obligations'], ['30-year-t-bond', 'T-Bond 30 ans', '30A', 'Obligations'],
  ['us-dollar', 'Dollar américain', 'USD', 'Devises'], ['euro-fx', 'Euro', 'EUR', 'Devises'], ['japanese-yen', 'Yen', 'JPY', 'Devises'],
  ['gold', 'Or', 'Or', 'Matières premières'], ['silver', 'Argent', 'Ag', 'Matières premières'], ['copper', 'Cuivre', 'Cu', 'Matières premières'], ['crude-oil', 'Pétrole (WTI)', 'WTI', 'Matières premières'],
  ['bitcoin', 'Bitcoin', 'BTC', 'Crypto'],
];
const SLUGS = ASSETS.map(a => a[0]);
const WINDOWS = [20, 60, 120, 250, 'max'];                               // séances ; « max » = tout l'historique commun (jusqu'à 20 ans)

// Relations classiques : signe attendu des rendements quotidiens (+1, −1) ou 0 quand la relation change selon le régime (inflation, fuite vers la qualité…).
const PAIRS = [
  { a: 'us-dollar', b: 'gold', expect: -1, why: 'L\'or est coté en dollars : un dollar fort pèse sur son prix.' },
  { a: 'us-dollar', b: 'crude-oil', expect: -1, why: 'Le pétrole est coté en dollars : dollar fort, prix plus bas pour les acheteurs étrangers.' },
  { a: 'us-dollar', b: 'copper', expect: -1, why: 'Même mécanisme que pour l\'or et le pétrole, avec en plus la demande industrielle.' },
  { a: '10-year-t-note', b: 'gold', expect: 1, why: 'Prix de l\'obligation en hausse = rendements en baisse : détenir de l\'or (qui ne rapporte rien) coûte moins cher.' },
  { a: '10-year-t-note', b: 'sp500', expect: 0, why: 'Relation changeante : négative quand les obligations servent de refuge, positive quand l\'inflation fait baisser les deux.' },
  { a: 'copper', b: 'sp500', expect: 1, why: 'Le cuivre suit la croissance industrielle, comme les actions (« docteur Cuivre »).' },
  { a: 'crude-oil', b: 'sp500', expect: 1, why: 'Pétrole et actions réagissent tous deux à la demande économique (sauf chocs d\'offre).' },
  { a: 'gold', b: 'silver', expect: 1, why: 'Deux métaux précieux très liés : contrôle de cohérence.' },
  { a: 'bitcoin', b: 'nasdaq-100', expect: 1, why: 'Le bitcoin se comporte souvent comme un actif de croissance sensible aux taux.' },
  { a: 'japanese-yen', b: 'sp500', expect: -1, why: 'Le yen est une valeur refuge : il tend à monter quand les actions chutent.' },
  { a: '30-year-t-bond', b: '10-year-t-note', expect: 1, why: 'Même courbe des taux : doivent évoluer ensemble (contrôle de cohérence).' },
];

const round = v => (v == null ? null : Math.round(v * 1000) / 1000);
const isoDay = t => new Date(t * 1e3).toISOString().slice(0, 10);

// Rendements quotidiens communs à deux marchés : calculés entre dates où les deux ont coté (calendriers différents, week-ends crypto…).
// → [[i, rendement a en %, rendement b en %], …] du plus ancien au plus récent.
function commonReturns(ma, mb, datesA) {
  const out = []; let prev = null;
  for (const d of datesA) {
    const cb = mb.get(d); if (cb == null) continue;
    const ca = ma.get(d);
    if (prev) out.push([out.length, (ca / prev.a - 1) * 100, (cb / prev.b - 1) * 100]);
    prev = { a: ca, b: cb };
  }
  return out;
}

// Lecture d'une relation : conforme à la théorie, faible, ou inversée ; pour les relations changeantes, comparaison au régime historique.
function readPair(expect, r250, rMax) {
  if (r250 == null) return { key: 'na', label: 'Données insuffisantes' };
  if (expect === 0) {
    const s = v => (v == null || Math.abs(v) < 0.15 ? 0 : Math.sign(v)), sr = s(r250), sm = s(rMax);
    return sr && sm && sr !== sm ? { key: 'flip', label: 'Régime inversé par rapport à l\'historique' } : { key: 'stable', label: 'Régime comparable à l\'historique' };
  }
  if (Math.abs(r250) < 0.2) return { key: 'weak', label: 'Lien faible en ce moment' };
  return Math.sign(r250) === expect ? { key: 'ok', label: 'Conforme à la théorie' } : { key: 'flip', label: 'Inversé par rapport à la théorie' };
}

// series : { slug: [[t en secondes, clôture, …], …] } ; corr : CALC.correlation (renvoie null sous 20 observations ou série constante).
function build(series, corr, now = Date.now()) {
  const assets = ASSETS.filter(a => series[a[0]] && series[a[0]].length > 60).map(([slug, name, short, group]) => ({ slug, name, short, group }));
  const maps = {}, dates = {};
  let asOf = 0;
  for (const a of assets) {
    const rows = series[a.slug]; maps[a.slug] = new Map(rows.map(r => [isoDay(r[0]), r[1]])); dates[a.slug] = rows.map(r => isoDay(r[0]));
    asOf = Math.max(asOf, rows[rows.length - 1][0]);
  }
  const cache = {};
  const rets = (x, y) => cache[x + '|' + y] ||= commonReturns(maps[x], maps[y], dates[x]);
  const r = (x, y, w) => { const all = rets(x, y), sel = w === 'max' ? all : all.slice(-w); return round(corr(sel)); };

  const matrix = {};                                                     // symétrique : on calcule le triangle supérieur et on le recopie
  for (const w of WINDOWS) {
    const m = assets.map(() => assets.map(() => null));
    for (let i = 0; i < assets.length; i++) { m[i][i] = 1; for (let j = i + 1; j < assets.length; j++) m[i][j] = m[j][i] = r(assets[i].slug, assets[j].slug, w); }
    matrix[w] = m;
  }

  const name = s => (assets.find(a => a.slug === s) || {}).name;
  const pairs = PAIRS.filter(p => maps[p.a] && maps[p.b]).map(p => {
    const r60 = r(p.a, p.b, 60), r250 = r(p.a, p.b, 250), rMax = r(p.a, p.b, 'max');
    return { a: p.a, b: p.b, aName: name(p.a), bName: name(p.b), expect: p.expect, why: p.why, r60, r250, rMax, status: readPair(p.expect, r250, rMax) };
  });

  // Changements de régime : le signe sur 60 séances est l'opposé de celui de l'historique, avec des liens assez nets des deux côtés.
  const shifts = [];
  for (let i = 0; i < assets.length; i++) for (let j = i + 1; j < assets.length; j++) {
    const r60 = matrix[60][i][j], rMax = matrix.max[i][j];
    if (r60 != null && rMax != null && Math.abs(r60) >= 0.3 && Math.abs(rMax) >= 0.15 && Math.sign(r60) !== Math.sign(rMax))
      shifts.push({ a: assets[i].slug, b: assets[j].slug, aName: assets[i].name, bName: assets[j].name, r60, rMax, gap: round(Math.abs(r60 - rMax)) });
  }
  shifts.sort((x, y) => y.gap - x.gap);

  return { updated: now, asOf: asOf ? isoDay(asOf) : null, assets, windows: WINDOWS, matrix, pairs, shifts: shifts.slice(0, 6) };
}

module.exports = { ASSETS, SLUGS, WINDOWS, PAIRS, commonReturns, readPair, build };
