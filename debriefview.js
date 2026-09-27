// Debrief du jour d'un marché : texte assemblé par le serveur (/api/debrief) à partir de tous les indicateurs et de l'agenda économique.
// Seul le premier paragraphe (la synthèse) est visible d'emblée, dans le même cadre que le reste du récit ; le bouton
// « Lire la suite » déplie la suite du récit (toujours dans ce cadre) et le détail des indicateurs (en dessous).
async function renderDebrief(m, root) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let d;
  try { d = await BD.json('/api/debrief?slug=' + encodeURIComponent(m.slug)); }
  catch { root.innerHTML = '<div class="card"><p class="note">Debrief indisponible pour le moment.</p></div>'; return; }
  if (!d.available) { root.innerHTML = `<div class="card"><p class="note">${esc(d.message || 'Debrief indisponible.')}</p></div>`; return; }
  const when = new Date(d.generated).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const [first, ...rest] = d.story;
  const para = p => `<h3>${esc(p.title)}</h3><p>${esc(p.text)}</p>`;
  root.innerHTML = `<div class="sechead"><h2 class="sec">${d.weekend ? 'Debrief de clôture' : 'Debrief du jour'} – ${esc(d.name)}</h2><span class="note">${esc(when)}</span></div>
   <div class="deb-bias">${['week', 'day'].map(k => { const b = d.bias[k], c = b.key === 'up' ? 'buy' : b.key === 'down' ? 'sell' : 'wait'; return `<div class="card deb-b"><span>${k === 'week' ? 'Semaine' : d.weekend ? 'Dernière séance' : 'Journée'}</span><span class="sig ${c}">${esc(b.label[0].toUpperCase() + b.label.slice(1))}</span><small>${esc(b.why)}</small></div>`; }).join('')}</div>
   <div class="card deb-story">
     ${para(first)}
     <div id="debRestStory" hidden>${rest.map(para).join('')}</div>
     <button type="button" class="btn deb-toggle" id="debToggle" aria-expanded="false" aria-controls="debRestStory debRestDetail">Lire la suite ↓</button>
   </div>
   <div id="debRestDetail" hidden>
     <h3 class="deb-detail">Détail des indicateurs</h3>
     <div class="deb">${d.sections.map(s => `<div class="card deb-s"><h3>${esc(s.title)}</h3><ul>${s.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>`).join('')}</div>
     <p class="note">${esc(d.note)}</p>
   </div>`;
  const story = root.querySelector('#debRestStory'), detail = root.querySelector('#debRestDetail'), btn = root.querySelector('#debToggle');
  story.hidden = true; detail.hidden = true;                                // fixe l'état initial en JS (fiable, indépendant du rendu de l'attribut HTML)
  btn.onclick = () => {
    const open = story.hidden; story.hidden = !open; detail.hidden = !open;
    btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? 'Replier ↑' : 'Lire la suite ↓';
  };
}
