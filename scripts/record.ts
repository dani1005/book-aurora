// Records a full read as an MP4 for sharing. Usage: bun run scripts/record.ts [bookId] [outDir]
// Needs a running server (bun run start) and playwright-core (bun add -d playwright-core).
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const book = process.argv[2] || 'alice';
const out = process.argv[3] || 'recordings';
const base = process.env.BASE_URL || 'http://127.0.0.1:4319';
const cache = `${process.env.HOME}/Library/Caches/ms-playwright`;
const chromeDir = readdirSync(cache).filter(d => d.startsWith('chromium-')).sort().pop()!;
const ffDir = readdirSync(cache).filter(d => d.startsWith('ffmpeg-')).sort().pop()!;
const exe = join(cache, chromeDir, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing');
// Playwright's bundled ffmpeg has no H.264 encoder (X needs H.264). Point FFMPEG at a full build,
// e.g. `pip install imageio-ffmpeg` or `brew install ffmpeg`; fall back to Playwright's and emit webm.
const ffmpeg = process.env.FFMPEG || Bun.which('ffmpeg') || join(cache, ffDir, readdirSync(join(cache, ffDir)).find(f => f.startsWith('ffmpeg-mac'))!);

const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, recordVideo: { dir: out, size: { width: 1920, height: 1080 } } });
const page = await ctx.newPage();
await page.goto(`${base}/?book=${encodeURIComponent(book)}`);
await page.waitForTimeout(1200);
await page.click('#start');
await page.waitForFunction(() => !(document.getElementById('poster') as HTMLElement).hidden, null, { timeout: 180000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: join(out, `${book}-final.png`) });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#poster')]);
await dl.saveAs(join(out, `${book}-poster.png`));
const video = page.video()!;
await ctx.close();
const webm = await video.path();
const mp4 = join(out, `${book}.mp4`);
const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', webm, '-vf', 'fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
if (r.status !== 0) { console.log('H.264 encode failed; keeping', webm); process.exit(0); }
await Bun.file(webm).delete?.();
await browser.close();
console.log('wrote', mp4);
