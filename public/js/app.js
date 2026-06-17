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

  // 1) Usion mini-app дотор бол identity-г платформоос авна (nickname асуухгүй)
  await tryUsionLogin();

  // 2) Standalone (Usion-гүй) — хадгалсан сесс сэргээх
  if (!state.player && getToken()) {
    try { state.player = (await api.me()).player; } catch { setToken(''); }
  }

  if (state.player) await afterLogin();
  renderPredict();
  loadDaily();

  // 3) Usion-гүй, сессгүй бол нэр асууна
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
        }
      } catch { /* алдвал nickname горимд унана */ }
      finish();
    });
  });
}

async function afterLogin() {
  showPlayerChip();
  try { state.savedPicks = (await api.getPicks()).picks || {}; } catch { state.savedPicks = {}; }
  state.picks = { ...state.savedPicks, ...loadDraft() };
}

function showPlayerChip() {
  $('#playerChip').hidden = false;
  $('#playerName').textContent = state.player.nickname;
  $('#playerAvatar').textContent = state.player.nickname.charAt(0);
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
  if (n === 4) return { cls: 'done', text: 'Бэлэн ✓' };
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
  return !m.finished && /^(ns|not started|tbd|sched|scheduled|)$/i.test((m.status || '').trim());
}
function scoreMatchClient(p, h, a) {
  if (!p || p.h == null || p.a == null || h == null || a == null) return 0;
  if (p.h === h && p.a === a) return 2;
  const sg = (x, y) => (x > y ? 1 : x < y ? -1 : 0);
  return sg(p.h, p.a) === sg(h, a) ? 1 : 0;
}

async function loadDaily(date) {
  const wrap = $('#matches');
  wrap.innerHTML = '<div class="empty">Уншиж байна…</div>';
  let data;
  try { data = await api.matches(date || ''); }
  catch (e) { wrap.innerHTML = `<div class="empty">${e.message}</div>`; return; }
  state.dailyDate = data.date;
  state.dailyMatches = data.matches || [];
  let picks = {};
  if (state.player) { try { picks = (await api.getMatchPicks()).picks || {}; } catch {} }
  state.matchPicksSaved = picks;
  state.matchPicks = { ...picks };
  renderDaily();
}

function renderDaily() {
  $('#dayLabel').textContent = state.dailyDate ? fmtDate(state.dailyDate) : '—';
  const wrap = $('#matches');
  const ms = state.dailyMatches;
  if (!ms.length) { wrap.innerHTML = '<div class="empty">Энэ өдөр World Cup тоглолт алга.</div>'; $('#dailyPts').hidden = true; return; }
  wrap.innerHTML = '';
  let pts = 0, scored = 0;
  for (const m of ms) {
    wrap.appendChild(matchCard(m));
    if (m.finished && state.matchPicks[m.id]) { pts += scoreMatchClient(state.matchPicks[m.id], m.homeScore, m.awayScore); scored++; }
  }
  $('#dailyPts').hidden = !scored;
  if (scored) $('#dailyPts').textContent = `Энэ өдрийн оноо: ${pts}`;
}

