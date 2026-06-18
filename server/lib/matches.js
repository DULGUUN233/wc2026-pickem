// WC2026 тоглолтын дата.
// FOOTBALL_DATA_KEY байвал бүх WC матчийг НЭГ дуудлагаар татаад огноогоор бүлэглэж cache хийнэ
// (ямар ч өдөр шууд гарна). Түлхүүргүй бол TheSportsDB (per-date) руу буцна. 90с SWR cache.
import { GROUPS, GROUP_IDS, FLAG_BASE } from './groups.js';

// Багийн нэр -> туг код / FIFA товчлол
const NAME_TO_CODE = {};
const CODE_TO_ABBR = {};
for (const g of GROUP_IDS) for (const t of GROUPS[g]) { NAME_TO_CODE[t.name.toLowerCase()] = t.code; CODE_TO_ABBR[t.code] = t.abbr; }
const ALIASES = {
  'iran': 'ir', 'ir iran': 'ir', 'korea': 'kr', 'south korea': 'kr', 'korea republic': 'kr',
  'usa': 'us', 'united states': 'us', 'turkey': 'tr', 'türkiye': 'tr', 'turkiye': 'tr',
  'czech republic': 'cz', 'czechia': 'cz', 'ivory coast': 'ci', "côte d'ivoire": 'ci', "cote d'ivoire": 'ci',
  'cape verde': 'cv', 'cabo verde': 'cv', 'dr congo': 'cd', 'congo dr': 'cd',
  'bosnia and herzegovina': 'ba', 'bosnia & herzegovina': 'ba', 'south africa': 'za',
  'scotland': 'gb-sct', 'england': 'gb-eng', 'saudi arabia': 'sa', 'new zealand': 'nz',
};
const codeOf = (name) => NAME_TO_CODE[(name || '').trim().toLowerCase()] || ALIASES[(name || '').trim().toLowerCase()] || null;
const flagFor = (name) => { const c = codeOf(name); return c ? `${FLAG_BASE}${c}.png` : null; };
const abbrFor = (name) => { const c = codeOf(name); return (c && CODE_TO_ABBR[c]) || (name || '').slice(0, 3).toUpperCase(); };
const num = (v) => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : null);

const TTL = 90 * 1000;

export function todayUlaanbaatar() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
const hhmmUB = (iso) => new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(11, 16);
const dateUB = (iso) => new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

/* ---- football-data.org: бүх WC матчийг нэг дуудлагаар, огноогоор бүлэглэж cache ---- */
function mapFD(m) {
  const ft = m.score?.fullTime || {};
  const ts = Date.parse(m.utcDate) || 0; // эхлэх цаг (epoch ms)
  const hasScore = ft.home != null && ft.away != null;
  // football-data заримдаа дууссан матчийг IN_PLAY-д ГАЦААДАГ. Тиймээс:
  // status FINISHED, ЭСВЭЛ дүнтэй бөгөөд эхэлснээс 3 цаг өнгөрсөн бол дууссан гэж үзнэ.
  const finished = m.status === 'FINISHED' || (hasScore && ts > 0 && Date.now() >= ts + 3 * 3600 * 1000);
  const live = !finished && (m.status === 'IN_PLAY' || m.status === 'PAUSED');
  return {
    id: String(m.id),
    home: m.homeTeam?.name || 'TBD',
    away: m.awayTeam?.name || 'TBD',
    homeAbbr: abbrFor(m.homeTeam?.name),
    awayAbbr: abbrFor(m.awayTeam?.name),
    homeFlag: flagFor(m.homeTeam?.name) || m.homeTeam?.crest || null,
    awayFlag: flagFor(m.awayTeam?.name) || m.awayTeam?.crest || null,
    date: dateUB(m.utcDate),
    time: hhmmUB(m.utcDate),
    ts,
    status: finished ? 'FT' : live ? 'LIVE' : 'NS',
    finished,
    homeScore: finished ? num(ft.home) : null,
    awayScore: finished ? num(ft.away) : null,
  };
}

let _all = null; // { at, byDate, results }
let _allRefreshing = false;
let _resultsVersion = 0; // дүн өөрчлөгдөх бүрт нэмэгдэнэ (scoreboard дахин тооцоход)
export function getResultsVersion() { return _resultsVersion; }

