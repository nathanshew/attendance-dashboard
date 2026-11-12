// Unlocks data.enc.json with the password and shows it. Every figure comes from
// the file; this page only formats, filters and sorts what it is given. Decrypted
// data and the password live in memory only, and nothing about them is stored.

import { lineChart, barChart, rollDots } from './charts.js';

const $ = (id) => document.getElementById(id);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DASH = '–';
const PAGE = 30;
const LONG_PREVIEW = 8;

/* Formatting */
const parts = (iso) => iso.split('-').map(Number);
const dateShort = (iso) => { if (!iso) return DASH; const [, m, d] = parts(iso); return `${d} ${MONTHS[m - 1]}`; };
const pct = (v, dp = 0) => (v == null ? DASH : `${(v * 100).toFixed(dp)}%`);
const num = (v) => (v == null ? DASH : Number(v).toLocaleString('en-GB', { maximumFractionDigits: 1 }));
const sundays = (n) => `${n} Sunday${n === 1 ? '' : 's'}`;

function updatedText(stamp) {
  const when = new Date(stamp);
  if (Number.isNaN(when.getTime())) return '';
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(when).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return `Updated ${f.weekday} ${f.day} ${f.month}, ${f.hour}:${f.minute} ${String(f.dayPeriod).toLowerCase()}`;
}

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Names are always set through textContent. The lang hint picks the right
// glyph forms for shared characters.
function nameEl(tag, className, name) {
  const node = make(tag, className, name);
  node.lang = 'zh-Hans';
  return node;
}

/* Page states */
function showState(kind, title, body, actionLabel, action) {
  $('app').hidden = true;
  $('jump').hidden = true;
  $('unlock').hidden = true;
  const box = $('state');
  box.hidden = false;
  box.dataset.kind = kind;
  $('state-title').textContent = title;
  $('state-body').textContent = body;
  const btn = $('state-action');
  btn.hidden = !actionLabel;
  if (actionLabel) {
    btn.textContent = actionLabel;
    btn.onclick = action;
  }
}

/* Unlock */
const bytes = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

async function decrypt(file, password) {
  const secret = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: bytes(file.salt), iterations: file.iterations },
    secret,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(file.iv) }, key, bytes(file.ciphertext));
  return new TextDecoder().decode(plain);
}

const damaged = () => showState('error', 'Could not read the data', 'The data file looks damaged. Wait for the next update, then try again.', 'Try again', boot);

// Resolves to the encrypted file, or to null once an error is on screen.
async function fetchFile() {
  let res;
  try {
    // GitHub Pages headers cannot be set, so no-store keeps each visit current.
    res = await fetch('data.enc.json', { cache: 'no-store' });
  } catch {
    showState('error', 'Could not load the data', 'Check your connection and try again.', 'Try again', boot);
    return null;
  }
  if (!res.ok) {
    showState('error', 'Could not load the data', `The server answered with error ${res.status}. Try again in a moment.`, 'Try again', boot);
    return null;
  }
  try {
    const file = await res.json();
    if (file.v !== 1 || !file.salt || !file.iv || !file.ciphertext || !file.iterations) throw new Error('format');
    return file;
  } catch {
    damaged();
    return null;
  }
}

let fileReady = null;

// The form appears at once and the file downloads while the password is typed.
function boot() {
  if (!window.crypto?.subtle) {
    showState('error', 'This browser cannot unlock the page', 'Open the page from its https link in an up-to-date browser.');
    return;
  }
  $('state').hidden = true;
  $('unlock').hidden = false;
  if (matchMedia('(hover: hover)').matches) $('password').focus();
  fileReady = fetchFile();
}

// Chrome on Android only offers to save when told the form succeeded, because
// the page never navigates. The browser's password manager holds it, not this page.
function offerToSave(form) {
  if (!window.PasswordCredential) return;
  try {
    navigator.credentials.store(new PasswordCredential(form)).catch(() => {});
  } catch { /* saving is optional */ }
}

