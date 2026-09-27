// Debrief journalier d'un marché : assemble les indicateurs du site (confluence, COT, Williams %R, saisonnalité, open interest),
// le contexte macro (inflation, taux) et l'agenda des annonces économiques en un texte lisible. Fonction pure : aucun accès réseau.
// Les phrases décrivent des faits et des lectures conventionnelles ; ce n'est ni une prévision ni un conseil en investissement.
const M = require('./macro.js'), { narrative, ratesModel } = require('./narrative.js');

const f1 = v => v.toFixed(1).replace('.', ',').replace('-', '−');
const f2 = v => v.toFixed(2).replace('.', ',').replace('-', '−');
const pt = v => (v > 0 ? '+' : v < 0 ? '−' : '') + f2(Math.abs(v)).replace(/,00$/, ',0') + ' pt';
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const period = p => MONTHS[+p.slice(5) - 1] + ' ' + p.slice(0, 4);
const AREA_NAME = Object.fromEntries(M.AREAS.map(a => [a.code, a.name]));
const CCY_LABEL = { USD: 'dollar américain', EUR: 'euro', GBP: 'livre sterling', JPY: 'yen', CAD: 'dollar canadien', CHF: 'franc suisse', AUD: 'dollar australien', NZD: 'dollar néo-zélandais' };

// Tendance d'une série sur `n` observations : valeur, variation, période.
function trend(series, n) {
  const l = M.lastOf(series), b = M.back(series, n);
  return l ? { value: l[1], period: l[0], delta: b ? l[1] - b[1] : null } : null;
}

function technical(row) {
  const out = [];
  const z = row.wr > -20 ? 'surachat' : row.wr < -80 ? 'survente' : 'neutre';
  out.push(row.roll
    ? `Williams %R (14 jours) : ${f1(row.wr)}, mais un changement de contrat récent fausse l'indicateur : signal neutralisé.`
    : `Williams %R (14 jours) : ${f1(row.wr)} — zone de ${z}${z === 'surachat' ? ' (lecture prudente à l\'achat)' : z === 'survente' ? ' (lecture favorable à un rebond)' : ''}.`);
  if (row.season) out.push(`Saisonnalité de la semaine : ${row.season.avgPct >= 0 ? '+' : '−'}${f2(Math.abs(row.season.avgPct))} % en moyenne sur ${row.season.n} ans, haussier ${row.season.up} années sur ${row.season.n}.`);
  if (row.oi) out.push(`Open interest : ${row.oi.chgPct >= 0 ? '+' : '−'}${f2(Math.abs(row.oi.chgPct))} % sur la semaine, prix ${row.oi.priceChgPct >= 0 ? '+' : '−'}${f2(Math.abs(row.oi.priceChgPct))} % → « ${row.oi.label} ».`);
  return out;
}

function positioning(row) {
  const z = v => (v >= 80 ? 'zone d\'achat' : v <= 20 ? 'zone de vente' : 'zone neutre');
  return [`COT Index des commerciaux : ${Math.round(row.idx6)} % sur 6 mois (${z(row.idx6)}, utilisé pour la confluence) et ${Math.round(row.idx36)} % sur 36 mois (${z(row.idx36)}).`];
}

function macroLines(market, macro, ccys) {
  const out = [];
  for (const ccy of ccys) {
    const area = M.areaOfCcy(ccy); if (!area) continue;
    const label = ccy === 'USD' ? 'États-Unis' : AREA_NAME[area], lines = [];
    const cpi = trend(macro.cpi && macro.cpi.yoy && macro.cpi.yoy[area], 3), rate = trend(macro.rates && macro.rates.immediate && macro.rates.immediate[area], 6);
    if (cpi) lines.push(`inflation ${f1(cpi.value)} % sur un an (${period(cpi.period)})${cpi.delta != null ? `, ${pt(cpi.delta)} en 3 mois` : ''}`);
    if (rate) lines.push(`taux directeur de référence ${f2(rate.value)} %${rate.delta != null ? `, ${Math.abs(rate.delta) < 0.05 ? 'inchangé' : pt(rate.delta)} en 6 mois` : ''}`);
    if (!lines.length) continue;
    let reading = '';
    if (cpi && rate && cpi.delta != null && rate.delta != null) {
      if (cpi.delta > 0.2 && rate.delta >= 0) reading = ' Inflation qui remonte et taux qui ne baissent pas : environnement plutôt restrictif.';
      else if (cpi.delta < -0.2 && rate.delta <= 0) reading = ' Inflation qui reflue et taux stables ou en baisse : environnement plutôt accommodant.';
    }
    out.push(`${label} (${CCY_LABEL[ccy] || ccy}) : ${lines.join(' ; ')}.${reading}`);
  }
  return out;
}