async function refreshAll() {
  const key = process.env.FOOTBALL_DATA_KEY?.trim();
  if (!key) return;
  try {
    const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': key },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return;
    const j = await res.json();
    const byDate = {};
    const results = {};
    for (const m of j.matches || []) {
      const mm = mapFD(m);
      (byDate[mm.date] = byDate[mm.date] || []).push(mm);
      results[mm.id] = { finished: mm.finished, h: mm.homeScore, a: mm.awayScore };
    }
    for (const d in byDate) byDate[d].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    const changed = !_all || JSON.stringify(results) !== JSON.stringify(_all.results);
    _all = { at: Date.now(), byDate, results };
    if (changed) _resultsVersion++;
  } catch {}
}
async function ensureAll() {
  const fresh = _all && Date.now() - _all.at < TTL;
  if (_all && !fresh && !_allRefreshing) {
    _allRefreshing = true;
    refreshAll().finally(() => { _allRefreshing = false; });
  }
  if (!_all) await refreshAll(); // эхний удаа л блоклоно
  return _all;
}

// Background polling: live үед 30с, өнөөдөр тоглолттой бол 60с, эс бөгөөс 5 мин
function nextPollDelay() {
  if (!_all) return 30 * 1000;
  const now = Date.now();
  const RESULT_WINDOW = 95 * 60 * 1000; // эхэлснээс 95 мин-ийн дараа дүн хүлээж эхэлнэ
  let awaiting = false;        // 95 мин болсон ч дуусаагүй тоглолт байна уу
  let nextWindow = Infinity;   // дараагийн window хэзээ нээгдэх
  for (const d in _all.byDate) {
    for (const m of _all.byDate[d]) {
      if (m.finished || !m.ts) continue;
      const start = m.ts + RESULT_WINDOW;
      if (now >= start) awaiting = true;
      else nextWindow = Math.min(nextWindow, start);
    }
  }
  if (awaiting) return 30 * 1000; // дүн ирэх хүртэл 30с тутам
  if (nextWindow !== Infinity) return Math.max(30 * 1000, Math.min(nextWindow - now, 30 * 60 * 1000));
  return 30 * 60 * 1000; // ойрын тоглолтгүй
}
export function startPolling() {
  if (!process.env.FOOTBALL_DATA_KEY?.trim()) return; // түлхүүргүй бол утгагүй
  const tick = async () => {
    try { await refreshAll(); } catch {}
    setTimeout(tick, nextPollDelay());
  };
  tick();
}

/* ---- TheSportsDB fallback (түлхүүргүй үед, per-date) ---- */
const _sdb = new Map();
async function fromSportsDb(date) {
  const c = _sdb.get(date);
  if (c && Date.now() - c.at < TTL) return c.matches;
  const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${encodeURIComponent(date)}&s=Soccer`, { signal: AbortSignal.timeout(9000) });
  const j = await res.json();
  const matches = (j.events || [])
    .filter((e) => /world cup/i.test(e.strLeague || ''))
    .map((e) => {
      const finished = /^(FT|AET|PEN|Match Finished)$/i.test(e.strStatus || '');
      return {
        id: String(e.idEvent), home: e.strHomeTeam, away: e.strAwayTeam,
        homeAbbr: abbrFor(e.strHomeTeam), awayAbbr: abbrFor(e.strAwayTeam),
        homeFlag: flagFor(e.strHomeTeam), awayFlag: flagFor(e.strAwayTeam),
        date: e.dateEvent, time: (e.strTime || '').slice(0, 5),
        ts: Date.parse(e.strTimestamp || `${e.dateEvent}T${e.strTime || '00:00:00'}Z`) || 0,
        status: finished ? 'FT' : 'NS', finished,
        homeScore: finished ? num(e.intHomeScore) : null, awayScore: finished ? num(e.intAwayScore) : null,
      };
    })
    .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  _sdb.set(date, { at: Date.now(), matches });
  return matches;
}

/** Тухайн өдрийн тоглолтууд. */
export async function fetchMatches(date) {
  const key = process.env.FOOTBALL_DATA_KEY?.trim();
  if (key) {
    const all = await ensureAll();
    if (all) return { date, source: 'football-data', hasKey: true, matches: all.byDate[date] || [] };
  }
  try { return { date, source: 'sportsdb', hasKey: false, matches: await fromSportsDb(date) }; }
  catch { return { date, source: 'error', hasKey: false, matches: [] }; }
}

/** Бүх матчийн эцсийн дүн { id: {finished, h, a} } (оноо тооцоход). */
export async function fetchAllResults() {
  const key = process.env.FOOTBALL_DATA_KEY?.trim();
  if (key) { const all = await ensureAll(); if (all) return all.results; }
  return {};
}

/** Бүх матчийг нэг хавтгай жагсаалтаар (notify scheduler-д). */
export async function allMatches() {
  const all = await ensureAll();
  return all ? Object.values(all.byDate).flat() : [];
}
