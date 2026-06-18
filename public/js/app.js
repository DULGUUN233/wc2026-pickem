import { api, getToken, setToken } from './api.js';

/* ============================ STATE ============================ */
const state = {
  player: null,
  cfg: null,
  picks: {}, // { A:[id,...] } 0-4 урт; бүрэн = 4
  savedPicks: {},
  myLeagues: [],
  dailyDate: null,
  dailyMatches: [],
  matchPicks: {},
  matchPicksSaved: {},
};

const $ = (s) => document.querySelector(s);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const draftKey = () => `wc2026:draft:${state.player?.id || 'anon'}`;
const QUAL = ['q-adv', 'q-adv', 'q-play', 'q-out'];

const ICON = {
  grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.45"/><circle cx="9" cy="12" r="1.45"/><circle cx="9" cy="18" r="1.45"/><circle cx="15" cy="6" r="1.45"/><circle cx="15" cy="12" r="1.45"/><circle cx="15" cy="18" r="1.45"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
};

/* ============================ HELPERS ============================ */
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2600);
}
const flagSrc = (code) => `${state.cfg.flagBase}${code}.png`;
const teamsOf = (g) => state.cfg.groups[g];
const teamById = (g, id) => state.cfg.groups[g].find((t) => t.id === id);
const isLocked = (g) => !!state.cfg.results[g] || state.cfg.lock.globalLockPassed;
const placedOf = (g) => state.picks[g] || [];
const isComplete = (g) => placedOf(g).length === 4;
function saveDraft() { try { localStorage.setItem(draftKey(), JSON.stringify(state.picks)); } catch {} }
function loadDraft() { try { return JSON.parse(localStorage.getItem(draftKey()) || '{}'); } catch { return {}; } }

/* ============================ INIT ============================ */
async function init() {
  try { state.cfg = await api.groups(); }
  catch { toast('Серверт холбогдож чадсангүй', 'err'); return; }

  wire();

  // Нэвтрэлт ба өдрийн дата татахыг ЗЭРЭГ — анхны ачаалал хурдан
  const matchesPrefetch = api.matches('').catch(() => null); // server cache-ийг халаана
  const authP = (async () => {
    await tryUsionLogin(); // Usion дотор бол identity платформоос
    if (!state.player && getToken()) { // standalone: хадгалсан сесс сэргээх
      try { state.player = (await api.me()).player; } catch { setToken(''); }
    }
    if (state.player) await afterLogin();
  })();
  await Promise.all([authP, matchesPrefetch]);

  renderPredict();
  movePill(false);
  await loadDaily(); // cache халсан тул хурдан

  // Usion-гүй, сессгүй бол нэр асууна
  if (!state.player) openNameModal();
}

// Usion SDK байвал init хүлээж, userId-аар нэвтэрнэ. Host-гүй бол чимээгүй буцна.
function tryUsionLogin() {
  return new Promise((resolve) => {
    const U = window.Usion;
    if (!U || typeof U.init !== 'function') return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, 1500);
    U.init(async () => {
      clearTimeout(timer);
      try {
        const uid = U.user?.getId?.() || U.config?.userId;
        const uname = U.user?.getName?.() || U.config?.userName || 'Тоглогч';
        const avatar = U.user?.getAvatar?.() || U.config?.userAvatar || null;
        if (uid) {
          const { player, token } = await api.usionAuth(uid, uname, avatar);
          setToken(token);
          state.player = player;
          if (avatar) state.player.avatar = avatar; // chip-д профайл зураг харуулахад
        }
      } catch { /* алдвал nickname горимд унана */ }
      finish();
    });
  });
}

async function afterLogin() {
  showPlayerChip();
  state.matchPicksLoaded = false;
  try { state.savedPicks = (await api.getPicks()).picks || {}; } catch { state.savedPicks = {}; }
  state.picks = { ...state.savedPicks, ...loadDraft() };
}

function showPlayerChip() {
  $('#playerChip').hidden = false;
  $('#playerName').textContent = '…';
  refreshScore();
}
async function refreshScore() {
  if (!state.player) return;
  try { const { total } = await api.me(); $('#playerName').textContent = `${total ?? 0} оноо`; } catch {}
}

