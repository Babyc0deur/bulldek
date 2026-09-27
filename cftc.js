// Champs demandés à la CFTC et compaction des rapports (Legacy, TFF, Disaggregated).
// Isolé du serveur pour pouvoir être testé sans réseau.
const n = v => (v == null || v === '' ? 0 : +v);

// Champs demandés à la CFTC. Le dernier rapport est gardé en détail, l'historique est compacté.
const LEGACY_FIELDS = ['report_date_as_yyyy_mm_dd', 'open_interest_all',
  'comm_positions_long_all', 'comm_positions_short_all', 'noncomm_positions_long_all', 'noncomm_positions_short_all', 'noncomm_postions_spread_all',
  'nonrept_positions_long_all', 'nonrept_positions_short_all', 'tot_rept_positions_long_all', 'tot_rept_positions_short',
  'change_in_comm_long_all', 'change_in_comm_short_all', 'change_in_noncomm_long_all', 'change_in_noncomm_short_all', 'change_in_noncomm_spead_all',
  'change_in_tot_rept_long_all', 'change_in_tot_rept_short', 'change_in_nonrept_long_all', 'change_in_nonrept_short_all',
  'pct_of_oi_comm_long_all', 'pct_of_oi_comm_short_all', 'pct_of_oi_noncomm_long_all', 'pct_of_oi_noncomm_short_all', 'pct_of_oi_noncomm_spread',
  'pct_of_oi_tot_rept_long_all', 'pct_of_oi_tot_rept_short', 'pct_of_oi_nonrept_long_all', 'pct_of_oi_nonrept_short_all',
  'traders_comm_long_all', 'traders_comm_short_all', 'traders_noncomm_long_all', 'traders_noncomm_short_all', 'traders_noncomm_spread_all',
  'traders_tot_rept_long_all', 'traders_tot_rept_short_all', 'contract_units'];
const TFF_FIELDS = ['report_date_as_yyyy_mm_dd', 'open_interest_all',
  'dealer_positions_long_all', 'dealer_positions_short_all', 'dealer_positions_spread_all',
  'asset_mgr_positions_long', 'asset_mgr_positions_short', 'asset_mgr_positions_spread',
  'lev_money_positions_long', 'lev_money_positions_short', 'lev_money_positions_spread',
  'other_rept_positions_long', 'other_rept_positions_short', 'other_rept_positions_spread',
  'nonrept_positions_long_all', 'nonrept_positions_short_all',
  'change_in_dealer_long_all', 'change_in_dealer_short_all', 'change_in_dealer_spread_all',
  'change_in_asset_mgr_long', 'change_in_asset_mgr_short', 'change_in_asset_mgr_spread',
  'change_in_lev_money_long', 'change_in_lev_money_short', 'change_in_lev_money_spread',
  'change_in_other_rept_long', 'change_in_other_rept_short', 'change_in_other_rept_spread',
  'change_in_nonrept_long_all', 'change_in_nonrept_short_all',
  'pct_of_oi_dealer_long_all', 'pct_of_oi_dealer_short_all', 'pct_of_oi_dealer_spread_all',
  'pct_of_oi_asset_mgr_long', 'pct_of_oi_asset_mgr_short', 'pct_of_oi_asset_mgr_spread',
  'pct_of_oi_lev_money_long', 'pct_of_oi_lev_money_short', 'pct_of_oi_lev_money_spread',
  'pct_of_oi_other_rept_long', 'pct_of_oi_other_rept_short', 'pct_of_oi_other_rept_spread',
  'pct_of_oi_nonrept_long_all', 'pct_of_oi_nonrept_short_all',
  'traders_dealer_long_all', 'traders_dealer_short_all', 'traders_dealer_spread_all',
  'traders_asset_mgr_long_all', 'traders_asset_mgr_short_all', 'traders_asset_mgr_spread',
  'traders_lev_money_long_all', 'traders_lev_money_short_all', 'traders_lev_money_spread',
  'traders_other_rept_long_all', 'traders_other_rept_short', 'traders_other_rept_spread'];

