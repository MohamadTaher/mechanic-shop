import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSlots, buildAvailability, nowInZone, validateSettings, validateBooking,
  SERVICES, DEFAULT_SCHEDULE, isBookableSlot,
} from '../src/schedule.js';

const sched = (over = {}) => ({ ...DEFAULT_SCHEDULE, ...over });
const MON = '2026-10-26'; // Monday
const SUN = '2026-11-01'; // Sunday
const SAT = '2026-10-31'; // Saturday

test('slots: 08:00-17:00 at 60 min gives 08:00..16:00', () => {
  const s = generateSlots(sched(), MON, new Set());
  assert.equal(s.length, 9);
  assert.equal(s[0], '08:00');
  assert.equal(s.at(-1), '16:00');
});

test('slots: last slot must end by closing (90 min)', () => {
  const s = generateSlots(sched({ slotMinutes: 90 }), MON, new Set());
  assert.deepEqual(s, ['08:00', '09:30', '11:00', '12:30', '14:00', '15:30']);
});

test('slots: Saturday 09:00-13:00', () => {
  assert.deepEqual(generateSlots(sched(), SAT, new Set()), ['09:00', '10:00', '11:00', '12:00']);
});

test('slots: closed weekday gives none', () => {
  assert.deepEqual(generateSlots(sched(), SUN, new Set()), []);
});

test('slots: closed date gives none', () => {
  assert.deepEqual(generateSlots(sched(), MON, new Set([MON])), []);
});

const farPast = { date: '2026-10-01', time: '00:00' };

test('availability: window length equals daysAhead', () => {
  const days = buildAvailability(sched({ daysAhead: 10 }), [], [], { date: MON, time: '00:00' });
  assert.equal(days.length, 10);
  assert.equal(days[0].date, MON);
  assert.equal(days[9].date, '2026-11-04');
  assert.equal(days[0].weekday, 1);
});

test('availability: full slot is unavailable, partly full is available', () => {
  const booked = [{ date: MON, time: '08:00', minutes: 60 }, { date: MON, time: '09:00', minutes: 60 }];
  let d = buildAvailability(sched({ capacity: 1 }), [], booked, { date: MON, time: '00:00' })[0];
  assert.equal(d.slots.find(s => s.time === '08:00').available, false);
  assert.equal(d.slots.find(s => s.time === '10:00').available, true);
  d = buildAvailability(sched({ capacity: 2 }), [], booked, { date: MON, time: '00:00' })[0];
  assert.equal(d.slots.find(s => s.time === '08:00').available, true);
});

test('availability: min notice hides near-future slots today', () => {
  const d = buildAvailability(sched({ minNoticeHours: 2 }), [], [], { date: MON, time: '09:30' })[0];
  // earliest allowed start is 11:30 -> first available is 12:00
  const avail = d.slots.filter(s => s.available).map(s => s.time);
  assert.equal(avail[0], '12:00');
  assert.equal(d.slots.find(s => s.time === '08:00').available, false);
});

test('availability: closed day reports open=false and no slots', () => {
  const days = buildAvailability(sched(), [{ date: '2026-10-27', reason: 'x' }], [], { date: MON, time: '00:00' });
  assert.equal(days[1].open, false);
  assert.deepEqual(days[1].slots, []);
  assert.equal(days[6].open, false); // Sunday
});

const NOW0 = { date: MON, time: '00:00' };
const avail = (schedule, booked, time) =>
  buildAvailability(schedule, [], booked, NOW0)[0].slots.find((s) => s.time === time).available;
const tenAm60 = [{ date: MON, time: '10:00', minutes: 60 }];

test('overlap: 60-min booking blocks 30-min slots inside it', () => {
  const s = sched({ slotMinutes: 30 });
  assert.equal(avail(s, tenAm60, '09:30'), true);
  assert.equal(avail(s, tenAm60, '10:00'), false);
  assert.equal(avail(s, tenAm60, '10:30'), false);
  assert.equal(avail(s, tenAm60, '11:00'), true);
});

test('overlap: 45-min grid against a 60-min booking', () => {
  const week = { ...DEFAULT_SCHEDULE.week, 1: { open: true, start: '09:00', end: '17:00' } };
  const s = sched({ slotMinutes: 45, week });
  assert.equal(avail(s, tenAm60, '09:00'), true);
  assert.equal(avail(s, tenAm60, '09:45'), false);
  assert.equal(avail(s, tenAm60, '10:30'), false);
  assert.equal(avail(s, tenAm60, '11:15'), true);
});

test('overlap: capacity 2 with one overlapping booking stays available', () => {
  assert.equal(avail(sched({ slotMinutes: 30, capacity: 2 }), tenAm60, '10:30'), true);
  const two = [...tenAm60, { date: MON, time: '10:30', minutes: 30 }];
  assert.equal(avail(sched({ slotMinutes: 30, capacity: 2 }), two, '10:30'), false);
});

