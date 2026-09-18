import { Aurora, LOOKS } from './aurora';
import { renderPoster } from './poster';

type Palette = Record<string, { color: string; hint: string }>;
interface Seg { i: number; chapter: string; text: string; emotions: Record<string, number>; dominant: string; intensity: number; ms: number }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('aurora'), glow = $<HTMLCanvasElement>('glow');
const MIN_INTERVAL = 36; // ms between rows; otherwise rows appear as fast as Jev answers

let aurora: Aurora | null = null;
let palette: Palette = {};
let meta: { title: string; author: string; total: number; provider: string; questionsPerPassage: number } | null = null;
let es: EventSource | null = null;
let queue: Seg[] = [];
let shown = 0, decisions = 0, latencies: number[] = [];
let startedAt = 0, endedAt = 0, done = false;
let raf = 0;

async function init() {
  const books: { id: string; title: string; author: string; segments: number }[] = await fetch('/api/books').then(r => r.json());
  const sel = $<HTMLSelectElement>('book');
  sel.innerHTML = books.map(b => `<option value="${b.id}">${b.title}${b.author ? ' · ' + b.author : ''} (${b.segments})</option>`).join('');
  const status = await fetch('/api/status').then(r => r.json());
  $('provider').textContent = status.provider === 'mock' ? 'mock mode · no jev key' : `jev via ${status.provider}`;
  $('start').onclick = () => start(sel.value);
  $('poster').onclick = savePoster;
  window.addEventListener('resize', layout);
  layout();
  const params = new URLSearchParams(location.search);
  if (params.has('book') && books.some(b => b.id === params.get('book'))) sel.value = params.get('book')!;
  if (params.has('kiosk')) document.body.classList.add('kiosk');
  if (params.has('auto')) start(sel.value);
}

function layout() {
  for (const c of [canvas, glow]) {
    const r = c.getBoundingClientRect();
    c.width = Math.round(r.width * devicePixelRatio); c.height = Math.round(r.height * devicePixelRatio);
  }
  draw();
}

function start(book: string) {
  es?.close(); cancelAnimationFrame(raf);
  queue = []; shown = 0; decisions = 0; latencies = []; done = false; endedAt = 0;
  aurora = null; meta = null;
  $('poster').hidden = true; $<HTMLButtonElement>('start').disabled = true;
  $('text').textContent = ''; $('chapter').textContent = ''; $('dominant').textContent = '';
  $('chapters').innerHTML = ''; lastTickPx = -Infinity;
  es = new EventSource(`/api/read?book=${encodeURIComponent(book)}`);
  es.addEventListener('meta', (e) => {
    const m = JSON.parse((e as MessageEvent).data);
    meta = m; palette = m.emotions;
    const look = LOOKS[new URLSearchParams(location.search).get('look') ?? ''] ?? LOOKS.flow;
    document.body.classList.toggle('labelled', look === LOOKS.aligned);
    aurora = new Aurora(m.total, palette, look);
    $('title').textContent = m.title; $('author').textContent = m.author;
    buildLegend(); buildLaneLabels();
    startedAt = performance.now();
    raf = requestAnimationFrame(tick);
  });
  es.addEventListener('segment', (e) => { queue.push(JSON.parse((e as MessageEvent).data)); });
  es.addEventListener('error', (e) => { const d = (e as MessageEvent).data; if (d) console.warn('segment failed', JSON.parse(d)); });
  es.addEventListener('done', () => { es?.close(); done = true; });
  es.addEventListener('abort', (e) => { console.error((e as MessageEvent).data); es?.close(); done = true; });
}

let lastShow = 0;
let lastTickPx = -Infinity;
function tick(now: number) {
  raf = requestAnimationFrame(tick);
  if (!aurora || !meta) return;
  if (queue.length && now - lastShow >= MIN_INTERVAL) {
    lastShow = now;
    const s = queue.shift()!;
    aurora.add({ i: s.i, emotions: s.emotions, intensity: s.intensity });
    shown++; decisions += meta.questionsPerPassage; latencies.push(s.ms);
    showPassage(s);
    draw();
  }
  const elapsed = ((endedAt || now) - startedAt) / 1000;
  $('s-seg').textContent = `${shown} / ${meta.total}`;
  $('s-dec').textContent = String(decisions);
  $('s-time').textContent = `${elapsed.toFixed(1)}s`;
  if (latencies.length) $('s-lat').textContent = `${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)}ms`;
  if (done && !queue.length && !endedAt) finish();
}

