// Aperçu des chartes graphiques : construit un bloc par thème avec de vrais composants du site.
const THEMES = [
  { slug: 'actuel', nom: 'Actuel', sous: 'Bleu nuit et orange', desc: "Le thème en place : fond bleu nuit, accent orange. Efficace, mais très proche de l'univers du site qui a servi de référence." },
  { slug: 'papier', nom: 'Papier', sous: 'Éditorial clair', desc: "Encre sur papier crème, titres à empattements, accent vert profond. L'esprit de la presse financière : posé, très lisible à l'écran comme à l'impression. Le plus éloigné de la référence." },
  { slug: 'terminal', nom: 'Terminal', sous: 'Ambre sur noir', desc: "Phosphore ambre sur fond noir, tout en chasse fixe et angles vifs. Une identité forte, technique, immédiatement reconnaissable ; les colonnes de chiffres s'alignent naturellement." },
  { slug: 'nordique', nom: 'Nordique', sous: 'Clair et froid', desc: "Blanc et bleu-gris, accent sarcelle, coins arrondis modérés. Sobre, neutre et très lisible : le choix « produit sérieux » qui ne cherche pas à impressionner." },
  { slug: 'graphite', nom: 'Graphite', sous: 'Sombre neutre, accent vert', desc: "Gris anthracite sans teinte bleue, accent vert. Reste sombre (confort en soirée) mais change complètement de couleur dominante ; le vert évite l'orange de la référence." },
  { slug: 'indigo', nom: 'Indigo', sous: 'Clair et vif', desc: "Blanc cassé et accent indigo, arrondis généreux. Plus moderne et plus « application » ; un ton résolument différent des sites financiers habituels." },
];

const rgbToHex = c => '#' + c.match(/\d+/g).slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function demo(t, i) {
  const a = el('article', 'theme-demo'); a.dataset.theme = t.slug; a.setAttribute('aria-labelledby', 'td-' + t.slug);
  a.innerHTML = `
    <div class="td-bar"><span class="logo">BULL<b>DESK</b></span><span class="td-nav">Screener · Comparer · À propos</span></div>
    <h2 id="td-${t.slug}">${i + 1}. ${t.nom} <small>${t.sous}</small></h2>
    <p class="td-desc">${t.desc}</p>
    <ul class="td-sw" aria-label="Palette"></ul>
    <div class="kpis td-k">
      <div class="kpi"><span>COT Index 36 mois</span><b>21 %</b></div>
      <div class="kpi"><span>Williams %R (14)</span><b>−12,7</b></div>
      <div class="kpi"><span>Confluence</span><b class="neg">−2</b></div>
      <div class="kpi"><span>Saison septembre</span><b class="pos">+1,4 %</b></div>
    </div>
    <div class="td-row"><span class="sig buy">Achat</span><span class="sig wait">Patience</span><span class="sig sell">Vente</span>
      <button class="chip on td-chip" type="button" aria-pressed="true"><i></i>10 ans</button><button class="chip td-chip" type="button" aria-pressed="false"><i></i>5 ans</button>
      <button class="btn on" type="button" aria-pressed="true">1a</button><button class="btn" type="button" aria-pressed="false">3a</button></div>
    <div class="card"><canvas class="sample" role="img" aria-label="Exemple de graphique avec deux courbes et des zones de surachat et de survente, aux couleurs du thème ${t.nom}."></canvas></div>
    <div class="tw"><table class="mon"><thead><tr><th scope="col">Période</th><th scope="col">Jan</th><th scope="col">Fév</th><th scope="col" class="cur">Sep</th><th scope="col">Oct</th></tr></thead>
      <tbody><tr><th scope="row">10 ans</th><td class="pos">+162,6</td><td class="neg">−88,2</td><td class="neg cur">−128,8</td><td class="pos">+152,7</td></tr>
      <tr><th scope="row">5 ans</th><td class="pos">+64,3</td><td class="neg">−117,3</td><td class="neg cur">−148,7</td><td class="pos">+410,9</td></tr></tbody></table></div>`;
  return a;
}

function drawSample(canvas) {
  const cs = getComputedStyle(canvas.closest('.theme-demo')), v = k => cs.getPropertyValue(k).trim();
  const dpr = devicePixelRatio || 1, W = canvas.clientWidth || 600, H = 170;
  canvas.style.height = H + 'px'; canvas.width = W * dpr; canvas.height = H * dpr;
  const x = canvas.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
  x.fillStyle = v('--bg'); x.fillRect(0, 0, W, H);
  x.fillStyle = v('--redl') + '22'; x.fillRect(0, 8, W, 26); x.fillStyle = v('--greenl') + '22'; x.fillRect(0, H - 34, W, 26);
  x.strokeStyle = v('--line'); x.lineWidth = 1; for (let i = 1; i < 5; i++) { x.beginPath(); x.moveTo(0, i * H / 5); x.lineTo(W, i * H / 5); x.stroke(); }
  let s = 11; const r = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296 - 0.5;
  const line = (color, w, drift) => { x.strokeStyle = color; x.lineWidth = w; x.beginPath(); let y = H * 0.55; for (let i = 0; i <= 60; i++) { y = Math.min(H - 14, Math.max(14, y + r() * 16 - drift)); i ? x.lineTo(i * W / 60, y) : x.moveTo(0, y); } x.stroke(); };
  line(v('--bluel'), 2, 0.6); line(v('--accent'), 2, 0.2);
  x.fillStyle = v('--muted'); x.font = '11px ' + (v('--font-body').split(',')[0] || 'sans-serif'); x.fillText('−20', 6, 30); x.fillText('−80', 6, H - 14);
}

const root = document.getElementById('demos');
THEMES.forEach((t, i) => root.appendChild(demo(t, i)));
document.querySelectorAll('.theme-demo').forEach(d => {                       // pastilles de la palette, lues dans le thème réellement appliqué
  const cs = getComputedStyle(d), ul = d.querySelector('.td-sw');
  for (const [k, l] of [['--bg', 'fond'], ['--panel', 'carte'], ['--text', 'texte'], ['--muted', 'secondaire'], ['--accent', 'accent'], ['--greenl', 'haussier'], ['--redl', 'baissier'], ['--bluel', 'courbe']]) {
    const hex = rgbToHex(cs.getPropertyValue(k).trim().startsWith('#') ? hexToRgb(cs.getPropertyValue(k).trim()) : cs.getPropertyValue(k));
    const li = el('li', '', `<i class="sw-c"></i><span>${l}<br><small>${hex}</small></span>`); li.firstChild.style.background = hex; ul.appendChild(li);
  }
});
function hexToRgb(h) { return 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',') + ')'; }
const redraw = () => document.querySelectorAll('canvas.sample').forEach(drawSample);
new ResizeObserver(redraw).observe(document.body); redraw();
