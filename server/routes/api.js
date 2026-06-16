import express from 'express';
import { ObjectId } from 'mongodb';
import { collections } from '../db.js';
import { GROUPS, GROUP_IDS, TOURNAMENT, FLAG_BASE, validateGroupOrder } from '../lib/groups.js';
import { scorePicks, POINTS_PER_EXACT, PERFECT_GROUP_BONUS } from '../lib/scoring.js';
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

// Тоглогчдыг оноогоор эрэмбэлж rank өгнө.
async function rankPlayers(players, results) {
  const pickDocs = await collections
    .picks()
    .find({ playerId: { $in: players.map((p) => String(p._id)) } })
    .toArray();
  const byPlayer = {};
  for (const d of pickDocs) byPlayer[d.playerId] = d.picks;
  const rows = players.map((p) => {
    const picks = byPlayer[String(p._id)] || {};
    const s = scorePicks(picks, results);
    const completed = Object.values(picks).filter((o) => Array.isArray(o) && o.length === 4).length;
    return { playerId: String(p._id), nickname: p.nickname, total: s.total, perfectGroups: s.perfectGroups, completed };
  });
  rows.sort((a, b) => b.total - a.total || b.perfectGroups - a.perfectGroups || a.nickname.localeCompare(b.nickname));
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
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
    res.json({ player: { id: String(insertedId), nickname }, token });
  })
);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    const player = await requirePlayer(req);
    res.json({ player: publicPlayer(player) });
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
    res.json({ picks: next, skipped });
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
      return res.json({ ok: true, cleared: group });
    }
    if (!validateGroupOrder(group, order)) throw new HttpError(400, 'Эрэмбэ буруу байна');
    await collections.results().updateOne(
      { _id: group },
      { $set: { order, updatedAt: new Date() } },
      { upsert: true }
    );
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
    const results = await resultsMap();
    const leagues = await collections.leagues().find({ memberIds: pid }).toArray();
    const out = [];
    for (const l of leagues) {
      const members = await collections
        .players()
        .find({ _id: { $in: l.memberIds.map((id) => new ObjectId(id)) } })
        .toArray();
      const rows = await rankPlayers(members, results);
      const mine = rows.find((r) => r.playerId === pid);
      out.push({
        id: String(l._id),
        name: l.name,
        code: l.code,
        memberCount: l.memberIds.length,
        owner: l.ownerId === pid,
        myRank: mine ? mine.rank : null,
        myTotal: mine ? mine.total : 0,
      });
    }
    res.json({ leagues: out });
  })
);

/* ---------------------------- leaderboard ---------------------------- */

router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const code = String(req.query.league || '').trim().toUpperCase();
    const results = await resultsMap();

    let playerFilter = {};
    let leagueInfo = null;
    if (code) {
      const league = await collections.leagues().findOne({ code });
      if (!league) throw new HttpError(404, 'Лиг олдсонгүй');
      playerFilter = { _id: { $in: league.memberIds.map((id) => new ObjectId(id)) } };
      leagueInfo = { name: league.name, code: league.code, memberCount: league.memberIds.length };
    }

    const players = await collections.players().find(playerFilter).toArray();
    const rows = await rankPlayers(players, results);

    res.json({
      league: leagueInfo,
      scoredGroups: Object.values(results).filter((o) => o && o.length === 4).length,
      totalGroups: GROUP_IDS.length,
      players: rows,
    });
  })
);

export default router;
