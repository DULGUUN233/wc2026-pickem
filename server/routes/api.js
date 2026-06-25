import express from 'express';
import { ObjectId } from 'mongodb';
import { collections } from '../db.js';
import { GROUPS, GROUP_IDS, TOURNAMENT, FLAG_BASE, validateGroupOrder } from '../lib/groups.js';
import { scorePicks, scoreMatch, scoreGroup, POINTS_PER_EXACT, PERFECT_GROUP_BONUS } from '../lib/scoring.js';
import { fetchMatches, fetchAllResults, allMatches, fetchKnockout, getResultsVersion, todayUlaanbaatar } from '../lib/matches.js';
import {
  randomToken,
  leagueCode,
  normalizeNickname,
  publicPlayer,
  asyncHandler,
  HttpError,
} from '../lib/util.js';

const router = express.Router();

/* ----------------------------- туслахууд ----------------------------- */

function lockAt() {
  return process.env.PICKS_LOCK_AT?.trim() || TOURNAMENT.lockAt || '';
}
function globalLockPassed() {
  const at = lockAt();
  if (!at) return false;
  const t = Date.parse(at);
  if (Number.isNaN(t)) return false;
  return Date.now() > t;
}

async function resultsMap() {
  const docs = await collections.results().find({}).toArray();
  const map = {};
  for (const d of docs) map[d._id] = d.order;
  return map;
}

// Мөрүүдийг оноогоор эрэмбэлж rank өгнө.
function rerank(rows) {
  const out = rows.slice().sort(
    (a, b) => b.total - a.total || b.perfectGroups - a.perfectGroups || a.nickname.localeCompare(b.nickname)
  );
  out.forEach((r, i) => (r.rank = i + 1));
  return out;
}

/* ---- Онооны самбарын сервер cache (Redis маягийн in-memory) ----
   Бүх тоглогчийн оноог нэг л удаа тооцоод хадгална. Picks/matchpicks/дүн
   өөрчлөгдөхөд invalidate хийнэ; эс бөгөөс TTL дуустал маш хурдан буцаана. */
let _sb = null; // { at, byId, scoredGroups }
let _sbDirty = true;
const SB_TTL = 60 * 1000;
function invalidateScoreboard() { _sbDirty = true; }

async function getScoreboard() {
  if (_sb && !_sbDirty && _sb.rv === getResultsVersion() && Date.now() - _sb.at < SB_TTL) return _sb;
  const [results, matchResults, players, pickDocs, mpDocs] = await Promise.all([
    resultsMap(),
    fetchAllResults(),
    collections.players().find({}).toArray(),
    collections.picks().find({}).toArray(),
    collections.matchPicks().find({}).toArray(),
  ]);
  const picksBy = {}; for (const d of pickDocs) picksBy[d.playerId] = d.picks;
  const mpBy = {}; for (const d of mpDocs) mpBy[d.playerId] = d.picks;
  const byId = {};
  for (const p of players) {
    const id = String(p._id);
    const picks = picksBy[id] || {};
    const s = scorePicks(picks, results);
    let dailyPts = 0;
    const mp = mpBy[id] || {};
    for (const [mid, pred] of Object.entries(mp)) {
      const r = matchResults[mid];
      if (r && r.finished) dailyPts += scoreMatch(pred, r.h, r.a, r.date);
    }
    const completed = Object.values(picks).filter((o) => Array.isArray(o) && o.length === 4).length;
    byId[id] = { playerId: id, nickname: p.nickname, avatar: p.avatar || null, total: s.total + dailyPts, perfectGroups: s.perfectGroups, completed };
  }
  _sb = { at: Date.now(), rv: getResultsVersion(), byId, scoredGroups: Object.values(results).filter((o) => o && o.length === 4).length };
  _sbDirty = false;
  return _sb;
}

async function requirePlayer(req) {
  const token = req.get('x-wc-token');
  if (!token) throw new HttpError(401, 'Нэвтрээгүй байна');
  const player = await collections.players().findOne({ token });
  if (!player) throw new HttpError(401, 'Хүчингүй token');
  return player;
}

/* ------------------------------- auth -------------------------------- */

// Шинэ тоглогч үүсгэх (nickname авна). Returning device GET /api/me-г токеноор ашиглана.
router.post(
  '/auth',
  asyncHandler(async (req, res) => {
    const nickname = normalizeNickname(req.body?.nickname);
    if (nickname.length < 2 || nickname.length > 24) {
      throw new HttpError(400, 'Нэр 2-24 тэмдэгт байх ёстой');
    }
    const nicknameLower = nickname.toLowerCase();
    const existing = await collections.players().findOne({ nicknameLower });
    if (existing) {
      throw new HttpError(409, 'Энэ нэр аль хэдийн авагдсан байна. Өөр нэр сонгоно уу.');
    }
    const token = randomToken();
    const doc = { nickname, nicknameLower, token, createdAt: new Date() };
    const { insertedId } = await collections.players().insertOne(doc);
    invalidateScoreboard();
    res.json({ player: { id: String(insertedId), nickname }, token });
  })
);

