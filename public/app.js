// Customer booking page. All text from the server is put on the page with textContent only.

import {
  $, el, api, time12, telHref, mapHref, contactWays, renderChrome, OTHER_SERVICE,
} from '/common.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Show this many week groups before the "Show later dates" button.
const WEEKS_SHOWN_FIRST = 2;

const state = { info: null, days: [], day: null, time: null, step: 1, booked: null, showAllDays: false };

// ---------- date and time words ----------

function utcDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(date, n) {
  const d = utcDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts });
const shortDow = fmt({ weekday: 'short' });
const shortDate = fmt({ month: 'short', day: 'numeric' });
const longDate = fmt({ weekday: 'long', month: 'long', day: 'numeric' });


function setStatus(text, kind) {
  const box = $('status');
  box.replaceChildren();
  if (text) box.append(el('p', { class: 'notice ' + (kind || 'info'), text }));
}

// ---------- page chrome ----------

function renderInfo(info) {
  const { shop, week } = info;
  document.title = `Book an appointment - ${shop.name}`;
  renderChrome(shop);
  $('about').textContent = shop.about || '';
  $('about').hidden = !shop.about;

  const phone = (shop.phone || '').trim();
  const email = (shop.email || '').trim();
  const ways = contactWays(shop, true);
  const heroCall = $('hero-call');
  heroCall.replaceChildren();
  heroCall.hidden = !ways;
  if (ways) heroCall.append('Questions? ', ...ways);

  buildServices(info.services || []);

  // Highlight today's row, using the shop's own idea of "today".
  const todayIdx = state.days.length ? state.days[0].weekday : -1;
  const list = $('hours');
  list.replaceChildren();
  for (const i of [1, 2, 3, 4, 5, 6, 0]) {
    const r = week[i];
    const open = r && r.open;
    const li = el('li', { class: i === todayIdx ? 'today' : '' },
      el('strong', { text: WEEKDAYS[i] + (i === todayIdx ? ' (today)' : '') }),
      el('span', { class: open ? '' : 'closed', text: open ? `${time12(r.start)} to ${time12(r.end)}` : 'Closed' }));
    list.append(li);
  }

  const contact = $('contact');
  contact.replaceChildren();
  if (shop.address) {
    contact.append(el('p', {}, el('strong', { text: 'Find us: ' }), document.createTextNode(shop.address)));
    contact.append(el('p', {}, el('a', { href: mapHref(shop.address), target: '_blank', rel: 'noopener', text: 'Get directions' })));
  }
  if (phone) contact.append(el('p', {}, el('strong', { text: 'Call us: ' }), el('a', { href: telHref(phone), text: phone })));
  if (email) contact.append(el('p', {}, el('strong', { text: 'Email us: ' }), el('a', { href: 'mailto:' + email, text: email })));
}

// ---------- steps ----------
// Each step is a browser history entry, so the phone's Back button moves back one step
// instead of leaving the page.

