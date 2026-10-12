// Page « Calendrier des indices » : affichage seulement. Tout est calculé côté serveur (monthcal.js → /api/calendrier).
// Navigation comme un agenda : flèches ‹ › (mois ou semaine précédent / suivant), « Aujourd'hui », et choix de la vue Mois / Semaine
// (la page s'ouvre sur le mois en cours ; rien n'est stocké dans le navigateur).
// La saisonnalité journalière n'est présentée qu'en faits (moyenne, médiane, années en hausse), sans étiquette « haussier » ni « baissier » :
// testée sans regarder le futur (2012-2025), une telle étiquette n'avait aucune valeur prédictive pour le sens du jour.
let calPeriod = 20;                                  // période affichée (15, 20 ou 25 ans) : simple variable de la page, rien n'est mémorisé dans le navigateur
const calDay = 864e5, calIso = t => new Date(t).toISOString().slice(0, 10);
const calMonthKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
const calShiftMonth = (key, k) => { const [y, m] = key.split('-').map(Number), i = m - 1 + k; return calMonthKey(y + Math.floor(i / 12), ((i % 12) + 12) % 12); };
const calShiftWeek = (monday, k) => calIso(Date.parse(monday + 'T00:00:00Z') + k * 7 * calDay);

function renderCalendar(data, root, nav = () => {}) {
  const $ = s => root.querySelector(s), months = data.months || [], week = data.view === 'week';
  const curMonth = calMonthKey(data.year, data.month);
  if (!data.periods.includes(calPeriod)) calPeriod = data.periods.includes(20) ? 20 : data.periods[0];
  const num = v => (v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace('.', ',') + ' %');
  // Détail de toutes les périodes (infobulle) : pour chaque indice, moyenne, médiane et années en hausse.
  const tip = s => data.periods.map(n => `${n} ans : ` + ['ES', 'NQ', 'YM'].map(k => { const x = s.periods[n][k]; return `${k} moy. ${num(x.mean)}, méd. ${num(x.median)}, ${x.up}/${x.n} en hausse`; }).join(' · ')).join('\n');
  const monthLabel = k => new Date(k + '-01T00:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const monthName = d => new Date(d.date + 'T00:00:00Z').toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }).replace('.', '');

  // Bornes de navigation : la période proposée par le serveur.
  const inRange = k => months.includes(k);
  const prev = week ? calShiftWeek(data.start, -1) : calShiftMonth(curMonth, -1), next = week ? calShiftWeek(data.start, 1) : calShiftMonth(curMonth, 1);
  const weekOk = monday => inRange(monday.slice(0, 7)) || inRange(calIso(Date.parse(monday + 'T00:00:00Z') + 6 * calDay).slice(0, 7));
  const canPrev = week ? weekOk(prev) : inRange(prev), canNext = week ? weekOk(next) : inRange(next);
  const isNow = week ? data.start === data.thisWeek : curMonth === (data.today || '').slice(0, 7);

  // Phrase d'avertissement, avec les chiffres mesurés par le serveur (jamais écrits à la main) ; sans mesure, phrase générale.
  const A = data.accuracy, p1 = v => (v == null ? '–' : v.toFixed(1).replace('.', ',') + ' %');
  const aU = A && A.labels && A.labels['up-strong'], aD = A && A.labels && A.labels['down-strong'], aAll = A && A.all;
  const warnNumbers = aU && aD && aAll
    ? `Testé sans regarder le futur sur ${A.days.toLocaleString('fr-FR')} jours (${A.from}-${A.to}), le S&P 500 a monté ${p1(aU.ES.up)} des jours « haussier fort », ${p1(aD.ES.up)} des jours « baissier fort »${aD.ES.up > 50 ? ' (donc plus d\'une fois sur deux)' : ''} et ${p1(aAll.ES.up)} de l'ensemble des jours : ${Math.abs(aU.ES.up - aAll.ES.up) < 5 && Math.abs(aD.ES.up - aAll.ES.up) < 5 ? 'l\'étiquette ne dit presque rien du sens du jour.' : 'comparez ces écarts à ce que vous attendez d\'un signal.'}`
    : 'Les étiquettes n\'ont pas été testées ici : ne les prenez pas pour un signal.';
  // Annonces majeures de la période affichée (faits : aucune lecture saisonnière).
  const major = data.days.filter(d => d.open && d.events.some(e => e.impact === 'high'));
  const majorLabel = d => d.events.filter(e => e.impact === 'high').map(e => e.label.replace(/ ;.*$/, '').replace(/ \(.*\)$/, '')).join(', ');
  const dayName = d => `${d.weekday} ${d.day}${week ? ' ' + monthName(d) : ''}`;
  const points = major.length ? [`Annonces de forte importance : ${major.map(d => `<b>${dayName(d)}</b> (${majorLabel(d)})`).join(', ')}.`] : [];

  // Étiquette indicative du jour, TOUJOURS accompagnée de sa fiabilité réellement mesurée (rejeu sans regarder le futur, calculé par le serveur) :
  // part des jours ainsi étiquetés où le S&P 500 a effectivement monté (étiquettes haussières) ou baissé (baissières), comparée à tous les jours.
  const labelBlock = d => {
    const s = d.season; if (!s.key) return '';
    const acc = A && A.labels && A.labels[s.key], all = A && A.all, up = /^up/.test(s.key), down = /^down/.test(s.key);
    let line = '', detail = '';
    if (acc && all) {
      line = up ? `S&P 500 : a monté <b>${p1(acc.ES.up)}</b> des jours ainsi étiquetés (tous les jours : ${p1(all.ES.up)}) · ${acc.n} jours`
        : down ? `S&P 500 : a baissé <b>${p1(acc.ES.down)}</b> des jours ainsi étiquetés (tous les jours : ${p1(all.ES.down)}) · ${acc.n} jours`
        : `Pas de lecture : le S&P 500 monte ${p1(acc.ES.up)} de ces jours (tous les jours : ${p1(all.ES.up)})`;
      detail = ['ES', 'NQ', 'YM'].map(t => `${t} : monte ${p1(acc[t].up)}, baisse ${p1(acc[t].down)} (tous les jours : monte ${p1(all[t].up)}, baisse ${p1(all[t].down)})`).join(' · ') + ` — mesuré de ${A.from} à ${A.to}, sans regarder le futur`;
    }
    return `<div><span class="cal-lab">${s.label}</span>${s.irregular ? ' <small title="La moitié des années ou plus sont allées dans l\'autre sens : la moyenne est tirée par quelques séances">irrégulier</small>' : ''}</div>${line ? `<div class="cal-acc" title="${detail}">${line}</div>` : ''}`;
  };
  // Saisonnalité d'un jour : étiquette indicative avec sa fiabilité mesurée, puis les faits : pour chaque indice, moyenne, médiane et années en hausse.
  const season = d => !d.open ? `<small>${d.weekend ? 'week-end' : 'Bourse fermée'}</small>`
    : `${labelBlock(d)}<div class="cal-fact" title="${tip(d.season)}">${['ES', 'NQ', 'YM'].map(k => { const x = d.season.periods[calPeriod][k]; return x.n ? `<div><b>${k}</b> moy. ${num(x.mean)} · méd. ${num(x.median)} · <b>${x.up}/${x.n}</b> en hausse</div>` : `<div><b>${k}</b> <small>données insuffisantes</small></div>`; }).join('')}</div>`;
  // Réaction historique des indices à ce type d'annonce : repère court (S&P 500), détail des trois indices au survol.
  const R = (data.reactions && data.reactions.kinds) || {}, pc = v => (v == null ? '–' : v.toFixed(1).replace('.', ',')), sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + pc(Math.abs(v));
  const react = kind => { const k = R[kind], es = k && k.ES; if (!es) return '';
    const tipR = ['ES', 'NQ', 'YM'].filter(t => k[t]).map(t => `${t} : mouvement moyen ±${pc(k[t].meanAbs)} %, amplitude ${pc(k[t].meanRange)} % (×${pc(k[t].rangeRatio)} une séance ordinaire), en hausse ${k[t].up} % des fois, ${k[t].n} annonces`).join(' · ');
    return ` <span class="ev-r" title="Depuis ${k.from.slice(0, 4)} : ${tipR}">ES ±${pc(es.meanAbs)} % · ampl. ×${pc(es.rangeRatio)}</span>`; };
  const events = d => { const ev = d.events.map(e => `<li class="ev-${e.impact}"><span class="ev-t">${e.time || '—'}</span> ${e.label} <small>${e.source}</small>${react(e.kind)}</li>`).join(''); return ev ? `<ul class="cal-ev">${ev}</ul>` : (d.open ? '<small>—</small>' : ''); };
  const head = d => `${d.weekday} ${d.day}${week ? ' ' + monthName(d) : ''}${d.today ? ' <span class="sig sm wait">aujourd\'hui</span>' : ''}${d.holiday ? `<br><small>${d.holiday.label}</small>` : ''}`;

  const body = week
    ? `<div class="cal-week" id="calGrid">${data.days.map(d => `<section class="card cal-day ${d.today ? 'cal-today' : ''} ${d.open ? '' : 'cal-off'}" aria-label="${d.weekday} ${d.day} ${monthName(d)}"><h3>${head(d)}</h3><div class="cal-s">${season(d)}</div>${events(d)}</section>`).join('')}</div>`
    : `<div class="card"><div class="tw"><table class="cmp cal" id="calTbl">
       <thead><tr><th scope="col">Jour</th><th scope="col">Saisonnalité du jour, ES / NQ / YM<br><small>faits sur ${calPeriod} ans : moyenne, médiane, années en hausse</small></th><th scope="col">Annonces (heure de New York)</th></tr></thead>
       <tbody>${data.days.map(d => `<tr class="${[d.today ? 'cal-today' : '', d.open ? '' : 'cal-off'].join(' ').trim()}"><th scope="row">${head(d)}</th><td>${season(d)}</td><td>${events(d)}</td></tr>`).join('')}</tbody></table></div></div>`;

  // Tableau : réaction moyenne de ES, NQ et YM aux trois grandes annonces.
  function reactTable() {
    const kinds = ['cpi', 'nfp', 'fomc'].filter(k => R[k] && R[k].ES);
    if (!kinds.length) return '';
    const row = (k, t) => { const s = R[k][t]; return s ? `<tr><th scope="row">${t === 'ES' ? `${R[k].label}<br><small>depuis ${R[k].from.slice(0, 4)}</small>` : ''}</th><td>${t}</td><td>${s.n}</td><td class="${s.meanChg >= 0 ? 'pos' : 'neg'}">${sg(s.meanChg)} %</td><td>±${pc(s.meanAbs)} %</td><td>${s.up} %</td><td>${pc(s.meanRange)} %</td><td><b>×${pc(s.rangeRatio)}</b></td><td><small>${new Date(s.last.date + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })} : ${sg(s.last.chg)} %, ampl. ${pc(s.last.range)} %</small></td></tr>` : ''; };
    return `<div class="card"><h2 class="sec">Réaction des indices aux grandes annonces</h2><div class="tw"><table class="cmp react-t">
      <thead><tr><th scope="col">Annonce</th><th scope="col">Indice</th><th scope="col">Annonces</th><th scope="col">Variation moyenne</th><th scope="col">Mouvement moyen</th><th scope="col">En hausse</th><th scope="col">Amplitude moyenne</th><th scope="col">vs séance ordinaire</th><th scope="col">Dernière fois</th></tr></thead>
      <tbody>${kinds.map(k => ['ES', 'NQ', 'YM'].map(t => row(k, t)).join('')).join('')}</tbody></table></div>
      <p class="note">Séance du jour de l'annonce (clôture contre clôture précédente), sur les futures ajustés des changements de contrat. Mouvement moyen : variation moyenne en valeur absolue, quel que soit le sens. Amplitude : plus haut moins plus bas de la séance, en % du prix. « vs séance ordinaire » : amplitude du jour d'annonce rapportée à celle des autres séances de la même période (×1,3 = 30 % plus agitée). La décision de la Fed tombe à 14 h : la séance entière n'en dépend pas. Le repère « ES ±… · ampl. ×… » à côté de chaque annonce reprend ces chiffres pour le S&P 500 ; survolez-le pour les trois indices.</p></div>`;
  }

  root.innerHTML = `
   <div class="cal-nav" role="toolbar" aria-label="Navigation du calendrier">
     <div class="cal-move">
       <button class="btn cal-arrow" id="calPrev" ${canPrev ? '' : 'disabled'} aria-label="${week ? 'Semaine précédente' : 'Mois précédent'}">‹</button>
       <h2 class="cal-title" id="calTitle" aria-live="polite">${week ? data.label : monthLabel(curMonth)}</h2>
       <button class="btn cal-arrow" id="calNext" ${canNext ? '' : 'disabled'} aria-label="${week ? 'Semaine suivante' : 'Mois suivant'}">›</button>
     </div>
     <div class="cal-tools">
       <button class="btn" id="calToday" ${isNow ? 'disabled' : ''}>Aujourd'hui</button>
       <div class="ranges" id="calP" role="group" aria-label="Période de la saisonnalité">${data.periods.map(n => `<button class="btn ${n === calPeriod ? 'on' : ''}" data-p="${n}" aria-pressed="${n === calPeriod}">${n} ans</button>`).join('')}</div>
       <div class="ranges" id="calView" role="group" aria-label="Affichage"><button class="btn ${week ? '' : 'on'}" data-v="month" aria-pressed="${!week}">Mois</button><button class="btn ${week ? 'on' : ''}" data-v="week" aria-pressed="${week}">Semaine</button></div>
     </div>
   </div>
   <div class="card cal-warn" role="note"><h2 class="sec">Ces étiquettes sont indicatives, pas des signaux</h2>
     <p>Elles résument ce que les indices ont fait les années précédentes, <b>pas ce qu'ils feront</b>. ${warnNumbers}</p>
     <p>Une moyenne est souvent tirée par quelques années extrêmes (2008) ; regardez la médiane, le nombre d'années en hausse et la fiabilité affichée sous chaque étiquette, et gardez vos règles de risque.</p></div>
   ${points.length ? `<div class="card"><h2 class="sec">${week ? 'Cette semaine-là' : 'En ' + data.label}</h2><ul class="rl-notes">${points.map(p => `<li>${p}</li>`).join('')}</ul></div>` : ''}
   ${body}
   ${reactTable()}
   <p class="note">Saisonnalité : variation de la séance (clôture contre clôture précédente) pour ce jour du mois, sur les ${calPeriod} dernières années complètes où le marché a coté ce jour-là. « 9/15 en hausse » : 9 années sur 15 ont monté. Survolez une case pour voir aussi les périodes de 15 et 25 ans. Couleur des annonces : <span class="ev-high">rouge</span> forte importance, <span class="ev-medium">ambre</span> moyenne, <span class="ev-low">gris</span> faible. Dates officielles connues jusqu'au ${new Date(data.officialUntil + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}.</p>`;

  $('#calP').onclick = e => { const b = e.target.closest('button'); if (!b || +b.dataset.p === calPeriod) return; calPeriod = +b.dataset.p; renderCalendar(data, root, nav); };
  $('#calPrev').onclick = () => canPrev && nav(week ? { w: prev } : { m: prev });
  $('#calNext').onclick = () => canNext && nav(week ? { w: next } : { m: next });
  $('#calToday').onclick = () => nav(week ? { w: data.thisWeek } : {});
  $('#calView').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const v = b.dataset.v; if ((v === 'week') === week) return;
    // Mois → semaine : la semaine d'aujourd'hui si elle est dans le mois affiché, sinon la première semaine du mois. Semaine → mois : le mois de son lundi.
    if (v === 'week') { const first = Date.parse(curMonth + '-01T00:00:00Z'), mon = calIso(first - ((new Date(first).getUTCDay() + 6) % 7) * calDay); nav({ w: (data.thisWeek || '').startsWith(curMonth) ? data.thisWeek : mon }); }
    else nav({ m: data.start.slice(0, 7) });
  };
}

async function bootCalendar(query, root = document.querySelector('#app')) {
  const q = query || {};
  try {
    let data = await BD.json('/api/calendrier' + (q.m ? '?m=' + encodeURIComponent(q.m) : q.w ? '?w=' + encodeURIComponent(q.w) : ''));
    renderCalendar(data, root, next => bootCalendar(next, root));
  } catch { root.innerHTML = '<div id="msg" class="err">Calendrier indisponible pour le moment. Réessayez dans une minute.</div>'; }
}
if (typeof document !== 'undefined' && document.body && document.body.dataset && document.body.dataset.page === 'calendar') bootCalendar();
