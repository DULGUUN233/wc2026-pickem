const TOKEN_KEY = 'wc2026:token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['x-wc-token'] = token;
  const res = await fetch('/api' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* хоосон */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `Алдаа (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  auth: (nickname) => request('POST', '/auth', { nickname }),
  me: () => request('GET', '/me'),
  groups: () => request('GET', '/groups'),
  getPicks: () => request('GET', '/picks'),
  savePicks: (picks) => request('PUT', '/picks', { picks }),
  results: () => request('GET', '/results'),
  setResult: (adminKey, group, order) => request('POST', '/admin/results', { adminKey, group, order }),
  createLeague: (name) => request('POST', '/leagues', { name }),
  joinLeague: (code) => request('POST', '/leagues/join', { code }),
  myLeagues: () => request('GET', '/leagues'),
  leaderboard: (leagueCode) =>
    request('GET', '/leaderboard' + (leagueCode ? `?league=${encodeURIComponent(leagueCode)}` : '')),
};