// Usion (mini-app) identity-аар нэвтрэх — usionId-аар тоглогч олох/үүсгэх
async function uniqueNickname(base, usionId) {
  const tries = [base, `${base.slice(0, 19)} ${usionId.slice(-4)}`, `${base.slice(0, 14)} ${usionId.slice(-8)}`];
  for (const c of tries) {
    if (!(await collections.players().findOne({ nicknameLower: c.toLowerCase() }))) return c;
  }
  return `${base.slice(0, 16)} ${String(Date.now()).slice(-5)}`;
}

router.post(
  '/auth/usion',
  asyncHandler(async (req, res) => {
    const usionId = String(req.body?.usionId || '').trim();
    if (!usionId) throw new HttpError(400, 'usionId шаардлагатай');
    const existing = await collections.players().findOne({ usionId });
    if (existing) {
      // Дахин нэвтрэх үед профайл зургийг шинэчилнэ (Usion дээр өөрчлөгдсөн/шинээр гарсан бол)
      const avatar = req.body?.avatar || null;
      if (avatar && avatar !== existing.avatar) {
        await collections.players().updateOne({ _id: existing._id }, { $set: { avatar } });
        existing.avatar = avatar;
        invalidateScoreboard();
      }
      return res.json({ player: publicPlayer(existing), token: existing.token });
    }
    let base = normalizeNickname(req.body?.name) || 'Тоглогч';
    if (base.length > 24) base = base.slice(0, 24);
    if (base.length < 2) base = 'Тоглогч';
    const nickname = await uniqueNickname(base, usionId);
    const token = randomToken();
    const doc = { usionId, nickname, nicknameLower: nickname.toLowerCase(), token, avatar: req.body?.avatar || null, createdAt: new Date() };
    const { insertedId } = await collections.players().insertOne(doc);
    invalidateScoreboard();
    res.json({ player: { id: String(insertedId), nickname }, token });
  })
);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const player = await requirePlayer(req);
    const sb = await getScoreboard();
    res.json({ player: publicPlayer(player), total: sb.byId[String(player._id)]?.total || 0 });
  })
);

// Тоглогчийн нийтийн профайл + илгээсэн таамаг (leaderboard-аас дарж харна)
router.get(
  '/players/:id',
  asyncHandler(async (req, res) => {
    let player = null;
    try { player = await collections.players().findOne({ _id: new ObjectId(req.params.id) }); } catch {}
    if (!player) throw new HttpError(404, 'Тоглогч олдсонгүй');
    const pid = String(player._id);
    const [mpDoc, pickDoc, results, allMs, groupResults, sb] = await Promise.all([
      collections.matchPicks().findOne({ playerId: pid }),
      collections.picks().findOne({ playerId: pid }),
      fetchAllResults(),
      allMatches(),
      resultsMap(),
      getScoreboard(),
    ]);
    const mById = {};
    for (const m of allMs) mById[m.id] = m;

    const matches = [];
    for (const [mid, pick] of Object.entries(mpDoc?.picks || {})) {
      const m = mById[mid];
      if (!m) continue;
      const r = results[mid];
      const fin = !!r?.finished;
      matches.push({
        id: mid, home: m.home, away: m.away, homeAbbr: m.homeAbbr, awayAbbr: m.awayAbbr,
        homeFlag: m.homeFlag, awayFlag: m.awayFlag, date: m.date, time: m.time, finished: fin,
        knockout: !!m.knockout, // хэсгийн шат / хасагдах шат ялгах
        pick, homeScore: fin ? r.h : null, awayScore: fin ? r.a : null,
        points: fin ? scoreMatch(pick, r.h, r.a, m.date) : null,
      });
    }
    matches.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

    const groups = [];
    for (const [g, order] of Object.entries(pickDoc?.picks || {})) {
      if (!Array.isArray(order) || !order.length) continue;
      const actual = groupResults[g] || null;
      groups.push({ group: g, order, actual, points: actual ? scoreGroup(order, actual).points : null });
    }
    groups.sort((a, b) => a.group.localeCompare(b.group));

    // Лигийн байр (тоглогчийн орсон бүх лиг) + global байр
    const memberLeagues = await collections.leagues().find({ memberIds: pid }).toArray();
    const leagues = memberLeagues.map((l) => {
      const rows = rerank(l.memberIds.map((mid) => sb.byId[mid]).filter(Boolean));
      const mine = rows.find((r) => r.playerId === pid);
      return { name: l.name, code: l.code, myRank: mine ? mine.rank : null, memberCount: l.memberIds.length };
    });
    const globalRows = rerank(Object.values(sb.byId));
    const globalRank = globalRows.find((r) => r.playerId === pid)?.rank || null;

    res.json({
      player: { id: pid, nickname: player.nickname, avatar: player.avatar || null, total: sb.byId[pid]?.total || 0 },
      global: { rank: globalRank, total: globalRows.length },
      leagues,
      matches,
      groups,
    });
  })
);

