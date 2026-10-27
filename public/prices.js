// Prices page: the owner's price list, read from the server.

import { $, el, api, contactWays, renderChrome, OTHER_SERVICE } from '/common.js';

function render(info) {
  document.title = `Prices - ${info.shop.name}`;
  renderChrome(info.shop);

  const list = $('prices');
  list.replaceChildren();
  const all = [...(info.services || []), { name: OTHER_SERVICE, price: 'Ask us', note: 'Tell us what is going on and we will give you a price.' }];
  for (const s of all) {
    const left = el('div', { class: 'price-what' }, el('h2', { class: 'price-name', text: s.name }));
    if (s.note) left.append(el('p', { class: 'price-note', text: s.note }));
    const row = el('li', { class: 'price-row' },
      el('div', { class: 'price-head' }, left, el('div', { class: 'price-amount', text: s.price })));
    const opts = (s.options || []).filter((o) => o.label || o.price);
    if (opts.length) {
      const table = el('table', { class: 'price-table' });
      table.append(el('caption', { class: 'sr-only', text: `${s.name} prices` }));
      const body = el('tbody');
      for (const o of opts) body.append(el('tr', {}, el('th', { scope: 'row', text: o.label }), el('td', { text: o.price })));
      table.append(body);
      row.append(table);
    }
    list.append(row);
  }
  list.hidden = false;

  const ways = contactWays(info.shop, true);
  $('ask').replaceChildren();
  $('ask').hidden = !ways;
  if (ways) $('ask').append('Not sure what you need? ', ...ways, ' and ask.');
}

async function load() {
  $('loading').hidden = false;
  $('load-error').hidden = true;
  try {
    render(await api('/api/info'));
  } catch {
    $('load-error').hidden = false;
  } finally {
    $('loading').hidden = true;
  }
}

$('retry').addEventListener('click', load);
load();
