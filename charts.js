// Hand-written SVG charts. They draw what they are given and calculate nothing
// about attendance; the only arithmetic here is pixel placement.

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs, parent, text) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
  if (text != null) node.textContent = text;
  if (parent) parent.appendChild(node);
  return node;
}

// A round top value for the axis, and the step between ticks.
function niceScale(maxValue, wholeSteps = false, ticks = 4) {
  if (!(maxValue > 0)) return { top: wholeSteps ? 4 : 1, step: wholeSteps ? 1 : 0.25 };
  const raw = maxValue / ticks;
  const pow = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  if (wholeSteps) step = Math.max(1, Math.ceil(step));
  return { top: Math.ceil((maxValue * 1.04) / step) * step, step };
}

// One tooltip per chart, shared by mouse, touch and keyboard.
// Touch: tap or slide sideways to move it; tap elsewhere to dismiss.
function bindTooltip(host, { count, indexAt, start, onShow, onHide, label }) {
  host._abort?.abort();
  const abort = new AbortController();
  host._abort = abort;
  const signal = abort.signal;

  host.tabIndex = 0;
  host.setAttribute('role', 'group');
  host.setAttribute('aria-roledescription', 'chart');
  host.setAttribute('aria-label', `${label}. Use the left and right arrow keys to read each value.`);

  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.hidden = true;
  tip.setAttribute('role', 'status');
  host.appendChild(tip);

  let current = null;
  let byKeyboard = false;
  const show = (i) => {
    if (i == null || i < 0 || i >= count) return;
    current = i;
    tip.hidden = false;
    onShow(i, tip);
  };
  const hide = () => {
    current = null;
    tip.hidden = true;
    onHide();
  };
  const point = (e) => {
    const box = host.getBoundingClientRect();
    return indexAt(e.clientX - box.left, e.clientY - box.top);
  };

  const showAtPointer = (e) => { byKeyboard = false; show(point(e)); };
  host.addEventListener('pointerdown', showAtPointer, { signal });
  host.addEventListener('pointermove', showAtPointer, { signal });
  host.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); }, { signal });
  // A finger that starts on a chart and scrolls the page ends in pointercancel.
  host.addEventListener('pointercancel', hide, { signal });
  // Tabbing to a chart scrolls it into view, so keyboard tooltips ignore scrolling.
  window.addEventListener('scroll', () => { if (current != null && !byKeyboard) hide(); }, { signal, passive: true });
  document.addEventListener('pointerdown', (e) => { if (!host.contains(e.target)) hide(); }, { signal });
  host.addEventListener('keydown', (e) => {
    byKeyboard = true;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); show(Math.max(0, (current ?? start + 1) - 1)); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); show(Math.min(count - 1, (current ?? start - 1) + 1)); }
    else if (e.key === 'Escape') hide();
  }, { signal });
  host.addEventListener('focus', () => {
    if (!host.matches(':focus-visible')) return;
    byKeyboard = true;
    show(current ?? start);
  }, { signal });
  host.addEventListener('blur', hide, { signal });
}

