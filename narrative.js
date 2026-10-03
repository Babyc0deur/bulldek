// Récit du debrief : relie les indicateurs entre eux (convergences, contradictions, prix ↔ open interest ↔ positionnement, macro ↔ biais, annonces ↔ marché)
// au lieu de les aligner. Fonctions pures, sans réseau. Lectures conventionnelles, pas des prévisions.
const M = require('./macro.js'), Y = require('./yields.js'), CALC = require('./calc.js'), I = require('./intermarket.js');

const f1 = v => v.toFixed(1).replace('.', ',').replace('-', '−'), f2 = v => v.toFixed(2).replace('.', ',').replace('-', '−');
const sg = v => (v >= 0 ? '+' : '−');
const pctTxt = v => sg(v) + f2(Math.abs(v)) + ' %';
const cap = s => s[0].toUpperCase() + s.slice(1);
const MASC = { up: 'haussier', down: 'baissier', flat: 'neutre' };
const DIR = { 1: 'haussier', '-1': 'baissier', 0: 'neutre' };

// Famille du marché : détermine comment la macro et les annonces s'y transmettent.
const kindOf = (group, slug) => (slug === 'us-dollar' ? 'usd' : { Indices: 'risk', Crypto: 'risk', Metals: 'metal', Bonds: 'bond', Currencies: 'fx' }[group] || 'commo');
const NATURE = { risk: 'un actif de croissance (valorisations sensibles aux taux)', metal: 'un métal sensible aux taux réels et à la demande de protection', bond: 'une obligation (prix inversement lié aux rendements)', fx: 'une devise cotée contre le dollar', usd: 'le dollar américain', commo: 'une matière première (surtout gouvernée par l\'offre, la demande et la météo)' };

// « Restrictivité » d'une zone : +1 si l'inflation remonte et/ou les taux montent, −1 si l'inverse, 0 sinon.
function hawk(macro, area) {
  const T = (S, n) => { const l = M.lastOf(S), b = M.back(S, n); return l && b ? l[1] - b[1] : null; };
  const c = T(macro.cpi && macro.cpi.yoy && macro.cpi.yoy[area], 3), r = T(macro.rates && macro.rates.immediate && macro.rates.immediate[area], 6);
  if (c == null && r == null) return null;
  const s = (c != null ? (c > 0.2 ? 1 : c < -0.2 ? -1 : 0) : 0) + (r != null ? (r > 0.05 ? 1 : r < -0.05 ? -1 : 0) : 0);
  return { score: Math.sign(s), cpi: c, rate: r };
}
// Effet d'un vent « restrictif » sur le marché : −1 pèse, +1 soutient, 0 sans direction claire.
function sensitivity(kind, foreign) { return { risk: -1, metal: -1, bond: -1, usd: 1, fx: foreign ? 1 : -1, commo: 0 }[kind]; }

function situation(row, bias, win = { weekend: false }, session = null) {
  const price = row.price >= 1000 ? Math.round(row.price).toLocaleString('fr-FR') : String(Math.round(row.price * 100) / 100).replace('.', ',');
  const mv = Number.isFinite(row.chgPct) ? `${row.name} clôture à ${price} (${pctTxt(row.chgPct)} sur la séance)` : `${row.name} est à ${price}`;
  const same = bias.week.key === bias.day.key, flat = k => k === 'flat';
  const open = win.weekend ? `Les marchés sont fermés : ce debrief repose sur la clôture de ${session || 'la dernière séance'}, en attendant l'ouverture de la semaine. ` : '';
  let t = `${open}${mv}. Le biais est ${MASC[bias.week.key]} sur la semaine et ${MASC[bias.day.key]} sur ${win.weekend ? 'la dernière séance' : 'la journée'}`;
  if (same && !flat(bias.week.key)) t += ' : les deux horizons vont dans le même sens, ce qui renforce la lecture.';
  else if (!same && !flat(bias.week.key) && !flat(bias.day.key)) t += ' : les deux horizons s\'opposent, la structure et le court terme ne racontent pas la même histoire ; mieux vaut attendre qu\'ils se réalignent.';
  else if (flat(bias.week.key) && flat(bias.day.key)) t += ' : rien ne se dégage nettement, ni sur la structure ni sur le court terme.';
  else t += flat(bias.week.key) ? ' : le court terme a un avis, mais la structure de fond reste indécise.' : ' : la structure a un avis, mais le court terme ne le confirme pas encore.';
  return t;
}