/* ------------------------------ groups ------------------------------- */

router.get(
  '/groups',
  asyncHandler(async (req, res) => {
    const results = await resultsMap();
    res.json({
      tournament: TOURNAMENT,
      flagBase: FLAG_BASE,
      groupIds: GROUP_IDS,
      groups: GROUPS,
      results, // дууссан группүүдийн жинхэнэ эрэмбэ
      scoring: { pointsPerExact: POINTS_PER_EXACT, perfectGroupBonus: PERFECT_GROUP_BONUS },
      lock: { globalLockPassed: globalLockPassed(), lockAt: lockAt() || null },
    });
  })
);

// Өдөр тутмын тоглолт (TheSportsDB). ?date=YYYY-MM-DD, default = Монголын өнөөдөр
router.get(
  '/matches',
  asyncHandler(async (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : todayUlaanbaatar();
    res.json(await fetchMatches(date));
  })
);

// Хасагдах шат — раунд бүрээр (ESPN торны бүтэц)
router.get('/knockout', asyncHandler(async (req, res) => res.json(await fetchKnockout())));

/* ------------------------------- picks ------------------------------- */

router.get(
  '/picks',
  asyncHandler(async (req, res) => {
    const player = await requirePlayer(req);
    const doc = await collections.picks().findOne({ playerId: String(player._id) });
    res.json({ picks: doc?.picks || {} });
  })
);

router.put(
  '/picks',
  asyncHandler(async (req, res) => {
    const player = await requirePlayer(req);
    if (globalLockPassed()) throw new HttpError(423, 'Таамаг хаагдсан байна');

    const incoming = req.body?.picks;
    if (!incoming || typeof incoming !== 'object') throw new HttpError(400, 'picks буруу байна');

    const results = await resultsMap();
    const current = (await collections.picks().findOne({ playerId: String(player._id) }))?.picks || {};
    const next = { ...current };
    const skipped = [];

    for (const group of Object.keys(incoming)) {
      if (!GROUP_IDS.includes(group)) continue;
      // Жинхэнэ дүн нь гарсан групп — өөрчлөхийг хориглоно
      if (results[group]) {
        skipped.push(group);
        continue;
      }
      const order = incoming[group];
      // Хоосон/дутуу бол тухайн группийн таамгийг устгана (хадгалахгүй)
      if (order == null || (Array.isArray(order) && order.length === 0)) {
        delete next[group];
        continue;
      }
      if (!validateGroupOrder(group, order)) {
        throw new HttpError(400, `Групп ${group}-ийн эрэмбэ буруу байна`);
      }
      next[group] = order;
    }

    await collections.picks().updateOne(
      { playerId: String(player._id) },
      { $set: { playerId: String(player._id), picks: next, updatedAt: new Date() } },
      { upsert: true }
    );
    invalidateScoreboard();
    res.json({ picks: next, skipped });
  })
);

/* --------------------- Өдөр тутмын матчийн таамаг --------------------- */
router.get(
  '/matchpicks',
  asyncHandler(async (req, res) => {
    const player = await requirePlayer(req);
    const doc = await collections.matchPicks().findOne({ playerId: String(player._id) });
    res.json({ picks: doc?.picks || {} });
  })
);

router.put(
  '/matchpicks',
  asyncHandler(async (req, res) => {
    const player = await requirePlayer(req);
    const incoming = req.body?.picks;
    if (!incoming || typeof incoming !== 'object') throw new HttpError(400, 'picks буруу байна');
    const all = await allMatches();
    const byId = {}; for (const mm of all) byId[mm.id] = mm;
    const now = Date.now();
    // Тоглолт одоо таамаглаж болох эсэх: эхлээгүй БА одооноос 2 өдрөөс хол биш
    const open = (mm) => !mm || !mm.ts || (now < mm.ts && mm.ts - now <= 2 * 86400000);
    const cur = (await collections.matchPicks().findOne({ playerId: String(player._id) }))?.picks || {};
    const next = { ...cur };
    for (const [mid, p] of Object.entries(incoming)) {
      if (!mid) continue;
      if (p == null) { delete next[mid]; continue; }
      if (!open(byId[mid])) continue; // эхэлсэн / 2 өдрөөс хол тоглолтыг хүлээж авахгүй
      const h = Number(p.h), a = Number(p.a);
      if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 30 || a > 30) continue;
      next[mid] = { h, a };
    }
    await collections.matchPicks().updateOne(
      { playerId: String(player._id) },
      { $set: { playerId: String(player._id), picks: next, updatedAt: new Date() } },
      { upsert: true }
    );
    invalidateScoreboard();
    res.json({ picks: next });
  })
);

