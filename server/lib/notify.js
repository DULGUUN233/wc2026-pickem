// Usion notify scheduler.
// 3 төрлийн мэдэгдэл (Usion-ийн signed REST notify endpoint-ээр):
//   1) Таамаглаагүй тоглолтод эхлэхээс 12ц ба 3ц өмнө сануулга
//   2) Тоглолт дуусаад оноо авсан (≥1) тоглогчид мэдэгдэл
//   3) Хэсгийн шат хаагдтал 12ц тутам, групп таамгаа дуусгаагүйд сануулга
// USION_API_URL / USION_SERVICE_ID / USION_NOTIFY_SECRET байхгүй бол чимээгүй идэвхгүй.
import crypto from 'node:crypto';
import { collections } from '../db.js';
import { allMatches, fetchAllResults } from './matches.js';
import { scoreMatch } from './scoring.js';
import { GROUP_IDS, TOURNAMENT } from './groups.js';

const H = 3600 * 1000;
const TICK = 5 * 60 * 1000; // 5 минут тутам шалгана

function cfg() {
  return {
    apiUrl: process.env.USION_API_URL?.trim(),
    serviceId: process.env.USION_SERVICE_ID?.trim(),
    secret: process.env.USION_NOTIFY_SECRET?.trim(),
  };
}
export function notifyEnabled() {
  const c = cfg();
  return Boolean(c.apiUrl && c.serviceId && c.secret);
}

// Usion руу нэг мэдэгдэл (signed). Алдаа гарвал false — хэзээ ч throw хийхгүй.
async function sendNotify(userId, { title, body, path }) {
  const { apiUrl, serviceId, secret } = cfg();
  const raw = JSON.stringify({ user_id: userId, title, body, ...(path ? { path } : {}) });
  const sig = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  try {
    const res = await fetch(`${apiUrl}/services/${serviceId}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Usion-Signature': sig },
      body: raw,
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Dedupe: key-г эхлээд "эзэмшээд" дараа нь явуулна. Аль хэдийн байвал алгасна.
async function notifyOnce(key, userId, payload) {
  try {
    await collections.notifications().insertOne({ key, sentAt: new Date() });
  } catch (e) {
    if (e?.code === 11000) return; // аль хэдийн явуулсан
    throw e;
  }
  await sendNotify(userId, payload);
}

export async function runTick() {
  if (!notifyEnabled()) return;
  try {
    const now = Date.now();
    const [matches, results, players, groupPicks, matchPicks] = await Promise.all([
      allMatches(),
      fetchAllResults(),
      collections.players().find({ usionId: { $exists: true, $ne: null } }, { projection: { usionId: 1 } }).toArray(),
      collections.picks().find({}).toArray(),
      collections.matchPicks().find({}).toArray(),
    ]);
    if (!players.length) return;

    const users = players.map((p) => [String(p._id), p.usionId]); // [playerId, usionId]
    const mpById = new Map(matchPicks.map((d) => [d.playerId, d.picks || {}]));
    const gpById = new Map(groupPicks.map((d) => [d.playerId, d.picks || {}]));

    // 1) Тоглолтын өмнөх сануулга (12ц / 3ц), таамаглаагүй хэрэглэгчдэд
    for (const m of matches) {
      if (m.finished || !m.ts || m.ts <= now) continue;
      const windows = [];
      if (now >= m.ts - 12 * H) windows.push(12);
      if (now >= m.ts - 3 * H) windows.push(3);
      if (!windows.length) continue;
      for (const [pid, usionId] of users) {
        if (mpById.get(pid)?.[m.id]) continue; // таамагласан бол алгасна
        for (const hrs of windows) {
          await notifyOnce(`prematch:${m.id}:${hrs}:${usionId}`, usionId, {
            title: 'Таамаг өгөөгүй байна ⏰',
            body: `${m.home} – ${m.away} тоглолт ${hrs} цагийн дараа эхэлнэ. Үр дүнг нь таамаглаарай!`,
            path: '/',
          });
        }
      }
    }

    // 2) Тоглолт дуусаад оноо авсан (≥1) тоглогчид
    for (const m of matches) {
      const r = results[m.id];
      if (!m.finished || !r?.finished) continue;
      for (const [pid, usionId] of users) {
        const pred = mpById.get(pid)?.[m.id];
        if (!pred) continue;
        const pt = scoreMatch(pred, r.h, r.a, m.date);
        if (pt < 1) continue;
        await notifyOnce(`result:${m.id}:${usionId}`, usionId, {
          title: 'Оноо нэмэгдлээ! 🎉',
          body: `${m.home} ${r.h}:${r.a} ${m.away} — та +${pt} оноо авлаа!`,
          path: '/',
        });
      }
    }

    // 3) Хэсгийн шат хаагдтал 12ц тутам, дуусгаагүй хэрэглэгчдэд
    const lock = Date.parse(process.env.PICKS_LOCK_AT?.trim() || TOURNAMENT.lockAt);
    if (Number.isFinite(lock) && now < lock) {
      const bucket = Math.floor(now / (12 * H)); // 12 цагийн период
      for (const [pid, usionId] of users) {
        const gp = gpById.get(pid) || {};
        const complete = GROUP_IDS.every((g) => Array.isArray(gp[g]) && gp[g].length === 4);
        if (complete) continue;
        await notifyOnce(`group:${bucket}:${usionId}`, usionId, {
          title: 'Хэсгийн шатын таамаг 🏆',
          body: 'Хэсгийн шат удахгүй хаагдана. 12 группийнхээ pickem-ийг хийж амжаарай!',
          path: '/',
        });
      }
    }
  } catch (e) {
    console.error('notify tick алдаа:', e);
  }
}

export function startNotifier() {
  if (!notifyEnabled()) {
    console.log('🔕 Notify идэвхгүй (USION_API_URL / USION_SERVICE_ID / USION_NOTIFY_SECRET тохируулаагүй)');
    return;
  }
  console.log('🔔 Notify scheduler аслаа (5 мин тутам)');
  setTimeout(function loop() {
    runTick().finally(() => setTimeout(loop, TICK));
  }, 15 * 1000); // эхлэхдээ 15с хүлээгээд (сервер бэлэн болтол)
}