function setupUnlock() {
  const form = $('unlock-form');
  const input = $('password');
  const toggle = $('pw-toggle');
  const submit = $('unlock-submit');
  const error = $('unlock-error');
  let busy = false;

  const setVisible = (show) => {
    input.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
    toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  };
  const setBusy = (on) => {
    busy = on;
    $('unlock').classList.toggle('is-busy', on);
    form.setAttribute('aria-busy', String(on));
    submit.disabled = on;
    input.readOnly = on;
    submit.textContent = on ? 'Unlocking…' : 'Unlock';
  };
  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    input.select();
  };

  toggle.onclick = () => setVisible(input.type === 'password');
  input.oninput = () => {
    error.hidden = true;
    input.removeAttribute('aria-invalid');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!input.value) {
      fail('Enter the password to continue.');
      return;
    }
    error.hidden = true;
    setBusy(true);
    const file = await fileReady;
    if (!file) {
      setBusy(false);
      return;
    }
    let text;
    try {
      text = await decrypt(file, input.value);
    } catch (err) {
      setBusy(false);
      if (err.name === 'OperationError') fail('That password is not right. Check it and try again.');
      else damaged();
      return;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      setBusy(false);
      damaged();
      return;
    }
    setVisible(false);
    offerToSave(form);
    input.value = '';
    setBusy(false);
    show(data);
  });
}

// Reloading is the one sure way to drop every decrypted value, including those
// held by charts, handlers and the page itself.
function lock() {
  history.replaceState(null, '', location.pathname + location.search);
  location.reload();
}

