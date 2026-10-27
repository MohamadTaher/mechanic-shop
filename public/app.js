// Customer booking page. All text from the server is put on the page with textContent only.

const SERVICES = [
  'Oil change',
  'Brakes',
  'Check engine light / diagnostics',
  'Tires',
  'Battery',
  'Something else',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const kid of kids) node.append(kid);
  return node;
}

const state = { info: null, days: [], day: null, time: null, step: 1 };

// ---------- date and time words ----------

function utcDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts });
const shortDow = fmt({ weekday: 'short' });
const shortDate = fmt({ month: 'short', day: 'numeric' });
const longDate = fmt({ weekday: 'long', month: 'long', day: 'numeric' });

function time12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function setStatus(text, kind) {
  const box = $('status');
  box.replaceChildren();
  if (text) box.append(el('p', { class: 'notice ' + (kind || 'info'), text }));
}

async function api(path, options) {
  const res = await fetch(path, options);
  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong. Please try again.');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- page chrome ----------

function renderInfo(info) {
  const { shop, week } = info;
  document.title = `Book an appointment - ${shop.name}`;
  $('shop-name').textContent = shop.name;
  $('foot-name').textContent = shop.name;
  $('about').textContent = shop.about || '';
  $('year').textContent = new Date().getFullYear();

  const phone = (shop.phone || '').trim();
  const tel = 'tel:' + phone.replace(/[^\d+]/g, '');
  const callTop = $('call-top');
  callTop.hidden = !phone;
  if (phone) {
    callTop.href = tel;
    $('call-top-num').textContent = phone;
  }

  const list = $('hours');
  list.replaceChildren();
  for (const i of [1, 2, 3, 4, 5, 6, 0]) {
    const r = week[i];
    const open = r && r.open;
    list.append(el('li', {},
      el('strong', { text: WEEKDAYS[i] }),
      el('span', { class: open ? '' : 'closed', text: open ? `${time12(r.start)} to ${time12(r.end)}` : 'Closed' })));
  }

  const contact = $('contact');
  contact.replaceChildren();
  if (shop.address) contact.append(el('p', {}, el('strong', { text: 'Find us: ' }), document.createTextNode(shop.address)));
  if (phone) contact.append(el('p', {}, el('strong', { text: 'Call us: ' }), el('a', { href: tel, text: phone })));
}

// ---------- steps ----------

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
  const heading = target.querySelector('h2');
  heading.focus({ preventScroll: true });
  const top = $('flow').getBoundingClientRect().top + window.scrollY - 12;
  window.scrollTo({ top: Math.max(0, top), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function renderDays() {
  const box = $('days');
  box.replaceChildren();
  state.days.forEach((day, i) => {
    const free = day.slots.filter((s) => s.available).length;
    const d = utcDate(day.date);
    const tag = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : '';
    let meta = '';
    if (!day.open) meta = 'Closed';
    else if (free === 0) meta = 'Full';
    else meta = free === 1 ? '1 time free' : `${free} times free`;
    const btn = el('button', { type: 'button', class: 'day', disabled: free === 0 },
      el('span', { class: 'tag', text: tag, hidden: !tag }),
      el('span', { class: 'dow', text: shortDow.format(d) }),
      el('span', { class: 'dt', text: shortDate.format(d) }),
      el('span', { class: 'meta', text: meta }));
    if (free > 0) btn.addEventListener('click', () => pickDay(day));
    box.append(btn);
  });
}

function pickDay(day) {
  state.day = day;
  state.time = null;
  renderTimes();
  show(2);
}

function renderTimes() {
  const day = state.day;
  $('step2-title').textContent = `Pick a time on ${longDate.format(utcDate(day.date))}`;
  const box = $('times');
  box.replaceChildren();
  const free = day.slots.filter((s) => s.available);
  $('no-times').hidden = free.length > 0;
  for (const s of free) {
    const b = el('button', { type: 'button', class: 'time', text: time12(s.time) });
    b.addEventListener('click', () => pickTime(s.time));
    box.append(b);
  }
}

function pickTime(time) {
  state.time = time;
  $('summary').textContent = `${longDate.format(utcDate(state.day.date))} at ${time12(time)}`;
  clearErrors();
  show(3);
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
    const focusable = first.querySelector('input, textarea');
    focusable.focus();
    return;
  }

  const btn = $('send');
  btn.disabled = true;
  btn.textContent = 'Booking…';
  try {
    const body = { ...v, date: state.day.date, time: state.time };
    await api('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    showDone();
  } catch (err) {
    if (err.status === 409) {
      try { await refresh(false); } catch { /* keep the old list */ }
      const fresh = state.days.find((d) => d.date === state.day.date);
      if (fresh && fresh.slots.some((s) => s.available)) {
        state.day = fresh;
        renderTimes();
        show(2);
      } else {
        show(1);
      }
      setStatus(err.message, 'bad');
    } else if (err.status === 400 || err.status === 429) {
      setStatus(err.message, 'bad');
    } else {
      setStatus('We could not reach the server. Please check your internet and try again.', 'bad');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Book my appointment';
  }
}

function showDone() {
  const { shop } = state.info;
  $('done-when').textContent = `${longDate.format(utcDate(state.day.date))} at ${time12(state.time)}`;
  $('done-address').textContent = shop.address ? shop.address : '';
  $('done-address').hidden = !shop.address;
  const call = $('done-call');
  call.replaceChildren();
  const phone = (shop.phone || '').trim();
  if (phone) {
    call.append('Need to change or cancel? Call us at ', el('a', { href: 'tel:' + phone.replace(/[^\d+]/g, ''), text: phone }), '.');
  } else {
    call.append('Need to change or cancel? Please call the shop.');
  }
  $('step3').reset();
  show(4);
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

function buildServices() {
  const box = $('services');
  SERVICES.forEach((name, i) => {
    box.append(el('label', { class: 'choice' },
      el('input', { type: 'radio', name: 'service', value: name, id: 'svc' + i }),
      el('span', { text: name })));
  });
}

buildServices();
$('retry').addEventListener('click', () => refresh());
$('back').addEventListener('click', () => { setStatus(''); show(state.step - 1); });
$('step3').addEventListener('submit', submit);
// Clear a field's error as soon as the customer starts fixing it.
for (const ev of ['input', 'change']) {
  $('step3').addEventListener(ev, (e) => {
    const box = e.target.closest('.field');
    if (box && box.classList.contains('invalid')) fieldError(box.id, '');
  });
}
$('again').addEventListener('click', async () => {
  setStatus('');
  try { await refresh(false); } catch { /* keep the old list */ }
  renderDays();
  show(1);
});
refresh().then(() => { if (state.info) $('year').textContent = new Date().getFullYear(); });
