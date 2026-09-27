// Pages Inflation / Taux (macroview.js) et debrief de la fiche (debriefview.js) exécutés dans un faux DOM.
const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const { render } = require('../tools/fake-dom.js');

const ROOT = path.join(__dirname, '..'), NOW = Date.parse('2026-09-25T12:00:00Z');
const AREAS = [{ code: 'USA', name: 'États-Unis', ccy: 'USD' }, { code: 'EA20', name: 'Zone euro', ccy: 'EUR' }, { code: 'JPN', name: 'Japon', ccy: 'JPY' }];
const mois = n => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(2021, 8 + i, 1)); return d.toISOString().slice(0, 7); });
const ser = (n, f) => mois(n).map((p, i) => [p, f(i)]);
const PAYLOAD = { areas: AREAS, data: { yoy: { USA: ser(60, i => 2 + i / 30), EA20: ser(60, i => 1 + i / 40) }, mom: { USA: ser(60, () => 0.2) } } };
const text = h => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const run = (payload = PAYLOAD, kind = 'cpi', pick) => render({ src: path.join(ROOT, 'macroview.js'), fnName: '((a, root) => renderMacro(a.kind, a.payload, root, a.pick))', args: { kind, payload, pick }, now: NOW, calc: {} });

test('inflation : deux zones, mesure annuelle, fenêtre de 5 ans par défaut, dernières valeurs en indicateurs', async () => {
  const { rec, root } = await run(), html = root.innerHTML;
  const s = rec.charts['#mChart'].series;
  assert.deepEqual(s.map(x => x.name), ['États-Unis', 'Zone euro']);
  assert.equal(s[0].data.length, 60); assert.ok(s[0].data.every(p => p[0] > 1e12));
  assert.match(html, /Zone A/); assert.match(html, /Variation annuelle \(%\)/); assert.match(html, /Source : OCDE \(indices des prix/);
  assert.doesNotMatch(html, /\sstyle=/); assert.match(html, /aria-pressed="true"/); assert.match(html, /<canvas id="mChart" role="img" aria-label="[^"]{30,}"/);
});

test('inflation : zones sans donnée non proposées ; une seule zone si B = aucune', async () => {
  const { root, el } = await run(PAYLOAD, 'cpi', { a: 'USA', b: '' }), html = root.innerHTML;
  assert.doesNotMatch(html, /Japon/); assert.match(html, /<select id="mB" class="btn selB"><option value="">Aucune/);
  assert.doesNotMatch(el('#mTbl').innerHTML, /Zone euro/); assert.match(el('#mTbl').innerHTML, /États-Unis/);
});

test('taux : mesures immédiat / court / long terme proposées', async () => {
  const p = { areas: AREAS, data: { immediate: { USA: ser(30, () => 3.6) }, short: {}, long: {} } };
  const { root, el } = await run(p, 'rates', { b: '' });
  assert.match(root.innerHTML, /Taux immédiat/); assert.match(root.innerHTML, /Court terme, 3 mois/); assert.match(root.innerHTML, /Long terme/); assert.match(el('#mTitle').textContent, /^Taux d'intérêt – Taux immédiat/);
});

test('source indisponible (data = null) : message clair, pas d\'exception', async () => {
  const { el } = await run({ areas: AREAS, data: null });
  assert.match(el('#msg').textContent, /indisponibles/);
});

test('debrief : biais semaine et journée en pastilles colorées, sections en cartes, texte échappé', async () => {
  const d = { available: true, name: 'Nasdaq <100>', generated: NOW, note: 'Repères pédagogiques.',
    bias: { week: { key: 'up', label: 'haussière', why: 'COT +1' }, day: { key: 'down', label: 'baissière', why: 'Williams %R −1' } },
    story: [{ title: 'Le point du jour', text: 'Récit <i>x</i>' }], sections: [{ title: 'Synthèse', lines: ['Ligne <b>1</b>'] }] };
  const { root } = await render({ src: path.join(ROOT, 'debriefview.js'), fnName: 'renderDebrief', args: { slug: 'x' }, now: NOW, calc: {}, overrides: { json: async () => d } });
  const html = root.innerHTML, t = text(html);
  assert.match(html, /Semaine<\/span><span class="sig buy">Haussière/); assert.match(html, /Journée<\/span><span class="sig sell">Baissière/);
  assert.match(t, /Debrief du jour – Nasdaq &lt;100&gt;/); assert.match(html, /Ligne &lt;b&gt;1&lt;\/b&gt;/); assert.doesNotMatch(html, /<b>1<\/b>/);
});

test('debrief indisponible : message, aucune exception', async () => {
  const { root } = await render({ src: path.join(ROOT, 'debriefview.js'), fnName: 'renderDebrief', args: { slug: 'x' }, now: NOW, calc: {}, overrides: { json: async () => ({ available: false, message: 'Données insuffisantes pour ce marché.' }) } });
  assert.match(root.innerHTML, /insuffisantes/);
  const r2 = await render({ src: path.join(ROOT, 'debriefview.js'), fnName: 'renderDebrief', args: { slug: 'x' }, now: NOW, calc: {}, overrides: { json: async () => { throw new Error('x'); } } });
  assert.match(r2.root.innerHTML, /indisponible/);
});

test('première récupération en cours (loading) : message d’attente, pas d’erreur', async () => {
  const { el } = await run({ areas: AREAS, data: null, loading: true });
  assert.match(el('#msg').textContent, /Première récupération des données OCDE en cours/);
  assert.notEqual(el('#msg').className, 'err');
});

test('debrief : un seul paragraphe visible au départ, « Lire la suite » déplie le reste et se replie ensuite', async () => {
  const d = { available: true, name: 'X', generated: NOW, note: 'Note.',
    bias: { week: { key: 'up', label: 'haussière', why: 'w' }, day: { key: 'up', label: 'haussière', why: 'd' } },
    story: [{ title: 'A', text: 'Premier paragraphe.' }, { title: 'B', text: 'Deuxième paragraphe.' }],
    sections: [{ title: 'Détail', lines: ['Une ligne.'] }] };
  const { root, el } = await render({ src: path.join(ROOT, 'debriefview.js'), fnName: 'renderDebrief', args: { slug: 'x' }, now: NOW, calc: {}, overrides: { json: async () => d } });
  const visible = root.innerHTML.split('id="debRestStory"')[0];
  assert.match(visible, /Premier paragraphe/); assert.doesNotMatch(visible, /Deuxième paragraphe/); assert.doesNotMatch(visible, /Une ligne/);
  // le premier paragraphe et la suite du récit partagent le même cadre (.card.deb-story)
  const card = root.innerHTML.match(/<div class="card deb-story">[\s\S]*?\n {3}<\/div>/)[0];
  assert.match(card, /Premier paragraphe/); assert.match(card, /id="debRestStory"/); assert.match(card, /Deuxième paragraphe/); assert.match(card, /id="debToggle"/);
  assert.match(root.innerHTML, /<div id="debRestStory" hidden>/); assert.match(root.innerHTML, /<div id="debRestDetail" hidden>/); assert.match(root.innerHTML, />Lire la suite ↓<\/button>/);
  const story = el('#debRestStory'), detail = el('#debRestDetail'), btn = el('#debToggle');
  assert.equal(story.hidden, true); assert.equal(detail.hidden, true);
  btn.onclick();
  assert.equal(story.hidden, false); assert.equal(detail.hidden, false); assert.match(btn.textContent, /Replier/);
  btn.onclick();
  assert.equal(story.hidden, true); assert.equal(detail.hidden, true); assert.match(btn.textContent, /Lire la suite/);
});
