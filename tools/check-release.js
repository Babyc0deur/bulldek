// Contrôle avant mise en ligne : « npm run check:release ». Échoue (code 1) tant que quelque chose de bloquant subsiste.
const fs = require('fs'), path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const problems = [];

const render = read('render.yaml');
if (!/TRUST_PROXY\s*\n\s*value:\s*"?[1-9]/.test(render)) problems.push('render.yaml : TRUST_PROXY doit valoir au moins 1 derrière le proxy de l\'hébergeur (sinon tous les visiteurs partagent un même compteur)');
if (!/NODE_VERSION/.test(render)) problems.push('render.yaml : NODE_VERSION absent (SQLite intégré demande Node 22.13 minimum)');

if (problems.length) { console.log('À corriger avant la mise en ligne :\n - ' + problems.join('\n - ')); process.exit(1); }
console.log('Contrôle avant mise en ligne : OK');
