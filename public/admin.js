// Owner page. Customer-supplied text (names, notes, ...) is only ever set with textContent.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];

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

const fmt = (opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts });
const longDate = fmt({ weekday: 'long', month: 'long', day: 'numeric' });
const midDate = fmt({ weekday: 'long', month: 'short', day: 'numeric' });
const shortDate = fmt({ weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

function utcDate(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function addDays(date, n) {
  const d = utcDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function time12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

const state = { settings: null, today: null, appointments: [] };

// ---------- helpers ----------

// Messages pop up at the bottom of the screen so they are seen wherever the owner has scrolled to.
let toastTimer;
function say(text, kind = 'good') {
  const box = $('toast');
  clearTimeout(toastTimer);
  box.replaceChildren();
  if (!text) return;
  const ok = el('button', { type: 'button', text: 'OK' });
  ok.addEventListener('click', () => box.replaceChildren());
  box.append(el('div', { class: 'toast ' + kind }, el('span', { text }), ok));
  const ms = kind === 'good' ? 3500 : kind === 'warn' ? 10000 : 12000;
  toastTimer = setTimeout(() => box.replaceChildren(), ms);
}

function bookedOn(date) {
  return state.appointments.filter((a) => a.date === date && a.status === 'booked');
}

async function api(path, options = {}) {
  const init = { ...options };
  if (init.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(init.body);
  }
  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error('Could not reach the server. Please check your internet and try again.');
  }
  let data = {};
  try { data = await res.json(); } catch { /* not JSON */ }
  // A wrong password on login or on "Change password" is not the same as being logged out.
  if (res.status === 401 && path !== '/api/admin/login' && path !== '/api/admin/password') {
    showLogin();
    throw new Error('Please log in again.');
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function guard(fn) {
  return async (...args) => {
    try { await fn(...args); } catch (err) { say(err.message, 'bad'); }
  };
}

// ---------- login ----------

function showLogin() {
  $('loading').hidden = true;
  $('app').hidden = true;
  $('logout').hidden = true;
  $('login').hidden = false;
}

async function showApp() {
  $('loading').hidden = true;
  $('login').hidden = true;
  $('app').hidden = false;
  $('logout').hidden = false;
  say('');
  // Appointments first: the days-off list uses them to warn about customers still booked.
  await loadAppointments();
  await Promise.all([loadSettings(), loadClosed(), loadServices()]);
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('login-error');
  err.hidden = true;
  const btn = $('login-btn');
  btn.disabled = true;
  try {
    await api('/api/admin/login', { method: 'POST', body: { password: $('password').value } });
    $('password').value = '';
    await showApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
    $('password').focus();
  } finally {
    btn.disabled = false;
  }
});

$('show-pw').addEventListener('change', (e) => {
  $('password').type = e.target.checked ? 'text' : 'password';
});

$('logout').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* ignore */ }
  showLogin();
});

// ---------- tabs ----------

const TABS = ['appts', 'hours', 'off', 'prices', 'shop'];
function selectTab(name) {
  for (const t of TABS) {
    $('tab-' + t).setAttribute('aria-selected', String(t === name));
    $('panel-' + t).hidden = t !== name;
  }
  say('');
}
for (const t of TABS) $('tab-' + t).addEventListener('click', () => selectTab(t));

// ---------- appointments ----------

async function loadAppointments() {
  const { today, appointments } = await api('/api/admin/appointments');
  state.today = today;
  state.appointments = appointments;
  $('off-date').min = today;
  const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  $('updated').textContent = `Last updated at ${now}. This page checks for new bookings every minute.`;
  const box = $('appts');
  box.replaceChildren();
  if (!appointments.some((a) => a.date >= today && a.status === 'booked')) {
    box.append(el('p', { class: 'notice info', text: 'No upcoming appointments. New bookings will show up here.' }));
  }
  if (!appointments.length) {
    return;
  }
  const groups = new Map();
  for (const a of appointments) {
    if (!groups.has(a.date)) groups.set(a.date, []);
    groups.get(a.date).push(a);
  }
  for (const [date, list] of groups) {
    const past = date < today;
    let label;
    if (date === today) label = 'Today';
    else if (date === addDays(today, 1)) label = 'Tomorrow';
    else label = midDate.format(utcDate(date));
    const active = list.filter((a) => a.status === 'booked').length;
    // Active bookings first, cancelled ones at the bottom of the day.
    const sorted = [...list.filter((a) => a.status === 'booked'), ...list.filter((a) => a.status !== 'booked')];
    const cards = sorted.map(apptCard);
    if (past) {
      const d = el('details', { class: 'day-group past' },
        el('summary', { text: `${label} (earlier, ${active} booked)` }));
      d.append(...cards);
      box.append(d);
    } else {
      const count = active === 1 ? '1 car' : `${active} cars`;
      const h = el('h3', {}, document.createTextNode(label + ' '), el('span', { class: 'count', text: `· ${count}` }));
      box.append(el('div', { class: 'day-group' }, h, ...cards));
    }
  }
}

function apptCard(a) {
  const cancelled = a.status === 'cancelled';
  const dl = el('dl', {},
    el('dt', { text: 'Phone' }),
    el('dd', {}, el('a', { class: 'phone-link', href: 'tel:' + a.phone.replace(/[^\d+]/g, ''), text: a.phone })),
    el('dt', { text: 'Car' }), el('dd', { text: a.car }),
    el('dt', { text: 'Needs' }), el('dd', { text: a.service }));
  if (a.note) dl.append(el('dt', { text: 'Note' }), el('dd', { text: a.note }));

  const top = el('div', { class: 'top' },
    el('span', { class: 'when', text: time12(a.time) }),
    el('span', { class: 'who', text: a.name }));
  const card = el('article', { class: 'card appt' + (cancelled ? ' cancelled' : '') }, top, dl);
  if (cancelled) {
    top.append(el('span', { class: 'badge', text: 'Cancelled' }));
  } else {
    const btn = el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Cancel' });
    btn.setAttribute('aria-label', `Cancel the appointment for ${a.name} at ${time12(a.time)}`);
    btn.addEventListener('click', guard(async () => {
      if (!confirm(`Cancel the appointment for ${a.name} at ${time12(a.time)}?`)) return;
      await api(`/api/admin/appointments/${a.id}/cancel`, { method: 'POST' });
      say('Appointment cancelled.');
      await loadAppointments();
      await loadClosed();
    }));
    card.append(btn);
  }
  return card;
}

$('refresh').addEventListener('click', guard(async () => { await loadAppointments(); say('Up to date.'); }));

// Check for new bookings every minute while the appointments list is on screen.
async function autoRefresh() {
  if (document.hidden || $('app').hidden || $('panel-appts').hidden) return;
  try { await loadAppointments(); } catch { /* try again next time */ }
}
setInterval(autoRefresh, 60 * 1000);
document.addEventListener('visibilitychange', autoRefresh);

// ---------- opening hours ----------

function buildWeek() {
  const box = $('week');
  box.replaceChildren();
  const week = state.settings.schedule.week;
  for (const i of ORDER) {
    const r = week[i];
    const toggle = el('button', { type: 'button', class: 'toggle', id: `open-${i}`, 'aria-pressed': String(r.open), text: r.open ? 'Open' : 'Closed' });
    toggle.setAttribute('aria-label', `${WEEKDAYS[i]}: ${r.open ? 'Open' : 'Closed'}. Tap to change.`);
    const from = el('input', { type: 'time', id: `from-${i}`, value: r.start });
    const to = el('input', { type: 'time', id: `to-${i}`, value: r.end });
    const range = el('div', { class: 'range' },
      el('div', {}, el('label', { for: `from-${i}`, text: 'From' }), from),
      el('div', {}, el('label', { for: `to-${i}`, text: 'To' }), to));
    const closedNote = el('p', { class: 'closed-note', text: 'Closed all day. Nobody can book.' });
    range.hidden = !r.open;
    closedNote.hidden = r.open;
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(open));
      toggle.textContent = open ? 'Open' : 'Closed';
      toggle.setAttribute('aria-label', `${WEEKDAYS[i]}: ${open ? 'Open' : 'Closed'}. Tap to change.`);
      range.hidden = !open;
      closedNote.hidden = open;
      slotHint();
    });
    from.addEventListener('change', slotHint);
    box.append(el('div', { class: 'week-row' }, el('span', { class: 'day-name', text: WEEKDAYS[i] }), toggle, range, closedNote));
  }
}

