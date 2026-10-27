import {
  DEFAULT_SCHEDULE, DEFAULT_SERVICES, OTHER_SERVICE, addDays, buildAvailability, isBookableSlot, isValidDate,
  nowInZone, phoneDigits, toMinutes, validateBooking, validateServices, validateSettings,
} from './schedule.js';
import {
  clearCookie, hashPassword, makeSessionValue, readCookie, safeEqual, sessionCookie, verifyPassword,
  verifySessionValue, COOKIE_NAME,
} from './auth.js';

const MAX_FUTURE_PER_PHONE = 3;
const DEFAULT_SHOP = { name: 'Mechanic Shop', phone: '', email: '', address: '', about: '' };

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

const fail = (status, error, headers) => json({ error }, status, headers);

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

async function loadSettings(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('schedule','shop')").all();
  const map = Object.fromEntries(results.map((r) => [r.key, r.value]));
  let schedule = DEFAULT_SCHEDULE;
  let shop = DEFAULT_SHOP;
  try { if (map.schedule) schedule = JSON.parse(map.schedule); } catch { /* keep default */ }
  try { if (map.shop) shop = { ...DEFAULT_SHOP, ...JSON.parse(map.shop) }; } catch { /* keep default */ }
  return { schedule, shop };
}

async function loadServices(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'services'").first();
  if (!row) return DEFAULT_SERVICES;
  try {
    const checked = validateServices(JSON.parse(row.value));
    return checked.ok ? checked.value : DEFAULT_SERVICES;
  } catch {
    return DEFAULT_SERVICES;
  }
}

async function loadClosedDates(env, fromDate) {
  const { results } = await env.DB.prepare('SELECT date, reason FROM closed_dates WHERE date >= ? ORDER BY date').bind(fromDate).all();
  return results;
}

// ---------- public ----------

async function handleInfo(env) {
  const { schedule, shop } = await loadSettings(env);
  const services = await loadServices(env);
  return json({ shop, week: schedule.week, slotMinutes: schedule.slotMinutes, services });
}

async function handleAvailability(env) {
  const { schedule } = await loadSettings(env);
  const now = nowInZone(env.TIMEZONE || 'America/New_York');
  const last = addDays(now.date, schedule.daysAhead);
  const closed = await loadClosedDates(env, now.date);
  const { results } = await env.DB
    .prepare("SELECT date, time, minutes FROM appointments WHERE status = 'booked' AND date >= ? AND date <= ?")
    .bind(now.date, last).all();
  return json({ timezone: env.TIMEZONE, days: buildAvailability(schedule, closed, results, now) });
}

async function handleBook(request, env) {
  const body = await readJson(request);
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    // Honeypot: pretend it worked, store nothing.
    return json({ id: 0, date: String(body.date || ''), time: String(body.time || '') }, 201);
  }
  const serviceNames = [...(await loadServices(env)).map((x) => x.name), OTHER_SERVICE];
  const checked = validateBooking(body, serviceNames);
  if (!checked.ok) return fail(400, checked.error);
  const b = checked.value;

  const { schedule } = await loadSettings(env);
  const now = nowInZone(env.TIMEZONE || 'America/New_York');
  const closed = await loadClosedDates(env, now.date);
  const { results: dayBooked } = await env.DB
    .prepare("SELECT date, time, minutes FROM appointments WHERE status = 'booked' AND date = ?")
    .bind(b.date).all();
  if (!isBookableSlot(schedule, closed, b.date, b.time, now, dayBooked)) {
    return fail(409, 'Sorry, that time is not available any more. Please pick another time.');
  }

  const { results: mine } = await env.DB
    .prepare("SELECT phone FROM appointments WHERE status = 'booked' AND (date > ? OR (date = ? AND time >= ?))")
    .bind(now.date, now.date, now.time).all();
  const digits = phoneDigits(b.phone);
  if (mine.filter((r) => phoneDigits(r.phone) === digits).length >= MAX_FUTURE_PER_PHONE) {
    return fail(429, `You already have ${MAX_FUTURE_PER_PHONE} upcoming appointments. Please call us if you need to change one.`);
  }

  // One statement: the overlap count and the insert cannot be split apart by another request.
  // Two appointments overlap when each starts before the other ends (times as minutes since midnight).
  const startMin = toMinutes(b.time);
  const res = await env.DB.prepare(
    `INSERT INTO appointments (date, time, minutes, name, phone, car, service, note)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM appointments WHERE date = ? AND status = 'booked'
              AND CAST(substr(time,1,2) AS INTEGER)*60 + CAST(substr(time,4,2) AS INTEGER) < ?
              AND CAST(substr(time,1,2) AS INTEGER)*60 + CAST(substr(time,4,2) AS INTEGER) + minutes > ?) < ?`,
  ).bind(
    b.date, b.time, schedule.slotMinutes, b.name, b.phone, b.car, b.service, b.note,
    b.date, startMin + schedule.slotMinutes, startMin, schedule.capacity,
  ).run();

  if (!res.meta.changes) return fail(409, 'Sorry, that time was just taken. Please pick another time.');
  return json({ id: res.meta.last_row_id, date: b.date, time: b.time }, 201);
}

// ---------- admin ----------

// The owner's own password (D1) wins; the ADMIN_PASSWORD secret is only the fallback / reset password.
async function loadStoredPassword(env) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'admin_password'").first();
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return { bad: true }; }
}

