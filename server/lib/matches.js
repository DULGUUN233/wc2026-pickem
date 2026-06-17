// Өдөр тутмын WC2026 тоглолт.
// FOOTBALL_DATA_KEY байвал football-data.org (албан ёсны бүрэн дата),
// үгүй бол TheSportsDB (түлхүүргүй, гэхдээ дутуу байж магадгүй). 5 мин cache.
import { GROUPS, GROUP_IDS, FLAG_BASE } from './groups.js';

// Багийн нэр -> туг код
const NAME_TO_CODE = {};
for (const g of GROUP_IDS) for (const t of GROUPS[g]) NAME_TO_CODE[t.name.toLowerCase()] = t.code;
const ALIASES = {
  'iran': 'ir', 'ir iran': 'ir', 'korea': 'kr', 'south korea': 'kr', 'korea republic': 'kr',
  'usa': 'us', 'united states': 'us', 'turkey': 'tr', 'türkiye': 'tr', 'turkiye': 'tr',
  'czech republic': 'cz', 'czechia': 'cz', 'ivory coast': 'ci', "côte d'ivoire": 'ci', "cote d'ivoire": 'ci',
  'cape verde': 'cv', 'cabo verde': 'cv', 'dr congo': 'cd', 'congo dr': 'cd',
  'bosnia and herzegovina': 'ba', 'bosnia & herzegovina': 'ba', 'south africa': 'za',
  'scotland': 'gb-sct', 'england': 'gb-eng', 'saudi arabia': 'sa', 'new zealand': 'nz',
};
function flagFor(name) {
  const n = (name || '').trim().toLowerCase();
  const code = NAME_TO_CODE[n] || ALIASES[n] || null;
  return code ? `${FLAG_BASE}${code}.png` : null;
}
function num(v) {
  return v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
}

const cache = new Map(); // date -> { at, data }
const TTL = 5 * 60 * 1000;

/** Монголын цагаар өнөөдөр (YYYY-MM-DD). */
export function todayUlaanbaatar() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
/** UTC цагийг Монголын (UTC+8) HH:MM болгох. */
function hhmmUB(iso) {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16);
}
/** UTC огноог Монголын өдөр (YYYY-MM-DD) болгох. */
function dateUB(iso) {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
function shiftDateStr(date, delta) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// ---- football-data.org (албан ёсны, бүрэн) ----
async function fromFootballData(date, key) {
  // Монголын өдөр нь UTC [өмнөх 16:00 – энэ 16:00) — 2 хоногийн цонхоор татаад шүүнэ
  const res = await fetch(
    `https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${shiftDateStr(date, -1)}&dateTo=${date}`,
    { headers: { 'X-Auth-Token': key }, signal: AbortSignal.timeout(9000) }
  );
  if (!res.ok) throw new Error('football-data ' + res.status);
  const j = await res.json();
  return (j.matches || []).filter((m) => dateUB(m.utcDate) === date).map((m) => {
    const finished = m.status === 'FINISHED';
    const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
    const ft = m.score?.fullTime || {};
    return {
      id: String(m.id),
      home: m.homeTeam?.name || 'TBD',
      away: m.awayTeam?.name || 'TBD',
      homeFlag: flagFor(m.homeTeam?.name) || m.homeTeam?.crest || null,
      awayFlag: flagFor(m.awayTeam?.name) || m.awayTeam?.crest || null,
      date,
      time: hhmmUB(m.utcDate),
      status: finished ? 'FT' : live ? 'LIVE' : 'NS',
      finished,
      homeScore: finished ? num(ft.home) : null,
      awayScore: finished ? num(ft.away) : null,
    };
  });
}

// ---- TheSportsDB (түлхүүргүй fallback) ----
async function fromSportsDb(date) {
  const res = await fetch(
    `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${encodeURIComponent(date)}&s=Soccer`,
    { signal: AbortSignal.timeout(9000) }
  );
  const j = await res.json();
  return (j.events || [])
    .filter((e) => /world cup/i.test(e.strLeague || ''))
    .map((e) => {
      const finished = /^(FT|AET|PEN|Match Finished)$/i.test(e.strStatus || '');
      return {
        id: String(e.idEvent),
        home: e.strHomeTeam,
        away: e.strAwayTeam,
        homeFlag: flagFor(e.strHomeTeam),
        awayFlag: flagFor(e.strAwayTeam),
        date: e.dateEvent,
        time: (e.strTime || '').slice(0, 5),
        status: finished ? 'FT' : 'NS',
        finished,
        homeScore: finished ? num(e.intHomeScore) : null,
        awayScore: finished ? num(e.intAwayScore) : null,
      };
    });
}

/** Тухайн өдрийн WC2026 тоглолтуудыг буцаана. */
export async function fetchMatches(date) {
  const cached = cache.get(date);
  if (cached && Date.now() - cached.at < TTL) return cached.data;

  const key = process.env.FOOTBALL_DATA_KEY?.trim();
  let matches = [];
  let source = 'none';
  try {
    if (key) { matches = await fromFootballData(date, key); source = 'football-data'; }
    else { matches = await fromSportsDb(date); source = 'sportsdb'; }
  } catch (e) {
    try { matches = await fromSportsDb(date); source = `sportsdb-fallback (${e.message})`; }
    catch { if (cached) return cached.data; matches = []; source = 'error'; }
  }
  matches.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const data = { date, source, hasKey: !!key, matches };
  cache.set(date, { at: Date.now(), data });
  return data;
}