/* ============================ NAME ============================ */
function openNameModal() { $('#nameModal').hidden = false; setTimeout(() => $('#nameInput').focus(), 120); }
async function submitName() {
  const nickname = $('#nameInput').value.trim();
  const errEl = $('#nameError'); errEl.hidden = true;
  if (nickname.length < 2) { errEl.textContent = 'Дор хаяж 2 тэмдэгт оруул'; errEl.hidden = false; return; }
  try {
    const { player, token } = await api.auth(nickname);
    setToken(token); state.player = player;
    $('#nameModal').hidden = true;
    await afterLogin(); renderPredict();
    toast(`Тавтай морил, ${player.nickname}!`, 'ok');
  } catch (e) { errEl.textContent = e.message; errEl.hidden = false; }
}

/* ============================ PREDICT ============================ */
function renderPredict() {
  const wrap = $('#groups');
  wrap.innerHTML = '';
  for (const g of state.cfg.groupIds) wrap.appendChild(groupCard(g));
  renderDeadline();
}

function renderDeadline() {
  const elD = $('#deadline');
  const at = state.cfg.lock.lockAt;
  if (!at) { elD.hidden = true; return; }
  elD.hidden = false;
  const t = Date.parse(at);
  clearInterval(renderDeadline._iv);
  const tick = () => {
    const diff = t - Date.now();
    if (diff <= 0) { elD.className = 'deadline closed'; elD.textContent = '🔒 Таамаг хаагдсан'; clearInterval(renderDeadline._iv); return; }
    const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), m = Math.floor((diff % 3600000) / 60000);
    const dt = new Date(t);
    const ds = `${dt.getMonth() + 1}-р сарын ${dt.getDate()}, ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    elD.className = 'deadline';
    elD.innerHTML = `⏳ Хаагдахад <b>${d}ө ${h}ц ${m}м</b> үлдлээ · ${ds}`;
  };
  tick();
  renderDeadline._iv = setInterval(tick, 1000);
}

function tagInfo(g) {
  if (state.cfg.results[g]) return { cls: 'done', text: 'Дүн гарсан' };
  if (state.cfg.lock.globalLockPassed) return { cls: 'locked', text: 'Хаагдсан' };
  const n = placedOf(g).length;
  if (n === 4) return { cls: '', text: '' };
  if (n > 0) return { cls: 'edited', text: `${n}/4` };
  return { cls: '', text: '' };
}

function groupCard(g) {
  const teams = teamsOf(g);
  const actual = state.cfg.results[g];
  const locked = isLocked(g);
  const placed = placedOf(g);
  const complete = placed.length === 4;
  const realPick = state.savedPicks[g];

  const card = el('div', 'gcard');
  card.dataset.card = g;
  const ti = tagInfo(g);
  const chipsActive = !locked && !complete;

  const chips = teams.map((t) => {
    const used = placed.includes(t.id);
    return `<button class="chip${used ? ' used' : ''}" data-chip="${t.id}" ${chipsActive ? '' : 'disabled'}>
      <img src="${flagSrc(t.code)}" alt="" onerror="this.style.display='none'">${t.abbr || t.name.slice(0, 3).toUpperCase()}</button>`;
  }).join('');

  let rows = '';
  for (let i = 0; i < 4; i++) {
    const id = actual ? actual[i] : placed[i];
    if (id) {
      const t = teamById(g, id);
      let mark = '', right = '';
      if (locked) {
        if (actual && realPick) { const ok = realPick[i] === id; mark = ok ? ' correct' : ' wrong'; right = `<span class="mark">${ok ? ICON.check : ICON.x}</span>`; }
      } else if (complete) {
        right = `<span class="grip" aria-label="чирэх">${ICON.grip}</span>`;
      }
      rows += `<li class="rrow ${QUAL[i]}${mark}" data-team="${id}">
        <span class="num">${i + 1}</span>
        <img class="flag" src="${flagSrc(t.code)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
        <span class="tname">${t.name}</span>${right}</li>`;
    } else {
      rows += `<li class="rrow empty"><span class="num">${i + 1}</span><span class="ph">—</span></li>`;
    }
  }

  card.innerHTML = `
    <div class="gcard-head"><div class="gname">Групп <span>${g}</span></div>
      <span class="gtag ${ti.cls}" ${ti.text ? '' : 'hidden'}>${ti.text}</span></div>
    <div class="chips">${chips}</div>
    <ul class="ranklist" data-group="${g}">${rows}</ul>`;

  if (chipsActive) {
    card.querySelectorAll('.chip[data-chip]').forEach((c) => c.addEventListener('click', () => tapChip(g, c.dataset.chip)));
  }
  if (complete && !locked) {
    const ul = card.querySelector('.ranklist');
    new window.Sortable(ul, {
      handle: '.grip', animation: 160, forceFallback: true, fallbackTolerance: 4,
      ghostClass: 'sortable-ghost', chosenClass: 'sortable-chosen', dragClass: 'sortable-drag',
      onEnd: () => onReorder(g, ul),
    });
  }
  return card;
}

function tapChip(g, id) {
  if (isLocked(g)) return;
  const p = [...placedOf(g)];
  const i = p.indexOf(id);
  if (i >= 0) {
    p.splice(i, 1); // буцааж авах
  } else {
    p.push(id);
    if (p.length === 3) { const rem = teamsOf(g).find((t) => !p.includes(t.id)); if (rem) p.push(rem.id); } // 3 сонгоход 4 дэх нь авто
  }
  state.picks[g] = p;
  saveDraft();
  rerenderCard(g);
  autoSave();
}

function rerenderCard(g) {
  const old = $(`#groups [data-card="${g}"]`);
  if (old) old.replaceWith(groupCard(g));
}

