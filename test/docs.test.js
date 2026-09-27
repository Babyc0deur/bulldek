// Pages « À propos » et « Mentions légales » : ce qu'elles affirment doit être vrai dans le code.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const CALC = require('../calc.js'), { LIMITS } = require('../freshness.js'), T = CALC.THRESHOLDS;

const ROOT = path.join(__dirname, '..'), read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PAGES = ['market.html', 'screener.html', 'compare.html', 'about.html'];
const SITE_CODE = fs.readdirSync(ROOT).filter(f => /\.(js|html|css)$/.test(f) && !/^(server|store|guard|cftc|freshness|macro|debrief)\.js$/.test(f));   // tout ce que reçoit le navigateur

// ---------- méthodologie : valeurs injectées depuis le code ----------
const about = read('about.html');
const PLACEHOLDERS = ['REFRESH_HOURS', 'COT_SHORT_WEEKS', 'COT_LONG_WEEKS', 'COT_BUY', 'COT_SELL', 'WR_PERIOD', 'WR_HIGH', 'WR_LOW', 'SEASON_MIN_YEARS', 'SEASON_HIT_PCT',
  'ROLL_PCT', 'ROLL_WINDOW', 'CONF', 'OI_FLAT_PCT', 'PRICE_FLAT_PCT', 'STALE_SESSION_DAYS', 'FETCH_MAX_HOURS', 'GRACE_HOURS'];

test('la méthodologie utilise des valeurs injectées : aucun seuil n\'est écrit en dur dans about.html', () => {
  for (const k of PLACEHOLDERS) assert.ok(about.includes('{{' + k + '}}'), `placeholder {{${k}}} absent`);
  // Les nombres qui sont des seuils du code ne doivent pas apparaître en clair dans le texte de la page.
  const texte = about.replace(/<[^>]*>/g, ' ').replace(/\{\{[A-Z_]+\}\}/g, ' ');
  for (const [label, re] of [['80 %', / 80 ?%/], ['20 %', / 20 ?%/], ['−80', /−80/], ['−20', /−20/], ['26 semaines', /26 (dernières )?semaines/], ['156 semaines', /156 (dernières )?semaines/], ['14 (période)', /N = 14/], ['60 %', / 60 ?%/]])
    assert.doesNotMatch(texte, re, `« ${label} » écrit en dur dans about.html : utiliser un placeholder`);
});

test('chaque placeholder correspond à une valeur réelle du code (aucune clé orpheline)', () => {
  const server = read('server.js'), bloc = server.slice(server.indexOf('function docValues'), server.indexOf('function docPage'));
  for (const k of PLACEHOLDERS) assert.ok(new RegExp('\\b' + k + '\\b').test(bloc), `valeur ${k} non fournie par le serveur`);
  for (const [k, v] of Object.entries({ COT_BUY: T.cotBuy, COT_SELL: T.cotSell, WR_HIGH: T.wrHigh, WR_LOW: T.wrLow })) assert.ok(typeof v === 'number', k);
  assert.ok(LIMITS.sessionMaxAge > 0 && LIMITS.fetchMaxAge > 0 && LIMITS.cotOverdueGrace > 0);
});

// ---------- mentions légales : chaque affirmation sur les données personnelles est vérifiée dans le code ----------
test('« aucun cookie, aucun traceur » : vrai pour tout le code envoyé au navigateur ; le stockage local n\'existe que dans theme.js', () => {
  const interdit = /document\.cookie|sessionStorage|indexedDB|sendBeacon|gtag\(|google-analytics|googletagmanager|facebook\.net|hotjar|matomo|plausible|_paq|fbq\(/i;
  for (const f of SITE_CODE) {
    assert.doesNotMatch(read(f), interdit, `${f} contient un traceur`);
    if (f !== 'theme.js') assert.doesNotMatch(read(f), /localStorage/, `${f} : le stockage local est réservé à theme.js (préférence de thème, annoncée dans les mentions légales)`);
  }
});

test('theme.js : une seule clé, uniquement le nom du thème, jamais envoyé au serveur, valeurs relues avec méfiance', () => {
  const t = read('theme.js');
  assert.deepEqual([...new Set([...t.matchAll(/localStorage\.(\w+)\(([^)]*)\)/g)].map(m => m[1]))].sort(), ['getItem', 'removeItem', 'setItem']);
  for (const m of t.matchAll(/localStorage\.\w+\(([^)]*)\)/g)) assert.match(m[1], /^KEY(,\s*v)?$/, 'toujours la même clé ; on ne stocke que le nom du thème : ' + m[1]);
  assert.match(t, /var KEY = 'bulldesk-theme'/);
  assert.doesNotMatch(t, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|document\.cookie|\.src\s*=|new Image/, 'theme.js ne doit rien envoyer');
  assert.match(t, /ids\.indexOf\(v\) >= 0/, 'la valeur lue est comparée à la liste des thèmes connus');
  const propos = read('about.html').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  for (const mot of ['bulldesk-theme', 'jamais envoyée au serveur']) assert.ok(propos.includes(mot), `À propos : « ${mot} » absent`);
});

