// Éléments communs : en-tête, menu des marchés, formatage et petits moteurs de graphiques (canvas, sans dépendance).
const BD = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const json = async u => { const r = await fetch(u); if (!r.ok) throw new Error(r.status); return r.json(); };
  const GROUPS = ['Currencies', 'Crypto', 'Indices', 'Bonds', 'Energy', 'Metals', 'Grains', 'Softs', 'Livestock'];
  const nf = n => (n == null || isNaN(n) ? '–' : Math.round(n).toLocaleString('en-US'));
  const sg = n => (n > 0 ? '+' : '') + nf(n);
  const dec = (n, d = 2) => (n == null || isNaN(n) ? '–' : (n > 0 ? '+' : '') + n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
  const MONTHS_L = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

  const ICON_COT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 3v9l7 4"/></svg>';
  const ICON_SEA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

  // ---- Coque de page ----
  const dailyMemo = {};
  const daily = code => dailyMemo[code] ||= json('/api/daily?code=' + code).then(r => r.data);
  const cotMemo = {};
  const cot = code => cotMemo[code] ||= json('/api/cot?code=' + code);                                   // rapport COT Legacy, partagé entre les sections d'une même page
  const weeklyMemo = {};
  const weekly = code => weeklyMemo[code] ||= json('/api/prices?code=' + code).then(r => r.data);        // clôtures hebdomadaires : [t, clôture, plus haut, plus bas]
  async function shell() {
    const markets = await json('/markets.json');
    const slug = location.pathname.split('/')[2];
    const m = markets.find(x => x.slug === slug) || markets[0];
    document.title = m.name + ' – Saisonnalité, Williams %R et COT | BullDesk';
    const options = GROUPS.map(g => `<optgroup label="${g}">` + markets.filter(x => x.group === g)
      .map(x => `<option value="${x.slug}" ${x.slug === m.slug ? 'selected' : ''}>${x.name}</option>`).join('') + '</optgroup>').join('');
    $('#shell').innerHTML = `
     <header class="top"><div class="wrap bar">
       <a class="logo" href="/">BULL<b>DESK</b></a>
       <div class="picker"><select id="mktSel" class="btn" aria-label="Actif">${options}</select></div>
       <ul class="jump"><li><a href="/screener">${ICON_COT}Screener</a></li><li><a href="/compare?a=${m.slug}">${ICON_COT}Comparer</a></li><li><a href="/inflation">${ICON_COT}Inflation</a></li><li><a href="/taux">${ICON_COT}Taux</a></li><li><a href="/intermarket">${ICON_COT}Intermarket</a></li><li><a href="#sDeb">${ICON_SEA}Debrief</a></li><li><a href="#sSea">${ICON_SEA}Saisonnalité</a></li><li><a href="#sWr">${ICON_SEA}Williams %R</a></li><li><a href="#sCot">${ICON_COT}COT</a></li><li><a href="#sOi">${ICON_COT}Open Interest</a></li></ul>
     </div></header>
     <div class="wrap pagehead">
       <h1>${m.name}<button class="info" aria-label="Informations" id="infoBtn">i</button></h1>
       <div class="infobox" id="infoBox"></div>
       <div class="fresh-wrap" id="fresh"></div>
       <div class="confl" id="confl"></div>
     </div>`;
    freshness($('#fresh'), m.code);                                                    // indicateur de fraîcheur (non bloquant)
    $('#mktSel').onchange = e => { location.href = '/market/' + e.target.value; };
    $('#infoBtn').onclick = () => $('#infoBox').classList.toggle('open');
    return m;
  }
  const setInfo = html => { $('#infoBox').insertAdjacentHTML('beforeend', html); };

  // ---- Couleurs du thème actif : lues une fois dans les variables CSS de <html> (le changement de thème recharge la page) ----
  // Repli hors navigateur (tests) : palette du thème par défaut, Terminal.
  const FALLBACK = { bg: '#0a0a08', bg2: '#15140e', panel: '#100f0b', line: '#3d3720', text: '#f2dda6', muted: '#b89f62', accent: '#ffb000', gold: '#ffd166',
    red: '#a83a30', redl: '#ff6b5e', green: '#3f7d20', greenl: '#9be564', blue: '#2d6a8f', bluel: '#6cc9ff', purple: '#c28cff' };
  let tcMemo = null;
  function tc() {
    if (tcMemo) return tcMemo;
    if (typeof document === 'undefined' || typeof getComputedStyle === 'undefined') return (tcMemo = { ...FALLBACK });
    const cs = getComputedStyle(document.documentElement), out = {};
    for (const k of Object.keys(FALLBACK)) out[k] = cs.getPropertyValue('--' + k).trim() || FALLBACK[k];
    return (tcMemo = out);
  }
  const alpha = (name, a) => { const n = parseInt((tc()[name] || name).slice(1), 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')'; };

  // ---- Utilitaires graphiques ----
  function fit(canvas, h) {
    const dpr = devicePixelRatio || 1, w = canvas.clientWidth || canvas.parentElement.clientWidth;
    canvas.style.height = h + 'px'; canvas.width = w * dpr; canvas.height = h * dpr;
    const x = canvas.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    return { x, w, h };
  }
  function niceTicks(lo, hi, n = 6) {
    if (lo === hi) { lo -= 1; hi += 1; }
    const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  const compact = v => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : a >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : a >= 1000 ? (v / 1e3).toFixed(1) + 'k' : v % 1 ? v.toFixed(1) : String(v); };

  // Graphique en lignes avec survol. o = {series:[{name,color,data:[[x,y]],width,dash}], xmin,xmax,ymin,ymax,
  //   xTicks:[[x,label]], yFmt, tipHead(x), tipFmt(y), bands:[{x0,x1,color}], hbands:[{y0,y1,color}], vlines:[{x,color}], height}
  function lineChart(canvas, o) {
    const P = { l: 54, r: 12, t: 10, b: 26 }, H = o.height || 340;
    let hover = null, g;
    const vis = () => o.series.filter(s => s.data.length);
    function scales() {
      let lo = o.ymin, hi = o.ymax;
      if (lo == null || hi == null) {
        let a = Infinity, b = -Infinity;
        vis().forEach(s => s.data.forEach(([x, y]) => { if (x >= o.xmin && x <= o.xmax) { a = Math.min(a, y); b = Math.max(b, y); } }));
        if (!isFinite(a)) { a = 0; b = 1; }
        const pad = (b - a) * .06 || 1; lo = o.ymin ?? a - pad; hi = o.ymax ?? b + pad;
      }
      return { lo, hi, X: v => P.l + (v - o.xmin) / (o.xmax - o.xmin || 1) * (g.w - P.l - P.r), Y: v => P.t + (hi - v) / (hi - lo || 1) * (g.h - P.t - P.b) };
    }
    function draw() {
      g = fit(canvas, H); const { x, w, h } = g, S = scales(), { X, Y } = S;
      const C = tc(); x.fillStyle = C.bg; x.fillRect(P.l, P.t, w - P.l - P.r, h - P.t - P.b);
      (o.hbands || []).forEach(b => { x.fillStyle = b.color; x.fillRect(P.l, Y(b.y1), w - P.l - P.r, Y(b.y0) - Y(b.y1)); });
      (o.bands || []).forEach(b => { x.fillStyle = b.color; x.fillRect(X(b.x0), P.t, X(b.x1) - X(b.x0), h - P.t - P.b); });
      x.font = '11px system-ui'; x.lineWidth = 1;
      x.textAlign = 'right'; x.fillStyle = C.muted;
      niceTicks(S.lo, S.hi).forEach(v => {
        x.strokeStyle = v === 0 ? C.muted : C.line; x.setLineDash(v === 0 ? [] : [3, 4]);
        x.beginPath(); x.moveTo(P.l, Y(v)); x.lineTo(w - P.r, Y(v)); x.stroke();
        x.fillText((o.yFmt || compact)(v), P.l - 6, Y(v) + 4);
      });
      x.setLineDash([]); x.textAlign = 'center';
      let lastEnd = -Infinity;
      (o.xTicks || []).forEach(([v, label]) => {
        x.strokeStyle = C.line; x.beginPath(); x.moveTo(X(v), P.t); x.lineTo(X(v), h - P.b); x.stroke();
        const tw = x.measureText(label).width, cx = X(v) > w - 34 ? w - P.r - tw / 2 : X(v) < P.l + 24 ? P.l + tw / 2 : X(v);
        if (cx - tw / 2 < lastEnd + 6) return;   // évite les libellés qui se chevauchent
        lastEnd = cx + tw / 2; x.textAlign = 'center'; x.fillText(label, cx, h - 8);
      });
      x.strokeStyle = C.muted; x.strokeRect(P.l, P.t, w - P.l - P.r, h - P.t - P.b);
      x.save(); x.beginPath(); x.rect(P.l, P.t, w - P.l - P.r, h - P.t - P.b); x.clip();
      vis().forEach(s => {
        x.strokeStyle = s.color; x.lineWidth = s.width || 1.6; x.setLineDash(s.dash || []); x.beginPath();
        let started = false;
        s.data.forEach(([a, b]) => { if (a < o.xmin || a > o.xmax) return; started ? x.lineTo(X(a), Y(b)) : x.moveTo(X(a), Y(b)); started = true; });
        x.stroke();
        if (s.dots) {                                                            // points sur chaque observation (courbes hebdomadaires)
          x.setLineDash([]); x.fillStyle = s.color;
          s.data.forEach(([a, b]) => { if (a < o.xmin || a > o.xmax) return; x.beginPath(); x.arc(X(a), Y(b), s.dotRadius || 2.4, 0, 7); x.fill(); });
        }
      });
      x.setLineDash([]);
      (o.vlines || []).forEach(v => { x.strokeStyle = v.color; x.lineWidth = 1.6; x.beginPath(); x.moveTo(X(v.x), P.t); x.lineTo(X(v.x), h - P.b); x.stroke(); });
      x.restore();
      if (hover != null) tooltip(x, S);
    }
    function nearest(data, xv) {
      let lo = 0, hi = data.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; data[m][0] < xv ? lo = m + 1 : hi = m; }
      if (lo > 0 && Math.abs(data[lo - 1][0] - xv) < Math.abs(data[lo][0] - xv)) lo--;
      return data[lo];
    }
    function tooltip(x, S) {
      const xv = o.xmin + (hover - P.l) / (g.w - P.l - P.r) * (o.xmax - o.xmin);
      if (xv < o.xmin || xv > o.xmax) return;
      const rows = vis().map(s => ({ s, p: nearest(s.data, xv) })).filter(r => r.p);
      if (!rows.length) return;
      const px = S.X(rows[0].p[0]);
      x.strokeStyle = alpha('text', .35); x.lineWidth = 1; x.beginPath(); x.moveTo(px, P.t); x.lineTo(px, g.h - P.b); x.stroke();
      rows.forEach(r => { x.fillStyle = r.s.color; x.beginPath(); x.arc(S.X(r.p[0]), S.Y(r.p[1]), 3.5, 0, 7); x.fill(); });
      const head = o.tipHead ? o.tipHead(rows[0].p[0]) : '', lines = rows.map(r => [r.s.color, r.s.name, (o.tipFmt || nf)(r.p[1])]);
      x.font = '12px system-ui';
      const bw = Math.max(x.measureText(head).width, ...lines.map(l => x.measureText(l[1] + ': ' + l[2]).width + 16)) + 16, bh = 22 + lines.length * 17;
      let bx = px + 12; if (bx + bw > g.w - 4) bx = px - bw - 12;
      const C = tc(); x.fillStyle = C.panel; x.strokeStyle = C.muted; x.beginPath(); x.roundRect(bx, P.t + 6, bw, bh, 8); x.fill(); x.stroke();
      x.textAlign = 'left'; x.fillStyle = C.text; x.fillText(head, bx + 8, P.t + 22);
      lines.forEach((l, i) => { x.fillStyle = l[0]; x.fillRect(bx + 8, P.t + 32 + i * 17, 8, 8); x.fillStyle = C.text; x.fillText(l[1] + ': ' + l[2], bx + 22, P.t + 40 + i * 17); });
    }
    const move = e => { const r = canvas.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; hover = t.clientX - r.left; draw(); };
    canvas.onmousemove = move; canvas.ontouchmove = move;
    canvas.onmouseleave = () => { hover = null; draw(); };
    new ResizeObserver(() => draw()).observe(canvas.parentElement);
    draw();
    return { redraw: (patch) => { Object.assign(o, patch || {}); draw(); } };
  }

  // Infobulle partagée par les camemberts : trop petits pour dessiner un texte lisible dans leur propre canvas,
  // elle est donc affichée par-dessus la page (un seul élément réutilisé par tous les camemberts de la page).
  const pieTip = (() => {
    let el;
    const ensure = () => el ||= (() => { const d = document.createElement('div'); d.className = 'pie-tip'; d.hidden = true; document.body.appendChild(d); return d; })();
    return {
      show(x, y, html) { const d = ensure(); d.innerHTML = html; d.style.left = (x + 14) + 'px'; d.style.top = (y + 14) + 'px'; d.hidden = false; },
      hide() { if (el) el.hidden = true; },
    };
  })();
  // Camembert : slices = [{v,color,name}]. Le survol (ou le toucher) affiche une infobulle si les tranches ont un nom.
  // fmt(slice, partDuTotalEnPct) formate le texte de l'infobulle ; par défaut : « nom : valeur (part %) ».
  function pie(canvas, slices, size = 110, fmt) {
    const dpr = devicePixelRatio || 1;
    canvas.style.width = size + 'px'; canvas.style.height = size + 'px'; canvas.width = size * dpr; canvas.height = size * dpr;
    const x = canvas.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, size, size);
    const tot = slices.reduce((s, a) => s + Math.max(0, a.v), 0) || 1; let a0 = -Math.PI / 2;
    const arcs = [];
    slices.forEach(s => {
      const a1 = a0 + Math.max(0, s.v) / tot * Math.PI * 2;
      x.fillStyle = s.color; x.strokeStyle = tc().bg; x.lineWidth = 1.5; x.beginPath(); x.moveTo(size / 2, size / 2);
      x.arc(size / 2, size / 2, size / 2 - 2, a0, a1); x.closePath(); x.fill(); x.stroke();
      if (s.v > 0) arcs.push({ a0, a1, s }); a0 = a1;
    });
    if (!slices.some(s => s.name != null)) return;                        // pas de nom fourni : rien à afficher au survol
    const format = fmt || ((s, pct) => `${s.name} : ${nf(s.v)} (${pct.toFixed(0)} %)`);
    const move = e => {
      const r = canvas.getBoundingClientRect(), t = e.touches ? e.touches[0] : e;
      const dx = t.clientX - (r.left + r.width / 2), dy = t.clientY - (r.top + r.height / 2);
      if (Math.hypot(dx, dy) > r.width / 2) return pieTip.hide();
      let a = Math.atan2(dy, dx); if (a < -Math.PI / 2) a += Math.PI * 2;   // même origine (nord) et même sens (horaire) que les tranches
      const hit = arcs.find(z => a >= z.a0 - 1e-6 && a < z.a1 + 1e-6);
      hit ? pieTip.show(t.clientX, t.clientY, format(hit.s, hit.s.v / tot * 100)) : pieTip.hide();
    };
    canvas.onmousemove = move; canvas.ontouchmove = e => { move(e); e.preventDefault(); };
    canvas.onmouseleave = () => pieTip.hide();
  }
  // Barres verticales de positions nettes : bars = [{label,v,color}]
  function bars(canvas, bars, h = 190, vals = true) {
    const { x, w } = fit(canvas, h), max = Math.max(...bars.map(b => Math.abs(b.v)), 1), mid = h / 2 - 8, bw = Math.min(70, (w - 40) / bars.length - 14);
    x.strokeStyle = tc().muted; x.beginPath(); x.moveTo(20, mid); x.lineTo(w - 20, mid); x.stroke();
    bars.forEach((b, i) => {
      const cx = 20 + (w - 40) * (i + .5) / bars.length, len = Math.abs(b.v) / max * (mid - 14);
      x.fillStyle = b.color; x.fillRect(cx - bw / 2, b.v >= 0 ? mid - len : mid, bw, Math.max(len, 1));
      x.fillStyle = tc().text; x.font = '11px system-ui'; x.textAlign = 'center';
      if (vals) x.fillText(nf(b.v), cx, b.v >= 0 ? mid - len - 5 : mid + len + 13);
      x.fillStyle = tc().muted; x.fillText(b.label, cx, h - 4);
    });
  }
  // Jauge demi-cercle : pct 0..100
  function gauge(canvas, pct, color) {
    const W = 230, H = 130; canvas.style.width = W + 'px'; const dpr = devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + 'px';
    const x = canvas.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    x.lineWidth = 26; x.lineCap = 'butt'; x.strokeStyle = tc().line; x.beginPath(); x.arc(W / 2, H - 6, 90, Math.PI, 0); x.stroke();
    if (pct > 0) { x.strokeStyle = color; x.beginPath(); x.arc(W / 2, H - 6, 90, Math.PI, Math.PI + Math.PI * Math.min(pct, 100) / 100); x.stroke(); }
    x.fillStyle = tc().text; x.font = '600 26px system-ui'; x.textAlign = 'center'; x.fillText(pct.toFixed(pct % 1 ? 1 : 0) + ' %', W / 2, H - 14);
  }
  // Couleurs dynamiques sans attribut style en ligne (compatible CSP) : data-c → variable CSS --c, data-bg → fond.
  function applyColors(root) {
    root.querySelectorAll('[data-c]').forEach(el => el.style.setProperty('--c', el.dataset.c));
    root.querySelectorAll('[data-bg]').forEach(el => { el.style.background = el.dataset.bg; });
  }
  // ---- Compte à rebours avant le prochain rapport COT ----
  // n = CALC.nextCotRelease(...) ; now en ms ; whenFmt = Intl.DateTimeFormat (fuseau du visiteur). Trois états : à venir, publié, en retard.
  const COT_GRACE_MS = 30 * 36e5;                                                               // doit rester égal à freshness.js (cotOverdueGrace) : vérifié par un test
  function countdownHtml(n, now, whenFmt) {
    const when = whenFmt.format(n.at);
    if (now <= n.at) {                                                                          // décidé d'après l'heure fournie, pas d'après un drapeau calculé plus tôt
      const ms = n.at - now, d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), mi = Math.floor(ms % 36e5 / 6e4);
      return '<b>Prochain rapport COT</b> : ' + when + ' <small>(15h30 à New York)</small> · dans <b>' + (d ? d + ' j ' : '') + h + ' h ' + String(mi).padStart(2, '0') + ' min</b>'
        + (n.delayed ? " · <em>publication décalée d'un jour ouvré (jour férié américain)</em>" : '');
    }
    if (now - n.at < COT_GRACE_MS) return '<b>Nouveau rapport publié</b> (' + when + ') · mise à jour des données en cours (actualisation toutes les 6 h).';
    return '<b>Rapport attendu</b> le ' + when + ' · <em>données non actualisées</em>.';
  }

  // ---- Indicateur de fraîcheur des données (règles calculées côté serveur : freshness.js) ----
  const ago = ms => { const m = Math.round(ms / 6e4); return m < 1 ? "à l'instant" : m < 60 ? 'il y a ' + m + ' min' : m < 2880 ? 'il y a ' + Math.round(m / 60) + ' h' : 'il y a ' + Math.round(m / 1440) + ' j'; };
  const dm = t => new Date(t).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
  const LABEL = { ok: 'Données à jour', warn: 'Données à vérifier', bad: 'Données indisponibles' };
  const pill = (lvl, inner) => '<span class="fresh ' + lvl + '" role="status"><span class="fdot" aria-hidden="true"></span><b>' + LABEL[lvl] + '</b>' + inner + '</span>';
  function freshMarket(s) {
    const p = s.prices, c = s.cot, parts = [];
    parts.push(p.missing ? 'Prix : indisponibles' : 'Prix : séance du ' + dm(p.lastSession));
    parts.push(c.missing ? 'COT : indisponible' : 'COT : positions du ' + dm(Date.parse(c.reportDate)));
    const last = Math.max(p.updatedAt || 0, c.updatedAt || 0);
    if (last) parts.push('actualisé ' + ago(s.now - last));
    const issues = [];
    if (p.reason === 'session') issues.push('dernière séance ancienne');
    if (p.reason === 'fetch') issues.push('prix non actualisés depuis plus de 2 jours');
    if (c.reason === 'overdue') issues.push('rapport COT du ' + dm(Date.parse(c.next.releaseDate)) + ' non reçu');
    if (c.reason === 'fetch') issues.push('COT non actualisé depuis plus de 2 jours');
    (s.errors || []).forEach(e => issues.push('échec de mise à jour (' + e.store + ') ' + ago(s.now - e.at)));
    return pill(s.level, ' · ' + parts.join(' · ') + (issues.length ? ' — ' + issues.join(', ') : ''));
  }
  function freshSummary(s) {
    const m = s.markets, lvl = m.bad ? 'bad' : m.warn ? 'warn' : 'ok';
    const att = s.attention.length ? ' — à vérifier : ' + s.attention.map(x => x.name).join(', ') : '';
    return pill(lvl, ' · ' + m.ok + '/' + m.total + ' marchés à jour' + (s.lastRefresh ? ' · actualisation ' + ago(s.now - s.lastRefresh) : '') + att);
  }
  async function freshness(el, code) {                       // code absent : résumé de tous les marchés
    if (!el) return;
    try { const s = await json('/api/status' + (code ? '?code=' + code : '')); el.innerHTML = code ? freshMarket(s) : freshSummary(s); }
    catch { el.innerHTML = ''; }                             // l'indicateur est facultatif : jamais bloquant
  }
  // Petites briques d'affichage partagées (screener, comparaison) : pastille de signal et point de signal.
  const sigPill = (text, cls) => '<span class="sig sm ' + cls + '">' + text + '</span>';                      // cls : buy | sell | wait
  const sigDot = (s, label) => '<i class="dot ' + (s > 0 ? 'up' : s < 0 ? 'dn' : 'nt') + '" role="img" aria-label="' + label + ' : ' + (s > 0 ? 'haussier' : s < 0 ? 'baissier' : 'neutre') + '" title="' + label + ' : ' + (s > 0 ? 'haussier' : s < 0 ? 'baissier' : 'neutre') + '"></i>';
  return { $, json, cot, daily, weekly, applyColors, tc, alpha, sigPill, sigDot, freshness, ago, countdownHtml, COT_GRACE_MS, shell, setInfo, lineChart, pie, bars, gauge, nf, sg, dec, MONTHS, MONTHS_L, GROUPS };
})();
