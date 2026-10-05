// Thème de l'interface. Terminal par défaut ; le menu « Thème » (ajouté dans la barre du haut de chaque page) applique un autre thème à
// tout le site et le mémorise dans le navigateur du visiteur. Une seule clé de stockage local, 'bulldesk-theme', qui ne contient que
// le nom du thème : elle n'est jamais envoyée au serveur (voir la page « À propos », section Vie privée). Chargé dans <head> pour appliquer le thème avant l'affichage.
(function () {
  var KEY = 'bulldesk-theme', DEFAULT = 'terminal';
  var THEMES = [['terminal', 'Terminal'], ['papier', 'Papier'], ['nordique', 'Nordique'], ['graphite', 'Graphite'], ['indigo', 'Indigo'], ['actuel', 'Bleu nuit (ancien)']];
  var ids = THEMES.map(function (t) { return t[0]; });

  function stored() {
    try { var v = localStorage.getItem(KEY); return ids.indexOf(v) >= 0 ? v : null; }        // valeur inconnue ou altérée : ignorée
    catch (e) { return null; }                                                                // stockage bloqué (navigation privée…) : thème par défaut
  }
  var current = stored() || DEFAULT;
  document.documentElement.setAttribute('data-theme', current);

  function build() {
    var bar = document.querySelector('.top .bar');
    if (document.getElementById('themeSel')) return true;
    if (!bar) return false;
    var box = document.createElement('div'); box.className = 'theme-pick';
    var label = document.createElement('label'); label.setAttribute('for', 'themeSel'); label.className = 'sr-only'; label.textContent = 'Thème du site';
    var sel = document.createElement('select'); sel.id = 'themeSel'; sel.className = 'btn';
    THEMES.forEach(function (t) { var o = document.createElement('option'); o.value = t[0]; o.textContent = 'Thème : ' + t[1]; if (t[0] === current) o.selected = true; sel.appendChild(o); });
    sel.onchange = function () {
      var v = sel.value, saved = true;
      try { if (v === DEFAULT) localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch (e) { saved = false; }
      document.documentElement.setAttribute('data-theme', v);
      if (saved) location.reload();                                                          // les graphiques relisent les couleurs du nouveau thème
    };
    box.appendChild(label); box.appendChild(sel); bar.appendChild(box);
    return true;
  }
  function start() {
    if (build()) return;
    var obs = new MutationObserver(function () { if (build()) obs.disconnect(); });          // la fiche marché construit sa barre après coup
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  // Écran de chargement : affiché dès le premier rendu (classe « bd-loading » sur <html>, dessinée en CSS dans shared.css),
  // retiré quand la page a reçu ses données : après l'événement « load », dès qu'aucune requête n'est plus en cours depuis 150 ms.
  // Les requêtes sont comptées en enveloppant fetch (ce script est le seul chargé dans <head>, donc avant ceux des pages).
  // Au plus tard 2,5 s après « load » : une section lente (débrief, fiabilité) affiche alors son propre message de chargement au lieu de cacher toute la page.
  // Filet de sécurité : 12 s si « load » n'arrive jamais.
  var root = document.documentElement, pending = 0, loaded = false, timer = null;
  if (!root.classList || typeof window === 'undefined') return;
  root.classList.add('bd-loading'); root.setAttribute('aria-busy', 'true');
  function finish() { clearTimeout(timer); root.classList.remove('bd-loading'); root.removeAttribute('aria-busy'); }
  function check() { clearTimeout(timer); if (loaded && pending === 0) timer = setTimeout(function () { if (pending === 0) finish(); }, 150); }
  if (window.fetch) {
    var fetch0 = window.fetch;
    window.fetch = function () {
      pending++;
      var p = fetch0.apply(window, arguments), done = function () { pending = Math.max(0, pending - 1); check(); };
      p.then(done, done);
      return p;
    };
  }
  window.addEventListener('load', function () { loaded = true; check(); setTimeout(finish, 2500); });
  setTimeout(finish, 12000);
})();