function onReorder(g, ul) {
  state.picks[g] = [...ul.children].map((li) => li.dataset.team);
  [...ul.children].forEach((li, i) => { li.className = 'rrow ' + QUAL[i]; li.querySelector('.num').textContent = i + 1; });
  saveDraft();
  autoSave();
}

let _saveTimer;
function autoSave() {
  if (!state.player || state.cfg.lock.globalLockPassed) return;
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    const payload = {};
    for (const g of state.cfg.groupIds) if (!isLocked(g) && placedOf(g).length === 4) payload[g] = state.picks[g];
    if (!Object.keys(payload).length) return;
    try { const { picks } = await api.savePicks(payload); state.savedPicks = picks; }
    catch (e) { toast(e.message, 'err'); }
  }, 700);
}

/* ============================ DAILY (matches) ============================ */
function shiftDate(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const days = ['Ням', 'Дав', 'Мяг', 'Лха', 'Пүр', 'Баа', 'Бям'];
  return `${d.getUTCMonth() + 1}-р сар ${d.getUTCDate()}, ${days[d.getUTCDay()]}`;
}
function canPredict(m) {
  if (m.finished) return false;
  if (m.ts) return Date.now() < m.ts; // эхлэх цагт таамаг хаагдана
  return /^(ns|not started|tbd|sched|scheduled|)$/i.test((m.status || '').trim());
}
function scoreMatchClient(p, h, a) {
  if (!p || p.h == null || p.a == null || h == null || a == null) return 0;
  if (p.h === h && p.a === a) return 2;
  const sg = (x, y) => (x > y ? 1 : x < y ? -1 : 0);
  return sg(p.h, p.a) === sg(h, a) ? 1 : 0;
}

async function loadDaily(date) {
  const wrap = $('#matches');
  if (!(state.dailyMatches || []).length) wrap.innerHTML = '<div class="empty">Уншиж байна…</div>';
  // matchpicks-ийг сесст нэг л удаа татна; тоглолттой зэрэг (parallel)
  const needPicks = state.player && !state.matchPicksLoaded;
  const [data, picksRes] = await Promise.all([
    api.matches(date || '').catch((e) => ({ _err: e })),
    needPicks ? api.getMatchPicks().catch(() => null) : Promise.resolve(null),
  ]);
  if (needPicks) {
    state.matchPicksLoaded = true;
    const p = picksRes?.picks || {};
    state.matchPicks = { ...p };
    state.matchPicksSaved = { ...p };
  }
  if (data?._err) { wrap.innerHTML = `<div class="empty">${data._err.message}</div>`; return; }
  const ms = data.matches || [];
  const sig = JSON.stringify(ms.map((m) => [m.id, m.status, m.homeScore, m.awayScore, m.ts]));
  const sameView = data.date === state.dailyDate && sig === state._dailySig;
  state.dailyDate = data.date;
  state.dailyMatches = ms;
  state._dailySig = sig;
  if (!sameView) renderDaily(); // өгөгдөл хэвээр бол дахин зурахгүй (лого анивчихгүй)
}