// Show the owner what the chosen length means, e.g. "8:00 AM, 8:30 AM, 9:00 AM and so on".
function slotHint() {
  const len = Number($('slotMinutes').value);
  const first = ORDER.find((i) => $(`open-${i}`)?.getAttribute('aria-pressed') === 'true');
  if (first === undefined || !len) {
    $('slot-hint').textContent = 'How much time each booking takes up.';
    return;
  }
  const [h, m] = ($(`from-${first}`).value || '09:00').split(':').map(Number);
  const times = [0, 1, 2].map((k) => {
    const t = h * 60 + m + k * len;
    return time12(`${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  });
  $('slot-hint').textContent = `Customers will see times like ${times.join(', ')} and so on.`;
}
$('slotMinutes').addEventListener('change', slotHint);

function fillSettings() {
  const { schedule, shop } = state.settings;
  buildWeek();
  $('slotMinutes').value = String(schedule.slotMinutes);
  $('capacity').value = schedule.capacity;
  $('daysAhead').value = schedule.daysAhead;
  $('minNoticeHours').value = schedule.minNoticeHours;
  slotHint();
  $('shop-name').value = shop.name;
  $('shop-email').value = shop.email || '';
  $('shop-phone').value = shop.phone;
  $('shop-address').value = shop.address;
  $('shop-about').value = shop.about;
}

async function loadSettings() {
  state.settings = await api('/api/admin/settings');
  fillSettings();
}

async function saveSettings(next) {
  const saved = await api('/api/admin/settings', { method: 'PUT', body: next });
  state.settings = saved;
  fillSettings();
  say('Saved ✓');
}

$('hours-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const week = {};
  for (const i of ORDER) {
    const open = $(`open-${i}`).getAttribute('aria-pressed') === 'true';
    week[i] = { open, start: $(`from-${i}`).value || '09:00', end: $(`to-${i}`).value || '17:00' };
  }
  const num = (id) => ($(id).value.trim() === '' ? NaN : Number($(id).value));
  const schedule = {
    slotMinutes: Number($('slotMinutes').value),
    capacity: num('capacity'),
    daysAhead: num('daysAhead'),
    minNoticeHours: num('minNoticeHours'),
    week,
  };
  await saveSettings({ schedule, shop: state.settings.shop });
}));

// ---------- shop details ----------

$('shop-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const shop = {
    name: $('shop-name').value,
    email: $('shop-email').value,
    phone: $('shop-phone').value,
    address: $('shop-address').value,
    about: $('shop-about').value,
  };
  await saveSettings({ schedule: state.settings.schedule, shop });
}));

$('pw-show').addEventListener('change', (e) => {
  for (const id of ['pw-current', 'pw-new', 'pw-new2']) $(id).type = e.target.checked ? 'text' : 'password';
});

$('pw-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const next = $('pw-new').value;
  if (next.length < 8) { say('Please use at least 8 characters.', 'bad'); return; }
  if (next !== $('pw-new2').value) { say("The new passwords don't match.", 'bad'); return; }
  await api('/api/admin/password', { method: 'POST', body: { current: $('pw-current').value, next } });
  for (const id of ['pw-current', 'pw-new', 'pw-new2']) $(id).value = '';
  say('Password changed. Use the new one next time you log in.');
}));

// ---------- prices ----------
// The list is edited on the page and only sent to the server when the owner presses Save.
// Each item can have optional "price lines", e.g. different prices for different rim sizes.

const MAX_LINES = 15;
let services = [];

async function loadServices() {
  ({ services } = await api('/api/admin/services'));
  renderServices();
}

// Copy what is typed in the boxes back into the list (before moving or removing anything).
function readServices() {
  services = [...document.querySelectorAll('.price-item')].map((card) => ({
    name: card.querySelector('[data-k=name]').value,
    price: card.querySelector('[data-k=price]').value,
    note: card.querySelector('[data-k=note]').value,
    options: [...card.querySelectorAll('.opt-row')].map((row) => ({
      label: row.querySelector('[data-k=label]').value,
      price: row.querySelector('[data-k=oprice]').value,
    })),
  }));
}

function optionRows(s, i) {
  const wrap = el('div', { class: 'opt-list' });
  (s.options || []).forEach((o, j) => {
    const lid = `opt-label-${i}-${j}`;
    const pid = `opt-price-${i}-${j}`;
    const remove = el('button', { type: 'button', class: 'btn btn-ghost btn-small opt-remove', text: 'Remove' });
    remove.setAttribute('aria-label', `Remove price line ${j + 1}`);
    remove.addEventListener('click', () => {
      readServices();
      services[i].options.splice(j, 1);
      renderServices();
    });
    wrap.append(el('div', { class: 'opt-row' },
      el('div', { class: 'opt-label' },
        el('label', { for: lid, text: 'For' }),
        el('input', { type: 'text', id: lid, 'data-k': 'label', value: o.label || '', maxlength: 80, placeholder: 'e.g. Sedan, 19" to 21" rims' })),
      el('div', { class: 'opt-price' },
        el('label', { for: pid, text: 'Price' }),
        el('input', { type: 'text', id: pid, 'data-k': 'oprice', value: o.price || '', maxlength: 30, placeholder: 'e.g. $25 a tire' })),
      remove));
  });
  const add = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: '+ Add a price line' });
  add.addEventListener('click', () => {
    readServices();
    const opts = services[i].options;
    if (opts.length >= MAX_LINES) { say(`Up to ${MAX_LINES} price lines per item.`, 'bad'); return; }
    opts.push({ label: '', price: '' });
    renderServices();
    $(`opt-label-${i}-${opts.length - 1}`).focus();
  });
  return el('div', { class: 'opt-box' },
    el('p', { class: 'opt-title' }, document.createTextNode('Different prices '), el('span', { class: 'hint', text: '(optional, e.g. by rim size)' })),
    wrap, add);
}

function renderServices(focusIndex) {
  const box = $('price-items');
  box.replaceChildren();
  services.forEach((s, i) => {
    const id = (k) => `svc-${k}-${i}`;
    const up = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: '↑ Up', disabled: i === 0 });
    const down = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: '↓ Down', disabled: i === services.length - 1 });
    const remove = el('button', { type: 'button', class: 'btn btn-danger btn-small', text: 'Remove item' });
    const label = s.name ? `"${s.name}"` : `item ${i + 1}`;
    up.setAttribute('aria-label', `Move ${label} up`);
    down.setAttribute('aria-label', `Move ${label} down`);
    remove.setAttribute('aria-label', `Remove ${label}`);
    up.addEventListener('click', () => { readServices(); [services[i - 1], services[i]] = [services[i], services[i - 1]]; renderServices(); });
    down.addEventListener('click', () => { readServices(); [services[i + 1], services[i]] = [services[i], services[i + 1]]; renderServices(); });
    remove.addEventListener('click', () => {
      readServices();
      if (services.length === 1) { say('Please keep at least one item.', 'bad'); return; }
      if (!confirm(`Remove ${label} from the price list?`)) return;
      services.splice(i, 1);
      renderServices();
      say('Removed. Press "Save prices" to update the website.', 'warn');
    });

    const note = el('textarea', { id: id('note'), 'data-k': 'note', maxlength: 300, rows: 3, placeholder: 'e.g. Price is per tire and includes balancing.' });
    note.value = s.note || '';

    box.append(el('div', { class: 'card price-item' },
      el('p', { class: 'item-num', text: `Item ${i + 1}` }),
      el('div', { class: 'row2' },
        el('div', { class: 'field' },
          el('label', { for: id('name'), text: 'What it is' }),
          el('input', { type: 'text', id: id('name'), 'data-k': 'name', value: s.name || '', maxlength: 60, placeholder: 'e.g. Tire change and balance' })),
        el('div', { class: 'field' },
          el('label', { for: id('price'), text: 'Main price' }),
          el('input', { type: 'text', id: id('price'), 'data-k': 'price', value: s.price || '', maxlength: 30, placeholder: 'e.g. $90 an hour' }))),
      el('div', { class: 'field' },
        el('label', { for: id('note') }, document.createTextNode('Description '), el('span', { class: 'hint', text: '(optional)' })),
        note),
      optionRows(s, i),
      el('div', { class: 'item-tools' }, up, down, remove)));
  });
  if (focusIndex !== undefined) {
    const first = $(`svc-name-${focusIndex}`);
    first.scrollIntoView({ block: 'center' });
    first.focus({ preventScroll: true });
  }
}

$('add-item').addEventListener('click', () => {
  readServices();
  if (services.length >= 30) { say('You can have up to 30 items.', 'bad'); return; }
  services.push({ name: '', price: '', note: '', options: [] });
  renderServices(services.length - 1);
});

$('prices-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  readServices();
  ({ services } = await api('/api/admin/services', { method: 'PUT', body: { services } }));
  renderServices();
  say('Prices saved ✓');
}));

// ---------- days off ----------

async function loadClosed() {
  const { days } = await api('/api/admin/closed-dates');
  const box = $('off-list');
  box.replaceChildren();
  if (!days.length) {
    box.append(el('p', { class: 'notice info', text: 'No days off are set.' }));
    return;
  }
  for (const d of days) {
    const btn = el('button', { type: 'button', class: 'btn btn-ghost btn-small', text: 'Remove' });
    btn.setAttribute('aria-label', `Remove day off ${shortDate.format(utcDate(d.date))}`);
    btn.addEventListener('click', guard(async () => {
      await api(`/api/admin/closed-dates/${d.date}`, { method: 'DELETE' });
      say('Day off removed.');
      await loadClosed();
    }));
    const what = el('div', { class: 'what' },
      el('strong', { text: shortDate.format(utcDate(d.date)) }),
      el('div', { class: 'muted', text: d.reason || '' }));
    const n = bookedOn(d.date).length;
    if (n) what.append(el('div', { class: 'warn-text', text: `${n} ${n === 1 ? 'customer is' : 'customers are'} still booked this day. Call them to move it.` }));
    box.append(el('div', { class: 'list-row' }, what, btn));
  }
}

$('off-form').addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  const date = $('off-date').value;
  if (!date) { say('Please pick a day first.', 'bad'); return; }
  if (date < state.today) { say('That day is in the past. Please pick a day from today on.', 'bad'); return; }
  await api('/api/admin/closed-dates', { method: 'POST', body: { date, reason: $('off-reason').value } });
  $('off-date').value = '';
  $('off-reason').value = '';
  const n = bookedOn(date).length;
  if (n) say(`Day off added. You still have ${n} ${n === 1 ? 'appointment' : 'appointments'} that day. Call ${n === 1 ? 'that customer' : 'those customers'} to move it.`, 'warn');
  else say('Day off added. Nobody can book that day now.');
  await loadClosed();
}));

// ---------- start ----------

(async () => {
  try {
    const res = await fetch('/api/admin/me');
    if (res.ok) await showApp();
    else showLogin();
  } catch {
    showLogin();
  }
})();