function convergence(row) {
  const sg_ = row.sig || {}, items = [['le positionnement des commerciaux (COT)', sg_.cot], ['la saisonnalité', sg_.season], ['le Williams %R', sg_.wr], ['l\'open interest', sg_.oi]];
  const up = items.filter(i => i[1] > 0).map(i => i[0]), down = items.filter(i => i[1] < 0).map(i => i[0]), flat = items.filter(i => !i[1]).map(i => i[0]);
  const list = a => (a.length > 1 ? a.slice(0, -1).join(', ') + ' et ' + a[a.length - 1] : a[0]);
  let t;
  if (up.length && down.length) t = `Les indicateurs se contredisent : ${list(up)} ${up.length > 1 ? 'plaident' : 'plaide'} pour la hausse, alors que ${list(down)} ${down.length > 1 ? 'pointent' : 'pointe'} vers la baisse. Une confluence de ${sg(row.score)}${Math.abs(row.score)} sur 4 est donc le résultat d'un arbitrage, pas d'un consensus.`;
  else if (up.length || down.length) { const a = up.length ? up : down, d = up.length ? 'vers la hausse' : 'vers la baisse'; t = `${a.length === 1 ? cap(list(a)) + ' est le seul signal actif, orienté ' + d : `${cap(list(a))} convergent ${d}`}${flat.length ? `, tandis que ${list(flat)} ${flat.length > 1 ? 'restent neutres' : 'reste neutre'}` : ''} : ${a.length >= 3 ? 'la convergence est forte' : a.length === 2 ? 'la convergence est réelle mais partielle' : 'un signal isolé ne suffit pas à faire une tendance'}.`; }
  else t = 'Aucun des quatre indicateurs n\'est en zone active : le marché n\'offre pas d\'avantage statistique net aujourd\'hui.';
  const cot = row.idx6 >= 80 ? `Les commerciaux, acteurs de la couverture et traditionnellement considérés comme les mieux informés, sont à ${Math.round(row.idx6)} % de leur amplitude sur 6 mois : un positionnement net acheteur inhabituellement élevé, que le site classe en zone d'achat.` : row.idx6 <= 20 ? `Les commerciaux, acteurs de la couverture et traditionnellement considérés comme les mieux informés, ne sont qu'à ${Math.round(row.idx6)} % de leur amplitude sur 6 mois : un positionnement net très bas, que le site classe en zone de vente (convention, non validée par un test rétrospectif).` : '';
  const season = row.season ? ` La saison de la semaine est ${row.season.avgPct >= 0 ? 'favorable' : 'défavorable'} (${pctTxt(row.season.avgPct)} en moyenne, hausse ${row.season.up} années sur ${row.season.n}).` : '';
  return t + (cot ? ' ' + cot : '') + season;
}

function priceFlow(row) {
  const parts = [];
  const oi = row.oi;
  if (oi && !row.roll) {
    const move = `Sur la semaine, le prix fait ${pctTxt(oi.priceChgPct)} pendant que l'open interest fait ${pctTxt(oi.chgPct)}`;
    const R = {
      'trend-up': 'de nouveaux acheteurs entrent : le mouvement est nourri, donc plus crédible.',
      covering: 'la hausse vient surtout de vendeurs qui rachètent pour se couvrir, sans nouvel afflux d\'acheteurs : elle est fragile et peut s\'essouffler une fois ces rachats terminés.',
      'trend-down': 'de nouveaux vendeurs entrent : la baisse est nourrie, donc plus crédible.',
      liquidation: 'la baisse vient surtout d\'acheteurs qui sortent, sans nouvel afflux de vendeurs : elle perd de sa force dès que la liquidation s\'achève.',
      flat: 'le mouvement est trop faible pour être interprété.',
    }[oi.key];
    if (R) parts.push(`${move} : ${R}`);
  } else if (row.roll) parts.push('Un changement de contrat récent brouille la lecture prix / open interest, que le site neutralise.');
  if (!row.roll && Number.isFinite(row.wr)) {
    const up = oi && oi.priceChgPct > 1, down = oi && oi.priceChgPct < -1;
    if (row.wr > -20) parts.push(`Avec un Williams %R à ${f1(row.wr)}, le prix est en zone de surachat${up ? ' après un mouvement haussier déjà avancé : le potentiel à court terme s\'amenuise et un repli technique devient plus probable' : ' : la prudence s\'impose pour de nouveaux achats, même si un marché peut rester suracheté longtemps dans une tendance forte'}.`);
    else if (row.wr < -80) parts.push(`Avec un Williams %R à ${f1(row.wr)}, le prix est en zone de survente${down ? ' après une baisse déjà marquée : un rebond technique devient plus probable' : ' : un rebond est possible, mais sans confirmation cela reste un pari contre la tendance'}.`);
    else parts.push(`Le Williams %R (${f1(row.wr)}) est en zone intermédiaire : le prix n'est ni étiré à l'achat ni à la vente.`);
  }
  return parts.join(' ');
}

