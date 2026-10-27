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
    list.append(el('li', { class: 'price-row' }, left, el('div', { class: 'price-amount', text: s.price })));
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
