// FIFA World Cup 2026 — групп шатны өгөгдөл.
// Туг: https://flagcdn.com/w80/<code>.png
// Эх сурвалж: Wikipedia "2026 FIFA World Cup Group A-L" + FIFA.com (2025-12-05 сугалаа,
// playoff-ийн дараах эцсийн 48 баг). 2 бие даасан эх сурвалжаар тулгаж баталгаажуулсан.

export const FLAG_BASE = 'https://flagcdn.com/w80/';

// Багийн id = ISO код (давхцахгүй, тогтвортой). abbr = FIFA 3-үсэгт код.
export const GROUPS = {
  A: [
    { id: 'mx', name: 'Mexico', code: 'mx', abbr: 'MEX' },
    { id: 'za', name: 'South Africa', code: 'za', abbr: 'RSA' },
    { id: 'kr', name: 'Korea Republic', code: 'kr', abbr: 'KOR' },
    { id: 'cz', name: 'Czechia', code: 'cz', abbr: 'CZE' },
  ],
  B: [
    { id: 'ca', name: 'Canada', code: 'ca', abbr: 'CAN' },
    { id: 'ba', name: 'Bosnia & Herzegovina', code: 'ba', abbr: 'BIH' },
    { id: 'qa', name: 'Qatar', code: 'qa', abbr: 'QAT' },
    { id: 'ch', name: 'Switzerland', code: 'ch', abbr: 'SUI' },
  ],
  C: [
    { id: 'br', name: 'Brazil', code: 'br', abbr: 'BRA' },
    { id: 'ma', name: 'Morocco', code: 'ma', abbr: 'MAR' },
    { id: 'ht', name: 'Haiti', code: 'ht', abbr: 'HAI' },
    { id: 'gb-sct', name: 'Scotland', code: 'gb-sct', abbr: 'SCO' },
  ],
  D: [
    { id: 'us', name: 'USA', code: 'us', abbr: 'USA' },
    { id: 'py', name: 'Paraguay', code: 'py', abbr: 'PAR' },
    { id: 'au', name: 'Australia', code: 'au', abbr: 'AUS' },
    { id: 'tr', name: 'Türkiye', code: 'tr', abbr: 'TUR' },
  ],
  E: [
    { id: 'de', name: 'Germany', code: 'de', abbr: 'GER' },
    { id: 'cw', name: 'Curaçao', code: 'cw', abbr: 'CUW' },
    { id: 'ci', name: "Côte d'Ivoire", code: 'ci', abbr: 'CIV' },
    { id: 'ec', name: 'Ecuador', code: 'ec', abbr: 'ECU' },
  ],
  F: [
    { id: 'nl', name: 'Netherlands', code: 'nl', abbr: 'NED' },
    { id: 'jp', name: 'Japan', code: 'jp', abbr: 'JPN' },
    { id: 'se', name: 'Sweden', code: 'se', abbr: 'SWE' },
    { id: 'tn', name: 'Tunisia', code: 'tn', abbr: 'TUN' },
  ],
  G: [
    { id: 'be', name: 'Belgium', code: 'be', abbr: 'BEL' },
    { id: 'eg', name: 'Egypt', code: 'eg', abbr: 'EGY' },
    { id: 'ir', name: 'IR Iran', code: 'ir', abbr: 'IRN' },
    { id: 'nz', name: 'New Zealand', code: 'nz', abbr: 'NZL' },
  ],
  H: [
    { id: 'es', name: 'Spain', code: 'es', abbr: 'ESP' },
    { id: 'cv', name: 'Cabo Verde', code: 'cv', abbr: 'CPV' },
    { id: 'sa', name: 'Saudi Arabia', code: 'sa', abbr: 'KSA' },
    { id: 'uy', name: 'Uruguay', code: 'uy', abbr: 'URU' },
  ],
  I: [
    { id: 'fr', name: 'France', code: 'fr', abbr: 'FRA' },
    { id: 'sn', name: 'Senegal', code: 'sn', abbr: 'SEN' },
    { id: 'iq', name: 'Iraq', code: 'iq', abbr: 'IRQ' },
    { id: 'no', name: 'Norway', code: 'no', abbr: 'NOR' },
  ],
  J: [
    { id: 'ar', name: 'Argentina', code: 'ar', abbr: 'ARG' },
    { id: 'dz', name: 'Algeria', code: 'dz', abbr: 'ALG' },
    { id: 'at', name: 'Austria', code: 'at', abbr: 'AUT' },
    { id: 'jo', name: 'Jordan', code: 'jo', abbr: 'JOR' },
  ],
  K: [
    { id: 'pt', name: 'Portugal', code: 'pt', abbr: 'POR' },
    { id: 'cd', name: 'Congo DR', code: 'cd', abbr: 'COD' },
    { id: 'uz', name: 'Uzbekistan', code: 'uz', abbr: 'UZB' },
    { id: 'co', name: 'Colombia', code: 'co', abbr: 'COL' },
  ],
  L: [
    { id: 'gb-eng', name: 'England', code: 'gb-eng', abbr: 'ENG' },
    { id: 'hr', name: 'Croatia', code: 'hr', abbr: 'CRO' },
    { id: 'gh', name: 'Ghana', code: 'gh', abbr: 'GHA' },
    { id: 'pa', name: 'Panama', code: 'pa', abbr: 'PAN' },
  ],
};

export const GROUP_IDS = Object.keys(GROUPS);

export const TOURNAMENT = {
  name: 'FIFA World Cup 2026',
  startDate: '2026-06-11',
  groupStageEndDate: '2026-06-27',
  // Таамаг хаагдах хугацаа (Монголын цаг, UTC+8). PICKS_LOCK_AT env-ээр дарж болно.
  lockAt: '2026-06-21T12:00:00+08:00',
};

// id -> {name, code, abbr, group}
export const TEAM_INDEX = (() => {
  const idx = {};
  for (const g of GROUP_IDS) {
    for (const t of GROUPS[g]) idx[t.id] = { ...t, group: g };
  }
  return idx;
})();

/** Тухайн групп дотор зөвхөн зөв id-ууд, давхцалгүй, бүрэн (4) эсэхийг шалгана. */
export function validateGroupOrder(group, order) {
  const teams = GROUPS[group];
  if (!teams) return false;
  if (!Array.isArray(order) || order.length !== 4) return false;
  const valid = new Set(teams.map((t) => t.id));
  const seen = new Set();
  for (const id of order) {
    if (!valid.has(id) || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}
