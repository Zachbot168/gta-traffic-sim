/** Text cards and diagrams, drawn in the same monochrome text style as the sim. */
import { MONO_FONT } from '../src/render/render-mono';

type Ctx = CanvasRenderingContext2D;
const WHITE = '#ffffff';
const GREY = '#8a8a8a';
const DIM = '#555555';
const RED = '#ff3b30';

export interface Line {
  text: string;
  /** Size relative to the frame height. */
  size?: number;
  color?: string;
  /** Seconds into the card when this line starts to appear. */
  at?: number;
  /** Extra space above, in line heights. */
  gap?: number;
  weight?: number;
}

function wrap(ctx: Ctx, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

function background(ctx: Ctx, w: number, h: number): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
}

/** Lines of text, left-aligned in a centred column, typed on one after another. */
export function textCard(lines: Line[], opts: { label?: string; typeRate?: number } = {}) {
  return (ctx: Ctx, t: number, w: number, h: number): void => {
    background(ctx, w, h);
    const left = w * 0.1;
    const maxWidth = w * 0.8;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    // Lay the whole card out first so it sits centred and does not jump as text appears.
    const laid: { rows: string[]; px: number; line: Line; y: number }[] = [];
    let y = 0;
    for (const line of lines) {
      const px = (line.size ?? 0.05) * h * 1.18;
      ctx.font = `${line.weight ?? 700} ${px}px ${MONO_FONT}`;
      const rows = wrap(ctx, line.text, maxWidth);
      y += (line.gap ?? 0.6) * px;
      laid.push({ rows, px, line, y });
      y += rows.length * px * 1.32;
    }
    let top = (h - y) / 2;
    if (opts.label) {
      ctx.font = `700 ${0.024 * h}px ${MONO_FONT}`;
      ctx.fillStyle = GREY;
      ctx.fillText(opts.label, left, top - 0.05 * h);
    }
    const rate = opts.typeRate ?? 55;
    for (const item of laid) {
      const start = item.line.at ?? 0;
      if (t < start) continue;
      let budget = Math.floor((t - start) * rate);
      ctx.font = `${item.line.weight ?? 700} ${item.px}px ${MONO_FONT}`;
      ctx.fillStyle = item.line.color ?? WHITE;
      item.rows.forEach((row, i) => {
        if (budget <= 0) return;
        const shown = row.slice(0, budget);
        budget -= row.length;
        ctx.fillText(shown, left, top + item.y + i * item.px * 1.32);
      });
    }
  };
}

/** One huge figure with a caption, for a number the narration lands on. */
export function numberCard(parts: { big: string; small: string; at?: number; color?: string }[]) {
  return (ctx: Ctx, t: number, w: number, h: number): void => {
    background(ctx, w, h);
    const colW = w / parts.length;
    parts.forEach((p, i) => {
      if (t < (p.at ?? 0)) return;
      const cx = colW * (i + 0.5);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = p.color ?? WHITE;
      ctx.font = `700 ${0.2 * h}px ${MONO_FONT}`;
      ctx.fillText(p.big, cx, h * 0.54);
      ctx.fillStyle = GREY;
      ctx.font = `700 ${0.034 * h}px ${MONO_FONT}`;
      wrap(ctx, p.small, colW * 0.8).forEach((row, r) => ctx.fillText(row, cx, h * 0.64 + r * 0.05 * h));
    });
  };
}

/**
 * The overpass miscount, drawn from above: a local street passes under an elevated
 * highway. Counting by straight-line distance, the highway car lands inside the
 * street's circle and gets counted as traffic on the street.
 */
export function overpassDiagram() {
  return (ctx: Ctx, t: number, w: number, h: number): void => {
    background(ctx, w, h);
    const cx = w * 0.5;
    const cy = h * 0.52;
    const u = h / 1080;
    const road = (x0: number, y0: number, x1: number, y1: number, width: number, label: string, lx: number, ly: number) => {
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = 2 * u;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      const nx = (-dy / len) * width;
      const ny = (dx / len) * width;
      ctx.beginPath();
      ctx.moveTo(x0 + nx, y0 + ny);
      ctx.lineTo(x1 + nx, y1 + ny);
      ctx.moveTo(x0 - nx, y0 - ny);
      ctx.lineTo(x1 - nx, y1 - ny);
      ctx.stroke();
      ctx.fillStyle = GREY;
      ctx.font = `700 ${26 * u}px ${MONO_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx, ly);
    };
    // The local street, running top to bottom, at ground level.
    road(cx, h * 0.12, cx, h * 0.92, 34 * u, 'LOCAL STREET (ground level)', cx + 60 * u, h * 0.17);
    // The highway crosses over it. Blank out the street where the deck covers it.
    ctx.fillStyle = '#000000';
    ctx.fillRect(w * 0.08, cy - 62 * u, w * 0.84, 124 * u);
    road(w * 0.08, cy, w * 0.92, cy, 62 * u, 'HIGHWAY (elevated, no ramp to the street)', w * 0.09, cy - 100 * u);
    // Dashes down the middle of the highway.
    ctx.setLineDash([24 * u, 22 * u]);
    ctx.strokeStyle = DIM;
    ctx.beginPath();
    ctx.moveTo(w * 0.08, cy);
    ctx.lineTo(w * 0.92, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    const car = (x: number, y: number, color: string, horizontal: boolean) => {
      ctx.fillStyle = color;
      const a = 46 * u;
      const b = 22 * u;
      ctx.fillRect(x - (horizontal ? a : b) / 2, y - (horizontal ? b : a) / 2, horizontal ? a : b, horizontal ? b : a);
    };
    // A spot on the street that wants a car, just below the deck.
    const sx = cx;
    const sy = cy + 150 * u;
    if (t > 1.5) {
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = 2 * u;
      ctx.setLineDash([6 * u, 8 * u]);
      ctx.strokeRect(sx - 20 * u, sy - 32 * u, 40 * u, 64 * u);
      ctx.setLineDash([]);
      ctx.fillStyle = WHITE;
      ctx.font = `700 ${26 * u}px ${MONO_FONT}`;
      ctx.textAlign = 'left';
      ctx.fillText('spawn a car here?', sx + 60 * u, sy);
    }
    // The highway car drives across.
    const hx = w * 0.2 + ((t * 120 * u) % (w * 0.6));
    const hy = cy - 28 * u;
    car(hx, hy, WHITE, true);
    // The straight-line check.
    if (t > 4) {
      const r = 240 * u;
      ctx.strokeStyle = GREY;
      ctx.lineWidth = 2 * u;
      ctx.setLineDash([10 * u, 10 * u]);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = GREY;
      ctx.font = `700 ${24 * u}px ${MONO_FONT}`;
      ctx.textAlign = 'right';
      ctx.fillText('straight-line check', sx - r * 0.75, sy + r * 0.8);
      const inside = Math.hypot(hx - sx, hy - sy) < r;
      if (inside && t > 6) {
        ctx.strokeStyle = RED;
        ctx.lineWidth = 3 * u;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(hx, hy);
        ctx.stroke();
        car(hx, hy, RED, true);
        ctx.fillStyle = RED;
        ctx.font = `700 ${30 * u}px ${MONO_FONT}`;
        ctx.textAlign = 'left';
        ctx.fillText('counted as traffic on the street: "road is full"', w * 0.09, h * 0.93);
      }
    }
    ctx.fillStyle = GREY;
    ctx.font = `700 ${24 * u}px ${MONO_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('MY DRAWING OF THE EXAMPLE IN US 11,071,916, FIG. 10', w * 0.08, h * 0.04);
  };
}
