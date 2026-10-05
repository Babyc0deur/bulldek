# BullDesk

Tableau de bord des marchés à terme : **saisonnalité**, **Williams %R** (14 jours) et **positionnement COT** (CFTC) sur 37 marchés, avec un **screener**, une **comparaison de deux marchés** et une page de **méthodologie**.

Application Node.js **sans aucune dépendance** (`package.json` n'en déclare pas). Information éducative, pas un conseil en investissement.

Dépôt : [github.com/Babyc0deur/bulldek](https://github.com/Babyc0deur/bulldek)

## Démarrer

```bash
npm start            # http://localhost:8123
npm test             # toute la suite (≈ 180 tests, quelques secondes)
npm run check:release   # contrôle avant mise en ligne
```

Prérequis : **Node 22.13 ou plus** (SQLite intégré `node:sqlite`). Sur une version plus ancienne, le serveur se replie automatiquement sur un fichier JSON.

Au premier démarrage, le serveur télécharge les données (1 à 2 minutes) : les pages peuvent afficher « données indisponibles » pendant ce temps.

## Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | `8123` | Port d'écoute |
| `DATA_DIR` | `./data` | Dossier de la base (`bulldesk.db`) |
| `REFRESH_HOURS` | `6` | Fréquence de mise à jour des prix hebdomadaires et du COT |
| `TRUST_PROXY` | `0` | Nombre de proxys de confiance devant le serveur (**1 sur Render**). À 0, `X-Forwarded-For` est ignoré ; derrière un proxy, tous les visiteurs partageraient un même compteur de limite de débit |
| `RATE_API` / `RATE_WEB` | `120` / `300` | Requêtes par minute et par visiteur (`/api/*` / pages et fichiers). `/health` n'est jamais limité |
| `RATE_WINDOW_MS` | `60000` | Fenêtre du limiteur |
| `STORE` | *(auto)* | `json` force le repli sur un fichier JSON |
| `FMP_API_KEY` | *(vide)* | Clé gratuite [Financial Modeling Prep](https://site.financialmodelingprep.com/) : ajoute le **chiffre publié** des annonces économiques (sinon prévision et précédent seulement, via Forex Factory) |
| `QUIET` | *(vide)* | `1` réduit le journal du serveur aux échecs et alertes (par défaut : rafraîchissements, sources macro et requêtes, sans jamais écrire d'adresse IP) |
| `NO_REFRESH` | *(vide)* | `1` désactive la mise à jour automatique (tests, démonstration hors ligne) |

## Pages et API

| Adresse | Contenu |
|---|---|
| `/market/<marché>` | Fiche : saisonnalité, Williams %R, COT (Legacy, TFF ou Disaggregated), confluence, fraîcheur |
| `/screener` | Les 37 marchés : COT Index, Williams %R, saisonnalité, confluence |
| `/compare?a=…&b=…` | Signaux, performance relative, corrélation, COT de deux marchés |
| `/fiabilite` | Fiabilité des signaux : historique rejoué semaine par semaine, performance à 5, 10 et 20 séances selon la confluence et chaque signal, significativité, stabilité |
| `/intermarket` | Analyse intermarchés : matrice de corrélations (20 séances à tout l'historique) entre 12 marchés, relations classiques lues par rapport à la théorie, changements de régime |
| `/inflation`, `/taux` | Inflation (CPI) et taux d'intérêt de 19 zones, comparés deux à deux (OCDE) |
| `/a-propos` | Méthodologie (valeurs injectées depuis le code), limites connues et vie privée |
| `/api/cot`, `/api/tff`, `/api/disagg`, `/api/daily`, `/api/prices`, `/api/seasonal` `?code=…` | Données par marché |
| `/api/macro?kind=cpi|rates`, `/api/calendar`, `/api/debrief?slug=…` | Inflation et taux, annonces économiques, debrief du jour d'un marché |
| `/api/ratios` | Six ratios intermarchés (actions/obligations, Nasdaq/S&P, Nasdaq/Dow, S&P/dollar, S&P/pétrole, cuivre/obligations) : série complète, variation, position sur 1 an, lecture |
| `/api/intermarket` | Corrélations croisées calculées sur les séances quotidiennes en cache (mémorisées 5 min, aucun appel externe) |
| `/api/yields` | Rendements, courbe, taux réel, VIX et VIX 3 mois (FRED) |
| `/api/reliability` | Fiabilité des signaux pour les 37 marchés (calcul mémorisé tant que prix et COT ne changent pas) |
| `/api/volatility`, `/api/keydates` | Volatilité des actions (VIX, structure, volatilité réalisée) ; dates clés des 6 prochains mois (FOMC, CPI, emploi, échéances et roll) |
| `/api/screener`, `/api/status[?code=…]`, `/health` | Synthèse, fraîcheur, sonde de supervision |

## Architecture

```
server.js      HTTP, mise à jour automatique, API, protections (CSP, limite de débit, ETag, gzip)
store.js       persistance : SQLite ligne par ligne, repli JSON, migration de l'ancien cache.json
guard.js       limiteur de débit, adresse du client, regroupement des appels aux sources
cftc.js        champs demandés à la CFTC et compaction des rapports
adjust.js      ajustement des changements de contrat des indices (comparaison à l'indice au comptant)
reliability.js rejeu historique des signaux et statistiques de fiabilité
vol.js         volatilité (VIX, structure, volatilité réalisée) ; keydates.js : dates clés (FOMC, CPI, emploi, échéances)
dailymerge.js  mise à jour incrémentale des prix quotidiens
calc.js        TOUTES les formules et tous les seuils (THRESHOLDS) : COT Index, Williams %R,
               saisonnalité, signaux, calendrier de publication du COT, corrélation…
freshness.js   règles « données à jour / à vérifier / indisponibles »
shared.js/css  briques communes (en-tête, graphiques sur canvas, pastilles)
market.js cot.js seasonal.js wr.js screener.js compare.js    affichage des pages
markets.json   les 37 marchés (généré par tools/build-markets.js)
```

`calc.js` est chargé à la fois par le serveur et par le navigateur : une formule n'existe qu'à un seul endroit.

## Sources de données

- **CFTC** (API publique Socrata) : rapports Legacy, TFF et Disaggregated, futures uniquement. Publiés le vendredi à 15h30 heure de New York, décalés d'un jour ouvré par un jour férié fédéral (règle vérifiée sur les 52 dates de 2026).
- **FRED** (CSV public sans clé, une requête par série, 6 h de cache) : rendements américains 2, 5, 10 et 30 ans, courbe, taux réel, inflation anticipée, VIX, inflation PCE (et son indice cœur), indice dollar (DXY).
- **OCDE** (SDMX public, limite d'appels stricte : une requête groupée par jeu, 24 h de cache) : inflation et taux. **Forex Factory** (flux JSON public non officiel) : calendrier des annonces, à remplacer par une source sous licence pour un usage public.
- **Yahoo Finance** (accès non officiel) : futures continus, quotidiens (tout l'historique disponible, jusqu'à 25 ans ; le Dow Jones est limité à 20 ans pour la saisonnalité) et hebdomadaires (10 ans).

## Tests

`npm test` couvre les formules, la correspondance des champs CFTC (avec un contrôle en ligne du schéma), le serveur de bout en bout, la sécurité, l'accessibilité et l'affichage des pages dans un faux DOM (`tools/fake-dom.js`).

Deux outils vérifient la qualité des tests eux-mêmes :

```bash
sh tools/mutate.sh calc.js test/thresholds.test.js "description" 's/cotBuy: 80,/cotBuy: 75,/'   # injecte un bug, vérifie qu'un test échoue
sh tools/mutations.sh        # 7 bugs de sécurité connus contre test/server.test.js
sh tools/attack-demo.sh      # rejoue des requêtes hostiles contre un serveur local
sh tools/check.sh            # vérification rapide d'un serveur lancé (santé, gzip, ETag, screener)
```

Les résultats de référence de la saisonnalité (`test/fixtures/nq-seasonal-golden.json`) proviennent de l'ancien calcul exécuté sur 20 ans de séances du Nasdaq (`tools/capture-seasonal-golden.js`). **Ne les régénérer que si le calcul doit volontairement changer.**

CI : `.github/workflows/ci.yml` lance les tests sur Node 22 et 24 ; le lundi, il vérifie aussi que l'API de la CFTC n'a pas changé de schéma.

## Déployer sur Render

1. Mettre le dossier dans un dépôt Git, puis **New → Blueprint** sur Render : `render.yaml` fait le reste (Node 22, `TRUST_PROXY=1`, limites).
2. Lancer `npm run check:release` : il vérifie `render.yaml` (`TRUST_PROXY`, `NODE_VERSION`).
3. Sur l'offre gratuite, le disque est éphémère : le cache est reconstitué à chaque redémarrage (1 à 2 minutes). Un disque persistant (variable `DATA_DIR`) l'évite.

## Limites connues et points ouverts

- **Source de prix** : Yahoo n'est pas une source officielle. Vérifier ses conditions d'usage avant un site public ; prévoir une source sous licence.
- **Futures continus non ajustés** : un changement de contrat crée un saut (détecté au-delà de 10 % en une séance : Williams %R marqué non fiable). Les courbes de saisonnalité conservent l'effet d'un saut isolé.
- **Signaux non validés** : les seuils (COT 80/20, Williams %R −80/−20, 60 % d'années) sont des conventions, pas des résultats d'un test rétrospectif.
- **Mentions légales** : le site n'en publie plus. Un site public en France doit en principe afficher l'identité de son éditeur et de son hébergeur (article 6 de la LCEN) : à trancher avant une mise en ligne.
- **Limite de débit** : par adresse et en mémoire (remise à zéro au redémarrage, non partagée entre instances) ; ne remplace pas une protection en amont contre une attaque distribuée.
