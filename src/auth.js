// Owner login cookie: "<expiry-ms>.<hmac>". The signing key comes from ADMIN_PASSWORD,
// so changing the password signs everyone out.

const enc = new TextEncoder();
export const COOKIE_NAME = 'admin';
export const SESSION_SECONDS = 30 * 24 * 60 * 60;

async function hmacKey(password) {
  const base = await crypto.subtle.digest('SHA-256', enc.encode('mechanic-admin-key:' + password));
  return crypto.subtle.importKey('raw', base, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(password, payload) {
  const key = await hmacKey(password);
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(payload)));
}

// Constant-time string comparison (hash both sides first so lengths do not leak).
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(String(a))),
    crypto.subtle.digest('SHA-256', enc.encode(String(b))),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function makeSessionValue(password, now = Date.now()) {
  const expiry = String(now + SESSION_SECONDS * 1000);
  return `${expiry}.${await sign(password, expiry)}`;
}

export async function verifySessionValue(password, value, now = Date.now()) {
  if (!password || typeof value !== 'string') return false;
  const dot = value.indexOf('.');
  if (dot < 1) return false;
  const expiry = value.slice(0, dot);
  const mac = value.slice(dot + 1);
  if (!/^\d+$/.test(expiry) || Number(expiry) < now) return false;
  return safeEqual(mac, await sign(password, expiry));
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

export function sessionCookie(value) {
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