function renderDaily() {
  $('#dayLabel').textContent = state.dailyDate ? fmtDate(state.dailyDate) : '—';
  const wrap = $('#matches');
  const ms = state.dailyMatches;
  if (!ms.length) { wrap.innerHTML = '<div class="empty">Энэ өдөр World Cup тоглолт алга.</div>'; return; }
  wrap.innerHTML = '';
  for (const m of ms) wrap.appendChild(matchCard(m));
}

function flagImg(src) {
  return src ? `<img src="${src}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span style="width:30px;display:inline-block"></span>';
}
function stepperHtml(side, val) {
  return `<div class="stepper"><span class="val" data-side="${side}">${val == null ? '?' : val}</span><div class="sbtns"><button data-side="${side}" data-delta="-1">−</button><button data-side="${side}" data-delta="1">+</button></div></div>`;
}

function matchCard(m) {
  const card = el('div', 'mcard');
  const predictable = canPredict(m);
  // оноон дээр төвд: дууссан → Дууссан, эхлээгүй → цаг, эхэлсэн (live) → LIVE
  const when = m.finished ? 'Дууссан' : predictable ? (m.time || '') : 'LIVE';
  const pick = state.matchPicks[m.id];          // ажлын таамаг (h/a нь тоо эсвэл undefined)
  const saved = state.matchPicksSaved[m.id];     // хадгалагдсан таамаг (бүтэн)
  const home = `<div class="mc-team">${flagImg(m.homeFlag)}<span class="nm" title="${m.home}">${m.homeAbbr || m.home}</span></div>`;
  const away = `<div class="mc-team away">${flagImg(m.awayFlag)}<span class="nm" title="${m.away}">${m.awayAbbr || m.away}</span></div>`;
  let mid;
  if (predictable) mid = `<div class="mc-score">${stepperHtml('h', pick?.h)}<span class="mc-colon">:</span>${stepperHtml('a', pick?.a)}</div>`;
  // Эхэлсэн/дууссан үед төвд МИНИЙ ТААМАГ; таамаглаагүй бол "? : ?"
  else if (saved) mid = `<div class="mc-final">${saved.h} : ${saved.a}</div>`;
  else mid = `<div class="mc-final" style="color:var(--text-3)">? : ?</div>`;

  card.innerHTML = `
    <div class="mc-when">${when}</div>
    <div class="mc-body">${home}${mid}${away}</div>`;

  if (m.finished && saved) {
    const pt = scoreMatchClient(saved, m.homeScore, m.awayScore);
    card.classList.add(pt === 2 ? 'res-exact' : pt === 1 ? 'res-out' : 'res-miss');
    const f = el('div', 'mc-pred');
    f.innerHTML = `Тоглолтын дүн <b>${m.homeScore}:${m.awayScore}</b> <span class="mc-pts p${pt}">+${pt}</span>`;
    card.appendChild(f);
  } else if (m.finished) {
    // Таамаглаагүй дууссан: дүнг бусад картын адил доор нь (онооны badge-гүй)
    const f = el('div', 'mc-pred');
    f.innerHTML = `Тоглолтын дүн <b>${m.homeScore}:${m.awayScore}</b>`;
    card.appendChild(f);
  }
  if (predictable) {
    card.classList.add('predictable');
    card.addEventListener('click', () => card.classList.toggle('open')); // дарахад +/− доошоо сунана
    card.querySelectorAll('.stepper button').forEach((b) =>
      b.addEventListener('click', (e) => { e.stopPropagation(); stepScore(m.id, b.dataset.side, Number(b.dataset.delta)); })
    );
    const dirty = (pick?.h ?? null) !== (saved?.h ?? null) || (pick?.a ?? null) !== (saved?.a ?? null);
    if (dirty) {
      const complete = typeof pick?.h === 'number' && typeof pick?.a === 'number';
      const f = el('div', 'mc-save');
      f.innerHTML = `<button class="btn btn-accent mc-savebtn"${complete ? '' : ' disabled'}>Хадгалах</button>`;
      f.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); saveMatch(m.id); });
      card.appendChild(f);
    }
  }
  return card;
}

// Зөвхөн тоо ба Save товчийг байрандаа шинэчилнэ (картыг дахин зурахгүй → лого анивчихгүй)
function patchMatchCard(id) {
  const idx = state.dailyMatches.findIndex((x) => x.id === id);
  const card = $('#matches').children[idx];
  if (!card) return;
  const pick = state.matchPicks[id];
  const saved = state.matchPicksSaved[id];
  const hv = card.querySelector('.val[data-side="h"]');
  const av = card.querySelector('.val[data-side="a"]');
  if (hv) hv.textContent = pick?.h == null ? '?' : pick.h;
  if (av) av.textContent = pick?.a == null ? '?' : pick.a;
  const dirty = (pick?.h ?? null) !== (saved?.h ?? null) || (pick?.a ?? null) !== (saved?.a ?? null);
  let saveEl = card.querySelector('.mc-save');
  if (dirty) {
    const complete = typeof pick?.h === 'number' && typeof pick?.a === 'number';
    if (!saveEl) {
      saveEl = el('div', 'mc-save');
      saveEl.innerHTML = `<button class="btn btn-accent mc-savebtn">Хадгалах</button>`;
      saveEl.querySelector('button').addEventListener('click', (e) => { e.stopPropagation(); saveMatch(id); });
      card.appendChild(saveEl);
    }
    saveEl.querySelector('button').disabled = !complete;
  } else if (saveEl) {
    saveEl.remove();
  }
}

function stepScore(id, side, delta) {
  if (!state.player) return openNameModal();
  const cur = { ...(state.matchPicks[id] || {}) };
  const v = cur[side];
  if (delta > 0) cur[side] = v == null ? 0 : Math.min(20, v + 1); // + ? → 0
  else if (v != null) cur[side] = Math.max(0, v - 1);             // − ? → ? хэвээр; − 0 → 0
  state.matchPicks[id] = cur;
  patchMatchCard(id);
}

async function saveMatch(id) {
  const pick = state.matchPicks[id];
  if (!pick || typeof pick.h !== 'number' || typeof pick.a !== 'number') return; // ?-тэй бол болохгүй
  try {
    await api.saveMatchPicks({ [id]: { h: pick.h, a: pick.a } });
    state.matchPicksSaved[id] = { h: pick.h, a: pick.a };
    patchMatchCard(id);
    successCheck();
  } catch (e) { toast(e.message, 'err'); }
}

// Хадгалсан үед төв дээр бичиггүй ногоон check анимэйшн
function successCheck() {
  document.querySelector('.t-check-host')?.remove();
  const host = el('div', 't-check-host');
  host.innerHTML = `<div class="t-check-box">
    <span class="t-success-check" data-state="out" aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="22" fill="#10B981"/>
        <path d="M15 24.5 L21.5 31 L33 18" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg></span>
    <span class="t-check-label">Хадгалагдсан</span>
  </div>`;
  document.body.appendChild(host);
  const seg = document.querySelector('.segmented'); // табуудын доор байрлуулна
  if (seg) host.style.paddingTop = Math.round(seg.getBoundingClientRect().bottom + 10) + 'px';
  const box = host.firstElementChild;
  requestAnimationFrame(() => box.querySelector('.t-success-check').setAttribute('data-state', 'in'));
  setTimeout(() => { box.style.transition = 'opacity .3s ease'; box.style.opacity = '0'; }, 1150);
  setTimeout(() => host.remove(), 1500);
}

// Хэвтээ swipe-аар өдөр солих (зүүн → дараагийн, баруун → өмнөх)
function setupSwipe() {
  const zone = $('#sub-daily');
  let sx = 0, sy = 0, t0 = 0;
  zone.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; t0 = Date.now(); }, { passive: true });
  zone.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Date.now() - t0 < 800 && Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5 && state.dailyDate) {
      loadDaily(shiftDate(state.dailyDate, dx < 0 ? 1 : -1));
    }
  }, { passive: true });
}

/* ============================ LEAGUES + RANKING ============================ */
async function loadLeagues() {
  $('#leagueHub').hidden = false;
  $('#leagueDetail').hidden = true;
  $('#profileView').hidden = true;
  await loadMyLeagues();
}

async function loadMyLeagues() {
  const wrap = $('#myLeagues');
  if (!state.player) { wrap.innerHTML = '<div class="empty">Эхлээд Таамаг хэсэгт нэрээ оруул.</div>'; return; }
  wrap.innerHTML = '<div class="empty">Уншиж байна…</div>';
  let data = { leagues: [], global: null };
  try { data = await api.myLeagues(); } catch {}
  const leagues = data.leagues || [];
  state.myLeagues = leagues;
  wrap.innerHTML = '';
  for (const l of leagues) wrap.appendChild(leagueCard({ name: l.name, code: l.code, rank: l.myRank, count: l.memberCount, owner: l.owner }));
  if (data.global) {
    wrap.appendChild(leagueCard({ name: 'Бүх тоглогч', rank: data.global.myRank, count: data.global.total, special: true }));
  }
}

function leagueCard(o) {
  const d = el('div', 'league-item' + (o.special ? ' special' : ''));
  const meta = (o.special ? '' : `<span class="code-badge">${o.code}</span>`) + `<span>${o.count} ${o.special ? 'тоглогч' : 'гишүүн'}</span>`;
  d.innerHTML = `
    <div class="l-rank">${o.rank ? '#' + o.rank : '–'}</div>
    <div class="l-main">
      <div class="l-name">${o.special ? '🌍 ' : ''}${o.name}${o.owner ? ' 👑' : ''}</div>
      <div class="l-meta">${meta}</div>
    </div>
    <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
  if (!o.special) d.querySelector('.code-badge').addEventListener('click', (e) => { e.stopPropagation(); copyCode(o.code); });
  d.addEventListener('click', () => showLeagueDetail(o.special ? '' : o.code, o.name));
  return d;
}

