import { api, getToken, setToken } from './api.js';

/* ============================ STATE ============================ */
const state = {
  player: null,
  cfg: null, // /api/groups-ийн хариу
  picks: {}, // { A:[id,id,id,id], ... }
  myLeagues: [],
  boardScope: '', // '' = global, эсвэл лигийн код
};

const $ = (sel) => document.querySelector(sel);
const draftKey = () => `wc2026:draft:${state.player?.id || 'anon'}`;

/* ============================ HELPERS ============================ */
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2600);
}

function flag(code) {
  return `<img class="flag" src="${state.cfg.flagBase}${code}.png" alt="" loading="lazy" onerror="this.style.visibility='hidden'">`;
}
function teamsOf(group) {
  return state.cfg.groups[group];
}
function isGroupLocked(group) {
  return !!state.cfg.results[group] || state.cfg.lock.globalLockPassed;
}
function saveDraft() {
  try {
    localStorage.setItem(draftKey(), JSON.stringify(state.picks));
  } catch {}
}
function loadDraft() {
  try {
    return JSON.parse(localStorage.getItem(draftKey()) || '{}');
  } catch {
    return {};
  }
}

/* ============================ INIT ============================ */
async function init() {
  try {
    state.cfg = await api.groups();
  } catch (e) {
    toast('Серверт холбогдож чадсангүй', 'err');
    return;
  }

  // Сесс сэргээх
  if (getToken()) {
    try {
      const { player } = await api.me();
      state.player = player;
    } catch {
      setToken('');
    }
  }

  wireNav();
  wireButtons();
  $('#brandCupBind')?.addEventListener?.('click', () => {});

  if (state.player) {
    await afterLogin();
  } else {
    openNameModal();
  }
  renderPredict();
}

async function afterLogin() {
  showPlayerChip();
  // server picks + локал draft нэгтгэх
  let serverPicks = {};
  try {
    serverPicks = (await api.getPicks()).picks || {};
  } catch {}
  const draft = loadDraft();
  state.picks = { ...draft, ...serverPicks }; // дуусгасан (server) нь давамгайлна
  // түгжигдсэн группүүдийн server утга заавал хэрэглэнэ
  for (const g of state.cfg.groupIds) {
    if (isGroupLocked(g) && serverPicks[g]) state.picks[g] = serverPicks[g];
  }
}

function showPlayerChip() {
  const chip = $('#playerChip');
  chip.hidden = false;
  $('#playerName').textContent = state.player.nickname;
  $('#playerAvatar').textContent = state.player.nickname.charAt(0);
}

/* ============================ NAME MODAL ============================ */
function openNameModal() {
  $('#nameModal').hidden = false;
  setTimeout(() => $('#nameInput').focus(), 100);
}
async function submitName() {
  const nickname = $('#nameInput').value.trim();
  const errEl = $('#nameError');
  errEl.hidden = true;
  if (nickname.length < 2) {
    errEl.textContent = 'Дор хаяж 2 тэмдэгт оруул';
    errEl.hidden = false;
    return;
  }
  try {
    const { player, token } = await api.auth(nickname);
    setToken(token);
    state.player = player;
    $('#nameModal').hidden = true;
    await afterLogin();
    renderPredict();
    toast(`Тавтай морил, ${player.nickname}!`, 'ok');
  } catch (e) {
    errEl.textContent = e.message;
    errEl.hidden = false;
  }
}

/* ============================ PREDICT ============================ */
function renderPredict() {
  const grid = $('#groupsGrid');
  grid.innerHTML = '';
  if (!state.cfg) return;
  for (const gid of state.cfg.groupIds) {
    grid.appendChild(renderGroupCard(gid));
  }
  updatePredictMeta();
  if (state.cfg.lock.globalLockPassed) {
    $('#predictHint').textContent = 'Таамаг хаагдсан. Самбараас оноогоо хар.';
  }
}

