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
  'cape verde': 'cv', 'cabo verde': 'cv', 'cape verde islands': 'cv', 'dr congo': 'cd', 'congo dr': 'cd',
  'bosnia and herzegovina': 'ba', 'bosnia & herzegovina': 'ba', 'bosnia-herzegovina': 'ba', 'south africa': 'za',
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
  // football-data заримдаа дууссан матчийг IN_PLAY-д ГАЦААДАГ. Тиймээс status FINISHED,
  // ЭСВЭЛ дүнтэй бөгөөд тоглолт дуусах хугацаа өнгөрсөн бол дууссан гэж үзнэ.
  // Групп шат нэмэлт цаггүй (2ц30м), хожлын тор нэмэлт цаг/пенальтитай (3ц).
  const knockout = m.stage && m.stage !== 'GROUP_STAGE';
  const overMs = (knockout ? 3 : 2.5) * 3600 * 1000;
  const finished = m.status === 'FINISHED' || (hasScore && ts > 0 && Date.now() >= ts + overMs);
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
    knockout: !!knockout, // GROUP_STAGE биш бол хасагдах шат
    homeScore: finished ? num(ft.home) : null,
    awayScore: finished ? num(ft.away) : null,
  };
}

let _all = null; // { at, byDate, results }
let _allRefreshing = false;
let _resultsVersion = 0; // дүн өөрчлөгдөх бүрт нэмэгдэнэ (scoreboard дахин тооцоход)
export function getResultsVersion() { return _resultsVersion; }

// Баг+огнооны түлхүүр (football-data ба ESPN-ийг тулгахад)
const matchKey = (homeName, awayName, date) => `${codeOf(homeName) || (homeName || '').toLowerCase()}|${codeOf(awayName) || (awayName || '').toLowerCase()}|${date}`;

// ESPN-ээс ДУУССАН тоглолтуудыг авна (найдвартай 'post' статус, түлхүүргүй).
// { matchKey: {h, a} } буцаана. football-data-ийн гацсан статусыг түргэн засахад.
async function fetchEspnFinished() {
  try {
    const res = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260601-20260720',
      { signal: AbortSignal.timeout(9000) }
    );
    if (!res.ok) return null;
    const j = await res.json();
    const map = new Map();
    for (const e of j.events || []) {
      if (e.status?.type?.state !== 'post') continue; // зөвхөн дууссан
      const cs = e.competitions?.[0]?.competitors || [];
      const home = cs.find((c) => c.homeAway === 'home');
      const away = cs.find((c) => c.homeAway === 'away');
      if (!home || !away) continue;
      map.set(matchKey(home.team?.displayName, away.team?.displayName, dateUB(e.date)), {
        h: num(home.score),
        a: num(away.score),
      });
    }
    return map;
  } catch {
    return null;
  }
}