function macroStory(row, market, macro, bias) {
  const kind = kindOf(row.group, market.slug), ccys = M.marketCurrencies(market.slug), foreign = ccys.length > 1 ? ccys[0] : null;
  const us = hawk(macro, 'USA'), fo = foreign ? hawk(macro, M.areaOfCcy(foreign)) : null;
  const parts = [];
  const CCY = { EUR: 'euro', GBP: 'livre sterling', JPY: 'yen', CAD: 'dollar canadien', CHF: 'franc suisse', AUD: 'dollar australien', NZD: 'dollar néo-zélandais' };
  const describe = (h, name) => (h.score > 0 ? `${name} : l'inflation et/ou les taux montent (contexte restrictif)` : h.score < 0 ? `${name} : l'inflation et/ou les taux refluent (contexte accommodant)` : `${name} : ni l'inflation ni les taux n'ont bougé de façon marquée`);
  let tilt = 0;
  if (kind === 'fx' && us && fo) {
    tilt = fo.score - us.score;
    parts.push(`Côté monnaie, ${describe(fo, CCY[foreign] || foreign)} ; ${describe(us, 'aux États-Unis')}. ${tilt > 0 ? `L'écart de politique monétaire tourne à l'avantage de la devise ${foreign}` : tilt < 0 ? 'L\'écart de politique monétaire tourne à l\'avantage du dollar' : 'Aucun écart net de politique monétaire ne se dessine entre les deux zones'}.`);
  } else if (us) {
    tilt = sensitivity(kind, false) * us.score;
    const link = { risk: us.score > 0 ? 'Des taux et une inflation qui montent pèsent en général sur les valorisations des actifs de croissance' : us.score < 0 ? 'Une détente de l\'inflation et des taux soutient en général les valorisations' : 'Sans impulsion macro nette, les valorisations ne reçoivent ni vent porteur ni vent contraire',
      metal: us.score > 0 ? 'Des taux qui montent augmentent le coût de détention d\'un métal qui ne rapporte rien, même si l\'inflation nourrit la demande de protection' : us.score < 0 ? 'Des taux qui refluent réduisent le coût de détention d\'un métal qui ne rapporte rien' : 'Sans impulsion sur les taux, le coût de détention du métal ne change pas',
      bond: us.score > 0 ? 'Des taux et une inflation qui montent poussent les rendements vers le haut, donc les prix des obligations vers le bas' : us.score < 0 ? 'Des taux et une inflation qui refluent soutiennent les prix des obligations' : 'Sans impulsion sur les rendements, le prix des obligations reste guidé par ses propres flux',
      usd: us.score > 0 ? 'Des taux américains qui montent rendent le dollar plus attractif' : us.score < 0 ? 'Des taux américains qui refluent rendent le dollar moins attractif' : 'Sans impulsion sur les taux, le dollar dépend surtout du différentiel avec les autres zones',
      commo: 'L\'inflation est ici davantage un symptôme qu\'une cause : elle renseigne sur la demande globale mais ne dicte pas la direction du marché' }[kind];
    parts.push(`${describe(us, 'Aux États-Unis')}. ${cap(NATURE[kind])} : ${link}.`);
  }
  if (!parts.length) return { text: 'Les données d\'inflation et de taux ne sont pas encore disponibles : la lecture macro est omise plutôt qu\'inventée.', tilt: 0, known: false };
  const b = bias.week.key === 'up' ? 1 : bias.week.key === 'down' ? -1 : 0;
  if (tilt !== 0 && b !== 0) parts.push(tilt === b ? `Ce contexte va dans le même sens que le biais de la semaine (${MASC[bias.week.key]}) : la macro et la technique se confirment.` : `Ce contexte va à l'inverse du biais de la semaine (${MASC[bias.week.key]}) : la macro nuance la lecture technique, ce qui invite à réduire la confiance dans le biais.`);
  else if (tilt !== 0) parts.push(`Le contexte macro est ${tilt > 0 ? 'porteur' : 'contraignant'} pour ce marché alors que la technique est indécise : il pourrait faire pencher la balance.`);
  return { text: parts.join(' '), tilt, known: true };
}

