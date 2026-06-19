/**
 * Оноо тооцох дүрэм:
 * Групп бүрийн БҮТЭН ЭРЭМБЭ (1-4) таана. Багийг яг зөв байранд нь таавал тус бүр 1 оноо.
 *   - Групп бүрт дээд тал нь 4 оноо.
 *   - 12 групп => нийт дээд тал нь 48 оноо.
 * Бүх 4 байрыг зөв таавал тухайн групп "төгс" (perfect) гэж тооцно (tiebreak / харуулахад).
 *
 * POINTS_PER_EXACT-ийг өөрчилж онооны жинг тааруулж болно.
 */
export const POINTS_PER_EXACT = 1;
export const PERFECT_GROUP_BONUS = 0; // төгс группэд нэмэлт оноо өгөх бол > 0 болго

/**
 * Нэг группын оноог тооцно.
 * @param {string[]} pick   таамагласан эрэмбэ (4 багийн id, 1->4)
 * @param {string[]} actual жинхэнэ эрэмбэ (4 багийн id, 1->4)
 * @returns {{points:number, correct:number, perfect:boolean}}
 */
export function scoreGroup(pick, actual) {
  if (!Array.isArray(pick) || !Array.isArray(actual)) {
    return { points: 0, correct: 0, perfect: false };
  }
  let correct = 0;
  for (let i = 0; i < actual.length; i++) {
    if (pick[i] && actual[i] && pick[i] === actual[i]) correct++;
  }
  const perfect = actual.length === 4 && correct === 4;
  const points = correct * POINTS_PER_EXACT + (perfect ? PERFECT_GROUP_BONUS : 0);
  return { points, correct, perfect };
}

/* ----------------------- Өдөр тутмын матчийн оноо ----------------------- */
export const MATCH_EXACT = 2; // яг дүн зөв (EXACT_BONUS_FROM-аас өмнөх тоглолт)
export const MATCH_EXACT_NEW = 3; // яг дүн зөв (EXACT_BONUS_FROM-аас хойших тоглолт)
export const EXACT_BONUS_FROM = '2026-06-19'; // энэ өдрөөс (оруулаад) яг таамаг 3 оноо
export const MATCH_OUTCOME = 1; // үр дүн (ялагч/тэнцэх) зөв, дүн буруу

const sign = (x, y) => (x > y ? 1 : x < y ? -1 : 0);
// Тоглолтын огноогоор яг таамгийн оноог буцаана (огноо YYYY-MM-DD).
const exactPoints = (date) => (date && date >= EXACT_BONUS_FROM ? MATCH_EXACT_NEW : MATCH_EXACT);

/**
 * Нэг матчийн таамгийг бодит дүнтэй тулгаж оноо өгнө.
 * @param {{h:number,a:number}} pred  таамагласан дүн
 * @param {number} h бодит гэрийн оноо
 * @param {number} a бодит зочны оноо
 * @param {string} [date] тоглолтын огноо (YYYY-MM-DD). EXACT_BONUS_FROM-аас хойш бол яг таамаг 3 оноо.
 */
export function scoreMatch(pred, h, a, date) {
  if (!pred || pred.h == null || pred.a == null || h == null || a == null) return 0;
  if (pred.h === h && pred.a === a) return exactPoints(date);
  return sign(pred.h, pred.a) === sign(h, a) ? MATCH_OUTCOME : 0;
}

/**
 * Тоглогчийн нийт оноог бүх группээр тооцно.
 * @param {Object<string,string[]>} picks   { A:[...], B:[...], ... }
 * @param {Object<string,string[]>} results { A:[...], ... } (зөвхөн дууссан группүүд)
 * @returns {{total:number, perfectGroups:number, scoredGroups:number, perGroup:Object}}
 */
export function scorePicks(picks = {}, results = {}) {
  let total = 0;
  let perfectGroups = 0;
  let scoredGroups = 0;
  const perGroup = {};
  for (const group of Object.keys(results)) {
    const actual = results[group];
    if (!actual || actual.length < 4) continue; // групп дуусаагүй бол тооцохгүй
    scoredGroups++;
    const s = scoreGroup(picks[group] || [], actual);
    perGroup[group] = s;
    total += s.points;
    if (s.perfect) perfectGroups++;
  }
  return { total, perfectGroups, scoredGroups, perGroup };
}
