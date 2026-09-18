import { LOOKS, type Aurora } from './aurora';

export interface PosterMeta { title: string; author: string; seconds: number; decisions: number; passages: number; cost: number; provider: string; palette: Record<string, { color: string }>; }

export async function renderPoster(aurora: Aurora, m: PosterMeta): Promise<Blob> {
  await (document as any).fonts?.ready;
  const W = 1200, H = 1800;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const bg = ctx.createRadialGradient(W / 2, H * 0.45, 50, W / 2, H * 0.45, H * 0.8);
  bg.addColorStop(0, '#120f2e'); bg.addColorStop(0.6, '#07071a'); bg.addColorStop(1, '#04040f');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Ribbon with glow.
  const rx = 150, ry = 290, rw = 900, rh = 1230;
  ctx.save(); ctx.filter = 'blur(48px)'; ctx.globalAlpha = 0.5;
  aurora.paint(c, { x: rx - 30, y: ry, w: rw + 60, h: rh });
  ctx.restore();
  aurora.paint(c, { x: rx, y: ry, w: rw, h: rh });

  ctx.fillStyle = '#ece9f4'; ctx.textBaseline = 'alphabetic';
  ctx.font = '500 20px "IBM Plex Mono", monospace'; ctx.fillStyle = '#7d7a90';
  ctx.letterSpacing = '0.2em';
  ctx.fillText('JEV READS', 100, 120);
  ctx.letterSpacing = '0em';
  ctx.fillStyle = '#ece9f4';
  ctx.font = '400 64px "Cormorant Garamond", Georgia, serif';
  ctx.fillText(fit(ctx, m.title, W - 200), 100, 190);
  ctx.font = 'italic 400 30px "Cormorant Garamond", Georgia, serif'; ctx.fillStyle = '#7d7a90';
  ctx.fillText(m.author, 100, 232);

  if (aurora.look === LOOKS.aligned) {
    // Lane labels above the ribbon: columns stay put, so the poster reads left to right by emotion.
    ctx.font = '500 13px "IBM Plex Mono", monospace'; ctx.textAlign = 'center'; ctx.letterSpacing = '0.08em';
    for (const l of aurora.lanes()) {
      ctx.fillStyle = tint(m.palette[l.key].color, 0.35);
      ctx.shadowColor = m.palette[l.key].color; ctx.shadowBlur = 10;
      ctx.fillText(l.key.toUpperCase(), rx + l.x * rw, ry - 22);
    }
    ctx.shadowBlur = 0; ctx.letterSpacing = '0em'; ctx.textAlign = 'left';
  } else {
    // Flowing look: a legend row under the ribbon, laid out from measured label widths.
    const keys = Object.keys(m.palette);
    ctx.font = '400 16px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
    const items = keys.map(k => ({ k, w: ctx.measureText(k).width + 22 + 34 }));
    const totalW = items.reduce((a, b) => a + b.w, 0) - 34;
    let x = (W - totalW) / 2; const ly = ry + rh + 46;
    for (const { k, w } of items) {
      ctx.fillStyle = m.palette[k].color; ctx.shadowColor = m.palette[k].color; ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(x + 6, ly, 5, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = tint(m.palette[k].color, 0.45);
      ctx.fillText(k, x + 22, ly + 5);
      x += w;
    }
  }
  ctx.fillStyle = '#7d7a90'; ctx.font = '400 17px "IBM Plex Mono", monospace';
  const foot = `${m.passages} passages · ${m.decisions} decisions · read in ${m.seconds.toFixed(1)}s` + (m.cost > 0 ? ` · $${m.cost.toFixed(3)}` : '') + ' · top to bottom';
  ctx.textAlign = 'center'; ctx.fillText(foot, W / 2, 1640);
  ctx.fillStyle = '#4b4960'; ctx.font = '400 15px "IBM Plex Mono", monospace';
  ctx.fillText('Every row is one passage. Every colour is a probability Jev assigned. No pixels, no prose; just judgement.', W / 2, 1680); ctx.textAlign = 'left';

  return new Promise(res => c.toBlob(b => res(b!), 'image/png'));
}

function tint(hex: string, t: number) {
  const [r, g, b] = hex.slice(1).match(/../g)!.map(h => parseInt(h, 16));
  return `rgb(${Math.round(r + (255 - r) * t)},${Math.round(g + (255 - g) * t)},${Math.round(b + (255 - b) * t)})`;
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number) {
  while (ctx.measureText(text).width > max && text.length > 4) text = text.slice(0, -2).trimEnd() + '…';
  return text;
}
