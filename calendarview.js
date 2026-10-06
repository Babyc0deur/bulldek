// Page « Calendrier des indices » : affichage seulement. Tout est calculé côté serveur (monthcal.js → /api/calendrier).
// Navigation comme un agenda : flèches ‹ › (mois ou semaine précédent / suivant), « Aujourd'hui », et choix de la vue Mois / Semaine
// (la page s'ouvre sur le mois en cours ; rien n'est stocké dans le navigateur).
const CAL_TONE = { 'up-strong': 'buy', up: 'buy', 'up-weak': 'buy', 'down-strong': 'sell', down: 'sell', 'down-weak': 'sell', mixed: 'wait', neutral: 'wait' };
const calDay = 864e5, calIso = t => new Date(t).toISOString().slice(0, 10);
const calMonthKey = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}`;
const calShiftMonth = (key, k) => { const [y, m] = key.split('-').map(Number), i = m - 1 + k; return calMonthKey(y + Math.floor(i / 12), ((i % 12) + 12) % 12); };
const calShiftWeek = (monday, k) => calIso(Date.parse(monday + 'T00:00:00Z') + k * 7 * calDay);

function renderCalendar(data, root, nav = () => {}) {
  const $ = s => root.querySelector(s), months = data.months || [], week = data.view === 'week';
  const curMonth = calMonthKey(data.year, data.month);
  const arrow = d => (d.dir > 0 ? '↑' : d.dir < 0 ? '↓' : '·') + (d.strong ? '*' : '');
  const num = v => (v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace('.', ',') + ' %');
  const tip = s => data.periods.map(n => `${n} ans : ` + ['ES', 'NQ', 'YM'].map(k => `${k} ${num(s.periods[n][k].mean)} (${s.periods[n][k].up}/${s.periods[n][k].n})`).join(', ')).join(' · ');
  const monthLabel = k => new Date(k + '-01T00:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const monthName = d => new Date(d.date + 'T00:00:00Z').toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' }).replace('.', '');

  // Bornes de navigation : la période proposée par le serveur.
  const inRange = k => months.includes(k);
  const prev = week ? calShiftWeek(data.start, -1) : calShiftMonth(curMonth, -1), next = week ? calShiftWeek(data.start, 1) : calShiftMonth(curMonth, 1);
  const weekOk = monday => inRange(monday.slice(0, 7)) || inRange(calIso(Date.parse(monday + 'T00:00:00Z') + 6 * calDay).slice(0, 7));
  const canPrev = week ? weekOk(prev) : inRange(prev), canNext = week ? weekOk(next) : inRange(next);
  const isNow = week ? data.start === data.thisWeek : curMonth === (data.today || '').slice(0, 7);

  // Points saillants : jours de saisonnalité forte, annonces majeures, et coïncidences.
  const open = data.days.filter(d => d.open), strong = open.filter(d => /strong/.test(d.season.key)), major = open.filter(d => d.events.some(e => e.impact === 'high'));
  const majorLabel = d => d.events.filter(e => e.impact === 'high').map(e => e.label.replace(/ ;.*$/, '').replace(/ \(.*\)$/, '')).join(', ');
  const dayName = d => `${d.weekday} ${d.day}${week ? ' ' + monthName(d) : ''}`;
  const points = [];
  if (strong.length) points.push(`Saisonnalité forte : ${strong.map(d => `<b>${dayName(d)}</b> (${d.season.label.toLowerCase()})`).join(', ')}.`);
  const clash = strong.filter(d => d.events.some(e => e.impact === 'high'));
  if (clash.length) points.push(`À surveiller : ${clash.map(d => `le ${dayName(d)}, la saisonnalité forte coïncide avec ${majorLabel(d)}`).join(' ; ')} — une annonce peut renverser la tendance du jour.`);
  const calm = major.filter(d => d.season.key === 'neutral' || d.season.key === 'mixed');
  if (calm.length) points.push(`Grosses annonces sans tendance saisonnière nette : ${calm.map(d => `${dayName(d)} (${majorLabel(d)})`).join(', ')} — c'est la publication qui décidera.`);

  const season = d => !d.open ? `<small>${d.weekend ? 'week-end' : 'Bourse fermée'}</small>`
    : `<span class="sig sm ${CAL_TONE[d.season.key]}">${d.season.label}</span>${d.season.irregular ? ' <small title="La moitié des années ou plus sont allées dans l\'autre sens : moyenne tirée par quelques séances">irrégulier</small>' : ''}<br><small class="cal-per" title="${tip(d.season)}">${data.periods.map(n => `${n} a ${arrow(d.season.periods[n])}`).join(' · ')}</small>`;
  const events = d => { const ev = d.events.map(e => `<li class="ev-${e.impact}"><span class="ev-t">${e.time || '—'}</span> ${e.label} <small>${e.source}</small></li>`).join(''); return ev ? `<ul class="cal-ev">${ev}</ul>` : (d.open ? '<small>—</small>' : ''); };
  const head = d => `${d.weekday} ${d.day}${week ? ' ' + monthName(d) : ''}${d.today ? ' <span class="sig sm wait">aujourd\'hui</span>' : ''}${d.holiday ? `<br><small>${d.holiday.label}</small>` : ''}`;

  const body = week
    ? `<div class="cal-week" id="calGrid">${data.days.map(d => `<section class="card cal-day ${d.today ? 'cal-today' : ''} ${d.open ? '' : 'cal-off'}" aria-label="${d.weekday} ${d.day} ${monthName(d)}"><h3>${head(d)}</h3><div class="cal-s">${season(d)}</div>${events(d)}</section>`).join('')}</div>`
    : `<div class="card"><div class="tw"><table class="cmp cal" id="calTbl">
       <thead><tr><th scope="col">Jour</th><th scope="col">Saisonnalité ES / NQ / YM<br><small>15 · 20 · 25 ans</small></th><th scope="col">Annonces (heure de New York)</th></tr></thead>
       <tbody>${data.days.map(d => `<tr class="${[d.today ? 'cal-today' : '', d.open ? '' : 'cal-off'].join(' ').trim()}"><th scope="row">${head(d)}</th><td>${season(d)}</td><td>${events(d)}</td></tr>`).join('')}</tbody></table></div></div>`;

  root.innerHTML = `
   <div class="cal-nav" role="toolbar" aria-label="Navigation du calendrier">
     <div class="cal-move">
       <button class="btn cal-arrow" id="calPrev" ${canPrev ? '' : 'disabled'} aria-label="${week ? 'Semaine précédente' : 'Mois précédent'}">‹</button>
       <h2 class="cal-title" id="calTitle" aria-live="polite">${week ? data.label : monthLabel(curMonth)}</h2>
       <button class="btn cal-arrow" id="calNext" ${canNext ? '' : 'disabled'} aria-label="${week ? 'Semaine suivante' : 'Mois suivant'}">›</button>
     </div>
     <div class="cal-tools">
       <button class="btn" id="calToday" ${isNow ? 'disabled' : ''}>Aujourd'hui</button>
       <div class="ranges" id="calView" role="group" aria-label="Affichage"><button class="btn ${week ? '' : 'on'}" data-v="month" aria-pressed="${!week}">Mois</button><button class="btn ${week ? 'on' : ''}" data-v="week" aria-pressed="${week}">Semaine</button></div>
     </div>
   </div>
   ${points.length ? `<div class="card"><h2 class="sec">Ce qui ressort ${week ? 'cette semaine-là' : 'en ' + data.label}</h2><ul class="rl-notes">${points.map(p => `<li>${p}</li>`).join('')}</ul></div>` : ''}
   ${body}
   <p class="note">Flèches : sens commun des trois indices sur 15, 20 et 25 ans (* : chacun dans ce sens au moins 60 % des années). Survolez-les pour les moyennes et le nombre d'années en hausse. Couleur des annonces : <span class="ev-high">rouge</span> forte importance, <span class="ev-medium">ambre</span> moyenne, <span class="ev-low">gris</span> faible. Dates officielles connues jusqu'au ${new Date(data.officialUntil + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}.</p>`;

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
