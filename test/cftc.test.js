const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const C = require('../cftc.js');

const row = (date, o) => ({ report_date_as_yyyy_mm_dd: date + 'T00:00:00.000', ...o });

test('listes de champs : sans doublon et avec la date', () => {
  for (const [nom, f] of [['LEGACY', C.LEGACY_FIELDS], ['TFF', C.TFF_FIELDS], ['DISAGG', C.DISAGG_FIELDS]]) {
    assert.equal(new Set(f).size, f.length, `${nom} contient des doublons`);
    assert.ok(f.includes('report_date_as_yyyy_mm_dd') && f.includes('open_interest_all'), `${nom} : date ou open interest manquant`);
  }
});

test('Legacy : ordre des colonnes, tri chronologique, conversion en nombres', () => {
  const recent = row('2026-09-15', { comm_positions_long_all: '100', comm_positions_short_all: '200', noncomm_positions_long_all: '300',
    noncomm_positions_short_all: '400', nonrept_positions_long_all: '500', nonrept_positions_short_all: '600', open_interest_all: '700' });
  const ancien = row('2026-09-08', { comm_positions_long_all: '1', open_interest_all: '' });   // champs absents ou vides → 0
  assert.deepEqual(C.compactLegacy([recent, ancien]), [
    ['2026-09-08', 1, 0, 0, 0, 0, 0, 0],
    ['2026-09-15', 100, 200, 300, 400, 500, 600, 700],
  ]);
});

test('TFF : ordre des colonnes', () => {
  const r = row('2026-09-15', { dealer_positions_long_all: '1', dealer_positions_short_all: '2', asset_mgr_positions_long: '3', asset_mgr_positions_short: '4',
    lev_money_positions_long: '5', lev_money_positions_short: '6', other_rept_positions_long: '7', other_rept_positions_short: '8',
    nonrept_positions_long_all: '9', nonrept_positions_short_all: '10' });
  assert.deepEqual(C.compactTff([r]), [['2026-09-15', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]);
});

test('Disaggregated : ordre des colonnes', () => {
  const r = row('2026-09-15', { prod_merc_positions_long: '1', prod_merc_positions_short: '2', swap_positions_long_all: '3', swap__positions_short_all: '4',
    m_money_positions_long_all: '5', m_money_positions_short_all: '6', other_rept_positions_long: '7', other_rept_positions_short: '8',
    nonrept_positions_long_all: '9', nonrept_positions_short_all: '10' });
  assert.deepEqual(C.compactDisagg([r]), [['2026-09-15', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]);
});

test('Disaggregated : piège du double tiret bas de la CFTC (swap__positions_short_all)', () => {
  // La CFTC écrit « swap__positions_short_all » (deux tirets bas). Le nom « logique » à un seul tiret n'existe pas :
  // il ne doit jamais être lu, sinon les shorts des swap dealers passeraient silencieusement à 0.
  assert.ok(C.DISAGG_FIELDS.includes('swap__positions_short_all') && C.DISAGG_FIELDS.includes('swap__positions_spread_all'));
  assert.ok(!C.DISAGG_FIELDS.includes('swap_positions_short_all'));
  const r = row('2026-09-15', { swap_positions_short_all: '999' });
  assert.equal(C.compactDisagg([r])[0][4], 0);
  // Idem pour « other_rept » : traders short/spread sans suffixe _all.
  assert.ok(C.DISAGG_FIELDS.includes('traders_other_rept_short') && !C.DISAGG_FIELDS.includes('traders_other_rept_short_all'));
});

// ---- Cohérence entre les champs lus par la page (cot.js) et ceux demandés au serveur ----
const src = fs.readFileSync(path.join(__dirname, '..', 'cot.js'), 'utf8');
const PREFIX = /^(comm|noncomm|nonrept|tot_rept|dealer|asset_mgr|lev_money|other_rept|prod_merc|swap|m_money|change_in|pct_of_oi|traders|open_interest|contract_units|report_date)/;
const keys = txt => [...new Set([...txt.matchAll(/(['"])([a-z][a-z0-9_]*[a-z0-9])\1/g)].map(m => m[2]).filter(k => PREFIX.test(k) && k.includes('_')))];
const iTff = src.indexOf("groupSection('#tffSec'"), iDis = src.indexOf("groupSection('#disSec'");

test('cot.js ↔ serveur : chaque champ lu existe dans la liste demandée (Legacy)', () => {
  assert.ok(iTff > 0 && iDis > iTff, 'structure de cot.js inattendue');
  const used = keys(src.slice(0, iTff));
  assert.ok(used.length > 25, `trop peu de champs Legacy détectés (${used.length})`);
  const absents = used.filter(k => !C.LEGACY_FIELDS.includes(k));
  assert.deepEqual(absents, [], 'champs Legacy lus par la page mais jamais demandés');
  for (const side of ['long', 'short'])                                            // clés construites dynamiquement
    for (const g of ['comm', 'noncomm', 'nonrept']) assert.ok(C.LEGACY_FIELDS.includes(`pct_of_oi_${g}_${side}_all`), `pct_of_oi_${g}_${side}_all`);
});
test('cot.js ↔ serveur : chaque champ lu existe dans la liste demandée (TFF)', () => {
  const used = keys(src.slice(iTff, iDis));
  assert.ok(used.length > 40, `trop peu de champs TFF détectés (${used.length})`);
  assert.deepEqual(used.filter(k => !C.TFF_FIELDS.includes(k)), []);
});
test('cot.js ↔ serveur : chaque champ lu existe dans la liste demandée (Disaggregated)', () => {
  const used = keys(src.slice(iDis));
  assert.ok(used.length > 35, `trop peu de champs Disaggregated détectés (${used.length})`);
  assert.deepEqual(used.filter(k => !C.DISAGG_FIELDS.includes(k)), []);
});

// ---- Schéma réel de la CFTC (nécessite le réseau ; ignoré hors ligne) ----
// Un nom de colonne inconnu fait répondre 400 à l'API : c'est exactement l'erreur que l'on veut attraper.
for (const [nom, dataset, fields, code] of [['Legacy', '6dca-aqww', C.LEGACY_FIELDS, '209742'], ['TFF', 'gpe5-46if', C.TFF_FIELDS, '209742'], ['Disaggregated', '72hh-3qpy', C.DISAGG_FIELDS, '088691']]) {
  test(`schéma CFTC en ligne : ${nom}`, async t => {
    const url = `https://publicreporting.cftc.gov/resource/${dataset}.json?$select=${fields.join(',')}&$limit=1&$where=` + encodeURIComponent(`cftc_contract_market_code='${code}'`);
    if (process.env.SKIP_LIVE) return t.skip('SKIP_LIVE : test réseau désactivé (intégration continue hors lundi)');
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(20000) }); } catch { return t.skip('réseau indisponible'); }
    const body = await r.json();
    assert.equal(r.status, 200, 'la CFTC refuse la requête : ' + JSON.stringify(body).slice(0, 200));
    assert.ok(Array.isArray(body) && body.length === 1);
  });
}