function renderGroupCard(gid) {
  const teams = teamsOf(gid);
  const order = state.picks[gid] || [];
  const actual = state.cfg.results[gid]; // дууссан бол [id x4]
  const locked = isGroupLocked(gid);
  const complete = order.length === 4;

  const card = document.createElement('div');
  card.className = 'group-card' + (complete ? ' complete' : '') + (locked ? ' locked' : '');

  let tag = '';
  if (actual) tag = '<span class="tag done">Дүн гарсан</span>';
  else if (state.cfg.lock.globalLockPassed) tag = '<span class="tag live">Хаагдсан</span>';
  else if (complete) tag = '<span class="tag ck">✓</span>';

  // Дүн гарсан үед жинхэнэ эрэмбээр, эс бөгөөс таамгийн эрэмбээр харуулна
  const displayTeams = actual
    ? actual.map((id) => teams.find((t) => t.id === id))
    : teams;

  let rows = '';
  for (const t of displayTeams) {
    const predPos = order.indexOf(t.id); // -1 бол сонгоогүй
    const rankClass = predPos >= 0 ? ` r${predPos + 1}` : '';
    let markCls = '';
    let mark = '';
    if (actual) {
      const actualPos = actual.indexOf(t.id);
      if (predPos === actualPos && predPos >= 0) {
        markCls = ' correct';
        mark = '✓';
      } else {
        markCls = ' wrong';
        mark = '✗';
      }
    }
    rows += `
      <div class="team-row${rankClass}${markCls}${locked ? ' locked' : ''}" data-team="${t.id}">
        <span class="rank">${predPos >= 0 ? predPos + 1 : '·'}</span>
        ${flag(t.code)}
        <span class="name">${t.name}</span>
        ${mark ? `<span class="mark">${mark}</span>` : ''}
      </div>`;
  }

  card.innerHTML = `
    <div class="group-hdr"><span>Групп ${gid}</span>${tag}</div>
    <div class="group-teams">${rows}</div>`;

  if (!locked) {
    card.querySelectorAll('.team-row').forEach((rowEl) => {
      rowEl.addEventListener('click', () => toggleRank(gid, rowEl.dataset.team));
    });
  }
  return card;
}

function toggleRank(gid, teamId) {
  const order = state.picks[gid] ? [...state.picks[gid]] : [];
  const idx = order.indexOf(teamId);
  if (idx >= 0) {
    order.splice(idx, 1); // сонгосон байсныг хасах
  } else if (order.length < 4) {
    order.push(teamId); // дараагийн байр оноох
  }
  state.picks[gid] = order;
  saveDraft();
  // зөвхөн тухайн картыг шинэчлэх
  const grid = $('#groupsGrid');
  const cards = grid.children;
  const i = state.cfg.groupIds.indexOf(gid);
  grid.replaceChild(renderGroupCard(gid), cards[i]);
  updatePredictMeta();
}

function updatePredictMeta() {
  const done = state.cfg.groupIds.filter((g) => (state.picks[g] || []).length === 4).length;
  $('#predictDone').textContent = done;
  const remaining = 12 - done;
  $('#saveInfo').textContent = remaining === 0 ? 'Бүх групп бэлэн 🎉' : `${remaining} групп дутуу`;
}