function finish() {
  endedAt = performance.now();
  $('cursor').style.opacity = '0';
  $('poster').hidden = false; $<HTMLButtonElement>('start').disabled = false;
}

function showPassage(s: Seg) {
  const chapterEl = $('chapter'), textEl = $('text'), domEl = $('dominant');
  chapterEl.textContent = s.chapter;
  textEl.style.opacity = '0';
  requestAnimationFrame(() => { textEl.textContent = s.text; textEl.style.opacity = '1'; });
  domEl.textContent = `${s.dominant} · ${Math.round(s.emotions[s.dominant] * 100)}%`;
  domEl.style.setProperty('--c', palette[s.dominant]?.color ?? '');
  setAmbient(s.dominant, s.intensity);
  for (const k of Object.keys(palette)) {
    const li = document.querySelector<HTMLElement>(`#legend li[data-k="${k}"]`);
    if (!li) continue;
    const p = s.emotions[k] ?? 0;
    li.querySelector<HTMLElement>('.bar i')!.style.width = `${Math.round(p * 100)}%`;
    li.querySelector('.pct')!.textContent = `${Math.round(p * 100)}`;
  }
  // Chapter ticks appear as chapters begin.
  const ticks = $('chapters');
  if (!ticks.querySelector(`[data-ch="${cssEscape(s.chapter)}"]`) && meta) {
    const span = document.createElement('span');
    span.dataset.ch = s.chapter;
    span.textContent = labelOf(s.chapter);
    span.style.top = `${(s.i / meta.total) * 100}%`;
    // Hide the text (keep the tick) when the previous label is too close to read.
    const px = (s.i / meta.total) * ticks.clientHeight;
    if (px - lastTickPx < 14) span.classList.add('tight'); else lastTickPx = px;
    ticks.appendChild(span);
  }
  if (meta) { const c = $('cursor'); c.style.opacity = '1'; c.style.top = `${((s.i + 1) / meta.total) * 100}%`; }
}

function draw() {
  for (const c of [canvas, glow]) {
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    aurora?.paint(c, { x: 0, y: 0, w: c.width, h: c.height });
  }
}

function buildLaneLabels() {
  if (!aurora) return;
  // Lane labels only make sense when columns stay put (aligned look).
  if (aurora.look !== LOOKS.aligned) { $('lanes').innerHTML = ''; $('guides').innerHTML = ''; return; }
  const lanes = aurora.lanes();
  $('lanes').innerHTML = lanes.map(l =>
    `<span style="left:${(l.x * 100).toFixed(2)}%;--c:${palette[l.key].color}">${l.key}</span>`).join('');
  $('guides').innerHTML = lanes.map(l => `<i style="left:${(l.x * 100).toFixed(2)}%"></i>`).join('');
}

function setAmbient(dominant: string, intensity: number) {
  const c = palette[dominant]?.color; if (!c) return;
  document.documentElement.style.setProperty('--ambient', c);
  document.documentElement.style.setProperty('--ambient-a', (0.10 + 0.16 * intensity).toFixed(3));
}

function buildLegend() {
  $('legend').innerHTML = Object.entries(palette).map(([k, v]) =>
    `<li data-k="${k}" style="--c:${v.color}"><span class="dot"></span><span class="name">${k}</span><span class="bar"><i></i></span><span class="pct">0</span></li>`).join('');
}

async function savePoster() {
  if (!aurora || !meta) return;
  const blob = await renderPoster(aurora, {
    title: meta.title, author: meta.author, seconds: ((endedAt || performance.now()) - startedAt) / 1000,
    decisions, passages: shown, provider: meta.provider, palette,
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `${meta.title.replace(/[^\w]+/g, '-').toLowerCase()}-aurora.png`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function labelOf(chapter: string) {
  const m = chapter.match(/^\s*(CHAPTER|Chapter|LETTER|Letter)\s+([IVXLC]+|\d+)/);
  if (!m) return '·';
  return (m[1].toLowerCase() === 'letter' ? 'L' : '') + m[2];
}
function cssEscape(s: string) { return (window as any).CSS?.escape ? CSS.escape(s) : s.replace(/"/g, '\\"'); }

init();