async function showLeagueDetail(code, name) {
  $('#leagueHub').hidden = true;
  $('#leagueDetail').hidden = false;
  $('#profileView').hidden = true;
  $('#ldName').textContent = name;
  const board = $('#ldBoard'); board.innerHTML = '<div class="empty">Уншиж байна…</div>';
  try {
    const data = await api.leaderboard(code || '');
    renderBoard(board, data.players);
  } catch (e) { board.innerHTML = `<div class="empty">${e.message}</div>`; }
}

const CROWN = '<svg class="crown" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 7l4.5 4L12 4l4.5 7L21 7l-1.8 11.2a1 1 0 0 1-1 .8H5.8a1 1 0 0 1-1-.8L3 7z"/></svg>';

// Аватар: Usion профайл зураг (алдвал нэрний эхний үсэг рүү буцна)
function avatarHtml(r) {
  const init = (r.nickname || '?').trim().charAt(0).toUpperCase() || '?';
  const img = r.avatar ? `<img src="${r.avatar}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : '';
  return `<span class="ava">${init}${img}</span>`;
}

function renderBoard(board, players) {
  if (!players.length) { board.innerHTML = '<div class="empty">Тоглогч алга.</div>'; return; }
  board.innerHTML = '';
  const meId = state.player?.id;

  // Подиум: шилдэг 3 (#2 зүүн, #1 төв, #3 баруун)
  const top = players.slice(0, 3);
  if (top.length) {
    const podium = el('div', 'podium');
    for (const r of [top[1], top[0], top[2]].filter(Boolean)) {
      const me = r.playerId === meId;
      const pod = el('div', `pod pod-${r.rank}` + (me ? ' me' : ''));
      pod.innerHTML = `${r.rank === 1 ? CROWN : ''}
        <div class="pod-ava">${avatarHtml(r)}<span class="pod-rank">${r.rank}</span></div>
        <div class="pod-name">${r.nickname}</div>
        <div class="pod-pts">${r.total} оноо</div>`;
      pod.addEventListener('click', () => openProfile(r.playerId));
      podium.appendChild(pod);
    }
    board.appendChild(podium);
  }

  // Жагсаалт: 4-өөс цааш
  const rest = players.slice(3);
  if (rest.length) {
    const list = el('div', 'board');
    for (const r of rest) {
      const me = r.playerId === meId;
      const d = el('div', 'brow' + (me ? ' me' : ''));
      d.innerHTML = `<div class="pos">${r.rank}</div>
        <div class="who">${avatarHtml(r)}<div class="nm">${r.nickname}</div></div>
        <div class="pts">${r.total}<small>ОНОО</small></div>`;
      d.addEventListener('click', () => openProfile(r.playerId));
      list.appendChild(d);
    }
    board.appendChild(list);
  }
}

// Тоглогчийн профайл (leaderboard-аас дарахад) — нэр/зураг/оноо + илгээсэн таамаг
async function openProfile(playerId) {
  if (!playerId) return;
  $('#leagueHub').hidden = true;
  $('#leagueDetail').hidden = true;
  $('#profileView').hidden = false;
  const body = $('#pvBody');
  body.innerHTML = '<div class="empty">Уншиж байна…</div>';
  try {
    const data = await api.playerProfile(playerId);
    renderProfile(body, data);
  } catch (e) { body.innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderProfile(body, data) {
  const p = data.player;
  const init = (p.nickname || '?').charAt(0).toUpperCase();
  const ava = p.avatar ? `<img src="${p.avatar}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  let html = `<div class="pv-hd"><span class="ava pv-ava">${init}${ava}</span>
    <div><div class="pv-name">${p.nickname}</div><div class="pv-total">${p.total} оноо</div></div></div>`;

  // Өдрийн матчийн таамаг
  html += `<div class="pv-sec">Өдрийн таамаг</div>`;
  if (data.matches.length) {
    html += `<div class="pv-cols"><span>Таамаг</span><span>Үр дүн</span><span>Авсан оноо</span></div>`;
    html += '<div class="pv-list">';
    for (const m of data.matches) {
      const res = m.finished ? `${m.homeScore}:${m.awayScore}` : m.time;
      const pts = m.finished ? `<span class="mc-pts p${m.points}">+${m.points}</span>` : '';
      html += `<div class="pv-row">
        <span class="pv-mt">${m.homeAbbr} <b>${m.pick.h}:${m.pick.a}</b> ${m.awayAbbr}</span>
        <span class="pv-res${m.finished ? '' : ' soon'}">${res}</span>
        <span class="pv-pts">${pts}</span></div>`;
    }
    html += '</div>';
  } else html += '<div class="empty">Таамаг алга.</div>';

  // Групп таамаг
  if (data.groups.length) {
    html += `<div class="pv-sec">Групп таамаг</div>`;
    for (const g of data.groups) {
      const teams = state.cfg?.groups?.[g.group] || [];
      const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
      const items = g.order.map((id, i) => {
        const t = byId[id];
        const ok = g.actual ? g.actual[i] === id : null;
        return `<span class="pv-gt ${ok === true ? 'ok' : ok === false ? 'no' : ''}">${i + 1}. ${t?.abbr || t?.name || id}${ok === true ? ' ✓' : ''}</span>`;
      }).join('');
      const pts = g.points == null ? '' : `<span class="gpts">+${g.points}</span>`;
      html += `<div class="pv-grp"><div class="pv-grp-hd">Групп ${g.group} ${pts}</div><div>${items}</div></div>`;
    }
  }
  body.innerHTML = html;
}

function copyCode(code) { navigator.clipboard?.writeText(code).then(() => toast(`Код хуулагдлаа: ${code}`, 'ok'), () => toast(`Код: ${code}`)); }

async function createLeague() {
  if (!state.player) return openNameModal();
  const name = $('#leagueNameInput').value.trim();
  if (name.length < 2) return toast('Лигийн нэр оруул', 'err');
  try { const { league } = await api.createLeague(name); $('#leagueNameInput').value = ''; toast(`"${league.name}" үүслээ · ${league.code}`, 'ok'); loadMyLeagues(); }
  catch (e) { toast(e.message, 'err'); }
}
async function joinLeague() {
  if (!state.player) return openNameModal();
  const code = $('#joinCodeInput').value.trim().toUpperCase();
  if (!code) return toast('Код оруул', 'err');
  try { const { league } = await api.joinLeague(code); $('#joinCodeInput').value = ''; toast(`"${league.name}" лигт нэгдлээ`, 'ok'); loadMyLeagues(); }
  catch (e) { toast(e.message, 'err'); }
}

/* ============================ ADMIN ============================ */
function openAdmin() { $('#adminModal').hidden = false; renderAdmin(); }
function renderAdmin() {
  const wrap = $('#adminGroups'); wrap.innerHTML = '';
  for (const g of state.cfg.groupIds) {
    const teams = teamsOf(g);
    const order = state.cfg.results[g] ? [...state.cfg.results[g]] : teams.map((t) => t.id);
    const box = el('div', 'admin-grp');
    const rows = order.map((id, i) => {
      const t = teamById(g, id);
      return `<li class="rrow ${QUAL[i]}" data-team="${id}"><span class="num">${i + 1}</span><img class="flag" src="${flagSrc(t.code)}" alt="" onerror="this.style.visibility='hidden'"><span class="tname">${t.name}</span><span class="grip">${ICON.grip}</span></li>`;
    }).join('');
    box.innerHTML = `
      <div class="ag-hd"><span>Групп ${g}</span>
        <span><button class="btn" data-save="${g}">Хадгалах</button> <button class="btn" data-clear="${g}">Цэвэрлэх</button></span></div>
      <ul class="ranklist" data-agroup="${g}">${rows}</ul>`;
    const ul = box.querySelector('.ranklist');
    new window.Sortable(ul, {
      handle: '.grip', animation: 160, forceFallback: true, fallbackTolerance: 4,
      onEnd: () => { [...ul.children].forEach((li, i) => { li.className = 'rrow ' + QUAL[i]; li.querySelector('.num').textContent = i + 1; }); },
    });
    box.querySelector(`[data-save="${g}"]`).addEventListener('click', () => adminSave(g, [...ul.children].map((li) => li.dataset.team)));
    box.querySelector(`[data-clear="${g}"]`).addEventListener('click', () => adminSave(g, []));
    wrap.appendChild(box);
  }
}
async function adminSave(g, order) {
  const key = $('#adminKeyInput').value.trim();
  if (!key) return toast('Admin түлхүүр оруул', 'err');
  try {
    await api.setResult(key, g, order.length ? order : null);
    state.cfg = await api.groups();
    toast(`Групп ${g} ${order.length ? 'хадгалагдлаа' : 'цэвэрлэгдлээ'} ✓`, 'ok');
    renderPredict();
  } catch (e) { toast(e.message, 'err'); }
}

/* ============================ NAV / WIRING ============================ */
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== `screen-${name}`));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.screen === name));
  if (name === 'leagues') loadLeagues();
  if (name === 'predict') movePill(false);
  refreshScore();
}

function setSubTab(name) {
  document.querySelectorAll('.subview').forEach((v) => (v.hidden = v.id !== `sub-${name}`));
  document.querySelectorAll('.seg').forEach((s) => s.classList.toggle('active', s.dataset.sub === name));
  movePill(true);
  if (name === 'daily') loadDaily(state.dailyDate);
}

// Гүйдэг pill-ийг идэвхтэй таб руу байрлуулна. animate=false бол шууд (анимацгүй) шилжинэ.
function movePill(animate) {
  const seg = document.querySelector('.seg.active');
  const pill = document.querySelector('.seg-pill');
  if (!seg || !pill) return;
  if (!animate) pill.style.transition = 'none';
  pill.style.transform = `translateX(${seg.offsetLeft}px)`;
  pill.style.width = `${seg.offsetWidth}px`;
  pill.style.height = `${seg.offsetHeight}px`;
  pill.style.top = `${seg.offsetTop}px`;
  if (!animate) { void pill.offsetWidth; pill.style.transition = ''; } // reflow → анимацыг сэргээх
}
// Апп нээлттэй / урагшаа ороход одоогийн дэлгэцийг чимээгүй шинэчилнэ
function refreshCurrent() {
  if (!state.player) return;
  refreshScore();
  if (!$('#screen-predict').hidden && !$('#sub-daily').hidden) loadDaily(state.dailyDate);
  else if (!$('#screen-leagues').hidden && !$('#leagueHub').hidden) loadLeagues();
}

function wire() {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshCurrent(); });
  setInterval(() => { if (!document.hidden) refreshCurrent(); }, 60000);
  $('#nameSubmit').addEventListener('click', submitName);
  $('#nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && submitName());
  $('#createLeagueBtn').addEventListener('click', createLeague);
  $('#joinLeagueBtn').addEventListener('click', joinLeague);
  $('#ldBack').addEventListener('click', () => { $('#leagueDetail').hidden = true; $('#leagueHub').hidden = false; });
  $('#pvBack').addEventListener('click', () => { $('#profileView').hidden = true; $('#leagueDetail').hidden = false; });
  $('#dayPrev').addEventListener('click', () => state.dailyDate && loadDaily(shiftDate(state.dailyDate, -1)));
  $('#dayNext').addEventListener('click', () => state.dailyDate && loadDaily(shiftDate(state.dailyDate, 1)));
  setupSwipe();
  $('#playerChip').addEventListener('click', () => { if (confirm('Гарах уу?')) { setToken(''); location.reload(); } });
  document.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => switchScreen(n.dataset.screen)));
  document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => setSubTab(b.dataset.sub)));
  window.addEventListener('resize', () => movePill(false));
  document.fonts?.ready?.then(() => movePill(false));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => ($('#' + b.dataset.close).hidden = true)));
  if (location.hash === '#admin') openAdmin();
}

init();