// Type d'annonce d'après son intitulé.
function eventType(title) {
  if (/cpi|pce|ppi|inflation|price index/i.test(title)) return 'inflation';
  if (/rate|fomc|statement|press conf|speaks|minutes|monetary|policy/i.test(title)) return 'banque';
  if (/non-farm|nfp|employment|payroll|unemployment|jobless|jobs|jolts|adp|claims/i.test(title)) return 'emploi';
  if (/gdp|retail|pmi|ism|sales|confidence|sentiment|production|durable|housing/i.test(title)) return 'activité';
  return 'autre';
}
function fmtTime(t) { return new Date(t).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }); }

function agendaStory(row, market, events, now, win = { weekend: false, hours: 48, back: 12 }) {
  const kind = kindOf(row.group, market.slug), ccys = M.marketCurrencies(market.slug), list = M.upcoming(events, ccys, now, win.hours, win.back);
  if (!list.length) return win.weekend ? ((events || []).some(e => e.t >= win.start) ? 'Aucune annonce d\'importance moyenne ou forte n\'est prévue la semaine prochaine pour les devises de ce marché : pas de catalyseur macro identifié, le marché sera plutôt guidé par son propre flux.' : 'Le calendrier de la semaine prochaine n\'est pas encore publié par notre source (il l\'est généralement le dimanche soir) : aucune annonce à signaler pour l\'instant, l\'agenda sera complété dès sa parution.') : 'Aucune annonce d\'importance moyenne ou forte n\'est attendue dans les 48 prochaines heures pour les devises de ce marché : pas de catalyseur macro immédiat, le marché sera plutôt guidé par son propre flux.';
  const strong = list.filter(e => e.impact === 'High'), main = (strong.length ? strong : list).slice(0, win.weekend ? 6 : 3);
  const out = [`${strong.length ? `${strong.length} annonce${strong.length > 1 ? 's' : ''} d'importance forte` : `${list.length} annonce${list.length > 1 ? 's' : ''} d'importance moyenne`} à surveiller${win.weekend ? ' la semaine prochaine' : ''}${strong.length ? ', pouvant amplifier les mouvements' : ''}.`];
  for (const e of main) {
    const past = e.t < now, ty = eventType(e.title), foreign = ccys.length > 1 && e.ccy === ccys[0];
    const cmp = e.forecast && e.previous ? ` (prévision ${e.forecast}, précédent ${e.previous})` : e.forecast ? ` (prévision ${e.forecast})` : e.previous ? ` (précédent ${e.previous})` : '';
    let read;
    const s = sensitivity(kind, foreign);
    if (ty === 'banque') read = 'le ton du discours compte davantage que le chiffre : un message ferme sur les taux serait lu comme restrictif, un message prudent comme accommodant';
    else if (ty === 'emploi') read = 'un chiffre plus fort que prévu est lu comme restrictif (les taux resteraient élevés), un chiffre plus faible comme accommodant (attention : pour le chômage et les inscriptions au chômage, la lecture est inversée)';
    else if (ty === 'inflation') read = 'un chiffre plus élevé que prévu est lu comme restrictif, un chiffre plus bas comme accommodant';
    else if (ty === 'activité') read = 'un chiffre plus fort que prévu est lu comme restrictif pour les taux (mais favorable à la croissance), un chiffre plus faible comme accommodant';
    else read = 'l\'impact dépend de l\'écart avec les attentes';
    let effect = '';
    if (ty !== 'autre') effect = s === 0 ? ` Pour ${market.name}, la transmission est peu directe : la réaction dépendra surtout du sentiment global.` : ` Pour ${market.name}, un résultat restrictif serait plutôt ${s < 0 ? 'défavorable' : 'favorable'} et un résultat accommodant plutôt ${s < 0 ? 'favorable' : 'défavorable'}.`;
    out.push(`${cap(fmtTime(e.t))} (heure de Paris) : ${e.title} (${e.ccy})${cmp}${past ? ', déjà publiée' + (e.actual ? ` (résultat ${e.actual})` : '') : ''} — ${read}.${effect}`);
  }
  out.push('La première réaction à une annonce est souvent brutale et partiellement corrigée ensuite : mieux vaut laisser le marché digérer le chiffre avant d\'en tirer une conclusion.');
  return out.join(' ');
}

