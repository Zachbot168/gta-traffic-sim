/**
 * Small line-chart drawer for the result panels. Drawn on the same canvas as the
 * city so it shows up in recordings and in headless frames.
 *
 * Conventions: one y-axis, 2px lines, markers with a surface-coloured ring, a
 * legend whenever there is more than one series, direct labels when there are few
 * enough to fit, and all text in neutral ink (colour is carried by the marks).
 */

/** Categorical colours for a dark surface, used in this fixed order. Validated for colour-blind separation. */
export const SERIES_COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'];

const INK = { primary: '#f0efec', secondary: '#c3c2b7', muted: '#8d8c85', grid: 'rgba(255,255,255,0.08)', axis: 'rgba(255,255,255,0.28)' };
const SURFACE = '#0d1119';

export interface Series {
  label: string;
  color: string;
  /** Points joined by a line. */
  line?: [number, number][];
  /** Points drawn as separate markers (measurements, as opposed to a fitted line). */
  dots?: [number, number][];
  dashed?: boolean;
}

export interface ChartSpec {
  title: string;
  subtitle?: string;
  xLabel: string;
  yLabel: string;
  xRange: [number, number];
  yRange: [number, number];
  xTicks: number[];
  yTicks: number[];
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  series: Series[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A data point on screen, so the page can show a tooltip when the pointer is near it. */
export interface HitPoint {
  x: number;
  y: number;
  color: string;
  text: string;
}

type Ctx = CanvasRenderingContext2D;

export function drawChart(ctx: Ctx, rect: Rect, spec: ChartSpec, scale = 1): HitPoint[] {
  const hits: HitPoint[] = [];
  const u = scale;
  const fx = spec.xFormat ?? ((v: number) => String(v));
  const fy = spec.yFormat ?? ((v: number) => String(v));
  const font = (size: number, weight = 400) => `${weight} ${size * u}px system-ui, -apple-system, "Segoe UI", sans-serif`;

  // Panel.
  ctx.save();
  ctx.fillStyle = 'rgba(13,17,25,0.95)';
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = u;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 12 * u);
  ctx.fill();
  ctx.stroke();

  const pad = 18 * u;
  let top = rect.y + pad;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = INK.primary;
  ctx.font = font(16, 700);
  ctx.fillText(spec.title, rect.x + pad, top);
  top += 22 * u;
  if (spec.subtitle) {
    ctx.fillStyle = INK.secondary;
    ctx.font = font(12.5);
    ctx.fillText(spec.subtitle, rect.x + pad, top);
    top += 18 * u;
  }

  // Legend: always present when there is more than one series.
  const directLabels = spec.series.length <= 4;
  if (spec.series.length > 1) {
    ctx.font = font(12.5);
    let lx = rect.x + pad;
    top += 4 * u;
    for (const s of spec.series) {
      const w = ctx.measureText(s.label).width + 34 * u;
      if (lx + w > rect.x + rect.w - pad) {
        lx = rect.x + pad;
        top += 18 * u;
      }
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2.5 * u;
      ctx.setLineDash(s.dashed ? [5 * u, 4 * u] : []);
      ctx.beginPath();
      ctx.moveTo(lx, top + 7 * u);
      ctx.lineTo(lx + 18 * u, top + 7 * u);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = INK.secondary;
      ctx.fillText(s.label, lx + 24 * u, top);
      lx += w;
    }
    top += 20 * u;
  }

  // Plot area.
  const left = rect.x + pad + 38 * u;
  // Leave room on the right for the longest direct label.
  ctx.font = font(12, 600);
  const labelRoom = directLabels ? Math.max(...spec.series.map((s) => ctx.measureText(s.label).width)) + 26 * u : 12 * u;
  const right = rect.x + rect.w - pad - labelRoom;
  const bottom = rect.y + rect.h - pad - 34 * u;
  top += 26 * u;
  const sx = (v: number) => left + ((v - spec.xRange[0]) / (spec.xRange[1] - spec.xRange[0])) * (right - left);
  const sy = (v: number) => bottom - ((v - spec.yRange[0]) / (spec.yRange[1] - spec.yRange[0])) * (bottom - top);

  ctx.font = font(11.5);
  ctx.lineWidth = u;
  for (const t of spec.yTicks) {
    ctx.strokeStyle = t === spec.yRange[0] ? INK.axis : INK.grid;
    ctx.beginPath();
    ctx.moveTo(left, sy(t));
    ctx.lineTo(right, sy(t));
    ctx.stroke();
    ctx.fillStyle = INK.muted;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(fy(t), left - 8 * u, sy(t));
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of spec.xTicks) {
    ctx.fillStyle = INK.muted;
    ctx.fillText(fx(t), sx(t), bottom + 7 * u);
  }
  ctx.fillStyle = INK.secondary;
  ctx.font = font(12);
  ctx.fillText(spec.xLabel, (left + right) / 2, bottom + 24 * u);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(spec.yLabel, rect.x + pad, top - 6 * u);

  // Marks.
  const ends: { y: number; label: string; color: string }[] = [];
  for (const s of spec.series) {
    if (s.line && s.line.length > 1) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2 * u;
      ctx.lineJoin = 'round';
      ctx.setLineDash(s.dashed ? [6 * u, 5 * u] : []);
      ctx.beginPath();
      s.line.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
      ctx.stroke();
      ctx.setLineDash([]);
      const last = s.line[s.line.length - 1]!;
      ends.push({ y: sy(last[1]), label: s.label, color: s.color });
    }
    const marks = s.dots ?? (s.line && s.line.length <= 12 ? s.line : []);
    for (const [x, y] of marks) {
      ctx.fillStyle = s.color;
      ctx.strokeStyle = SURFACE;
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.arc(sx(x), sy(y), 4.5 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      hits.push({ x: sx(x), y: sy(y), color: s.color, text: `${s.label}: ${fy(y)} at ${fx(x)}` });
    }
  }

  // Direct labels at the right-hand end of each line, nudged apart so they never overlap.
  if (directLabels) {
    ends.sort((p, q) => p.y - q.y);
    const gap = 15 * u;
    for (let i = 1; i < ends.length; i++) {
      if (ends[i]!.y - ends[i - 1]!.y < gap) ends[i]!.y = ends[i - 1]!.y + gap;
    }
    // If the nudging pushed labels below the axis, slide the whole group back up.
    const overflow = ends.length ? ends[ends.length - 1]!.y - bottom : 0;
    if (overflow > 0) for (const e of ends) e.y -= overflow;
    ctx.font = font(12, 600);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const e of ends) {
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(right + 10 * u, e.y, 3.5 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = INK.primary;
      ctx.fillText(e.label, right + 18 * u, e.y);
    }
  }
  ctx.restore();
  return hits;
}

/** Lay charts out side by side (or stacked on a narrow screen) in the middle of the view. */
export function layoutCharts(count: number, width: number, height: number, reservedTop: number, reservedBottom: number, scale = 1): Rect[] {
  const margin = 16 * scale;
  const stacked = width < 760 * scale;
  const usableH = height - reservedTop - reservedBottom - margin * 2;
  const rects: Rect[] = [];
  if (stacked) {
    const h = Math.min(330 * scale, (usableH - margin * (count - 1)) / count);
    const y0 = reservedTop + margin + Math.max(0, (usableH - (h * count + margin * (count - 1))) / 2);
    for (let i = 0; i < count; i++) rects.push({ x: margin, y: y0 + i * (h + margin), w: width - margin * 2, h });
  } else {
    const w = Math.min(560 * scale, (width - margin * (count + 1)) / count);
    const h = Math.min(400 * scale, usableH);
    const x0 = (width - (w * count + margin * (count - 1))) / 2;
    const y0 = reservedTop + margin + (usableH - h) * 0.5;
    for (let i = 0; i < count; i++) rects.push({ x: x0 + i * (w + margin), y: y0, w, h });
  }
  return rects;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