/* ------------------------------ results ------------------------------ */

router.get(
  '/results',
  asyncHandler(async (req, res) => {
    res.json({ results: await resultsMap() });
  })
);

// Admin: групп бүрийн ЖИНХЭНЭ эцсийн эрэмбэ оруулах/устгах
router.post(
  '/admin/results',
  asyncHandler(async (req, res) => {
    const { adminKey, group, order } = req.body || {};
    if (!process.env.ADMIN_KEY || adminKey !== process.env.ADMIN_KEY) {
      throw new HttpError(403, 'Admin түлхүүр буруу байна');
    }
    if (!GROUP_IDS.includes(group)) throw new HttpError(400, 'Групп буруу байна');

    if (order == null || (Array.isArray(order) && order.length === 0)) {
      await collections.results().deleteOne({ _id: group });
      invalidateScoreboard();
      return res.json({ ok: true, cleared: group });
    }
    if (!validateGroupOrder(group, order)) throw new HttpError(400, 'Эрэмбэ буруу байна');
    await collections.results().updateOne(
      { _id: group },
      { $set: { order, updatedAt: new Date() } },
      { upsert: true }
    );
    invalidateScoreboard();
    res.json({ ok: true, group });
  })
);

/* ------------------------------ leagues ------------------------------ */

router.post(
  '/leagues',
  asyncHandler(async (req, res) => {
    const player = await requirePlayer(req);
    const name = normalizeNickname(req.body?.name);
    if (name.length < 2 || name.length > 30) throw new HttpError(400, 'Лигийн нэр 2-30 тэмдэгт');

    // давхцахгүй код үүсгэх
    let code;
    for (let i = 0; i < 6; i++) {
      code = leagueCode();
      if (!(await collections.leagues().findOne({ code }))) break;
    }
    const doc = {
      name,
      code,
      ownerId: String(player._id),
      memberIds: [String(player._id)],
      createdAt: new Date(),
    };
    const { insertedId } = await collections.leagues().insertOne(doc);
    res.json({ league: { id: String(insertedId), name, code, memberCount: 1, owner: true } });
  })
);

router.post(
  '/leagues/join',
  asyncHandler(async (req, res) => {
    const player = await requirePlayer(req);
    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!code) throw new HttpError(400, 'Код оруулна уу');
    const league = await collections.leagues().findOne({ code });
    if (!league) throw new HttpError(404, 'Ийм кодтой лиг олдсонгүй');
    await collections.leagues().updateOne(
      { _id: league._id },
      { $addToSet: { memberIds: String(player._id) } }
    );
    const memberCount = new Set([...league.memberIds, String(player._id)]).size;
    res.json({
      league: {
        id: String(league._id),
        name: league.name,
        code: league.code,
        memberCount,
        owner: league.ownerId === String(player._id),
      },
    });
  })
);

router.get(
  '/leagues',
  asyncHandler(async (req, res) => {
    const player = await requirePlayer(req);
    const pid = String(player._id);
    const sb = await getScoreboard();
    const leagues = await collections.leagues().find({ memberIds: pid }).toArray();
    const out = leagues.map((l) => {
      const rows = rerank(l.memberIds.map((id) => sb.byId[id]).filter(Boolean));
      const mine = rows.find((r) => r.playerId === pid);
      return {
        id: String(l._id),
        name: l.name,
        code: l.code,
        memberCount: l.memberIds.length,
        owner: l.ownerId === pid,
        myRank: mine ? mine.rank : null,
        myTotal: mine ? mine.total : 0,
      };
    });
    const allRows = rerank(Object.values(sb.byId));
    const myGlobal = allRows.find((r) => r.playerId === pid);
    res.json({ leagues: out, global: { myRank: myGlobal ? myGlobal.rank : null, total: allRows.length } });
  })
);

/* ---------------------------- leaderboard ---------------------------- */

router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const code = String(req.query.league || '').trim().toUpperCase();
    const sb = await getScoreboard();

    let leagueInfo = null;
    let rows;
    if (code) {
      const league = await collections.leagues().findOne({ code });
      if (!league) throw new HttpError(404, 'Лиг олдсонгүй');
      leagueInfo = { name: league.name, code: league.code, memberCount: league.memberIds.length };
      rows = rerank(league.memberIds.map((id) => sb.byId[id]).filter(Boolean));
    } else {
      rows = rerank(Object.values(sb.byId));
    }

    res.json({
      league: leagueInfo,
      scoredGroups: sb.scoredGroups,
      totalGroups: GROUP_IDS.length,
      players: rows,
    });
  })
);

export default router;