// The password field has just gone, so keyboard and screen reader users would
// otherwise be dropped at the top of the document.
function focusHeading() {
  const heading = $('sunday-title');
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

function show(data) {
  $('unlock').hidden = true;
  $('lock').hidden = false;
  if (!data || !data.latest_sunday || !Array.isArray(data.weeks)) {
    showHeader(data || {});
    showState('empty', 'No Sundays recorded yet', 'Attendance will appear here after the first Sunday is keyed in.');
    focusHeading();
    return;
  }
  $('skip').hidden = false;
  $('brand').hidden = false;
  render(data);
  focusHeading();
}

/* Sections */
function showHeader(data) {
  if (data.latest_sunday) {
    const [y, m, d] = parts(data.latest_sunday);
    const title = $('sunday-title');
    title.textContent = `Sunday ${d} ${MONTHS_LONG[m - 1]}`;
    title.append(make('span', 'top__year', ` ${y}`));
  }
  const up = data.generated_at ? updatedText(data.generated_at) : '';
  $('updated').textContent = up;
  $('updated').hidden = !up;
  $('pending').textContent = data.pending_sunday ? `${dateShort(data.pending_sunday)} has not been keyed in yet` : '';
  $('pending').hidden = !data.pending_sunday;
}

function showHeadline(data, week) {
  const s = data.summary || {};
  // Same one decimal the bot's message uses, with the decimal set smaller.
  const hero = $('hero-rate');
  const [whole, frac] = pct(s.this_week_rate, 1).split('.');
  hero.replaceChildren(whole);
  if (frac) hero.append(make('small', '', `.${frac}`));
  $('hero-sub').textContent = week && week.roster_present != null
    ? `${num(week.roster_present)} of ${num(data.roster_size)} on the roll` : '';

  const calls = data.absent?.new?.length ?? 0;
  const long = data.absent?.long_term?.length ?? 0;
  $('hero-calls-link').hidden = !calls && !long;
  $('hero-calls').textContent = calls ? `${calls} to call` : `${long} long-term`;

  $('tile-avg').textContent = pct(s.average_rate, 1);
  $('tile-ma').textContent = pct(s.moving_average_4, 1);

  const change = $('tile-change');
  change.classList.remove('is-up', 'is-down');
  change.replaceChildren();
  const c = s.change_vs_last_week;
  if (c == null) {
    change.textContent = DASH;
    $('tile-change-sub').textContent = 'No earlier Sunday to compare';
  } else {
    const points = (Math.abs(c) * 100).toFixed(1);
    if (Number(points) === 0) {
      change.textContent = 'No change';
    } else {
      change.classList.add(c > 0 ? 'is-up' : 'is-down');
      change.append(make('span', 'arrow', c > 0 ? '▲' : '▼'), points, make('small', '', 'pts'));
    }
    $('tile-change-sub').textContent = `Last Sunday ${pct(s.last_week_rate, 1)}`;
  }

  $('tile-people').textContent = num(s.this_week_people);
  const bits = [];
  if (s.this_week_am != null) bits.push(`${num(s.this_week_am)} Morning`);
  if (s.this_week_pm != null) bits.push(`${num(s.this_week_pm)} Evening`);
  if (s.this_week_guests) bits.push(`${num(s.this_week_guests)} guest${s.this_week_guests === 1 ? '' : 's'}`);
  $('tile-people-sub').replaceChildren(...bits.map((b) => make('span', '', b)));
}

function showFollowUp(data) {
  const fresh = data.absent?.new || [];
  const long = data.absent?.long_term || [];
  const back = data.returned || [];

  const total = data.absent?.total ?? fresh.length + long.length;
  $('care-eyebrow').textContent = total ? `Who needs a call · ${total} absent in total` : 'Who needs a call';
  $('care-title').textContent = fresh.length ? `${fresh.length} newly absent` : 'Newly absent';
  $('care-sub').hidden = !fresh.length;
  $('new-empty').hidden = fresh.length > 0;
  // Everyone at exactly 3 weeks normally shares one last-seen date, so say it
  // once in the heading and let the names breathe.
  const sameDate = new Set(fresh.map((p) => p.last_seen)).size === 1;
  $('care-sub').textContent = sameDate && fresh[0].last_seen
    ? `Missed the last 3 Sundays. Last seen ${dateShort(fresh[0].last_seen)}.`
    : 'Missed the last 3 Sundays';
  $('new-list').classList.toggle('is-dated', !sameDate);
  $('new-list').replaceChildren(...fresh.map((p) => {
    const li = make('li');
    li.append(nameEl('span', 'care__name', p.name));
    if (!sameDate) li.append(make('span', 'care__seen', p.last_seen ? `Last seen ${dateShort(p.last_seen)}` : 'Not seen this year'));
    return li;
  }));

  const wa = $('whatsapp');
  wa.hidden = !data.whatsapp_text;
  if (data.whatsapp_text) wa.href = `https://wa.me/?text=${encodeURIComponent(data.whatsapp_text)}`;
  // The message carries everyone, not only the names in this card.
  $('whatsapp-label').textContent = total ? `Forward to WhatsApp (${total})` : 'Forward to WhatsApp';
  wa.setAttribute('aria-label', total ? `Forward to WhatsApp: ${total} absent people, and anyone who came back this Sunday` : 'Forward to WhatsApp');

  $('returned-box').hidden = !back.length;
  $('returned-title').textContent = `Welcome back, ${back.length === 1 ? '1 person' : `${back.length} people`} returned`;
  $('returned-list').replaceChildren(...back.map((p) => {
    const li = make('li');
    li.append(nameEl('span', '', p.name), make('span', 'sub', `after ${sundays(p.missed)} away`));
    return li;
  }));

  $('long-title').textContent = long.length ? `${long.length} long-term absent` : 'Long-term absent';
  $('long-empty').hidden = long.length > 0;
  const list = $('long-list');
  const more = $('long-more');
  let open = false;
  const drawLong = () => {
    const shown = open ? long : long.slice(0, LONG_PREVIEW);
    list.replaceChildren(...shown.map((p) => {
      const li = make('li');
      li.append(nameEl('span', 'n', p.name), make('span', 'w', `${sundays(p.streak)} · ${p.last_seen ? dateShort(p.last_seen) : 'not seen'}`));
      return li;
    }));
    more.hidden = long.length <= LONG_PREVIEW;
    more.textContent = open ? 'Show fewer' : `Show all ${long.length}`;
    more.setAttribute('aria-expanded', String(open));
  };
  more.onclick = () => { open = !open; drawLong(); };
  drawLong();
}

const gapNote = (w) => (w.status === 'no_service' ? 'No service' : w.status === 'pending' ? 'Not keyed in yet' : null);

function chartPoints(weeks) {
  let lastMonth = null;
  return weeks.map((w) => {
    const month = parts(w.date)[1];
    const tick = month !== lastMonth ? MONTHS[month - 1] : null;
    lastMonth = month;
    return { title: `Sun ${dateShort(w.date)}`, tick, gapNote: gapNote(w) };
  });
}

function drawCharts(data, weeks) {
  const points = chartPoints(weeks);
  const held = (key) => weeks.map((w) => (w.status === 'held' ? w[key] : null));
  lineChart($('chart-trend'), {
    label: 'Weekly attendance rate with 4-week average',
    points,
    wideHeight: 380,
    emptyNote: 'No weekly figures yet.',
    axisFormat: (v) => `${Math.round(v * 100)}%`,
    series: [
      { id: 'weekly', name: 'Rate', values: held('rate'), format: (v) => pct(v, 1), showEnd: true },
      { id: 'ma', name: '4-week avg', values: held('moving_average_4'), format: (v) => pct(v, 1) },
    ],
  });
  lineChart($('chart-service'), {
    label: 'People at the Morning and Evening services each Sunday',
    points,
    wideHeight: 352,
    wholeSteps: true,
    emptyNote: 'No Morning or Evening counts yet.',
    axisFormat: (v) => String(Math.round(v)),
    series: [
      { id: 'am', name: 'Morning', values: held('am'), format: num },
      { id: 'pm', name: 'Evening', values: held('pm'), format: num },
    ],
    blankNote: 'Not split by service',
    missingNote: 'Not recorded',
  });
  const months = data.months || [];
  barChart($('chart-month'), {
    label: 'Average attendance rate by month',
    rows: months.map((m, i) => {
      const [y, mo] = parts(`${m.month}-01`);
      return {
        label: MONTHS[mo - 1],
        value: m.average_rate,
        valueText: pct(m.average_rate),
        now: i === months.length - 1,
        title: `${MONTHS_LONG[mo - 1]} ${y}`,
        tipRows: [
          { name: 'Average rate', value: pct(m.average_rate, 1), color: 'var(--s-ma)' },
          { name: 'People', value: num(m.average_people), color: 'var(--s-weekly)' },
          { name: m.sundays === 1 ? 'Sunday' : 'Sundays', value: num(m.sundays), color: 'transparent' },
        ],
      };
    }),
  });
  const week = weeks.find((w) => w.date === data.latest_sunday);
  rollDots($('roll'), week?.roster_present ?? 0, week?.roster_present == null ? 0 : data.roster_size);
}

function fillTable(table, heads, rows) {
  const thead = make('thead');
  const hr = make('tr');
  heads.forEach((h) => { const th = make('th', '', h); th.scope = 'col'; hr.append(th); });
  thead.append(hr);
  const tbody = make('tbody');
  rows.forEach((cells) => {
    const tr = make('tr');
    cells.forEach((c) => {
      const td = make('td', c.gap ? 'is-gap' : '', c.gap ? c.gap : c);
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.replaceChildren(thead, tbody);
}

function serviceRow(w) {
  const day = dateShort(w.date);
  if (gapNote(w)) return [day, { gap: gapNote(w) }, ''];
  if (w.am == null && w.pm == null) return [day, { gap: 'Not split by service' }, ''];
  const cell = (v) => (v == null ? { gap: 'Not recorded' } : num(v));
  return [day, cell(w.am), cell(w.pm)];
}

function showTables(data, weeks) {
  const newest = [...weeks].reverse();
  fillTable($('table-trend'), ['Sunday', 'Rate', '4-week avg', 'People'], newest.map((w) => (
    gapNote(w)
      ? [dateShort(w.date), { gap: gapNote(w) }, '', '']
      : [dateShort(w.date), pct(w.rate, 1), pct(w.moving_average_4, 1), num(w.people)]
  )));
  fillTable($('table-service'), ['Sunday', 'Morning', 'Evening'], newest.map((w) => (
    serviceRow(w)
  )));
  fillTable($('table-month'), ['Month', 'Rate', 'People', 'Sundays'], [...(data.months || [])].reverse().map((m) => {
    const [y, mo] = parts(`${m.month}-01`);
    return [`${MONTHS[mo - 1]} ${y}`, pct(m.average_rate, 1), num(m.average_people), num(m.sundays)];
  }));
}

/* People */
const collator = new Intl.Collator('zh-Hans-u-co-pinyin');
const sorters = {
  streak: (a, b) => b.streak - a.streak || collator.compare(a.name, b.name),
  // A null rate (no Sundays held yet) sorts last either way.
  'rate-low': (a, b) => (a.rate ?? Infinity) - (b.rate ?? Infinity) || collator.compare(a.name, b.name),
  'rate-high': (a, b) => (b.rate ?? -Infinity) - (a.rate ?? -Infinity) || collator.compare(a.name, b.name),
  name: (a, b) => collator.compare(a.name, b.name),
};
const filters = {
  all: () => true,
  morning: (m) => m.list === 'morning' || m.list === 'both',
  evening: (m) => m.list === 'evening' || m.list === 'both',
  away: (m) => m.streak >= 3,
};

function personRow(m) {
  const li = make('li', 'prow');
  const dots = make('div', 'prow__dots');
  const recent = m.recent || [];
  dots.setAttribute('role', 'img');
  dots.setAttribute('aria-label', `Last ${sundays(recent.length)}, oldest first: ${recent.map((v) => (v ? 'here' : 'away')).join(', ')}`);
  recent.forEach((v) => dots.append(make('i', v ? 'dot dot--on' : 'dot')));

  const state = make('div', 'prow__state');
  const streak = make('span', `prow__streak${m.streak >= 3 ? ' is-away' : ''}`, m.streak ? `Away ${sundays(m.streak)}` : 'Here on the latest Sunday');
  const seen = make('span', '', m.last_seen ? `Seen ${dateShort(m.last_seen)}` : 'Not seen this year');
  state.append(streak);
  if (m.streak) state.append(seen);

  li.append(nameEl('span', 'prow__name', m.name), make('span', 'prow__rate', pct(m.rate)), dots, state);
  return li;
}

function setupPeople(members) {
  const view = { query: '', filter: 'all', sort: 'name', limit: PAGE };
  const search = $('people-search');
  const sort = $('people-sort');
  const chips = [...document.querySelectorAll('.chip')];

  const draw = () => {
    const q = view.query.trim().toLowerCase();
    const matched = members
      .filter((m) => filters[view.filter](m) && (!q || m.name.toLowerCase().includes(q)))
      .sort(sorters[view.sort]);
    const shown = matched.slice(0, view.limit);
    $('people-list').replaceChildren(...shown.map(personRow));

    const none = matched.length === 0;
    $('people-empty').hidden = !none;
    if (none) {
      $('people-empty-text').textContent = q
        ? `Nobody matches “${view.query.trim()}”. Check the spelling or clear the search.`
        : (members.length ? 'Nobody fits this filter right now.' : 'No people in the data yet.');
    }
    $('people-count').textContent = none ? '' : `Showing ${shown.length} of ${matched.length}`;
    const more = $('people-more');
    more.hidden = shown.length >= matched.length;
    more.textContent = `Show ${Math.min(PAGE, matched.length - shown.length)} more`;
  };

  search.oninput = () => { view.query = search.value; view.limit = PAGE; draw(); };
  sort.onchange = () => { view.sort = sort.value; view.limit = PAGE; draw(); };
  chips.forEach((chip) => {
    chip.onclick = () => {
      view.filter = chip.dataset.filter;
      view.limit = PAGE;
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      draw();
    };
  });
  $('people-more').onclick = () => { view.limit += PAGE; draw(); };
  $('people-clear').onclick = () => {
    search.value = '';
    view.query = '';
    view.filter = 'all';
    view.limit = PAGE;
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.filter === 'all')));
    draw();
    search.focus();
  };
  draw();
}

function showWarnings(data) {
  const list = data.warnings || [];
  $('warnings').hidden = !list.length;
  $('warnings-title').textContent = `Data notes (${list.length})`;
  $('warnings-list').replaceChildren(...list.map((w) => {
    const li = make('li');
    const where = [w.cell, w.date && dateShort(w.date)].filter(Boolean).join(' · ');
    if (where) li.append(make('span', '', where));
    li.append(w.message ?? '');
    return li;
  }));
}

function render(data) {
  // Future Sundays have nothing to show, so charts stop at the latest known week.
  const weeks = data.weeks.filter((w) => w.status !== 'future');
  const week = weeks.find((w) => w.date === data.latest_sunday);

  showHeader(data);
  $('state').hidden = true;
  $('app').hidden = false;
  $('jump').hidden = false;

  const note = data.notes?.evening;
  $('service-note').textContent = note ? ` ${note}` : '';
  $('service-note').hidden = !note;

  showHeadline(data, week);
  showFollowUp(data);
  showTables(data, weeks);
  setupPeople(data.members || []);
  showWarnings(data);
  drawCharts(data, weeks);

  // Charts are drawn to real pixels, so redraw when the width changes.
  let lastWidth = $('app').clientWidth;
  let frame = 0;
  new ResizeObserver(() => {
    const width = $('app').clientWidth;
    if (width === lastWidth) return;
    lastWidth = width;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => drawCharts(data, weeks));
  }).observe($('app'));
}

/* Theme */
function setupTheme() {
  const root = document.documentElement;
  const btn = $('theme-toggle');
  const media = matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (root.dataset.theme ? root.dataset.theme === 'dark' : media.matches);
  const sync = () => {
    const dark = isDark();
    root.dataset.dark = dark ? '1' : '0';
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  };
  btn.onclick = () => {
    const next = isDark() ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* not saved, still applied */ }
    sync();
  };
  media.addEventListener('change', sync);
  sync();
}

setupTheme();
setupUnlock();
$('lock').onclick = lock;
boot();