// Key for the session cookie: changes whenever the password does.
// A damaged stored row gives no key at all, so no cookie can pass.
const sessionKey = (stored, env) => {
  if (!stored) return env.ADMIN_PASSWORD;
  return typeof stored.hash === 'string' && stored.hash ? stored.hash : null;
};

async function passwordMatches(candidate, stored, env) {
  if (typeof candidate !== 'string') return false;
  if (stored) return verifyPassword(candidate, stored);
  return safeEqual(candidate, env.ADMIN_PASSWORD);
}

async function isAdmin(request, env) {
  const stored = await loadStoredPassword(env);
  return verifySessionValue(sessionKey(stored, env), readCookie(request, COOKIE_NAME));
}

function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
}

async function handleLogin(request, env) {
  const stored = await loadStoredPassword(env);
  if (!stored && !env.ADMIN_PASSWORD) return fail(500, 'Admin password not set up yet.');
  const body = await readJson(request);
  if (!(await passwordMatches(body.password, stored, env))) {
    await new Promise((r) => setTimeout(r, 500));
    return fail(401, "That password didn't work.");
  }
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(await makeSessionValue(sessionKey(stored, env))) });
}

async function handlePassword(request, env) {
  const body = await readJson(request);
  const stored = await loadStoredPassword(env);
  if (!(await passwordMatches(body.current, stored, env))) {
    await new Promise((r) => setTimeout(r, 500));
    return fail(401, 'Your current password is not right.');
  }
  if (typeof body.next !== 'string' || body.next.length < 8 || body.next.length > 200) {
    return fail(400, 'Please use at least 8 characters.');
  }
  const row = await hashPassword(body.next);
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('admin_password', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(JSON.stringify(row)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(await makeSessionValue(row.hash)) });
}

async function handleAdmin(request, env, url, path) {
  const method = request.method;
  if (method !== 'GET' && !sameOrigin(request)) return fail(403, 'Request blocked.');

  if (path === '/api/admin/login' && method === 'POST') return handleLogin(request, env);
  if (path === '/api/admin/logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
  if (!(await isAdmin(request, env))) return fail(401, 'Please log in.');

  const now = nowInZone(env.TIMEZONE || 'America/New_York');

  if (path === '/api/admin/password' && method === 'POST') return handlePassword(request, env);

  if (path === '/api/admin/me' && method === 'GET') return json({ ok: true });

  if (path === '/api/admin/appointments' && method === 'GET') {
    const { results } = await env.DB
      .prepare('SELECT id, date, time, name, phone, car, service, note, status FROM appointments WHERE date >= ? ORDER BY date, time, id')
      .bind(addDays(now.date, -7)).all();
    return json({ today: now.date, appointments: results });
  }

  let m = path.match(/^\/api\/admin\/appointments\/(\d+)\/cancel$/);
  if (m && method === 'POST') {
    const res = await env.DB.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ? AND status = 'booked'").bind(Number(m[1])).run();
    if (!res.meta.changes) return fail(404, 'That appointment was not found or is already cancelled.');
    return json({ ok: true });
  }

  if (path === '/api/admin/settings' && method === 'GET') return json(await loadSettings(env));

  if (path === '/api/admin/settings' && method === 'PUT') {
    const checked = validateSettings(await readJson(request));
    if (!checked.ok) return fail(400, checked.error);
    const { schedule, shop } = checked.value;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('schedule', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(schedule)),
      env.DB.prepare("INSERT INTO settings (key, value) VALUES ('shop', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify(shop)),
    ]);
    return json({ schedule, shop });
  }

  if (path === '/api/admin/services' && method === 'GET') return json({ services: await loadServices(env) });

  if (path === '/api/admin/services' && method === 'PUT') {
    const checked = validateServices((await readJson(request)).services);
    if (!checked.ok) return fail(400, checked.error);
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('services', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(JSON.stringify(checked.value)).run();
    return json({ services: checked.value });
  }

  if (path === '/api/admin/closed-dates' && method === 'GET') return json({ days: await loadClosedDates(env, now.date) });

  if (path === '/api/admin/closed-dates' && method === 'POST') {
    const body = await readJson(request);
    const date = typeof body.date === 'string' ? body.date.trim() : '';
    if (!isValidDate(date)) return fail(400, 'Please pick a date.');
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 100) : '';
    await env.DB.prepare('INSERT INTO closed_dates (date, reason) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET reason = excluded.reason').bind(date, reason).run();
    return json({ date, reason }, 201);
  }

  m = path.match(/^\/api\/admin\/closed-dates\/(\d{4}-\d{2}-\d{2})$/);
  if (m && method === 'DELETE') {
    await env.DB.prepare('DELETE FROM closed_dates WHERE date = ?').bind(m[1]).run();
    return json({ ok: true });
  }

  return fail(404, 'Not found.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (path.startsWith('/api/admin/')) return await handleAdmin(request, env, url, path);
      if (path === '/api/info' && request.method === 'GET') return await handleInfo(env);
      if (path === '/api/availability' && request.method === 'GET') return await handleAvailability(env);
      if (path === '/api/book' && request.method === 'POST') return await handleBook(request, env);
      return fail(404, 'Not found.');
    } catch (err) {
      console.error(err);
      return fail(500, 'Something went wrong on our side. Please try again, or give us a call.');
    }
  },
};
