// Analyse intermarchés : comment les grandes classes d'actifs (actions, obligations, dollar, métaux, pétrole, crypto) évoluent les unes par rapport aux autres.
// Fonctions pures, sans réseau : à partir des séances quotidiennes déjà en cache, on calcule les corrélations des rendements quotidiens (matrice par fenêtre),
// on lit des relations classiques (dollar/or, cuivre/actions…) en les comparant à la théorie, et on repère les changements de régime récents.
// Une corrélation décrit un mouvement conjoint passé ; ce n'est ni une relation de cause à effet ni une prévision.

// [slug du marché, nom, abréviation de colonne, famille]
const ASSETS = [
  ['sp500', 'S&P 500', 'SPX', 'Actions'], ['nasdaq-100', 'Nasdaq 100', 'NDX', 'Actions'],
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

// Famille économique d'un marché : détermine le sens à donner à une corrélation (refuge, croissance, effet dollar…).
const FAMILY = { sp500: 'actions', 'nasdaq-100': 'actions', 'dow-jones': 'actions', '10-year-t-note': 'obligations', '30-year-t-bond': 'obligations', '5-year-t-note': 'obligations', '2-year-t-note': 'obligations',
  'us-dollar': 'dollar', 'japanese-yen': 'refuge', gold: 'or', silver: 'or', copper: 'cuivre', 'crude-oil': 'petrole', bitcoin: 'crypto' };
const GROUP_FAMILY = { Indices: 'actions', Bonds: 'obligations', Currencies: 'devises', Crypto: 'crypto', Energy: 'petrole', Metals: 'cuivre', Grains: 'matiere', Softs: 'matiere', Livestock: 'matiere' };
const familyOf = (slug, group) => FAMILY[slug] || GROUP_FAMILY[group] || 'matiere';

// Ce que signifie, en une phrase, une corrélation r entre deux marchés selon leurs familles. Les obligations sont lues sur le prix du contrat.
function meaning(famA, famB, r) {
  const has = (x, y) => (famA === x && famB === y) || (famA === y && famB === x), pos = r > 0;
  const mat = f => ['or', 'cuivre', 'petrole', 'matiere'].includes(f);
  if (has('actions', 'obligations')) return pos ? 'Actions et obligations bougent ensemble : l\'inflation et le niveau des taux pèsent sur les deux à la fois, les obligations ne jouent plus leur rôle de protection.' : 'Régime de refuge classique : quand les actions reculent, les obligations montent.';
  if (has('actions', 'petrole')) return pos ? 'Le pétrole suit la demande économique, comme les actions.' : 'Le pétrole pèse sur les actions (coût de l\'énergie, inflation, choc d\'offre) : sa hausse est un vent contraire.';
  if (famA === 'dollar' && mat(famB) || famB === 'dollar' && mat(famA)) return pos ? 'Ils montent avec le dollar : un mouvement de refuge ou de demande mondiale l\'emporte sur l\'effet habituel du dollar.' : 'Effet dollar habituel : un dollar fort pèse sur les matières premières cotées en dollars, un dollar faible les soutient.';
  if (has('or', 'obligations')) return pos ? 'L\'or suit le prix des obligations : des rendements en baisse réduisent le coût de détention d\'un actif qui ne rapporte rien.' : 'L\'or évolue à l\'inverse du prix des obligations : il progresse quand les rendements montent (inflation, défiance).';
  if (has('actions', 'cuivre')) return pos ? 'Le cuivre confirme les actions : la croissance industrielle soutient les deux.' : 'Le cuivre et les actions divergent : signe de prudence sur la croissance.';
  if (has('actions', 'or')) return pos ? 'L\'or suit les actions : la liquidité abondante porte tous les actifs, son rôle de refuge s\'efface.' : 'L\'or joue son rôle de refuge face aux actions.';
  if (has('actions', 'crypto')) return pos ? 'Le bitcoin se comporte comme un actif de croissance, sensible aux mêmes facteurs (taux, liquidité).' : 'Le bitcoin se détache des actions.';
  if (has('actions', 'refuge')) return pos ? 'Le yen monte avec les actions : son rôle de refuge est en retrait.' : 'Le yen joue son rôle de refuge face aux actions.';
  if (has('actions', 'dollar')) return pos ? 'Le dollar monte avec les actions : la force américaine domine.' : 'Le dollar fait office de refuge face aux actions.';
  if (has('actions', 'matiere')) return pos ? 'Cette matière première suit l\'appétit pour le risque et la demande mondiale.' : 'Cette matière première se détache des actions : ses prix répondent à l\'offre (météo, stocks).';
  if (has('petrole', 'matiere') || has('petrole', 'cuivre')) return pos ? 'Elles partagent un même moteur : coûts de l\'énergie et demande industrielle.' : 'Le pétrole et ce marché évoluent en sens inverse : une énergie plus chère pèse sur ses prix ou sa demande.';
  if (has('obligations', 'dollar')) return pos ? 'Le dollar monte avec le prix des obligations : mouvement de refuge vers les actifs américains.' : 'Le dollar monte quand les rendements montent : les écarts de taux attirent les capitaux.';
  return pos ? 'Les deux marchés réagissent au même facteur dominant.' : 'Les deux marchés évoluent en sens inverse : un facteur commun les fait réagir de façon opposée.';
}

// Le signe sur 60 séances est l'opposé de celui de l'historique, avec des liens assez nets des deux côtés.
const isShift = (r60, rMax) => r60 != null && rMax != null && Math.abs(r60) >= 0.3 && Math.abs(rMax) >= 0.15 && Math.sign(r60) !== Math.sign(rMax);

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
    const rr = Math.abs(r60 == null ? 0 : r60) >= 0.2 ? r60 : r250;
    return { a: p.a, b: p.b, aName: name(p.a), bName: name(p.b), expect: p.expect, why: p.why, r60, r250, rMax, status: readPair(p.expect, r250, rMax),
      reading: rr == null || Math.abs(rr) < 0.2 ? null : meaning(familyOf(p.a), familyOf(p.b), rr) };
  });

  // Changements de régime : le signe sur 60 séances est l'opposé de celui de l'historique, avec des liens assez nets des deux côtés.
  const shifts = [];
  for (let i = 0; i < assets.length; i++) for (let j = i + 1; j < assets.length; j++) {
    const r60 = matrix[60][i][j], rMax = matrix.max[i][j];
    if (isShift(r60, rMax))
      shifts.push({ a: assets[i].slug, b: assets[j].slug, aName: assets[i].name, bName: assets[j].name, r60, rMax, gap: round(Math.abs(r60 - rMax)), reading: meaning(familyOf(assets[i].slug), familyOf(assets[j].slug), r60) });
  }
  shifts.sort((x, y) => y.gap - x.gap);

  return { updated: now, asOf: asOf ? isoDay(asOf) : null, assets, windows: WINDOWS, matrix, pairs, shifts: shifts.slice(0, 6) };
}