async function refreshAll() {
  const key = process.env.FOOTBALL_DATA_KEY?.trim();
  if (!key) return;
  let fdMatches;
  try {
    const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': key },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return;
    const j = await res.json();
    fdMatches = (j.matches || []).map(mapFD);
  } catch {
    return;
  }

  // ESPN-ийн найдвартай "дууссан + дүн"-ийг давхарлана (football-data IN_PLAY-д гацсаныг түргэн засна)
  const espn = await fetchEspnFinished();
  if (espn) {
    for (const mm of fdMatches) {
      if (mm.finished) continue;
      const e = espn.get(matchKey(mm.home, mm.away, mm.date));
      if (e && e.h != null && e.a != null) {
        mm.finished = true;
        mm.status = 'FT';
        mm.homeScore = e.h;
        mm.awayScore = e.a;
      }
    }
  }

  const byDate = {};
  const results = {};
  for (const mm of fdMatches) {
    (byDate[mm.date] = byDate[mm.date] || []).push(mm);
    results[mm.id] = { finished: mm.finished, h: mm.homeScore, a: mm.awayScore, date: mm.date };
  }
  for (const d in byDate) byDate[d].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  const changed = !_all || JSON.stringify(results) !== JSON.stringify(_all.results);
  _all = { at: Date.now(), byDate, results };
  if (changed) _resultsVersion++;
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
export function startPolling(onChange) {
  if (!process.env.FOOTBALL_DATA_KEY?.trim()) return; // түлхүүргүй бол утгагүй
  const tick = async () => {
    const before = _resultsVersion;
    try { await refreshAll(); } catch {}
    // тоглолтын дүн өөрчлөгдсөн (матч дууссан / оноо шинэчлэгдсэн) бол дуудна
    if (onChange && _resultsVersion !== before) { try { await onChange(); } catch {} }
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

/* ---- Хасагдах шат (ESPN, раунд бүрээр) ---- */
const KO_ORDER = ['round-of-32', 'round-of-16', 'quarterfinals', 'semifinals', '3rd-place-match', 'final'];
const KO_NAME = {
  'round-of-32': 'Round of 32', 'round-of-16': '1/8 финал', 'quarterfinals': '1/4 финал',
  'semifinals': 'Хагас финал', '3rd-place-match': '3-р байрын тоглолт', 'final': 'Финал',
};
function mapKO(e) {
  const cs = e.competitions?.[0]?.competitors || [];
  const home = cs.find((c) => c.homeAway === 'home') || cs[0] || {};
  const away = cs.find((c) => c.homeAway === 'away') || cs[1] || {};
  const ht = home.team || {}, at = away.team || {};
  const state = e.status?.type?.state;
  const finished = state === 'post';
  return {
    id: String(e.id),
    home: ht.displayName || '?', away: at.displayName || '?',
    homeAbbr: ht.abbreviation || '?', awayAbbr: at.abbreviation || '?',
    homeFlag: ht.logo ? (flagFor(ht.displayName) || ht.logo) : null,
    awayFlag: at.logo ? (flagFor(at.displayName) || at.logo) : null,
    date: dateUB(e.date), time: hhmmUB(e.date),
    status: finished ? 'FT' : state === 'in' ? 'LIVE' : 'NS', finished,
    homeScore: finished ? num(home.score) : null, awayScore: finished ? num(away.score) : null,
  };
}
let _ko = null;
let _koRefreshing = false;
async function refreshKO() {
  try {
    const res = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260628-20260720',
      { signal: AbortSignal.timeout(9000) }
    );
    if (!res.ok) return;
    const j = await res.json();
    const byRound = {};
    for (const e of j.events || []) {
      const slug = e.season?.slug;
      if (!KO_NAME[slug]) continue;
      (byRound[slug] = byRound[slug] || []).push(mapKO(e));
    }
    const rounds = KO_ORDER.filter((s) => byRound[s]).map((s) => ({
      slug: s, name: KO_NAME[s],
      matches: byRound[s].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
    }));
    _ko = { at: Date.now(), rounds };
  } catch {}
}
export async function fetchKnockout() {
  const fresh = _ko && Date.now() - _ko.at < TTL;
  if (_ko && !fresh && !_koRefreshing) { _koRefreshing = true; refreshKO().finally(() => { _koRefreshing = false; }); }
  if (!_ko) await refreshKO();
  return { rounds: _ko ? _ko.rounds : [] };
}

/* ---- ESPN-ээс групп шатны ДУУССАН эрэмбэ (бүх баг 3 тоглосон) ---- */
// → { A: ['mx','za','kr','cz'], ... } зөвхөн бүрэн дууссан БА цэвэр map хийгдсэн группүүд.
export async function fetchGroupStandings() {
  try {
    const res = await fetch(
      'https://site.api.espn.com/apis/v2/sports/soccer/fifa.world/standings',
      { signal: AbortSignal.timeout(9000) }
    );
    if (!res.ok) return {};
    const j = await res.json();
    const out = {};
    for (const ch of j.children || []) {
      const letter = (ch.name || '').replace(/^group\s+/i, '').trim().toUpperCase(); // "Group A" → "A"
      if (!GROUP_IDS.includes(letter)) continue;
      const entries = ch.standings?.entries || [];
      if (entries.length !== 4) continue;
      const stat = (e, n) => { const x = (e.stats || []).find((s) => s.name === n || s.type === n); return x ? x.value : undefined; };
      const rows = entries.map((e) => ({
        name: e.team?.displayName || e.team?.name,
        rank: Number(stat(e, 'rank')),
        gp: Number(stat(e, 'gamesPlayed')),
      }));
      if (!rows.every((r) => r.gp >= 3)) continue; // бүх баг 3 тоглоогүй → групп дуусаагүй
      if (!rows.every((r) => r.rank >= 1 && r.rank <= 4)) continue;
      rows.sort((a, b) => a.rank - b.rank);
      const ids = rows.map((r) => codeOf(r.name));
      const groupIds = new Set(GROUPS[letter].map((t) => t.id));
      if (ids.some((id) => !id || !groupIds.has(id))) continue; // нэр map хийгдсэнгүй → бүхэлд нь алгасна
      if (new Set(ids).size !== 4) continue; // давхцал → алгасна
      out[letter] = ids;
    }
    return out;
  } catch { return {}; }
}

/* ---- Хасагдах шатны bracket (ESPN) — self-propagating pickem-д ---- */
// Тогтмол мод (ESPN-ийн placeholder-оос баталгаажсан): утга = өмнөх раундын матчийн дугаар (1-based).
export const BRACKET_TREE = {
  R16: [[1, 3], [2, 5], [4, 6], [7, 8], [11, 12], [9, 10], [13, 15], [14, 16]],
  QF: [[1, 2], [5, 6], [3, 4], [7, 8]],
  SF: [[1, 2], [3, 4]],
  F: [[1, 2]],
};

function koWinner(e) {
  if (e?.status?.type?.state !== 'post') return null; // дуусаагүй
  const cs = e.competitions?.[0]?.competitors || [];
  const w = cs.find((x) => x.winner) || cs.slice().sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))[0];
  return w ? codeOf(w.team?.displayName) : null;
}

