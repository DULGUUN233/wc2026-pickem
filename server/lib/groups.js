// FIFA World Cup 2026 — групп шатны өгөгдөл.
// Туг: https://flagcdn.com/w80/<code>.png
// Эх сурвалж: Wikipedia "2026 FIFA World Cup Group A-L" + FIFA.com (2025-12-05 сугалаа,
// playoff-ийн дараах эцсийн 48 баг). 2 бие даасан эх сурвалжаар тулгаж баталгаажуулсан.

export const FLAG_BASE = 'https://flagcdn.com/w80/';

// Багийн id = ISO код (давхцахгүй, тогтвортой).
export const GROUPS = {
  A: [
    { id: 'mx', name: 'Mexico', code: 'mx' },
    { id: 'za', name: 'South Africa', code: 'za' },
    { id: 'kr', name: 'Korea Republic', code: 'kr' },
    { id: 'cz', name: 'Czechia', code: 'cz' },
  ],
  B: [
    { id: 'ca', name: 'Canada', code: 'ca' },
    { id: 'ba', name: 'Bosnia & Herzegovina', code: 'ba' },
    { id: 'qa', name: 'Qatar', code: 'qa' },
    { id: 'ch', name: 'Switzerland', code: 'ch' },
  ],
  C: [
    { id: 'br', name: 'Brazil', code: 'br' },
    { id: 'ma', name: 'Morocco', code: 'ma' },
    { id: 'ht', name: 'Haiti', code: 'ht' },
    { id: 'gb-sct', name: 'Scotland', code: 'gb-sct' },
  ],
  D: [
    { id: 'us', name: 'USA', code: 'us' },
    { id: 'py', name: 'Paraguay', code: 'py' },
    { id: 'au', name: 'Australia', code: 'au' },
    { id: 'tr', name: 'Türkiye', code: 'tr' },
  ],
  E: [
    { id: 'de', name: 'Germany', code: 'de' },
    { id: 'cw', name: 'Curaçao', code: 'cw' },
    { id: 'ci', name: "Côte d'Ivoire", code: 'ci' },
    { id: 'ec', name: 'Ecuador', code: 'ec' },
  ],
  F: [
    { id: 'nl', name: 'Netherlands', code: 'nl' },
    { id: 'jp', name: 'Japan', code: 'jp' },
    { id: 'se', name: 'Sweden', code: 'se' },
    { id: 'tn', name: 'Tunisia', code: 'tn' },
  ],
  G: [
    { id: 'be', name: 'Belgium', code: 'be' },
    { id: 'eg', name: 'Egypt', code: 'eg' },
    { id: 'ir', name: 'IR Iran', code: 'ir' },
    { id: 'nz', name: 'New Zealand', code: 'nz' },
  ],
  H: [
    { id: 'es', name: 'Spain', code: 'es' },
    { id: 'cv', name: 'Cabo Verde', code: 'cv' },
    { id: 'sa', name: 'Saudi Arabia', code: 'sa' },
    { id: 'uy', name: 'Uruguay', code: 'uy' },
  ],
  I: [
    { id: 'fr', name: 'France', code: 'fr' },
    { id: 'sn', name: 'Senegal', code: 'sn' },
    { id: 'iq', name: 'Iraq', code: 'iq' },
    { id: 'no', name: 'Norway', code: 'no' },
  ],
  J: [
    { id: 'ar', name: 'Argentina', code: 'ar' },
    { id: 'dz', name: 'Algeria', code: 'dz' },
    { id: 'at', name: 'Austria', code: 'at' },
    { id: 'jo', name: 'Jordan', code: 'jo' },
  ],
  K: [
    { id: 'pt', name: 'Portugal', code: 'pt' },
    { id: 'cd', name: 'Congo DR', code: 'cd' },
    { id: 'uz', name: 'Uzbekistan', code: 'uz' },
    { id: 'co', name: 'Colombia', code: 'co' },
  ],
  L: [
    { id: 'gb-eng', name: 'England', code: 'gb-eng' },
    { id: 'hr', name: 'Croatia', code: 'hr' },
    { id: 'gh', name: 'Ghana', code: 'gh' },
    { id: 'pa', name: 'Panama', code: 'pa' },
  ],
};

export const GROUP_IDS = Object.keys(GROUPS);

export const TOURNAMENT = {
  name: 'FIFA World Cup 2026',
  startDate: '2026-06-11',
  groupStageEndDate: '2026-06-27',
};

// id -> {name, code, group}
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