function placeTip(tip, host, anchorX, anchorY) {
  const W = host.clientWidth;
  const w = tip.offsetWidth;
  const gap = 12;
  let left = anchorX + gap;
  if (left + w > W) left = anchorX - gap - w;
  if (left < 0) left = Math.max(0, Math.min(W - w, anchorX - w / 2));
  tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(anchorY)}px)`;
}

function fillTip(tip, title, rows, note) {
  tip.replaceChildren();
  const head = document.createElement('div');
  head.className = 'tip__date';
  head.textContent = title;
  tip.appendChild(head);
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = 'tip__row';
    const key = document.createElement('i');
    key.className = 'tip__key';
    key.style.background = row.color;
    const val = document.createElement('b');
    val.textContent = row.value;
    const name = document.createElement('span');
    name.textContent = row.name;
    line.append(key, val, name);
    tip.appendChild(line);
  }
  if (note) {
    const n = document.createElement('div');
    n.className = 'tip__note';
    n.textContent = note;
    tip.appendChild(n);
  }
}

/* Line chart.
   points: [{ title, tick, gapNote }]  gapNote set means a week with no figure.
   series: [{ id, name, values, format, showEnd }]  null values break the line. */
export function lineChart(host, { points, series, axisFormat, label, blankNote, missingNote, emptyNote, wholeSteps, wideHeight = 272 }) {
  host.replaceChildren();
  const W = host.clientWidth;
  if (!W || !points.length) return;
  const all = series.flatMap((s) => s.values).filter((v) => v != null);
  if (!all.length) {
    host._abort?.abort();
    host.removeAttribute('tabindex');
    const note = document.createElement('p');
    note.className = 'chart__empty';
    note.textContent = emptyNote;
    host.appendChild(note);
    return;
  }
  const H = W < 440 ? 224 : wideHeight;
  const m = { t: 12, r: 40, b: 26, l: 36 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = points.length;
  const step = n > 1 ? pw / (n - 1) : pw;
  const x = (i) => (n > 1 ? m.l + i * step : m.l + pw / 2);

  const { top, step: yStep } = niceScale(Math.max(...all), wholeSteps);
  const y = (v) => m.t + ph - (v / top) * ph;

  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, host);

  // Weeks with no figure are pale bands, so the break reads as deliberate.
  points.forEach((p, i) => {
    if (!p.gapNote) return;
    const bw = Math.max(step, 7);
    const left = Math.max(m.l, x(i) - bw / 2);
    const right = Math.min(m.l + pw + 4, x(i) + bw / 2);
    svgEl('rect', { class: 'gap-band', x: left, y: m.t, width: right - left, height: ph }, svg);
  });

  for (let v = 0; v <= top + yStep / 1000; v += yStep) {
    svgEl('line', { class: v === 0 ? 'base' : 'grid', x1: m.l, x2: m.l + pw, y1: y(v), y2: y(v) }, svg);
    svgEl('text', { x: m.l - 7, y: y(v) + 4, 'text-anchor': 'end' }, svg, axisFormat(v));
  }

  let lastTickX = -Infinity;
  points.forEach((p, i) => {
    if (!p.tick || x(i) - lastTickX < 34) return;
    lastTickX = x(i);
    svgEl('text', { x: x(i), y: H - 7, 'text-anchor': i === 0 ? 'start' : 'middle' }, svg, p.tick);
  });

  for (const s of series) {
    let d = '';
    s.values.forEach((v, i) => {
      if (v == null) return;
      d += `${i > 0 && s.values[i - 1] != null ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    });
    svgEl('path', { class: `ln ln--${s.id}`, d }, svg);
    // A week with blanks either side has no line, so it gets a dot.
    s.values.forEach((v, i) => {
      if (v != null && s.values[i - 1] == null && s.values[i + 1] == null) {
        svgEl('circle', { class: `pt pt--${s.id}`, cx: x(i), cy: y(v), r: 4 }, svg);
      }
    });
  }

  // End markers and labels. If two labels would touch, the first one listed stays.
  const placed = [];
  for (const s of series) {
    let i = s.values.length - 1;
    while (i >= 0 && s.values[i] == null) i -= 1;
    if (i < 0) continue;
    const py = y(s.values[i]);
    svgEl('circle', { class: `pt pt--${s.id}`, cx: x(i), cy: py, r: 4.5 }, svg);
    if (s.showEnd === false || placed.some((q) => Math.abs(q - py) < 15)) continue;
    placed.push(py);
    svgEl('text', { class: 'end-label', x: x(i) + 9, y: py + 4.5 }, svg, s.format(s.values[i]));
  }

  const cross = svgEl('line', { class: 'cross', y1: m.t, y2: m.t + ph, visibility: 'hidden' }, svg);
  const rings = series.map((s) => svgEl('circle', { class: `pt pt--${s.id}`, r: 4.5, visibility: 'hidden' }, svg));

  let start = n - 1;
  while (start > 0 && points[start].gapNote) start -= 1;

  bindTooltip(host, {
    count: n,
    start,
    label,
    indexAt: (px) => Math.max(0, Math.min(n - 1, Math.round((px - m.l) / (n > 1 ? step : 1)))),
    onHide: () => {
      cross.setAttribute('visibility', 'hidden');
      rings.forEach((r) => r.setAttribute('visibility', 'hidden'));
    },
    onShow: (i, tip) => {
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      series.forEach((s, k) => {
        const v = s.values[i];
        rings[k].setAttribute('visibility', v == null ? 'hidden' : 'visible');
        if (v != null) {
          rings[k].setAttribute('cx', x(i));
          rings[k].setAttribute('cy', y(v));
        }
      });
      const p = points[i];
      // All blank uses blankNote. One blank beside a real figure uses missingNote.
      const anyValue = series.some((s) => s.values[i] != null);
      const rows = p.gapNote || !anyValue ? [] : series
        .filter((s) => s.values[i] != null || missingNote)
        .map((s) => ({
          name: s.name,
          value: s.values[i] == null ? missingNote : s.format(s.values[i]),
          color: `var(--s-${s.id})`,
        }));
      fillTip(tip, p.title, rows, p.gapNote || (rows.length ? null : blankNote));
      placeTip(tip, host, x(i), m.t);
    },
  });
}