// Grands moteurs auxquels on compare n'importe quel marché : actions, obligations, dollar, or, pétrole.
const DRIVERS = ['sp500', '10-year-t-note', 'us-dollar', 'gold', 'crude-oil'];
// Corrélations d'un marché {slug, group} avec les moteurs (sauf lui-même et sa propre famille quand le lien serait une évidence), sur 60 séances, 1 an et tout l'historique,
// avec la variation du moteur sur 5 séances. series : { slug: [[t, clôture, …], …] } doit contenir le marché et les moteurs. null si le marché n'a pas assez de séances.
const bloc = f => (f === 'dollar' || f === 'refuge' ? 'devises' : f);          // dollar, yen et autres devises : même bloc (leur lien mutuel est une évidence)
function profile(market, series, corr) {
  const own = series[market.slug];
  if (!own || own.length <= 60) return null;
  const ownFam = familyOf(market.slug, market.group), mo = new Map(own.map(r => [isoDay(r[0]), r[1]])), od = own.map(r => isoDay(r[0]));
  const drivers = [];
  for (const slug of DRIVERS) {
    const rows = series[slug], a = ASSETS.find(x => x[0] === slug);
    if (!rows || rows.length <= 60 || slug === market.slug || bloc(familyOf(slug)) === bloc(ownFam) && ['actions', 'obligations', 'devises'].includes(bloc(ownFam))) continue;
    const all = commonReturns(mo, new Map(rows.map(r => [isoDay(r[0]), r[1]])), od), at = n => round(corr(n === 'max' ? all : all.slice(-n)));
    const n = rows.length, r60 = at(60), rMax = at('max');
    drivers.push({ slug, name: a[1], family: familyOf(slug), r60, r250: at(250), rMax, chg5: round((rows[n - 1][1] / rows[n - 6][1] - 1) * 100), flip: isShift(r60, rMax) });
  }
  return { family: ownFam, drivers };
}

