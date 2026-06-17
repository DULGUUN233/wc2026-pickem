// Өдөр тутмын WC2026 тоглолтыг TheSportsDB-ээс татна (түлхүүргүй free API).
// Rate limit-ээс сэргийлж 5 минут cache хийнэ.
import { GROUPS, GROUP_IDS, FLAG_BASE } from './groups.js';

// Багийн нэр -> туг код. GROUPS-аас + TheSportsDB-ийн өөр нэрсийн alias.
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

const cache = new Map(); // date -> { at, data }
const TTL = 5 * 60 * 1000;

function num(v) {
  return v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null;
}

/** Монголын цагаар өнөөдрийн огноо (YYYY-MM-DD). */
export function todayUlaanbaatar() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Тухайн өдрийн WC2026 тоглолтуудыг буцаана. */
export async function fetchMatches(date) {
  const cached = cache.get(date);
  if (cached && Date.now() - cached.at < TTL) return cached.data;

  const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${encodeURIComponent(date)}&s=Soccer`;
  let events = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const j = await res.json();
    events = (j.events || []).filter((e) => /world cup/i.test(e.strLeague || ''));
  } catch {
    if (cached) return cached.data; // алдвал хуучин cache
    events = [];
  }

  const matches = events
    .map((e) => {
      const finished = /^(FT|AET|PEN|Match Finished)$/i.test(e.strStatus || '');
      return {
        id: e.idEvent,
        home: e.strHomeTeam,
        away: e.strAwayTeam,
        homeFlag: flagFor(e.strHomeTeam),
        awayFlag: flagFor(e.strAwayTeam),
        date: e.dateEvent,
        time: (e.strTime || '').slice(0, 5),
        status: e.strStatus || '',
        finished,
        homeScore: finished ? num(e.intHomeScore) : null,
        awayScore: finished ? num(e.intAwayScore) : null,
      };
    })
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const data = { date, matches };
  cache.set(date, { at: Date.now(), data });
  return data;
}
