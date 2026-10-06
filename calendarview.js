// Page « Calendrier des indices » : affichage seulement. Tout est calculé côté serveur (monthcal.js → /api/calendrier).
const CAL_TONE = { 'up-strong': 'buy', up: 'buy', 'up-weak': 'buy', 'down-strong': 'sell', down: 'sell', 'down-weak': 'sell', mixed: 'wait', neutral: 'wait' };
const CAL_SOURCE = { officiel: 'officiel', habituel: 'habituel', 'Forex Factory': 'Forex Factory', règle: 'règle' };

function renderCalendar(data, root) {
  const $ = s => root.querySelector(s), monthLabel = k => new Date(k + '-01T00:00:00Z').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const cur = `${data.year}-${String(data.month + 1).padStart(2, '0')}`;
  const arrow = d => (d.dir > 0 ? '↑' : d.dir < 0 ? '↓' : '·') + (d.strong ? '*' : '');
  const num = v => (v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace('.', ',') + ' %');
  const tip = s => data.periods.map(n => `${n} ans : ` + ['ES', 'NQ', 'YM'].map(k => `${k} ${num(s.periods[n][k].mean)} (${s.periods[n][k].up}/${s.periods[n][k].n})`).join(', ')).join(' · ');

  // Points saillants : jours de saisonnalité forte, annonces majeures, et coïncidences.
  const open = data.days.filter(d => d.open), strong = open.filter(d => /strong/.test(d.season.key)), major = open.filter(d => d.events.some(e => e.impact === 'high'));
  const majorLabel = d => d.events.filter(e => e.impact === 'high').map(e => e.label.replace(/ ;.*$/, '').replace(/ \(.*\)$/, '')).join(', ');
  const dayName = d => `${d.weekday} ${d.day}`;
  const points = [];
  if (strong.length) points.push(`Saisonnalité forte : ${strong.map(d => `<b>${dayName(d)}</b> (${d.season.label.toLowerCase()})`).join(', ')}.`);
  const clash = strong.filter(d => d.events.some(e => e.impact === 'high'));
  if (clash.length) points.push(`À surveiller : ${clash.map(d => `le ${dayName(d)}, la saisonnalité forte coïncide avec ${majorLabel(d)}`).join(' ; ')} — une annonce peut renverser la tendance du jour.`);
  const calm = major.filter(d => d.season.key === 'neutral' || d.season.key === 'mixed');
  if (calm.length) points.push(`Grosses annonces sans tendance saisonnière nette : ${calm.map(d => `${dayName(d)} (${majorLabel(d)})`).join(', ')} — c'est la publication qui décidera.`);

  root.innerHTML = `
   <div class="ranges" id="calM" role="group" aria-label="Mois affiché">${data.months.map(k => `<button class="btn ${k === cur ? 'on' : ''}" data-m="${k}" aria-pressed="${k === cur}">${monthLabel(k)}</button>`).join('')}</div>
   ${points.length ? `<div class="card"><h2 class="sec">Ce qui ressort en ${data.label}</h2><ul class="rl-notes">${points.map(p => `<li>${p}</li>`).join('')}</ul></div>` : ''}
   <div class="card"><div class="tw"><table class="cmp cal" id="calTbl">
     <thead><tr><th scope="col">Jour</th><th scope="col">Saisonnalité ES / NQ / YM<br><small>15 · 20 · 25 ans</small></th><th scope="col">Annonces (heure de New York)</th></tr></thead>
     <tbody>${data.days.map(d => {
       const cls = [d.today ? 'cal-today' : '', d.open ? '' : 'cal-off'].join(' ').trim();
       const season = !d.open ? `<small>${d.weekend ? 'week-end' : 'Bourse fermée'}</small>`
         : `<span class="sig sm ${CAL_TONE[d.season.key]}">${d.season.label}</span>${d.season.irregular ? ' <small title="La moitié des années ou plus sont allées dans l\'autre sens : moyenne tirée par quelques séances">irrégulier</small>' : ''}<br><small class="cal-per" title="${tip(d.season)}">${data.periods.map(n => `${n} a ${arrow(d.season.periods[n])}`).join(' · ')}</small>`;
       const ev = d.events.map(e => `<li class="ev-${e.impact}"><span class="ev-t">${e.time || '—'}</span> ${e.label} <small>${CAL_SOURCE[e.source] || e.source}</small></li>`).join('');
       return `<tr class="${cls}"><th scope="row">${d.weekday} ${d.day}${d.today ? ' <span class="sig sm wait">aujourd\'hui</span>' : ''}${d.holiday ? `<br><small>${d.holiday.label}</small>` : ''}</th><td>${season}</td><td>${ev ? `<ul class="cal-ev">${ev}</ul>` : (d.open ? '<small>—</small>' : '')}</td></tr>`;
     }).join('')}</tbody></table></div>
     <p class="note">Flèches : sens commun des trois indices sur 15, 20 et 25 ans (* : chacun dans ce sens au moins 60 % des années). Survolez-les pour les moyennes et le nombre d'années en hausse. Couleur des annonces : <span class="ev-high">rouge</span> forte importance, <span class="ev-medium">ambre</span> moyenne, <span class="ev-low">gris</span> faible. Calendriers officiels publiés jusqu'en ${monthLabel(data.officialUntil.slice(0, 7))}.</p></div>`;
  $('#calM').onclick = e => { const b = e.target.closest('button'); if (b && b.dataset.m !== cur) bootCalendar(b.dataset.m, root); };
}

async function bootCalendar(month, root = document.querySelector('#app')) {
  try { renderCalendar(await BD.json('/api/calendrier' + (month ? '?m=' + encodeURIComponent(month) : '')), root); }
  catch { root.innerHTML = '<div id="msg" class="err">Calendrier indisponible pour le moment. Réessayez dans une minute.</div>'; }
}
if (typeof document !== 'undefined' && document.body && document.body.dataset && document.body.dataset.page === 'calendar') bootCalendar();