test('« aucune ressource chargée depuis un service tiers » : aucune URL absolue dans les pages et feuilles de style', () => {
  for (const f of SITE_CODE.filter(f => /\.(html|css)$/.test(f))) {
    const t = read(f).replace(/https?:\/\/(www\.)?(cftc\.gov|cnil\.fr)[^\s"'<)]*/g, '');           // simples mentions de texte
    const charges = [...t.matchAll(/(?:src|href)=["']https?:\/\/[^"']+|url\(\s*["']?https?:|@import\s+["']?https?:/gi)].map(m => m[0]);
    assert.deepEqual(charges, [], `${f} charge une ressource externe`);
  }
});

test('« le site n\'appelle que son propre serveur » : tout fetch() du navigateur vise une adresse relative', () => {
  for (const f of SITE_CODE.filter(f => f.endsWith('.js'))) {
    for (const m of read(f).matchAll(/fetch\(\s*(['"`])([^'"`]*)\1/g)) assert.ok(m[2].startsWith('/') || m[2].startsWith('${'), `${f} : fetch vers ${m[2]}`);
    assert.doesNotMatch(read(f), /new WebSocket|XMLHttpRequest|EventSource/, `${f} : canal réseau inattendu`);
  }
});

test('« aucune adresse IP dans les journaux ni sur disque » : le journal du serveur n\'écrit pas l\'IP, le limiteur reste en mémoire', () => {
  // On inspecte le CODE des appels console.log, pas leurs textes : on retire les chaînes entre guillemets et on ne garde des gabarits `…` que les expressions ${…}.
  const codeSeul = l => l.replace(/'[^']*'|"[^"]*"/g, ' ').replace(/`([^`]*)`/g, (m, inner) => [...inner.matchAll(/\$\{([^}]*)\}/g)].map(x => x[1]).join(' '));
  for (const f of ['server.js', 'store.js']) for (const l of read(f).split('\n').filter(x => /console\.log/.test(x)))
    assert.doesNotMatch(codeSeul(l), /remoteAddress|clientIp|headers|req\.|socket|\bip\b/i, `${f} journalise possiblement l'IP : ${l.trim().slice(0, 90)}`);
  assert.doesNotMatch(codeSeul("console.log('erreur', clientIp(req))"), /^$/);                     // garde-fou : l'analyseur voit bien un appel qui fuiterait l'IP
  assert.match(codeSeul("console.log('x', clientIp(req))"), /clientIp/);
  assert.match(codeSeul('console.log(`ip ${req.socket.remoteAddress}`)'), /remoteAddress/);
  assert.doesNotMatch(codeSeul("console.log('X-Forwarded-For reçu')"), /forwarded|headers/i);
  const guard = read('guard.js');
  assert.doesNotMatch(guard, /require\(['"](fs|node:fs|node:sqlite|net|http)['"]\)/, 'guard.js (limiteur, seul lieu où l\'IP est utilisée) ne doit rien écrire ni envoyer');
  assert.doesNotMatch(read('server.js'), /limiter\.[a-z]+\([^)]*\)\s*[^;]*(writeFile|store\.put)/, 'le compteur du limiteur ne doit pas être persisté');
  const usages = [...read('server.js').matchAll(/clientIp\(/g)].length;
  assert.equal(usages, 1, 'l\'IP ne doit servir qu\'une fois : à la limite de débit');
});

test('« l\'IP n\'est gardée qu\'une minute » : durée de la fenêtre du limiteur par défaut', () => {
  assert.match(read('server.js'), /RATE_WINDOW_MS = \+process\.env\.RATE_WINDOW_MS \|\| 60000/);
});

// ---------- structure commune ----------
test('toutes les pages : pied de page avec le lien À propos, lien d\'évitement et zone principale', () => {
  for (const f of PAGES) {
    const t = read(f);
    assert.match(t, /<a href="\/a-propos">/, f + ' : lien À propos'); assert.doesNotMatch(t, /mentions-legales/, f + ' : plus de lien Mentions légales');
    assert.match(t, /<footer class="f">/, f);
  }
  assert.match(read('about.html'), /<a class="skip" href="#contenu">/, 'about.html : lien d\'évitement');
});

test('ancres internes : chaque lien #… pointe vers un identifiant existant', () => {
  const t = read('about.html'), ids = new Set([...t.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  for (const m of t.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(m[1]), `about.html : ancre #${m[1]} sans cible`);
  assert.ok(ids.has('limites'));
});