test('overlap: back-to-back is not an overlap', () => {
  assert.equal(avail(sched(), tenAm60, '09:00'), true);
  assert.equal(avail(sched(), tenAm60, '11:00'), true);
});

test('overlap: other dates do not interfere', () => {
  assert.equal(avail(sched(), [{ date: '2026-10-27', time: '10:00', minutes: 60 }], '10:00'), true);
});

test('isBookableSlot: respects overlapping bookings', () => {
  const s = sched({ slotMinutes: 30 });
  assert.equal(isBookableSlot(s, [], MON, '10:30', NOW0, tenAm60), false);
  assert.equal(isBookableSlot(s, [], MON, '11:00', NOW0, tenAm60), true);
  assert.equal(isBookableSlot(s, [], MON, '11:00', NOW0), true);
});

test('nowInZone: fixed instant in two zones', () => {
  const t = new Date('2026-10-27T02:30:00Z');
  assert.deepEqual(nowInZone('America/New_York', t), { date: '2026-10-26', time: '22:30' });
  assert.deepEqual(nowInZone('Asia/Tokyo', t), { date: '2026-10-27', time: '11:30' });
});

test('nowInZone: midnight is 00:xx not 24:xx', () => {
  const t = new Date('2026-10-27T04:05:00Z');
  assert.equal(nowInZone('America/New_York', t).time, '00:05');
});

const goodSettings = () => ({ schedule: structuredClone(DEFAULT_SCHEDULE), shop: { name: 'A', phone: '', address: '', about: '' } });

test('settings: default is valid', () => {
  assert.equal(validateSettings(goodSettings()).ok, true);
});

test('settings: rejects start >= end on open day', () => {
  const s = goodSettings();
  s.schedule.week['1'].start = '17:00';
  const r = validateSettings(s);
  assert.equal(r.ok, false);
  assert.match(r.error, /before/i);
});

test('settings: ignores start>=end on closed day', () => {
  const s = goodSettings();
  s.schedule.week['0'] = { open: false, start: '18:00', end: '09:00' };
  assert.equal(validateSettings(s).ok, true);
});

test('settings: rejects bad slotMinutes, capacity, daysAhead, notice, time format', () => {
  for (const [k, v] of [['slotMinutes', 25], ['capacity', 0], ['capacity', 11], ['daysAhead', 91], ['minNoticeHours', 73], ['minNoticeHours', -1]]) {
    const s = goodSettings();
    s.schedule[k] = v;
    assert.equal(validateSettings(s).ok, false, `${k}=${v}`);
  }
  const s = goodSettings();
  s.schedule.week['2'].start = '8am';
  assert.equal(validateSettings(s).ok, false);
});

test('settings: rejects empty shop name', () => {
  const s = goodSettings();
  s.shop.name = '  ';
  assert.equal(validateSettings(s).ok, false);
});

const goodBooking = () => ({
  date: MON, time: '08:00', name: '  Sam Lee ', phone: '(555) 123-4567', car: ' 2015 Honda Civic ',
  service: 'Brakes', note: ' hi ',
});

test('booking: valid input is trimmed', () => {
  const r = validateBooking(goodBooking());
  assert.equal(r.ok, true);
  assert.equal(r.value.name, 'Sam Lee');
  assert.equal(r.value.car, '2015 Honda Civic');
  assert.equal(r.value.note, 'hi');
});

test('booking: phone needs 7-15 digits and only allowed characters', () => {
  for (const p of ['12345', '1'.repeat(16), 'call me', '555-123-45a7']) {
    const b = goodBooking(); b.phone = p;
    assert.equal(validateBooking(b).ok, false, p);
  }
  for (const p of ['+1 555 123 4567', '555-1234']) {
    const b = goodBooking(); b.phone = p;
    assert.equal(validateBooking(b).ok, true, p);
  }
});

test('booking: service must be in list', () => {
  const b = goodBooking(); b.service = 'Free car';
  assert.equal(validateBooking(b).ok, false);
  for (const s of SERVICES) { b.service = s; assert.equal(validateBooking(b).ok, true); }
});

test('booking: length limits', () => {
  let b = goodBooking(); b.name = '   '; assert.equal(validateBooking(b).ok, false);
  b = goodBooking(); b.name = 'x'.repeat(81); assert.equal(validateBooking(b).ok, false);
  b = goodBooking(); b.car = ''; assert.equal(validateBooking(b).ok, false);
  b = goodBooking(); b.car = 'x'.repeat(81); assert.equal(validateBooking(b).ok, false);
  b = goodBooking(); b.note = 'x'.repeat(501); assert.equal(validateBooking(b).ok, false);
  b = goodBooking(); b.note = undefined; assert.equal(validateBooking(b).ok, true);
});

test('booking: bad date/time format rejected', () => {
  let b = goodBooking(); b.date = '10/26/2026'; assert.equal(validateBooking(b).ok, false);
  b = goodBooking(); b.time = '8am'; assert.equal(validateBooking(b).ok, false);
});
