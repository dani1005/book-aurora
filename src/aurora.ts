// Renders the book as an aurora: one thin row per passage, each emotion a curtain
// whose width and brightness follow Jev's probability for that passage.
export interface Palette { [k: string]: { color: string } }
export interface Row { i: number; emotions: Record<string, number>; intensity: number }

// Lane order chosen so neighbouring colours blend pleasantly.
const ORDER = ['anger', 'suspense', 'fear', 'sadness', 'wonder', 'humor', 'joy', 'tenderness', 'calm'];
const PASTEL = 0.3;        // how far each colour is pulled toward white

// Two looks. `flow` (default) lets the curtains sway and overlap like an aurora; `aligned` keeps every
// emotion in a fixed column under a label, which reads more like a spectrogram. Pick with ?look=.
export interface Look { laneStart: number; laneSpan: number; sway1: number; sway2: number; rMin: number; rGain: number; feather: number[] }
export const LOOKS: Record<string, Look> = {
  aligned: { laneStart: 0.08, laneSpan: 0.84, sway1: 0.05, sway2: 0.025, rMin: 0.07, rGain: 0.26, feather: [0.06, 0.14, 0.28, 0.5, 0.76, 1, 0.76, 0.5, 0.28, 0.14, 0.06] },
  flow:    { laneStart: 0.18, laneSpan: 0.64, sway1: 0.09, sway2: 0.05,  rMin: 0.06, rGain: 0.26, feather: [0.08, 0.2, 0.42, 0.72, 1, 0.72, 0.42, 0.2, 0.08] },
};

export class Aurora {
  private off: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D;
  private scratch: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  readonly W = 420;
  readonly rowH = 3;
  rows: Row[] = [];
  private keys: string[] = [];
  private colors: Record<string, [number, number, number]> = {};

  constructor(public total: number, palette: Palette, public look: Look = LOOKS.flow) {
    this.keys = ORDER.filter(k => k in palette).concat(Object.keys(palette).filter(k => !ORDER.includes(k)));
    for (const k of this.keys) this.colors[k] = pastel(hex(palette[k].color), PASTEL);
    this.off = document.createElement('canvas');
    this.off.width = this.W; this.off.height = Math.max(1, total * this.rowH);
    this.octx = this.off.getContext('2d')!;
    this.scratch = document.createElement('canvas');
    this.scratch.width = this.W; this.scratch.height = this.rowH;
    this.sctx = this.scratch.getContext('2d')!;
  }

  get canvas() { return this.off; }

  /** Horizontal home of each emotion lane as a fraction of the width, for labels. */
  lanes(): { key: string; x: number }[] {
    const n = this.keys.length;
    return this.keys.map((key, k) => ({ key, x: this.look.laneStart + this.look.laneSpan * (k / (n - 1)) }));
  }

  private laneX(k: number, i: number) {
    const n = this.keys.length;
    const L = this.look;
    const base = this.W * (L.laneStart + L.laneSpan * (k / (n - 1)));
    // Slow drift so curtains lean and sway down the page instead of standing in rigid columns.
    return base + this.W * (L.sway1 * Math.sin(i * 0.027 + k * 1.31) + L.sway2 * Math.sin(i * 0.009 + k * 0.7));
  }

  add(row: Row) {
    this.rows.push(row);
    const s = this.sctx, W = this.W, h = this.rowH;
    s.clearRect(0, 0, W, h);
    s.globalCompositeOperation = 'lighter';
    // Slightly flatten the distribution so secondary emotions show through as softer veils.
    const vals = this.keys.map(k => Math.pow(row.emotions[k] ?? 0, 1.0));
    const sum = vals.reduce((a, b) => a + b, 0) || 1;
    this.keys.forEach((k, idx) => {
      const p = vals[idx] / sum;
      if (p < 0.02) return;
      const x = this.laneX(idx, row.i);
      const r = W * (this.look.rMin + this.look.rGain * p);
      const a = Math.min(0.72, p * (0.5 + 0.6 * row.intensity) * 1.6);
      const [cr, cg, cb] = this.colors[k];
      const g = s.createLinearGradient(x - r, 0, x + r, 0);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},0)`);
      g.addColorStop(0.5, `rgba(${cr},${cg},${cb},${a})`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      s.fillStyle = g;
      s.fillRect(x - r, 0, 2 * r, h);
    });
    // Stamp the row into the strip, feathered over its neighbours so rows melt into one another.
    const ctx = this.octx;
    ctx.globalCompositeOperation = 'lighter';
    const F = this.look.feather;
    const y = row.i * h, mid = (F.length - 1) / 2;
    const norm = F.reduce((a, b) => a + b, 0) / 2.1;
    F.forEach((w, j) => {
      ctx.globalAlpha = w / norm;
      ctx.drawImage(this.scratch, 0, y + (j - mid) * h);
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Draw the strip into a target canvas, scaled to fit the box. */
  paint(target: HTMLCanvasElement, opts: { x: number; y: number; w: number; h: number }) {
    const ctx = target.getContext('2d')!;
    const { x, y, w, h } = opts;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const drawnRows = this.rows.length ? this.rows[this.rows.length - 1].i + 1 : 0;
    const srcH = Math.min(this.off.height, (drawnRows + 3) * this.rowH);
    const scale = h / this.off.height;
    if (drawnRows > 0) ctx.drawImage(this.off, 0, 0, this.W, srcH, x, y, w, srcH * scale);
  }
}

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function pastel([r, g, b]: [number, number, number], t: number): [number, number, number] {
  return [Math.round(r + (255 - r) * t), Math.round(g + (255 - g) * t), Math.round(b + (255 - b) * t)];
}
