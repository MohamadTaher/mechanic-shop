// Helpers shared by the customer pages (booking page and prices page).
// All text from the server is put on the page with textContent only.

export const OTHER_SERVICE = 'Something else';

export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...kids) {
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

export async function api(path, options) {
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

export function time12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export const telHref = (phone) => 'tel:' + phone.replace(/[^\d+]/g, '');
export const mailHref = (email) => 'mailto:' + email;
export const mapHref = (address) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address);

// "email you@shop.com" / "call 555-1234" / "call 555-1234 or email you@shop.com" as links.
// Returns null when the shop has given neither.
// Pass capital=true when it starts a sentence ("Email ...").
export function contactWays(shop, capital = false) {
  const phone = (shop.phone || '').trim();
  const email = (shop.email || '').trim();
  const parts = [];
  if (phone) parts.push('call ', el('a', { href: telHref(phone), text: phone }));
  if (phone && email) parts.push(' or ');
  if (email) parts.push('email ', el('a', { href: mailHref(email), text: email }));
  if (capital && parts.length) parts[0] = parts[0][0].toUpperCase() + parts[0].slice(1);
  return parts.length ? parts : null;
}

// Shop name, header call button, footer.
export function renderChrome(shop) {
  for (const id of ['shop-name', 'foot-name']) if ($(id)) $(id).textContent = shop.name;
  if ($('year')) $('year').textContent = new Date().getFullYear();
  const phone = (shop.phone || '').trim();
  const call = $('call-top');
  if (call) {
    call.hidden = !phone;
    if (phone) {
      call.href = telHref(phone);
      call.setAttribute('aria-label', `Call us at ${phone}`);
      $('call-top-num').textContent = phone;
    }
  }
}