async function savePicks() {
  if (!state.player) return openNameModal();
  // Зөвхөн бүрэн (4) группүүдийг илгээнэ; бусдыг алгасна
  const payload = {};
  for (const g of state.cfg.groupIds) {
    const o = state.picks[g] || [];
    if (o.length === 4) payload[g] = o;
  }
  if (Object.keys(payload).length === 0) {
    toast('Дор хаяж нэг группийг бүрэн эрэмбэл', 'err');
    return;
  }
  const btn = $('#savePicksBtn');
  btn.disabled = true;
  try {
    const { skipped } = await api.savePicks(payload);
    if (skipped?.length) toast(`Хадгалсан. ${skipped.join(', ')} групп дүн гарсан тул өөрчлөгдсөнгүй.`, 'ok');
    else toast('Таамаг хадгалагдлаа ✓', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

/* ============================ LEAGUES ============================ */
async function loadLeagues() {
  const wrap = $('#myLeagues');
  if (!state.player) {
    wrap.innerHTML = '<div class="empty">Эхлээд нэрээ оруул.</div>';
    return;
  }
  try {
    state.myLeagues = (await api.myLeagues()).leagues;
  } catch {
    state.myLeagues = [];
  }
  if (!state.myLeagues.length) {
    wrap.innerHTML = '<div class="empty">Лиг алга. Шинээр үүсгэ эсвэл кодоор нэгд.</div>';
    return;
  }
  wrap.innerHTML = '';
  for (const l of state.myLeagues) {
    const div = document.createElement('div');
    div.className = 'league-item';
    div.innerHTML = `
      <div>
        <div class="l-name">${l.name}${l.owner ? ' 👑' : ''}</div>
        <div class="l-meta">
          <span class="code-badge" title="Хуулах">${l.code}</span>
          <span>${l.memberCount} гишүүн</span>
        </div>
      </div>
      <div class="spacer"></div>
      <button class="btn" data-board="${l.code}">Самбар</button>`;
    div.querySelector('.code-badge').addEventListener('click', () => copyCode(l.code));
    div.querySelector('[data-board]').addEventListener('click', () => {
      state.boardScope = l.code;
      switchScreen('leaderboard');
    });
    wrap.appendChild(div);
  }
}

function copyCode(code) {
  navigator.clipboard?.writeText(code).then(
    () => toast(`Код хуулагдлаа: ${code}`, 'ok'),
    () => toast(`Код: ${code}`)
  );
}

async function createLeague() {
  if (!state.player) return openNameModal();
  const name = $('#leagueNameInput').value.trim();
  if (name.length < 2) return toast('Лигийн нэр оруул', 'err');
  try {
    const { league } = await api.createLeague(name);
    $('#leagueNameInput').value = '';
    toast(`"${league.name}" үүслээ. Код: ${league.code}`, 'ok');
    await loadLeagues();
  } catch (e) {
    toast(e.message, 'err');
  }
}

async function joinLeague() {
  if (!state.player) return openNameModal();
  const code = $('#joinCodeInput').value.trim().toUpperCase();
  if (!code) return toast('Код оруул', 'err');
  try {
    const { league } = await api.joinLeague(code);
    $('#joinCodeInput').value = '';
    toast(`"${league.name}" лигт нэгдлээ`, 'ok');
    await loadLeagues();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ============================ LEADERBOARD ============================ */
function buildScopeOptions() {
  const sel = $('#boardScope');
  sel.innerHTML = '<option value="">🌍 Бүгд</option>';
  for (const l of state.myLeagues) {
    const opt = document.createElement('option');
    opt.value = l.code;
    opt.textContent = `🛡️ ${l.name}`;
    sel.appendChild(opt);
  }
  sel.value = state.boardScope;
}

async function loadLeaderboard() {
  // лигийн жагсаалт байхгүй бол татах (scope select-д хэрэгтэй)
  if (state.player && !state.myLeagues.length) {
    try {
      state.myLeagues = (await api.myLeagues()).leagues;
    } catch {}
  }
  buildScopeOptions();
  const board = $('#leaderboard');
  board.innerHTML = '<div class="empty">Уншиж байна...</div>';
  try {
    const data = await api.leaderboard(state.boardScope);
    renderBoard(data);
  } catch (e) {
    board.innerHTML = `<div class="empty">${e.message}</div>`;
  }
}

function renderBoard(data) {
  const board = $('#leaderboard');
  $('#boardMeta').textContent =
    `${data.scoredGroups}/${data.totalGroups} групп дүгнэгдсэн` +
    (data.league ? ` · ${data.league.name}` : ' · Бүх тоглогч');
  if (!data.players.length) {
    board.innerHTML = '<div class="empty">Тоглогч алга.</div>';
    return;
  }
  board.innerHTML = '';
  for (const r of data.players) {
    const div = document.createElement('div');
    const me = state.player && r.playerId === state.player.id;
    div.className = 'board-row' + (me ? ' me' : '') + (r.rank <= 3 ? ` top${r.rank}` : '');
    const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank;
    div.innerHTML = `
      <div class="pos">${medal}</div>
      <div class="who">
        <span class="nm">${r.nickname}${me ? ' (чи)' : ''}</span>
        <span class="det">${r.completed}/12 таамаг · ${r.perfectGroups} төгс групп</span>
      </div>
      <div class="pts">${r.total}<small>оноо</small></div>`;
    board.appendChild(div);
  }
}

/* ============================ ADMIN ============================ */
function openAdmin() {
  $('#adminModal').hidden = false;
  renderAdminGroups();
}
function renderAdminGroups() {
  const wrap = $('#adminGroups');
  wrap.innerHTML = '';
  const tmp = {}; // group -> order (admin-ийн оруулж буй түр утга)
  for (const gid of state.cfg.groupIds) {
    const teams = teamsOf(gid);
    const existing = state.cfg.results[gid] || [];
    tmp[gid] = [...existing];
    const box = document.createElement('div');
    box.className = 'admin-grp';
    const renderRows = () => {
      const order = tmp[gid];
      box.querySelector('.ag-rows').innerHTML = teams
        .map((t) => {
          const pos = order.indexOf(t.id);
          return `<div class="team-row${pos >= 0 ? ' r' + (pos + 1) : ''}" data-team="${t.id}">
            <span class="rank">${pos >= 0 ? pos + 1 : '·'}</span>${flag(t.code)}
            <span class="name">${t.name}</span></div>`;
        })
        .join('');
      box.querySelectorAll('.ag-rows .team-row').forEach((rEl) => {
        rEl.addEventListener('click', () => {
          const id = rEl.dataset.team;
          const i = tmp[gid].indexOf(id);
          if (i >= 0) tmp[gid].splice(i, 1);
          else if (tmp[gid].length < 4) tmp[gid].push(id);
          renderRows();
        });
      });
    };
    box.innerHTML = `
      <div class="ag-hd"><span>Групп ${gid}</span>
        <span>
          <button class="btn" data-save="${gid}">Хадгалах</button>
          <button class="btn" data-clear="${gid}">Цэвэрлэх</button>
        </span>
      </div>
      <div class="ag-rows group-teams"></div>`;
    renderRows();
    box.querySelector(`[data-save="${gid}"]`).addEventListener('click', () => adminSave(gid, tmp[gid]));
    box.querySelector(`[data-clear="${gid}"]`).addEventListener('click', () => adminSave(gid, []));
    wrap.appendChild(box);
  }
}
async function adminSave(gid, order) {
  const key = $('#adminKeyInput').value.trim();
  if (!key) return toast('Admin түлхүүр оруул', 'err');
  if (order.length !== 0 && order.length !== 4) return toast('4 багийг бүрэн эрэмбэл', 'err');
  try {
    await api.setResult(key, gid, order.length ? order : null);
    state.cfg = await api.groups(); // results шинэчлэх
    toast(`Групп ${gid} ${order.length ? 'хадгалагдлаа' : 'цэвэрлэгдлээ'} ✓`, 'ok');
    renderPredict();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ============================ NAV / WIRING ============================ */
function switchScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== `screen-${name}`));
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.screen === name));
  $('.save-bar').style.display = name === 'predict' ? 'flex' : 'none';
  if (name === 'leagues') loadLeagues();
  if (name === 'leaderboard') loadLeaderboard();
}

function wireNav() {
  document.querySelectorAll('.nav-item').forEach((n) =>
    n.addEventListener('click', () => switchScreen(n.dataset.screen))
  );
}

function wireButtons() {
  $('#nameSubmit').addEventListener('click', submitName);
  $('#nameInput').addEventListener('keydown', (e) => e.key === 'Enter' && submitName());
  $('#savePicksBtn').addEventListener('click', savePicks);
  $('#createLeagueBtn').addEventListener('click', createLeague);
  $('#joinLeagueBtn').addEventListener('click', joinLeague);
  $('#boardScope').addEventListener('change', (e) => {
    state.boardScope = e.target.value;
    loadLeaderboard();
  });
  $('#playerChip').addEventListener('click', () => {
    if (confirm('Гарах уу? (нэрээ дахин оруулна)')) {
      setToken('');
      location.reload();
    }
  });
  // Admin: толгойн цомыг дарж нээнэ, эсвэл #admin hash
  document.querySelector('.brand-cup').addEventListener('click', openAdmin);
  document.querySelectorAll('[data-close]').forEach((b) =>
    b.addEventListener('click', () => ($('#' + b.dataset.close).hidden = true))
  );
  if (location.hash === '#admin') openAdmin();
}

init();