const IMPACT_FR = { High: 'forte', Medium: 'moyenne' };
function fmtTime(t) { const d = new Date(t); return d.toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }); }
function recap(events, ccys, now, win) {
  return M.recent(events, ccys, now, win.recapHours || 0).map(e => {
    const extra = [e.forecast && `prévision ${e.forecast}`, e.previous && `précédent ${e.previous}`].filter(Boolean).join(', ');
    return `${fmtTime(e.t)} (Paris) · ${e.ccy} · ${e.title} · importance ${IMPACT_FR[e.impact]}${extra ? ' (' + extra + ')' : ''}`;
  });
}
function agenda(events, ccys, now, win = M.horizon(now)) {
  const list = M.upcoming(events, ccys, now, win.hours, win.back);
  return list.slice(0, 12).map(e => {
    const extra = [e.forecast && `prévision ${e.forecast}`, e.previous && `précédent ${e.previous}`].filter(Boolean).join(', ');
    return `${fmtTime(e.t)} (Paris) · ${e.ccy} · ${e.title} · importance ${IMPACT_FR[e.impact]}${extra ? ' (' + extra + ')' : ''}${e.t < now ? ' — déjà publiée' : ''}`;
  });
}

// Biais de la semaine (signaux structurels : COT 6 mois, saisonnalité, open interest → −3 à +3) et de la journée
// (Williams %R 14 jours + direction de la dernière séance si elle dépasse ±0,5 % → −2 à +2). Conventions du site, non validées par un test rétrospectif.
const DAY_MOVE = 0.5;
const LEAN = { up: 'haussière', down: 'baissière', flat: 'neutre' };
const lean = (score, min) => (score >= min ? 'up' : score <= -min ? 'down' : 'flat');
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
function biases(row) {
  const sg = row.sig || {}, week = (sg.cot || 0) + (sg.season || 0) + (sg.oi || 0);
  const known = Number.isFinite(row.chgPct), move = known && Math.abs(row.chgPct) >= DAY_MOVE ? Math.sign(row.chgPct) : 0, day = (sg.wr || 0) + move;
  return {
    week: { key: lean(week, 2), label: LEAN[lean(week, 2)], score: week, max: 3, why: `COT ${sgn(sg.cot || 0)}, saisonnalité ${sgn(sg.season || 0)}, open interest ${sgn(sg.oi || 0)}` },
    day: { key: lean(day, 1), label: LEAN[lean(day, 1)], score: day, max: 2, why: `Williams %R ${sgn(sg.wr || 0)}, ${known ? `dernière séance ${row.chgPct >= 0 ? '+' : '−'}${f2(Math.abs(row.chgPct))} %${move === 0 ? ' (mouvement trop faible pour compter)' : ''}` : 'variation de la dernière séance indisponible'}` },
  };
}

// Lecture d'ensemble : confluence du site + éventuel risque d'annonce.
function headline(row, risky) {
  const s = row.score, abs = Math.abs(s);
  const lean = s > 0 ? 'haussier' : s < 0 ? 'baissier' : 'neutre';
  const base = abs >= 2 ? `Confluence ${s > 0 ? '+' : '−'}${abs} sur 4 : biais ${lean} marqué.` : abs === 1 ? `Confluence ${s > 0 ? '+' : '−'}1 sur 4 : léger biais ${lean}.` : 'Confluence nulle : signaux partagés, pas de biais net.';
  return base + (risky ? ' Des annonces importantes sont attendues : la volatilité peut dépasser ce que suggèrent les indicateurs.' : '');
}

