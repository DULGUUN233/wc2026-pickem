import crypto from 'node:crypto';

export function randomToken() {
  return crypto.randomBytes(24).toString('hex');
}

// Андуурахааргүй тэмдэгтүүд (0/O, 1/I/L хасав)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function leagueCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function normalizeNickname(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

export function publicPlayer(p) {
  if (!p) return null;
  return { id: String(p._id), nickname: p.nickname };
}

// Express дотор async алдааг барих жижиг wrapper
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
