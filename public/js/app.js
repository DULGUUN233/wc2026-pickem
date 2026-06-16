import { api, getToken, setToken } from './api.js';

/* ============================ STATE ============================ */
const state = {
  player: null,
  cfg: null,
  picks: {}, // { A:[id,...] } 0-4 урт; бүрэн = 4
  savedPicks: {},
  myLeagues: [],
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

  if (getToken()) { try { state.player = (await api.me()).player; } catch { setToken(''); } }

  wire();
  if (state.player) await afterLogin();
  renderPredict();
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

/* ============================ HERO / NAME ============================ */
function startApp() { $('#screen-hero').hidden = true; if (!state.player) openNameModal(); }
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
  updateMeter();
  if (state.cfg.lock.globalLockPassed) $('#predictHint').textContent = 'Таамаг хаагдсан. Самбараас оноогоо хар.';
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
  updateMeter();
}

function rerenderCard(g) {
  const old = $(`#groups [data-card="${g}"]`);
  if (old) old.replaceWith(groupCard(g));
}

function onReorder(g, ul) {
  state.picks[g] = [...ul.children].map((li) => li.dataset.team);
  [...ul.children].forEach((li, i) => { li.className = 'rrow ' + QUAL[i]; li.querySelector('.num').textContent = i + 1; });
  saveDraft();
}

function updateMeter() {
  const done = state.cfg.groupIds.filter((g) => placedOf(g).length === 4).length;
  $('#predictDone').textContent = done;
  $('#meterFill').style.width = (done / 12) * 100 + '%';
}

async function savePicks() {
  if (!state.player) return openNameModal();
  const payload = {};
  for (const g of state.cfg.groupIds) if (!isLocked(g) && placedOf(g).length === 4) payload[g] = state.picks[g];
  if (!Object.keys(payload).length) return toast('Эрэмбэлж дуусгасан групп алга', 'err');
  const btn = $('#savePicksBtn'); btn.disabled = true;
  try { const { picks } = await api.savePicks(payload); state.savedPicks = picks; toast('Таамаг хадгалагдлаа ✓', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}

/* ============================ LEAGUES + RANKING ============================ */
async function loadLeagues() {
  $('#leagueHub').hidden = false;
  $('#leagueDetail').hidden = true;
  await Promise.all([loadMyLeagues(), loadGlobalBoard()]);
}

async function loadMyLeagues() {
  const wrap = $('#myLeagues');
  if (!state.player) { wrap.innerHTML = '<div class="empty">Эхлээд Таамаг хэсэгт нэрээ оруул.</div>'; return; }
  try { state.myLeagues = (await api.myLeagues()).leagues; } catch { state.myLeagues = []; }
  if (!state.myLeagues.length) { wrap.innerHTML = '<div class="empty">Лиг алга. Шинээр үүсгэ эсвэл кодоор нэгд.</div>'; return; }
  wrap.innerHTML = '';
  for (const l of state.myLeagues) {
    const d = el('div', 'league-item');
    d.innerHTML = `
      <div class="l-rank">${l.myRank ? '#' + l.myRank : '–'}</div>
      <div class="l-main">
        <div class="l-name">${l.name}${l.owner ? ' 👑' : ''}</div>
        <div class="l-meta"><span class="code-badge">${l.code}</span><span>${l.memberCount} гишүүн</span></div>
      </div>
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
    d.querySelector('.code-badge').addEventListener('click', (e) => { e.stopPropagation(); copyCode(l.code); });
    d.addEventListener('click', () => showLeagueDetail(l.code, l.name));
    wrap.appendChild(d);
  }
}

async function loadGlobalBoard() {
  const board = $('#globalBoard');
  board.innerHTML = '<div class="empty">Уншиж байна…</div>';
  try {
    const data = await api.leaderboard();
    $('#globalMeta').textContent = `${data.players.length} тоглогч · ${data.scoredGroups}/${data.totalGroups} групп дүгнэгдсэн`;
    renderBoard(board, data.players);
  } catch (e) { board.innerHTML = `<div class="empty">${e.message}</div>`; }
}

async function showLeagueDetail(code, name) {
  $('#leagueHub').hidden = true;
  $('#leagueDetail').hidden = false;
  $('#ldName').textContent = name;
  $('#ldMeta').textContent = 'Уншиж байна…';
  const board = $('#ldBoard'); board.innerHTML = '';
  try {
    const data = await api.leaderboard(code);
    $('#ldMeta').textContent = `Код ${code} · ${data.players.length} гишүүн · ${data.scoredGroups}/${data.totalGroups} групп`;
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
      <div class="who"><div class="nm">${r.nickname}${me ? ' · чи' : ''}</div><div class="det">${r.perfectGroups} төгс групп</div></div>
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
  $('#saveBar').hidden = name !== 'predict';
  if (name === 'leagues') loadLeagues();
}
function wire() {
  $('#startBtn').addEventListener('click', startApp);
  $('#nameSubmit').addEventListener('click', submitName);
  $('#nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && submitName());
  $('#savePicksBtn').addEventListener('click', savePicks);
  $('#createLeagueBtn').addEventListener('click', createLeague);
  $('#joinLeagueBtn').addEventListener('click', joinLeague);
  $('#ldBack').addEventListener('click', () => { $('#leagueDetail').hidden = true; $('#leagueHub').hidden = false; });
  $('#playerChip').addEventListener('click', () => { if (confirm('Гарах уу?')) { setToken(''); location.reload(); } });
  document.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => switchScreen(n.dataset.screen)));
  document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => ($('#' + b.dataset.close).hidden = true)));
  if (location.hash === '#admin') openAdmin();
}

init();