// Rapport Disaggregated (matières premières) : producteurs/négociants, swap dealers, managed money, autres.
// Attention : la CFTC écrit « swap__positions_short_all » avec un double tiret bas ; « other_rept » n'a pas de suffixe _all pour les traders short/spread.
const DISAGG_FIELDS = ['report_date_as_yyyy_mm_dd', 'open_interest_all', 'contract_units',
  'prod_merc_positions_long', 'prod_merc_positions_short',
  'swap_positions_long_all', 'swap__positions_short_all', 'swap__positions_spread_all',
  'm_money_positions_long_all', 'm_money_positions_short_all', 'm_money_positions_spread',
  'other_rept_positions_long', 'other_rept_positions_short', 'other_rept_positions_spread',
  'nonrept_positions_long_all', 'nonrept_positions_short_all',
  'change_in_prod_merc_long', 'change_in_prod_merc_short', 'change_in_swap_long_all', 'change_in_swap_short_all', 'change_in_swap_spread_all',
  'change_in_m_money_long_all', 'change_in_m_money_short_all', 'change_in_m_money_spread',
  'change_in_other_rept_long', 'change_in_other_rept_short', 'change_in_other_rept_spread',
  'change_in_nonrept_long_all', 'change_in_nonrept_short_all',
  'pct_of_oi_prod_merc_long', 'pct_of_oi_prod_merc_short', 'pct_of_oi_swap_long_all', 'pct_of_oi_swap_short_all', 'pct_of_oi_swap_spread_all',
  'pct_of_oi_m_money_long_all', 'pct_of_oi_m_money_short_all', 'pct_of_oi_m_money_spread',
  'pct_of_oi_other_rept_long', 'pct_of_oi_other_rept_short', 'pct_of_oi_other_rept_spread',
  'pct_of_oi_nonrept_long_all', 'pct_of_oi_nonrept_short_all',
  'traders_prod_merc_long_all', 'traders_prod_merc_short_all', 'traders_swap_long_all', 'traders_swap_short_all', 'traders_swap_spread_all',
  'traders_m_money_long_all', 'traders_m_money_short_all', 'traders_m_money_spread_all',
  'traders_other_rept_long_all', 'traders_other_rept_short', 'traders_other_rept_spread'];

// Chaque fonction reçoit les lignes de l'API (de la plus récente à la plus ancienne) et renvoie l'historique
// du plus ancien au plus récent, sous forme de tableaux compacts [date, ...positions].
// [date, commerciaux L, S, grands spéculateurs L, S, petits traders L, S, open interest]
function compactLegacy(rows) {
  return rows.slice().reverse().map(r => [r.report_date_as_yyyy_mm_dd.slice(0, 10),
    n(r.comm_positions_long_all), n(r.comm_positions_short_all), n(r.noncomm_positions_long_all), n(r.noncomm_positions_short_all),
    n(r.nonrept_positions_long_all), n(r.nonrept_positions_short_all), n(r.open_interest_all)]);
}

// [date, dealers L, S, asset managers L, S, fonds à effet de levier L, S, autres L, S, non déclarants L, S]
function compactTff(rows) {
  return rows.slice().reverse().map(r => [r.report_date_as_yyyy_mm_dd.slice(0, 10),
    n(r.dealer_positions_long_all), n(r.dealer_positions_short_all), n(r.asset_mgr_positions_long), n(r.asset_mgr_positions_short),
    n(r.lev_money_positions_long), n(r.lev_money_positions_short), n(r.other_rept_positions_long), n(r.other_rept_positions_short),
    n(r.nonrept_positions_long_all), n(r.nonrept_positions_short_all)]);
}

// [date, producteurs L, S, swap dealers L, S, managed money L, S, autres L, S, non déclarants L, S]
function compactDisagg(rows) {
  return rows.slice().reverse().map(r => [r.report_date_as_yyyy_mm_dd.slice(0, 10),
    n(r.prod_merc_positions_long), n(r.prod_merc_positions_short), n(r.swap_positions_long_all), n(r.swap__positions_short_all),
    n(r.m_money_positions_long_all), n(r.m_money_positions_short_all), n(r.other_rept_positions_long), n(r.other_rept_positions_short),
    n(r.nonrept_positions_long_all), n(r.nonrept_positions_short_all)]);
}

module.exports = { LEGACY_FIELDS, TFF_FIELDS, DISAGG_FIELDS, compactLegacy, compactTff, compactDisagg };