// row : ligne du screener ; macro : { cpi, rates } ; events : calendrier normalisé ; now : ms.
function ratesLines(yields, daily) {
  const m = ratesModel(yields, daily);
  if (!m) return [];
  const d = v => (v == null ? '' : ` (${pt(v)} en 5 séances)`), out = [`Rendement américain 10 ans : ${f2(m.us10y.value)} %${d(m.us10y.delta)}`];
  if (m.us2y) out.push(`Rendement américain 2 ans : ${f2(m.us2y.value)} %${d(m.us2y.delta)}`);
  if (m.curve) out.push(`Courbe 10 ans − 2 ans : ${pt(m.curve.value)}`);
  if (m.real) out.push(`Taux réel 10 ans : ${f2(m.real.value)} %`);
  if (m.be) out.push(`Inflation anticipée 10 ans : ${f2(m.be[1])} %`);
  if (m.vix) out.push(`VIX : ${f1(m.vix.value)}`);
  if (m.pce) out.push(`Inflation PCE (sur un an) : ${f1(m.pce.value)} %`);
  if (m.pceCore) out.push(`Inflation PCE cœur (sur un an) : ${f1(m.pceCore.value)} %`);
  if (m.dxy) out.push(`Indice dollar (DXY) : ${f1(m.dxy.value)}${d(m.dxy.delta)}`);
  if (m.c10) out.push(`Corrélation 60 séances avec le rendement 10 ans : ${f2(m.c10.r)}`);
  if (m.cv) out.push(`Corrélation 60 séances avec le VIX : ${f2(m.cv.r)}`);
  if (m.cdxy) out.push(`Corrélation 60 séances avec le dollar (DXY) : ${f2(m.cdxy.r)}`);
  return out;
}

function debrief({ market, row, macro = {}, events = [], now = Date.now(), daily }) {
  if (!row || row.missing) return { slug: market.slug, name: market.name, available: false, message: 'Données insuffisantes pour ce marché.' };
  const ccys = M.marketCurrencies(market.slug);
  const win = M.horizon(now), ag = agenda(events, ccys, now, win), risky = M.upcoming(events, ccys, now, win.weekend ? win.hours : 24, win.back).some(e => e.impact === 'High');
  const bias = biases(row), asOf = row.priceDate ? row.priceDate * 1000 : null;
  const session = asOf ? new Date(asOf).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : null;
  const sections = [
    { title: 'Synthèse', lines: [headline(row, risky), `Semaine : ${bias.week.label} (${bias.week.why}).`, `${win.weekend ? 'Dernière séance' : 'Journée'} : ${bias.day.label} (${bias.day.why}).`] },
    { title: 'Technique', lines: technical(row) },
    { title: 'Positionnement (COT)', lines: positioning(row) },
    { title: 'Contexte macro', lines: macroLines(market, macro, ccys) },
    { title: 'Rendements, courbe et risque', lines: ratesLines(macro.yields, daily) },
    ...(win.weekend ? [{ title: 'Annonces de la semaine écoulée (depuis lundi)', lines: recap(events, ccys, now, win) }] : []),
    { title: win.weekend ? 'Agenda de la semaine qui s\'ouvre' : 'Agenda économique (48 h)', lines: ag },
  ];
  const attention = [];
  if (win.weekend) attention.push(`Week-end : les marchés sont fermés. Ce debrief repose sur la clôture de ${session || 'la dernière séance'} et sera actualisé à l'ouverture de la semaine.`);
  if (row.roll) attention.push('Changement de contrat récent : Williams %R et open interest neutralisés.');
  if (row.fresh && row.fresh !== 'ok') attention.push('Certaines données de ce marché ne sont pas à jour : vérifier la fraîcheur avant toute lecture.');
  if (risky) attention.push('' + (win.weekend ? 'Annonce(s) d\'importance forte dès l\'ouverture de la semaine : la réouverture peut être agitée.' : 'Annonce(s) d\'importance forte dans les prochaines 24 h : éviter de tirer des conclusions avant la publication.') + '');
  if (!macro.cpi && !macro.rates) attention.push('Données macro (inflation, taux) pas encore chargées.');
  if (!macro.yields) attention.push('Rendements, courbe et VIX pas encore chargés.');
  if (attention.length) sections.push({ title: 'Points de vigilance', lines: attention });
  for (const s of sections) if (!s.lines.length) s.lines = [s.title.startsWith('Annonces de la semaine') ? 'Aucune annonce importante depuis lundi pour les devises concernées.' : s.title.startsWith('Agenda') ? (win.weekend ? (events.some(e => e.t >= win.start) ? 'Aucune annonce importante prévue la semaine prochaine pour les devises concernées.' : 'Calendrier de la semaine prochaine pas encore publié par notre source (généralement le dimanche soir).') : 'Aucune annonce importante prévue sur cette période pour les devises concernées.') : 'Données indisponibles.'];
  const story = narrative({ market, row, macro, events, now, bias, win, session, daily });
  return { slug: market.slug, name: market.name, available: true, generated: now, weekend: win.weekend, session, score: row.score, bias, story, sections,
    note: 'Repères pédagogiques issus des indicateurs du site, sans prévision ni conseil en investissement.' };
}

module.exports = { biases, debrief, trend, technical, positioning, macroLines, agenda, headline };