// Rendements, courbe, taux réels, VIX et corrélations glissantes (60 séances) du marché avec ces séries.
const dpt = v => (v > 0 ? '+' : v < 0 ? '−' : '') + f2(Math.abs(v)) + ' pt';
const frDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
function ratesModel(yields, daily) {
  if (!yields || !yields.us10y) return null;
  const m = { us10y: Y.change(yields.us10y, 5), us2y: Y.change(yields.us2y, 5), curve: Y.change(yields.curve, 20), real: Y.change(yields.real10y, 5), be: Y.lastOf(yields.breakeven), vix: Y.change(yields.vix, 5),
    pce: Y.change(yields.pceYoy, 1), pceCore: Y.change(yields.pceCoreYoy, 1), dxy: Y.change(yields.dxy, 5) };
  m.c10 = Y.assetCorrelation(daily, yields.us10y, CALC.correlation); m.cv = Y.assetCorrelation(daily, yields.vix, CALC.correlation); m.cdxy = Y.assetCorrelation(daily, yields.dxy, CALC.correlation);
  return m;
}
const frMonth = d => new Date(d + 'T00:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
function ratesStory(row, market, yields, daily, bias) {
  const m = ratesModel(yields, daily);
  if (!m) return 'Les rendements américains, la courbe, le VIX, l\'inflation PCE et le dollar ne sont pas encore chargés : cette lecture est omise plutôt qu\'inventée.';
  const out = [];
  out.push(`Le rendement américain à 10 ans est à ${f2(m.us10y.value)} % (${m.us10y.delta != null ? dpt(m.us10y.delta) + ' sur 5 séances' : 'variation indisponible'}, données du ${frDate(m.us10y.date)})${m.us2y ? ` et celui à 2 ans à ${f2(m.us2y.value)} %` : ''}.`);
  if (m.curve) out.push(`La courbe 10 ans moins 2 ans vaut ${dpt(m.curve.value)} : ${m.curve.value >= 0 ? 'pente positive (normale)' : 'courbe inversée'}${m.curve.delta != null && Math.abs(m.curve.delta) >= 0.05 ? `, ${m.curve.delta > 0 ? 'pentifiée' : 'aplatie'} de ${f2(Math.abs(m.curve.delta))} pt en 20 séances` : ''}.`);
  if (m.real) out.push(`Le taux réel à 10 ans (net de l'inflation) est à ${f2(m.real.value)} %${m.be ? ` et l'inflation anticipée à 10 ans à ${f2(m.be[1])} %` : ''} : ${m.real.value >= 2 ? 'un taux réel élevé, qui pèse en général sur les valorisations et sur les actifs sans rendement comme l\'or' : m.real.value <= 0.5 ? 'un taux réel bas, en général favorable aux actifs sans rendement et aux valorisations' : 'un niveau intermédiaire, sans pression marquée'}.`);
  if (m.vix) out.push(`Le VIX, indicateur de la volatilité attendue sur les actions, est à ${f1(m.vix.value)} (${frDate(m.vix.date)}) : ${m.vix.value < 15 ? 'régime de calme' : m.vix.value < 25 ? 'régime normal' : 'régime de tension'}${m.vix.delta != null && Math.abs(m.vix.delta) >= 1 ? `, ${m.vix.delta > 0 ? 'en hausse' : 'en baisse'} de ${f1(Math.abs(m.vix.delta))} point${Math.abs(m.vix.delta) >= 2 ? 's' : ''} sur 5 séances` : ''}.`);
  if (m.pce || m.pceCore) { const ref = m.pce || m.pceCore;
    out.push(`L'inflation PCE, l'indicateur suivi par la Fed, est à ${m.pce ? f1(m.pce.value) + ' %' : '– %'} sur un an${m.pceCore ? `, dont ${f1(m.pceCore.value)} % hors alimentation et énergie (indice cœur)` : ''}, publiée pour ${frMonth(ref.date)}${m.pceCore && m.pceCore.delta != null && Math.abs(m.pceCore.delta) >= 0.05 ? ` (${m.pceCore.delta > 0 ? '+' : '−'}${f1(Math.abs(m.pceCore.delta))} pt sur un mois pour le cœur)` : ''}.`);
  }
  if (m.dxy) out.push(`L'indice du dollar (DXY) est à ${f1(m.dxy.value)} (${frDate(m.dxy.date)})${m.dxy.delta != null && Math.abs(m.dxy.delta) >= 0.1 ? `, ${m.dxy.delta > 0 ? 'en hausse' : 'en baisse'} de ${f1(Math.abs(m.dxy.delta))} sur 5 séances` : ''}.`);
  const b = bias.week.key === 'up' ? 1 : bias.week.key === 'down' ? -1 : 0;
  const link = (c, label, series, subject, unit) => {
    if (!c) return null;
    if (Math.abs(c.r) < 0.3) return `Sur les ${c.n} dernières séances, ${market.name} est peu lié ${label} (corrélation ${f2(c.r)}, faible) : ce facteur n'explique pas grand-chose de ses mouvements récents.`;
    let t = `Sur les ${c.n} dernières séances, ${market.name} évolue ${c.r < 0 ? 'en sens inverse' : 'dans le même sens'} ${label} (corrélation ${f2(c.r)}, ${Y.strength(c.r)}).`;
    if (series && series.delta != null && series.delta !== 0) {
      const push = Math.sign(c.r) * Math.sign(series.delta);                       // > 0 : la variation récente a plutôt soutenu le marché
      t += ` ${subject} a ${series.delta > 0 ? 'monté' : 'baissé'} de ${f2(Math.abs(series.delta))} ${unit} sur 5 séances, ce qui a plutôt ${push > 0 ? 'soutenu' : 'pesé sur'} le marché${b ? (push === b ? ', dans le sens du biais de la semaine' : ', à l\'inverse du biais de la semaine (à surveiller)') : ''}.`;
    }
    return t;
  };
  const l1 = link(m.c10, 'du rendement à 10 ans', m.us10y, 'Le rendement', 'pt'), l2 = link(m.cv, 'du VIX', m.vix, 'Le VIX', 'point'), l3 = link(m.cdxy, 'du dollar (DXY)', m.dxy, 'Le dollar', 'point');
  if (l1) out.push(l1); if (l2) out.push(l2); if (l3) out.push(l3);
  if (l1 || l2 || l3) out.push('Une corrélation passée n\'est pas une relation de cause à effet et varie dans le temps : c\'est un repère, pas une règle.');
  return out.join(' ');
}

// Intermarchés (indices uniquement) : corrélations de l'indice avec les obligations, le dollar, l'or et le pétrole sur 60 séances, comparées à l'historique,
// avec ce qu'elles signifient et ce que le mouvement récent de chaque moteur a changé pour l'indice. inter = INTER.profile(...) ; null → paragraphe omis.
const isIndex = (row, market) => (row && row.group === 'Indices') || (market && I.familyOf(market.slug, market.group) === 'actions');
// Régime inflation / déflation et ratios intermarchés (inter.regime, inter.ratios).
// Un ratio « soutient » l'indice quand l'indice en est le numérateur et que le ratio monte (ou le dénominateur et qu'il baisse).
function ratioStory(market, inter, b) {
  const out = [], rg = inter.regime, rs = (inter.ratios || []).filter(r => r.dir);
  if (rg && rg.key !== 'neutral') out.push(`Régime : ${rg.label.toLowerCase()} (corrélation actions / obligations ${f2(rg.r60)} sur 60 séances) — ${rg.key === 'inflation' ? 'les taux et l\'inflation mènent le marché, les obligations ne protègent pas les actions' : 'les obligations jouent leur rôle de refuge'}.`);
  const moving = rs.filter(r => r.dir !== 'flat'), flat = rs.filter(r => r.dir === 'flat');
  for (const r of moving) {
    const own = r.num === market.slug ? 1 : r.den === market.slug ? -1 : 0, sup = own * (r.dir === 'up' ? 1 : -1);
    let t = r.reading;
    if (r.pos250 != null && (r.pos250 >= 90 || r.pos250 <= 10)) t += ` Il est proche de son ${r.pos250 >= 90 ? 'plus haut' : 'plus bas'} sur 1 an (${r.pos250} %).`;
    if (sup) t += ` Cela ${sup > 0 ? 'joue plutôt en faveur de' : 'joue plutôt contre'} ${market.name}${b ? (sup === b ? ', dans le sens du biais de la semaine' : ', à l\'inverse du biais de la semaine (à surveiller)') : ''}.`;
    out.push(t);
  }
  if (flat.length) out.push(`Ratios stables sur 3 mois : ${flat.map(r => r.label).join(', ')}.`);
  return out.length ? out : null;
}
// Paragraphe distinct : régime et ratios (null hors indices ou sans donnée).
function ratiosStory(row, market, inter, bias) {
  if (!inter || !isIndex(row, market)) return null;
  const r = ratioStory(market, inter, bias.week.key === 'up' ? 1 : bias.week.key === 'down' ? -1 : 0);
  return r ? r.join(' ') : null;
}
function interStory(row, market, inter, bias) {
  if (!inter || !isIndex(row, market)) return null;
  const b = bias.week.key === 'up' ? 1 : bias.week.key === 'down' ? -1 : 0, ds = (inter.drivers || []).filter(d => d.r60 != null);
  if (!ds.length) return null;
  const active = ds.filter(d => Math.abs(d.r60) >= 0.3 || d.flip), quiet = ds.filter(d => !active.includes(d));
  const out = [`${market.name} est comparé aux obligations, au dollar, à l'or et au pétrole sur les 60 dernières séances, puis à son historique.`];
  for (const d of active) {
    const way = d.r60 < 0 ? 'en sens inverse' : 'dans le même sens', ref = d.rMax == null ? '' : `, ${f2(d.rMax)} sur l'historique`;
    let t = `${d.name} : ${market.name} évolue ${way} (corrélation ${f2(d.r60)} sur 60 séances${ref}, ${Y.strength(d.r60)})${d.flip ? ' — le lien s\'est inversé par rapport à l\'historique' : ''}. ${I.meaning(I.familyOf(market.slug, market.group), d.family, d.r60)}`;
    if (d.chg5 != null && Math.abs(d.chg5) >= 0.1) {
      const push = Math.sign(d.r60) * Math.sign(d.chg5);                              // > 0 : le mouvement récent du moteur a plutôt soutenu l'indice
      t += ` Sur 5 séances, ${d.name} ${d.chg5 > 0 ? 'progresse' : 'recule'} de ${f2(Math.abs(d.chg5))} %, ce qui a plutôt ${push > 0 ? 'soutenu' : 'pesé sur'} l'indice${b ? (push === b ? ', dans le sens du biais de la semaine' : ', à l\'inverse du biais de la semaine (à surveiller)') : ''}.`;
    }
    out.push(t);
  }
  if (quiet.length) out.push(active.length ? `Peu de lien récent avec ${quiet.map(d => d.name).join(', ')}.` : `Aucune corrélation nette (au-delà de 0,3 en valeur absolue) avec ${quiet.map(d => d.name).join(', ')} : l'indice évolue surtout pour ses propres raisons.`);
  if (ds.some(d => d.flip)) out.push('Au moins un lien a changé de régime : mieux vaut ne pas se fier à la relation habituelle tant qu\'elle n\'est pas confirmée.');
  out.push('Une corrélation passée n\'est pas une relation de cause à effet et varie dans le temps : c\'est un repère, pas une règle.');
  return out.join(' ');
}

// Bilan du week-end : annonces publiées depuis lundi. Notre source ne fournit pas le chiffre publié : la réaction du prix est le meilleur indice de la lecture du marché.
// Surprise d'une annonce publiée : { dir : sens de l'écart au consensus, hawk : lecture restrictive (+1) ou accommodante (−1) } ; null sans chiffre comparable.
// Chômage et inscriptions au chômage : un chiffre plus élevé est un signe de faiblesse, donc lu à l'inverse.
const numOf = v => { const m = String(v == null ? '' : v).replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
function surprise(e) {
  const a = numOf(e.actual), f = numOf(e.forecast);
  if (!e.actual || a == null || f == null) return null;
  const dir = Math.abs(a - f) < 1e-9 ? 0 : Math.sign(a - f), inv = /unemployment|jobless|claims/i.test(e.title);
  return { dir, hawk: dir && ['inflation', 'emploi', 'activité'].includes(eventType(e.title)) ? dir * (inv ? -1 : 1) : 0 };
}
function verdict(e, market, kind, foreign) {
  const sp = surprise(e); if (!sp) return '';
  if (sp.dir === 0) return ', conforme aux attentes';
  const s = sensitivity(kind, foreign);
  return `, ${sp.dir > 0 ? 'supérieur' : 'inférieur'} aux attentes${sp.hawk && s ? ` (lecture ${sp.hawk > 0 ? 'restrictive' : 'accommodante'}, plutôt ${sp.hawk * s > 0 ? 'favorable' : 'défavorable'} à ${market.name})` : ''}`;
}
function recapStory(row, market, events, now, win) {
  const kind = kindOf(row.group, market.slug), ccys = M.marketCurrencies(market.slug), list = M.recent(events, ccys, now, win.recapHours || 0);
  if (!list.length) return 'Aucune annonce d\'importance moyenne ou forte n\'a été publiée depuis lundi pour les devises de ce marché : la semaine s\'est jouée sur les flux plutôt que sur les chiffres.';
  const strong = list.filter(e => e.impact === 'High'), main = list.slice(-8);
  const day = e => new Date(e.t).toLocaleDateString('fr-FR', { weekday: 'long', timeZone: 'Europe/Paris' });
  const out = [`${list.length} annonce${list.length > 1 ? 's' : ''} d'importance moyenne ou forte ${list.length > 1 ? 'ont' : 'a'} rythmé la semaine${strong.length ? ` (dont ${strong.length} d'importance forte)` : ''}.`];
  for (const e of main) {
    const ty = eventType(e.title), parts = [e.actual && `résultat ${e.actual}`, e.forecast && `prévision ${e.forecast}`, e.previous && `précédent ${e.previous}`].filter(Boolean), cmp = parts.length ? ` (${parts.join(', ')})` : '';
    const what = { inflation: 'chiffre d\'inflation', banque: 'communication de banque centrale', emploi: 'donnée d\'emploi', 'activité': 'indicateur d\'activité', autre: 'publication' }[ty];
    out.push(`${cap(day(e))} : ${what} « ${e.title} » (${e.ccy}${e.impact === 'Medium' ? ', importance moyenne' : ''})${cmp}${verdict(e, market, kind, ccys.length > 1 && e.ccy === ccys[0])}.`);
  }
  const hasActual = main.some(e => e.actual);
  if (Number.isFinite(row.chgPct)) out.push(`${hasActual ? 'La réaction du prix dit comment le marché a lu ces chiffres : ' : 'Le résultat exact de ces publications n\'est pas repris par notre source ; la réaction du prix est le meilleur indice de la lecture qu\'en a faite le marché : '}${market.name} a terminé la dernière séance à ${pctTxt(row.chgPct)}${Math.abs(row.chgPct) < 0.5 ? ', un mouvement modeste : les annonces n\'ont pas déclenché de réaction marquée' : row.chgPct > 0 ? ', une réaction plutôt positive' : ', une réaction plutôt négative'}${kind === 'commo' ? ' (pour une matière première, le lien avec ces annonces reste indirect)' : ''}.`);
  return out.join(' ');
}

function watch(row, bias) {
  const T = { buy: 80, sell: 20 }, out = [];
  if (bias.week.key === 'down') out.push(`Le scénario baissier serait remis en cause si le COT Index 6 mois remontait au-dessus de ${T.sell} % (actuellement ${Math.round(row.idx6)} %), ou si l'open interest se remettait à monter avec un prix en hausse.`);
  else if (bias.week.key === 'up') out.push(`Le scénario haussier serait remis en cause si le COT Index 6 mois repassait sous ${T.buy} % (actuellement ${Math.round(row.idx6)} %), ou si l'open interest se mettait à monter avec un prix en baisse.`);
  else out.push('Sans biais de fond, l\'événement à surveiller est le passage d\'un indicateur en zone active (COT Index sous 20 % ou au-dessus de 80 %) qui ferait basculer la confluence.');
  if (bias.day.key === 'down' && row.wr > -80) out.push('À court terme, un Williams %R sous −80 signalerait une survente et un possible rebond.');
  else if (bias.day.key === 'up' && row.wr < -20) out.push('À court terme, un Williams %R au-dessus de −20 signalerait un surachat et un possible repli.');
  return out.join(' ');
}

function narrative({ market, row, macro = {}, events = [], now, bias, win, session, daily, inter }) {
  const m = macroStory(row, market, macro, bias), im = interStory(row, market, inter, bias), rr = ratiosStory(row, market, inter, bias);
  return [
    { title: win && win.weekend ? 'Le point de clôture' : 'Le point du jour', text: situation(row, bias, win, session) },
    { title: 'Ce que disent les indicateurs entre eux', text: convergence(row) },
    { title: 'Prix, open interest et momentum', text: priceFlow(row) || 'Données insuffisantes pour relier prix et open interest.' },
    { title: 'Le contexte macro', text: m.text },
    { title: 'Rendements, volatilité et corrélations', text: ratesStory(row, market, macro.yields, daily, bias) },
    ...(im ? [{ title: 'Intermarchés', text: im }] : []),
    ...(rr ? [{ title: 'Régime et ratios', text: rr }] : []),
    ...(win && win.weekend ? [{ title: 'Les annonces de la semaine écoulée', text: recapStory(row, market, events, now, win) }] : []),
    { title: 'Les annonces à venir', text: agendaStory(row, market, events, now, win) },
    { title: 'Ce qui ferait changer la lecture', text: watch(row, bias) },
  ];
}

module.exports = { ratiosStory, interStory, surprise, ratesStory, ratesModel, narrative, kindOf, hawk, sensitivity, eventType, situation, convergence, priceFlow, macroStory, agendaStory, watch };