function show(step) {
  state.step = step;
  for (const [id, n] of [['step1', 1], ['step2', 2], ['step3', 3]]) $(id).hidden = n !== step;
  $('done').hidden = step !== 4;
  $('stepper').hidden = step === 4;
  $('back').hidden = step === 1 || step === 4;
  if (step <= 3) {
    $('step-label').textContent = `Step ${step} of 3`;
    [...document.querySelectorAll('.dots i')].forEach((d, i) => d.classList.toggle('on', i < step));
  }
  const target = step === 4 ? $('done') : $(['step1', 'step2', 'step3'][step - 1]);
  target.querySelector('h2').focus({ preventScroll: true });
  const top = $('flow').getBoundingClientRect().top + window.scrollY - 12;
  window.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function go(step) {
  history.pushState({ step }, '');
  show(step);
}

window.addEventListener('popstate', (e) => {
  setStatus('');
  let target = (e.state && e.state.step) || 1;
  // After a booking, going back (or forward into the old "done" screen) starts fresh.
  if (state.step === 4 || target === 4) {
    startOver(false);
    history.replaceState({ step: 1 }, '');
    return;
  }
  if (target >= 2 && !state.day) target = 1;
  if (target >= 3 && !state.time) target = 2;
  show(target);
});

// Monday of the week the date falls in.
function weekStart(day) {
  return addDays(day.date, -((day.weekday + 6) % 7));
}

function dayCard(day, isToday, isTomorrow) {
  const free = day.slots.filter((s) => s.available).length;
  const tag = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : '';
  let meta;
  if (!day.open) meta = 'Closed';
  else if (free === 0) meta = isToday ? 'No times left' : 'Fully booked';
  else meta = free === 1 ? '1 time free' : `${free} times free`;
  const d = utcDate(day.date);
  const btn = el('button', { type: 'button', class: 'day' + (free ? '' : ' off'), disabled: free === 0 },
    el('span', { class: 'tag', text: tag, hidden: !tag }),
    el('span', { class: 'dow', text: shortDow.format(d) }),
    el('span', { class: 'dt', text: shortDate.format(d) }),
    el('span', { class: 'meta', text: meta }));
  btn.setAttribute('aria-label', `${longDate.format(d)}: ${meta}`);
  if (free > 0) btn.addEventListener('click', () => pickDay(day));
  return btn;
}

function renderDays() {
  const box = $('days');
  box.replaceChildren();
  if (!state.days.length) return;

  const today = state.days[0].date;
  const thisWeek = weekStart(state.days[0]);
  const groups = new Map();
  for (const day of state.days) {
    const ws = weekStart(day);
    if (!groups.has(ws)) groups.set(ws, []);
    groups.get(ws).push(day);
  }

  let n = 0;
  for (const [ws, days] of groups) {
    const shown = state.showAllDays || n < WEEKS_SHOWN_FIRST;
    n++;
    if (!shown) continue;
    let label;
    if (ws === thisWeek) label = 'This week';
    else if (ws === addDays(thisWeek, 7)) label = 'Next week';
    else label = `Week of ${shortDate.format(utcDate(ws))}`;
    const grid = el('div', { class: 'days' });
    for (const day of days) grid.append(dayCard(day, day.date === today, day.date === addDays(today, 1)));
    box.append(el('h3', { class: 'group-title', text: label }), grid);
  }
  $('more-days').hidden = state.showAllDays || groups.size <= WEEKS_SHOWN_FIRST;

  if (!state.days.some((d) => d.slots.some((s) => s.available))) {
    box.prepend(el('p', { class: 'notice info', text: 'Sorry, there are no free times right now. Please call us and we will find you a time.' }));
  }
}

function pickDay(day) {
  setStatus('');
  state.day = day;
  state.time = null;
  renderTimes();
  go(2);
}

function renderTimes() {
  const day = state.day;
  $('step2-title').textContent = `Pick a time on ${longDate.format(utcDate(day.date))}`;
  const box = $('times');
  box.replaceChildren();
  const free = day.slots.filter((s) => s.available);
  $('no-times').hidden = free.length > 0;

  const parts = [
    ['Morning', (h) => h < 12],
    ['Afternoon', (h) => h >= 12 && h < 17],
    ['Evening', (h) => h >= 17],
  ];
  for (const [label, test] of parts) {
    const list = free.filter((s) => test(Number(s.time.slice(0, 2))));
    if (!list.length) continue;
    const grid = el('div', { class: 'times' });
    for (const s of list) {
      const b = el('button', { type: 'button', class: 'time', text: time12(s.time) });
      b.addEventListener('click', () => pickTime(s.time));
      grid.append(b);
    }
    box.append(el('h3', { class: 'group-title', text: label }), grid);
  }
}

function pickTime(time) {
  setStatus('');
  state.time = time;
  $('summary').textContent = `${longDate.format(utcDate(state.day.date))} at ${time12(time)}`;
  clearErrors();
  go(3);
  // Put the cursor in the first box so typing can start right away (not on phones,
  // where the keyboard would cover the summary).
  if (matchMedia('(hover: hover)').matches) $('name').focus({ preventScroll: true });
}

// ---------- form ----------

const FIELD_IDS = { name: 'f-name', phone: 'f-phone', car: 'f-car', service: 'f-service', note: 'f-note' };

function clearErrors() {
  for (const id of Object.values(FIELD_IDS)) fieldError(id, '');
}

function fieldError(id, text) {
  const box = $(id);
  box.classList.toggle('invalid', !!text);
  const p = box.querySelector('.error-text');
  p.textContent = text;
  p.hidden = !text;
  const input = box.querySelector('input:not([type=radio]), textarea');
  if (input) input.setAttribute('aria-invalid', String(!!text));
}

function readForm() {
  const f = $('step3');
  const checked = f.querySelector('input[name=service]:checked');
  return {
    name: f.name.value.trim(),
    phone: f.phone.value.trim(),
    car: f.car.value.trim(),
    service: checked ? checked.value : '',
    note: f.note.value.trim(),
    website: f.website.value,
  };
}

function checkForm(v) {
  const errors = {};
  if (!v.name) errors.name = 'Please enter your name.';
  const digits = v.phone.replace(/\D/g, '').length;
  if (digits < 7 || digits > 15 || !/^[0-9\s\-+().]+$/.test(v.phone)) errors.phone = 'Please enter a phone number we can call, like 555-123-4567.';
  if (!v.car) errors.car = 'Please tell us your car, like "2015 Honda Civic".';
  if (!v.service) errors.service = 'Please choose what you need.';
  if (v.note.length > 500) errors.note = 'That is a bit long. Please keep it under 500 letters.';
  return errors;
}

async function submit(event) {
  event.preventDefault();
  setStatus('');
  const v = readForm();
  const errors = checkForm(v);
  clearErrors();
  const keys = Object.keys(errors);
  if (keys.length) {
    for (const k of keys) fieldError(FIELD_IDS[k], errors[k]);
    const first = $(FIELD_IDS[keys[0]]);
    first.scrollIntoView({ block: 'center' });
    first.querySelector('input, textarea').focus({ preventScroll: true });
    return;
  }

  const btn = $('send');
  btn.disabled = true;
  btn.textContent = 'Booking…';
  try {
    const body = { ...v, date: state.day.date, time: state.time };
    await api('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    state.booked = { car: v.car, service: v.service };
    showDone();
  } catch (err) {
    if (err.status === 409) {
      try { await refresh(false); } catch { /* keep the old list */ }
      const fresh = state.days.find((d) => d.date === state.day.date);
      if (fresh && fresh.slots.some((s) => s.available)) {
        state.day = fresh;
        state.time = null;
        renderTimes();
        history.replaceState({ step: 2 }, '');
        show(2);
      } else {
        state.day = null;
        state.time = null;
        history.replaceState({ step: 1 }, '');
        show(1);
      }
      setStatus(err.message, 'bad');
    } else if (err.status === 400 || err.status === 429) {
      setStatus(err.message, 'bad');
      $('status').scrollIntoView({ block: 'center' });
    } else {
      setStatus('We could not reach the shop. Please check your internet and try again.', 'bad');
      $('status').scrollIntoView({ block: 'center' });
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Book my appointment';
  }
}

function showDone() {
  const { shop } = state.info;
  $('done-when').textContent = `${longDate.format(utcDate(state.day.date))} at ${time12(state.time)}`;
  $('done-what').textContent = state.booked ? `${state.booked.service} · ${state.booked.car}` : '';

  const address = (shop.address || '').trim();
  $('done-where').hidden = !address;
  if (address) {
    $('done-address').textContent = address;
    $('done-map').href = mapHref(address);
  }

  const call = $('done-call');
  call.replaceChildren();
  const ways = contactWays(shop);
  if (ways) call.append('Need to change or cancel? Please ', ...ways, '.');
  else call.append('Need to change or cancel? Please contact the shop.');

  $('step3').reset();
  go(4);
}

async function startOver(push = true) {
  setStatus('');
  state.day = null;
  state.time = null;
  try { await refresh(false); } catch { /* keep the old list */ }
  renderDays();
  if (push) go(1);
  else show(1);
}

// ---------- loading ----------

async function refresh(showSpinner = true) {
  if (showSpinner) {
    $('loading').hidden = false;
    $('flow').hidden = true;
    $('load-error').hidden = true;
  }
  try {
    const [info, avail] = await Promise.all([api('/api/info'), api('/api/availability')]);
    state.info = info;
    state.days = avail.days;
    renderInfo(info);
    renderDays();
    $('loading').hidden = true;
    $('load-error').hidden = true;
    $('flow').hidden = false;
  } catch (err) {
    $('loading').hidden = true;
    if (showSpinner) {
      $('flow').hidden = true;
      $('load-error').hidden = false;
    } else {
      throw err;
    }
  }
}

// "What do you need?" choices, with prices. Keeps the customer's pick if the list is rebuilt.
function buildServices(services) {
  const box = $('services');
  const picked = box.querySelector('input:checked')?.value;
  box.replaceChildren();
  const all = [...services, { name: OTHER_SERVICE, price: 'Ask us', note: 'Tell us about it in the box below.' }];
  all.forEach((s, i) => {
    const input = el('input', { type: 'radio', name: 'service', value: s.name, id: 'svc' + i });
    if (s.name === picked) input.checked = true;
    const text = el('span', { class: 'choice-text' }, el('span', { class: 'choice-name', text: s.name }));
    if (s.note) text.append(el('span', { class: 'choice-note', text: s.note }));
    box.append(el('label', { class: 'choice' }, input, text, el('span', { class: 'choice-price', text: s.price })));
  });
}

history.replaceState({ step: 1 }, '');
$('retry').addEventListener('click', () => refresh());
$('back').addEventListener('click', () => history.back());
$('change-time').addEventListener('click', () => history.back());
$('more-days').addEventListener('click', () => {
  state.showAllDays = true;
  renderDays();
});
$('step3').addEventListener('submit', submit);
// Clear a field's error as soon as the customer starts fixing it.
for (const ev of ['input', 'change']) {
  $('step3').addEventListener(ev, (e) => {
    const box = e.target.closest('.field');
    if (box && box.classList.contains('invalid')) fieldError(box.id, '');
  });
}
$('again').addEventListener('click', () => startOver(true));
refresh();
