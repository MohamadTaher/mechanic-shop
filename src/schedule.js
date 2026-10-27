// Pure scheduling logic. No Cloudflare APIs in here so it can be unit tested with plain Node.
// Dates are "YYYY-MM-DD" and times "HH:MM" (24h), always in the shop's local time.

export const SERVICES = [
  'Oil change',
  'Brakes',
  'Check engine light / diagnostics',
  'Tires',
  'Battery',
  'Something else',
];

export const SLOT_LENGTHS = [15, 20, 30, 45, 60, 90, 120];

export const DEFAULT_SCHEDULE = {
  slotMinutes: 60,
  capacity: 1,
  daysAhead: 21,
  minNoticeHours: 2,
  week: {
    0: { open: false, start: '09:00', end: '17:00' },
    1: { open: true, start: '08:00', end: '17:00' },
    2: { open: true, start: '08:00', end: '17:00' },
    3: { open: true, start: '08:00', end: '17:00' },
    4: { open: true, start: '08:00', end: '17:00' },
    5: { open: true, start: '08:00', end: '17:00' },
    6: { open: true, start: '09:00', end: '13:00' },
  },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidTime(s) {
  return typeof s === 'string' && TIME_RE.test(s);
}

export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function fromMinutes(n) {
  return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
}

function dayNumber(date) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Today's date and clock time in the given IANA time zone.
export function nowInZone(timeZone, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant);
  const get = (type) => parts.find((p) => p.type === type).value;
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${hour}:${get('minute')}` };
}

function closedSetOf(closed) {
  if (closed instanceof Set) return closed;
  return new Set((closed || []).map((c) => (typeof c === 'string' ? c : c.date)));
}

// Start times for a date, ignoring bookings and the current time.
export function generateSlots(schedule, date, closed) {
  const rule = schedule.week[weekdayOf(date)];
  if (!rule || !rule.open || closedSetOf(closed).has(date)) return [];
  const step = schedule.slotMinutes;
  const end = toMinutes(rule.end);
  const slots = [];
  for (let t = toMinutes(rule.start); t + step <= end; t += step) slots.push(fromMinutes(t));
  return slots;
}

function slotIsAvailable(schedule, date, time, booked, now) {
  const slotAbs = dayNumber(date) * 1440 + toMinutes(time);
  const earliest = dayNumber(now.date) * 1440 + toMinutes(now.time) + schedule.minNoticeHours * 60;
  if (slotAbs < earliest) return false;
  // Count bookings on this date whose own length overlaps [start, start + slotMinutes).
  const start = toMinutes(time);
  const end = start + schedule.slotMinutes;
  let overlapping = 0;
  for (const b of booked) {
    if (b.date !== date) continue;
    const bStart = toMinutes(b.time);
    if (bStart < end && bStart + b.minutes > start) overlapping++;
  }
  return overlapping < schedule.capacity;
}

// booked: [{ date, time, minutes }] of booked appointments. Returns the whole booking window.
export function buildAvailability(schedule, closedDates, booked, now) {
  const closed = closedSetOf(closedDates);
  const days = [];
  for (let i = 0; i < schedule.daysAhead; i++) {
    const date = addDays(now.date, i);
    const times = generateSlots(schedule, date, closed);
    days.push({
      date,
      weekday: weekdayOf(date),
      open: times.length > 0,
      slots: times.map((time) => ({ time, available: slotIsAvailable(schedule, date, time, booked, now) })),
    });
  }
  return days;
}

// Is this exact date/time a real slot inside the window and far enough ahead? (capacity is rechecked atomically in SQL)
export function isBookableSlot(schedule, closedDates, date, time, now, booked = []) {
  const offset = dayNumber(date) - dayNumber(now.date);
  if (offset < 0 || offset >= schedule.daysAhead) return false;
  if (!generateSlots(schedule, date, closedDates).includes(time)) return false;
  return slotIsAvailable(schedule, date, time, booked, now);
}

const fail = (error) => ({ ok: false, error });

export function validateSettings(input) {
  const s = input && input.schedule;
  const shop = input && input.shop;
  if (!s || typeof s !== 'object' || !s.week) return fail('The opening hours are missing.');
  if (!SLOT_LENGTHS.includes(s.slotMinutes)) return fail('Please choose an appointment length from the list.');
  if (!Number.isInteger(s.capacity) || s.capacity < 1 || s.capacity > 10) return fail('Cars at the same time must be a number from 1 to 10.');
  if (!Number.isInteger(s.daysAhead) || s.daysAhead < 1 || s.daysAhead > 90) return fail('How far ahead people can book must be 1 to 90 days.');
  if (!Number.isInteger(s.minNoticeHours) || s.minNoticeHours < 0 || s.minNoticeHours > 72) return fail('Minimum notice must be 0 to 72 hours.');

  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const week = {};
  for (let d = 0; d < 7; d++) {
    const r = s.week[d];
    if (!r || typeof r !== 'object') return fail(`${names[d]} is missing.`);
    if (typeof r.open !== 'boolean') return fail(`${names[d]}: please choose Open or Closed.`);
    if (!isValidTime(r.start) || !isValidTime(r.end)) return fail(`${names[d]}: please enter a valid opening and closing time.`);
    if (r.open && toMinutes(r.start) >= toMinutes(r.end)) return fail(`${names[d]}: opening time must be before closing time.`);
    week[d] = { open: r.open, start: r.start, end: r.end };
  }

  if (!shop || typeof shop !== 'object') return fail('The shop details are missing.');
  const text = (v, max) => (typeof v === 'string' ? v.trim() : '').slice(0, max);
  const cleanShop = {
    name: text(shop.name, 80),
    phone: text(shop.phone, 40),
    address: text(shop.address, 200),
    about: text(shop.about, 500),
  };
  if (!cleanShop.name) return fail('Please enter the shop name.');

  return {
    ok: true,
    value: {
      schedule: { slotMinutes: s.slotMinutes, capacity: s.capacity, daysAhead: s.daysAhead, minNoticeHours: s.minNoticeHours, week },
      shop: cleanShop,
    },
  };
}

export function phoneDigits(phone) {
  return String(phone).replace(/\D/g, '');
}

export function validateBooking(input) {
  const b = input || {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const v = {
    date: str(b.date), time: str(b.time), name: str(b.name), phone: str(b.phone),
    car: str(b.car), service: str(b.service), note: str(b.note),
  };
  if (!isValidDate(v.date) || !isValidTime(v.time)) return fail('Please pick a day and time.');
  if (v.name.length < 1 || v.name.length > 80) return fail('Please enter your name (up to 80 letters).');
  const digits = phoneDigits(v.phone).length;
  if (!/^[0-9\s\-+().]+$/.test(v.phone) || digits < 7 || digits > 15) return fail('Please enter a phone number we can call, like 555-123-4567.');
  if (v.car.length < 1 || v.car.length > 80) return fail('Please tell us your car, like "2015 Honda Civic".');
  if (!SERVICES.includes(v.service)) return fail('Please choose what you need.');
  if (v.note.length > 500) return fail('Your note is too long. Please keep it under 500 letters.');
  return { ok: true, value: v };
}