let _br = null;
let _brRefreshing = false;
async function refreshBracket() {
  let evs = [];
  try {
    const res = await fetch(
      'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard?dates=20260628-20260720',
      { signal: AbortSignal.timeout(9000) }
    );
    if (!res.ok) return;
    const j = await res.json();
    evs = j.events || [];
  } catch { return; }
  const round = (slug) => evs.filter((e) => e.season?.slug === slug).sort((a, b) => (+a.id) - (+b.id));
  const r32 = round('round-of-32');
  if (r32.length !== 16) return; // бүтэц бэлэн биш
  const r16 = round('round-of-16'), qf = round('quarterfinals'), sf = round('semifinals'), fin = round('final');

  const cmp = (e, idx) => e.competitions?.[0]?.competitors?.[idx]?.team || {};
  const teamId = (e, idx) => codeOf(cmp(e, idx).displayName); // map хийгдвэл id, эс бол null
  const slot = (e, idx) => { const id = teamId(e, idx); return id ? { id } : { id: null, label: cmp(e, idx).abbreviation || 'TBD' }; };
  const r32slots = r32.map((e) => ({ a: slot(e, 0).id, b: slot(e, 1).id, aLabel: slot(e, 0).label, bLabel: slot(e, 1).label }));
  const ready = r32slots.every((s) => s.a && s.b); // бүх 32 баг тодорхой болсон уу

  const winners = {}, meta = {}; // бодит ялагчид (оноо) + матч бүрийн огноо/цаг
  const fill = (list, key) => list.forEach((e, i) => {
    winners[`${key}-${i + 1}`] = koWinner(e);
    meta[`${key}-${i + 1}`] = { date: dateUB(e.date), time: hhmmUB(e.date) };
  });
  fill(r32, 'R32'); fill(r16, 'R16'); fill(qf, 'QF'); fill(sf, 'SF'); fill(fin, 'F');

  const startTs = Math.min(...r32.map((e) => Date.parse(e?.date) || Infinity)); // R32 эхлэх (lock)
  _br = { at: Date.now(), ready, startTs: Number.isFinite(startTs) ? startTs : 0, r32: r32slots, winners, meta };
}

export async function fetchBracket() {
  const fresh = _br && Date.now() - _br.at < TTL;
  if (_br && !fresh && !_brRefreshing) { _brRefreshing = true; refreshBracket().finally(() => { _brRefreshing = false; }); }
  if (!_br) await refreshBracket();
  return _br ? { ready: _br.ready, startTs: _br.startTs, r32: _br.r32, winners: _br.winners, meta: _br.meta, tree: BRACKET_TREE } : null;
}

// ТЕСТ: TBD R32 слотуудыг тогтмол mock багаар дүүргэж ready болгоно (зөвхөн тест тоглогчдод;
// бодит багууд групп дуусахад орлоно). Cached bracket-ийг өөрчлөхгүй — хуулбар буцаана.
export function bracketTestFill(b) {
  if (!b || b.ready) return b;
  const pool = GROUP_IDS.flatMap((g) => GROUPS[g].map((t) => t.id));
  const used = new Set(b.r32.flatMap((s) => [s.a, s.b]).filter(Boolean));
  let pi = 0; const next = () => { while (used.has(pool[pi])) pi++; used.add(pool[pi]); return pool[pi++]; };
  const r32 = b.r32.map((s) => ({ a: s.a || next(), b: s.b || next() }));
  return { ...b, r32, ready: true };
}