// ---------- Ratios intermarchés : un marché divisé par un autre ; la tendance du ratio dit lequel des deux surperforme ----------
// Ratios pensés pour qui trade les indices : actions contre refuge, croissance contre valeur, petites contre grandes capitalisations, et les deux grands
// facteurs externes (dollar, pétrole). up / down : ce que signifie un ratio qui monte / qui baisse.
const RATIOS = [
  { id: 'actions-obligations', num: 'sp500', den: '10-year-t-note', label: 'S&P 500 / T-Note 10 ans',
    up: 'les actions surperforment les obligations : appétit pour le risque', down: 'les obligations surperforment les actions : recherche de refuge' },
  { id: 'nasdaq-sp500', num: 'nasdaq-100', den: 'sp500', label: 'Nasdaq 100 / S&P 500',
    up: 'le Nasdaq surperforme le S&P 500 : leadership de la croissance et de la technologie, souvent avec des taux stables ou en baisse', down: 'le S&P 500 surperforme le Nasdaq : rotation hors de la technologie, fréquente quand les taux montent ou que la prudence gagne' },
  { id: 'nasdaq-dow', num: 'nasdaq-100', den: 'dow-jones', label: 'Nasdaq 100 / Dow Jones',
    up: 'la croissance surperforme la valeur : marché porté par la technologie', down: 'la valeur surperforme la croissance : rotation vers les titres cycliques et défensifs du Dow' },
  { id: 'sp500-dollar', num: 'sp500', den: 'us-dollar', label: 'S&P 500 / Dollar américain',
    up: 'les actions surperforment le dollar : l\'appétit pour le risque l\'emporte sur la demande de refuge', down: 'le dollar surperforme les actions : recherche de refuge, ou dollar fort qui pèse sur les bénéfices des multinationales' },
  { id: 'sp500-petrole', num: 'sp500', den: 'crude-oil', label: 'S&P 500 / Pétrole',
    up: 'les actions surperforment le pétrole : la facture énergétique ne pèse pas sur le marché', down: 'le pétrole surperforme les actions : coûts de l\'énergie et inflation pèsent sur le marché' },
];
const RATIO_SLUGS = [...new Set(RATIOS.flatMap(r => [r.num, r.den]))];
const sig = v => +v.toPrecision(5);                                       // 5 chiffres significatifs : les ratios bruts peuvent valoir 0,001 comme 80

// series : { slug: [[t en secondes, clôture, …], …] }. Chaque ratio est calculé aux dates où les deux marchés ont coté.
// Sortie : dernière valeur, variation sur 20 et 60 séances (%), position sur 1 an (rang de la dernière valeur parmi les 250 dernières, 0-100), sens sur 3 mois, lecture, série complète.
function ratios(series, now = Date.now()) {
  const out = [];
  for (const r of RATIOS) {
    const sn = series[r.num], sd = series[r.den];
    if (!sn || !sd || sn.length <= 60 || sd.length <= 60) continue;
    const md = new Map(sd.map(x => [isoDay(x[0]), x[1]])), pts = [];
    for (const x of sn) { const d = md.get(isoDay(x[0])); if (d) pts.push([x[0], sig(x[1] / d)]); }
    if (pts.length <= 60) continue;
    const n = pts.length, last = pts[n - 1][1], pct = k => (n > k ? Math.round((last / pts[n - 1 - k][1] - 1) * 10000) / 100 : null);
    const win = pts.slice(-250).map(p => p[1]), pos = Math.round(win.filter(v => v <= last).length / win.length * 100);   // au moins 61 valeurs : un ratio plus court est écarté plus haut
    const chg60 = pct(60), dir = chg60 == null || Math.abs(chg60) < 1 ? 'flat' : chg60 > 0 ? 'up' : 'down';
    const f = v => Math.abs(v).toFixed(1).replace('.', ',');
    const reading = dir === 'flat' ? `${r.label} est stable depuis 3 mois (${chg60 == null ? '–' : (chg60 > 0 ? '+' : '−') + f(chg60)} %) : aucune des deux jambes ne prend le dessus.`
      : `${r.label} ${dir === 'up' ? 'progresse' : 'recule'} de ${f(chg60)} % sur 3 mois — ${dir === 'up' ? r.up : r.down}.`;
    out.push({ id: r.id, label: r.label, num: r.num, den: r.den, last, chg20: pct(20), chg60, pos250: pos, dir, reading, series: pts });
  }
  return { updated: now, asOf: out.length ? isoDay(Math.max(...out.map(o => o.series[o.series.length - 1][0]))) : null, ratios: out };
}

module.exports = { RATIOS, RATIO_SLUGS, ratios, ASSETS, SLUGS, WINDOWS, PAIRS, DRIVERS, FAMILY, familyOf, meaning, isShift, profile, commonReturns, readPair, build };