/* Horizontal bars. rows: [{ label, value, valueText, title, tipRows, now }] */
export function barChart(host, { rows, label }) {
  host.replaceChildren();
  const W = host.clientWidth;
  if (!W || !rows.length) return;
  const rowH = W >= 340 ? 34 : 30;
  const barH = 16;
  const m = { t: 2, r: 46, l: 36 };
  const H = m.t + rows.length * rowH + 2;
  const pw = W - m.l - m.r;
  const vals = rows.map((r) => r.value).filter((v) => v != null);
  const { top } = niceScale(vals.length ? Math.max(...vals) : 0);
  const svg = svgEl('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, host);
  svgEl('line', { class: 'base', x1: m.l, x2: m.l, y1: m.t, y2: H - 2 }, svg);

  const bars = rows.map((r, i) => {
    const cy = m.t + i * rowH + rowH / 2;
    svgEl('text', { x: 0, y: cy + 4 }, svg, r.label);
    if (r.value == null) {
      svgEl('text', { x: m.l + 8, y: cy + 4 }, svg, r.valueText);
      return null;
    }
    const w = Math.max(3, (r.value / top) * pw);
    const rad = Math.min(4, w);
    const y0 = cy - barH / 2;
    // Square at the baseline, rounded at the data end.
    const d = `M${m.l + 1} ${y0}H${m.l + w - rad}a${rad} ${rad} 0 0 1 ${rad} ${rad}V${y0 + barH - rad}a${rad} ${rad} 0 0 1 ${-rad} ${rad}H${m.l + 1}Z`;
    const bar = svgEl('path', { class: `bar${r.now ? ' bar--now' : ''}`, d }, svg);
    svgEl('text', { class: 'end-label', x: m.l + w + 7, y: cy + 4.5 }, svg, r.valueText);
    return bar;
  });

  let lit = null;
  bindTooltip(host, {
    count: rows.length,
    start: rows.length - 1,
    label,
    indexAt: (_, py) => Math.max(0, Math.min(rows.length - 1, Math.floor((py - m.t) / rowH))),
    onHide: () => { lit?.classList.remove('is-on'); lit = null; },
    onShow: (i, tip) => {
      lit?.classList.remove('is-on');
      lit = bars[i];
      lit?.classList.add('is-on');
      const r = rows[i];
      fillTip(tip, r.title, r.tipRows);
      const tipH = tip.offsetHeight;
      const yTop = Math.max(0, Math.min(H - tipH, m.t + i * rowH + rowH / 2 - tipH / 2));
      placeTip(tip, host, r.value == null ? m.l : m.l + Math.min(pw, (r.value / top) * pw) + 34, yTop);
    },
  });
}

// The roll: one dot per person on the roster, filled if they were here.
export function rollDots(host, present, total) {
  host.replaceChildren();
  const W = host.clientWidth;
  if (!W || !total) return;
  const pitch = W < 400 ? 11 : 12;
  const r = pitch < 12 ? 3.75 : 4;
  const maxCols = Math.max(1, Math.floor(W / pitch));
  const rowsNeeded = Math.ceil(total / maxCols);
  const cols = Math.ceil(total / rowsNeeded);
  const svg = svgEl('svg', {
    width: cols * pitch, height: rowsNeeded * pitch, viewBox: `0 0 ${cols * pitch} ${rowsNeeded * pitch}`,
    role: 'img', 'aria-label': `${present} of ${total} people on the roll were here`,
  }, host);
  let on = '';
  const off = svgEl('g', { fill: 'none', stroke: 'var(--dot-off)', 'stroke-width': 1.25 }, svg);
  for (let i = 0; i < total; i += 1) {
    const cx = (i % cols) * pitch + pitch / 2;
    const cy = Math.floor(i / cols) * pitch + pitch / 2;
    if (i < present) on += `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
    else svgEl('circle', { cx, cy, r: r - 0.6 }, off);
  }
  svgEl('path', { d: on, fill: 'var(--dot-on)' }, svg);
}
