import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { segmentBook } from './segment';
import { makeReader } from './jev';
import { EMOTIONS } from './emotions';

const PORT = Number(process.env.PORT || 4319);
const BOOKS_DIR = join(import.meta.dir, '..', 'books');
const { reader, provider } = makeReader();
const CONCURRENCY = Number(process.env.JEV_CONCURRENCY || 6);
console.log(`book-aurora server on :${PORT}  provider=${provider}`);

async function listBooks() {
  const entries: { id: string; title: string; author: string; words: number; segments: number }[] = [];
  for (const dir of [BOOKS_DIR, join(BOOKS_DIR, 'private')]) {
    let files: string[] = [];
    try { files = await readdir(dir); } catch { continue; }
    for (const f of files.filter(f => f.endsWith('.txt'))) {
      const raw = await readFile(join(dir, f), 'utf8');
      const meta = parseMeta(raw, f);
      entries.push({ id: (dir.endsWith('private') ? 'private/' : '') + f.replace(/\.txt$/, ''), ...meta, words: raw.split(/\s+/).length, segments: segmentBook(raw).length });
    }
  }
  return entries;
}

// Optional display overrides in books/meta.json: { "<id>": { "title": "...", "author": "..." } }
let overrides: Record<string, { title?: string; author?: string }> = {};
try { overrides = JSON.parse(await readFile(join(BOOKS_DIR, 'meta.json'), 'utf8')); } catch {}

function parseMeta(raw: string, file: string) {
  const id = file.replace(/\.txt$/, '');
  const o = overrides[id] ?? {};
  const title = o.title || raw.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || id.replace(/[-_]/g, ' ');
  const author = o.author || raw.match(/^Author:\s*(.+)$/m)?.[1]?.trim() || '';
  return { title, author };
}

function sse(data: unknown, event?: string) {
  return (event ? `event: ${event}\n` : '') + `data: ${JSON.stringify(data)}\n\n`;
}

async function readStream(bookId: string, signal: AbortSignal): Promise<Response> {
  if (!/^(private\/)?[\w.-]+$/.test(bookId)) return new Response('bad book id', { status: 400 });
  let raw: string;
  try { raw = await readFile(join(BOOKS_DIR, bookId + '.txt'), 'utf8'); } catch { return new Response('unknown book', { status: 404 }); }
  const meta = parseMeta(raw, bookId);
  const segments = segmentBook(raw);
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (d: unknown, ev?: string) => controller.enqueue(enc.encode(sse(d, ev)));
      send({ ...meta, total: segments.length, provider, questionsPerPassage: Object.keys(EMOTIONS).length + 1, emotions: EMOTIONS, chapters: [...new Set(segments.map(s => s.chapter))] }, 'meta');
      // Bounded concurrency, results emitted strictly in order so the aurora flows top to bottom.
      const pending: Promise<any>[] = [];
      let next = 0, emitted = 0, failures = 0;
      const launch = () => {
        if (next >= segments.length) return;
        const s = segments[next++];
        const prev = s.i > 0 ? segments[s.i - 1].text : null;
        pending.push(reader(s.text, prev, s.chapter, s.i).then(r => ({ s, r })).catch(err => ({ s, err })));
      };
      for (let k = 0; k < CONCURRENCY; k++) launch();
      while (pending.length && !signal.aborted) {
        const item = await pending.shift();
        launch();
        if (item.err) {
          failures++;
          send({ i: item.s.i, chapter: item.s.chapter, text: item.s.text, error: String(item.err.message || item.err) }, 'error');
          if (failures > 8) { send({ reason: 'too many Jev failures' }, 'abort'); break; }
          continue;
        }
        emitted++;
        send({ i: item.s.i, chapter: item.s.chapter, text: item.s.text, ...item.r }, 'segment');
      }
      send({ emitted, failures }, 'done');
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } });
}

const dist = join(import.meta.dir, '..', 'dist');
Bun.serve({
  port: PORT,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/api/books') return Response.json(await listBooks());
    if (url.pathname === '/api/read') return readStream(url.searchParams.get('book') || 'alice', req.signal);
    if (url.pathname === '/api/status') return Response.json({ provider });
    if (process.env.SERVE_DIST) {
      const path = url.pathname === '/' ? '/index.html' : url.pathname;
      const file = Bun.file(join(dist, path));
      if (await file.exists()) return new Response(file);
      return new Response(Bun.file(join(dist, 'index.html')));
    }
    return new Response('not found', { status: 404 });
  },
});