function flagImg(src) {
  return src ? `<img src="${src}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span style="width:30px;display:inline-block"></span>';
}
function stepperHtml(side, val) {
  return `<div class="stepper"><span class="val">${val}</span><div class="sbtns"><button data-side="${side}" data-delta="-1">−</button><button data-side="${side}" data-delta="1">+</button></div></div>`;
}

function matchCard(m) {
  const card = el('div', 'mcard');
  const predictable = canPredict(m);
  const statusCls = m.finished ? 'ft' : predictable ? 'ns' : 'live';
  const statusTxt = m.finished ? 'Дууссан' : predictable ? 'Эхлээгүй' : 'LIVE';
  const p = state.matchPicks[m.id];
  const home = `<div class="mc-team">${flagImg(m.homeFlag)}<span class="nm" title="${m.home}">${m.homeAbbr || m.home}</span></div>`;
  const away = `<div class="mc-team away">${flagImg(m.awayFlag)}<span class="nm" title="${m.away}">${m.awayAbbr || m.away}</span></div>`;
  let mid;
  if (predictable) mid = `<div class="mc-score">${stepperHtml('h', p?.h ?? 0)}<span class="mc-colon">:</span>${stepperHtml('a', p?.a ?? 0)}</div>`;
  else if (m.finished) mid = `<div class="mc-final">${m.homeScore} : ${m.awayScore}</div>`;
  else mid = `<div class="mc-final" style="font-size:16px;color:var(--text-3)">VS</div>`;

  card.innerHTML = `
    <div class="mc-top"><span>${m.time || ''}</span><span class="mc-status ${statusCls}">${statusTxt}</span></div>
    <div class="mc-body">${home}${mid}${away}</div>`;

  if (m.finished && p) {
    const pt = scoreMatchClient(p, m.homeScore, m.awayScore);
    const f = el('div', 'mc-pred');
    f.innerHTML = `Таны таамаг <b>${p.h}:${p.a}</b> <span class="mc-pts p${pt}">+${pt}</span>`;
    card.appendChild(f);
  }
  if (predictable) {
    card.querySelectorAll('.stepper button').forEach((b) => b.addEventListener('click', () => stepScore(m.id, b.dataset.side, Number(b.dataset.delta))));
  }
  return card;
}

function stepScore(id, side, delta) {
  if (!state.player) return openNameModal();
  const cur = state.matchPicks[id] ? { ...state.matchPicks[id] } : { h: 0, a: 0 };
  cur[side] = Math.max(0, Math.min(20, (cur[side] ?? 0) + delta));
  state.matchPicks[id] = cur;
  const idx = state.dailyMatches.findIndex((x) => x.id === id);
  const cards = $('#matches').children;
  if (idx >= 0 && cards[idx]) cards[idx].replaceWith(matchCard(state.dailyMatches[idx]));
  autoSaveMatches();
}

let _matchTimer;
function autoSaveMatches() {
  if (!state.player) return;
  clearTimeout(_matchTimer);
  _matchTimer = setTimeout(async () => {
    try { const { picks } = await api.saveMatchPicks(state.matchPicks); state.matchPicksSaved = picks; }
    catch (e) { toast(e.message, 'err'); }
  }, 700);
}

/* ============================ LEAGUES + RANKING ============================ */
async function loadLeagues() {
  $('#leagueHub').hidden = false;
  $('#leagueDetail').hidden = true;
  await loadMyLeagues();
}

async function loadMyLeagues() {
  const wrap = $('#myLeagues');
  if (!state.player) { wrap.innerHTML = '<div class="empty">Эхлээд Таамаг хэсэгт нэрээ оруул.</div>'; return; }
  wrap.innerHTML = '<div class="empty">Уншиж байна…</div>';
  let leagues = [], global = null;
  try { leagues = (await api.myLeagues()).leagues; } catch {}
  try { global = await api.leaderboard(); } catch {}
  state.myLeagues = leagues;
  wrap.innerHTML = '';
  for (const l of leagues) wrap.appendChild(leagueCard({ name: l.name, code: l.code, rank: l.myRank, count: l.memberCount, owner: l.owner }));
  if (global) {
    const myRow = state.player && global.players.find((p) => p.playerId === state.player.id);
    wrap.appendChild(leagueCard({ name: 'Бүх тоглогч', rank: myRow ? myRow.rank : null, count: global.players.length, special: true }));
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
  $('#ldName').textContent = name;
  const board = $('#ldBoard'); board.innerHTML = '<div class="empty">Уншиж байна…</div>';
  try {
    const data = await api.leaderboard(code || '');
    renderBoard(board, data.players);
  } catch (e) { board.innerHTML = `<div class="empty">${e.message}</div>`; }
}

function renderBoard(board, players) {
  if (!players.length) { board.innerHTML = '<div class="empty">Тоглогч алга.</div>'; return; }
  board.innerHTML = '';
  for (const r of players) {
    const me = state.player && r.playerId === state.player.id;
    const d = el('div', 'brow' + (me ? ' me' : ''));
    const posCls = r.rank <= 3 ? `pos medal g${r.rank}` : 'pos';
    d.innerHTML = `<div class="${posCls}">${r.rank}</div>
      <div class="who"><div class="nm">${r.nickname}</div></div>
      <div class="pts">${r.total}<small>ОНОО</small></div>`;
    board.appendChild(d);
  }
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
}

function setSubTab(name) {
  document.querySelectorAll('.subview').forEach((v) => (v.hidden = v.id !== `sub-${name}`));
  document.querySelectorAll('.seg').forEach((s) => s.classList.toggle('active', s.dataset.sub === name));
  if (name === 'daily') loadDaily(state.dailyDate);
}
function wire() {
  $('#nameSubmit').addEventListener('click', submitName);
  $('#nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && submitName());
  $('#createLeagueBtn').addEventListener('click', createLeague);
  $('#joinLeagueBtn').addEventListener('click', joinLeague);
  $('#ldBack').addEventListener('click', () => { $('#leagueDetail').hidden = true; $('#leagueHub').hidden = false; });
  $('#dayPrev').addEventListener('click', () => state.dailyDate && loadDaily(shiftDate(state.dailyDate, -1)));
  $('#dayNext').addEventListener('click', () => state.dailyDate && loadDaily(shiftDate(state.dailyDate, 1)));
  $('#playerChip').addEventListener('click', () => { if (confirm('Гарах уу?')) { setToken(''); location.reload(); } });
  document.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => switchScreen(n.dataset.screen)));
  document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => setSubTab(b.dataset.sub)));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => ($('#' + b.dataset.close).hidden = true)));
  if (location.hash === '#admin') openAdmin();
}

init();
