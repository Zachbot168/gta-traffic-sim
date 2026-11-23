/**
 * The monochrome, text-flavoured look: black background, hollow white roads,
 * and glyph labels like a roguelike (@ is the hero, P is police, H the helicopter,
 * + a fork, ? the last known position). One accent colour is kept for alerts only.
 *
 * Same inputs as the colour renderer, so the two can be swapped at any time.
 */
import { VISION_HALF_ANGLE, VISION_RANGE, type Chase } from '../sim/chase';
import type { CoarseGraph } from '../sim/coarse';
import { ROAD_SPECS, type RoadClass } from '../sim/graph';
import type { CityMap } from '../sim/mapgen';
import { VEHICLE_TYPES, type World } from '../sim/world';
import type { Camera, Overlays, RouteDemo } from './render';

export const MONO_FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

const BLACK = '#000000';
const WHITE = '#ffffff';
const DIM = '#3a3a3a';
const MID = '#777777';
const SOFT = '#b8b8b8';
/** The only colour: something is looking at you, or something is wrong. */
const ALERT = '#ff3b30';

const ROAD_INK: Record<RoadClass, string> = { street: '#4a4a4a', ramp: '#6a6a6a', arterial: '#7c7c7c', highway: WHITE };

type Ctx = CanvasRenderingContext2D;

export class MonoRenderer {
  private chains: Record<RoadClass, number[][]> = { street: [], arterial: [], highway: [], ramp: [] };

  constructor(
    private map: CityMap,
    private coarse: CoarseGraph,
  ) {
    const g = map.graph;
    for (const link of coarse.links) {
      const first = g.links[g.linkBetween(link.chain[0]!, link.chain[1]!)]!;
      this.chains[first.cls].push(link.chain);
    }
  }

  draw(ctx: Ctx, width: number, height: number, cam: Camera, world: World, overlays: Overlays, demo: RouteDemo | null, chase: Chase | null = null): void {
    const g = this.map.graph;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BLACK;
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(cam.zoom, 0, 0, cam.zoom, width / 2 - cam.x * cam.zoom, height / 2 - cam.y * cam.zoom);

    // One screen pixel, and one text unit, in world metres. Text scales with the canvas, not the zoom.
    const px = 1 / cam.zoom;
    const em = (Math.max(width, 900) / 1280) * px;
    const view = {
      x0: cam.x - width / 2 / cam.zoom - 40,
      x1: cam.x + width / 2 / cam.zoom + 40,
      y0: cam.y - height / 2 / cam.zoom - 40,
      y1: cam.y + height / 2 / cam.zoom + 40,
    };
    const inView = (x: number, y: number) => x >= view.x0 && x <= view.x1 && y >= view.y0 && y <= view.y1;
    const text = (label: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', boxed = false) => {
      ctx.font = `700 ${size * em}px ${MONO_FONT}`;
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      if (boxed) {
        const w = ctx.measureText(label).width + 6 * em;
        const left = align === 'center' ? x - w / 2 : x - 3 * em;
        ctx.fillStyle = BLACK;
        ctx.fillRect(left, y - size * em * 0.7, w, size * em * 1.4);
      }
      ctx.fillStyle = color;
      ctx.fillText(label, x, y);
    };

    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    const quiet = overlays.graph || overlays.coarse || demo !== null;

    // River: a band of tildes.
    if (this.map.river) {
      const r = this.map.river;
      const b = this.map.bounds;
      ctx.strokeStyle = DIM;
      ctx.lineWidth = px;
      ctx.beginPath();
      ctx.moveTo(r.x0, b.minY - 60);
      ctx.lineTo(r.x0, b.maxY + 60);
      ctx.moveTo(r.x1, b.minY - 60);
      ctx.lineTo(r.x1, b.maxY + 60);
      ctx.stroke();
      const step = Math.max(40, 26 * em);
      for (let y = b.minY - 40; y < b.maxY + 60; y += step) {
        if (y < view.y0 || y > view.y1) continue;
        for (let x = r.x0 + step * 0.4, i = 0; x < r.x1; x += step, i++) {
          text('~', x + ((Math.round(y / step) + i) % 2) * step * 0.3, y, 14, DIM);
        }
      }
    }

    // Roads are hollow: an outline in grey, the inside punched back out in black.
    const ground: RoadClass[] = ['street', 'ramp', 'arterial'];
    for (const cls of ground) this.strokeRoads(ctx, cls, ROAD_SPECS[cls].width, quiet ? DIM : ROAD_INK[cls], px);
    for (const cls of ground) this.strokeRoads(ctx, cls, ROAD_SPECS[cls].width - Math.max(2.2 * px, 0.9), BLACK, px, true);
    if (cam.zoom > 1.1 && !quiet) this.centreLines(ctx, 'arterial', px);
    this.drawVehicles(ctx, world, cam, inView, 0, text);

    if (this.chains.highway.length) {
      // The deck is drawn last so it covers the streets it passes over.
      this.strokeRoads(ctx, 'highway', ROAD_SPECS.highway.width, quiet ? MID : WHITE, px);
      this.strokeRoads(ctx, 'highway', ROAD_SPECS.highway.width - Math.max(2.6 * px, 1), BLACK, px, true);
      if (cam.zoom > 1.1 && !quiet) this.centreLines(ctx, 'highway', px);
    }
    this.drawVehicles(ctx, world, cam, inView, 1, text);

    if (overlays.graph) {
      ctx.strokeStyle = MID;
      ctx.lineWidth = px;
      ctx.beginPath();
      for (const l of g.links) {
        const p = g.nodes[l.a]!;
        const q = g.nodes[l.b]!;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      ctx.fillStyle = SOFT;
      const r = Math.max(1.6 * px, 1.1);
      for (const n of g.nodes) {
        if (inView(n.x, n.y)) ctx.fillRect(n.x - r, n.y - r, r * 2, r * 2);
      }
    }

    if (overlays.coarse) {
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = Math.max(1.4 * px, 0.8);
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.beginPath();
      for (const l of this.coarse.links) {
        const p = g.nodes[l.a]!;
        const q = g.nodes[l.b]!;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Forks are plus signs.
      const arm = Math.max(5 * px, 3.5);
      ctx.lineWidth = Math.max(2 * px, 1);
      ctx.beginPath();
      for (const id of this.coarse.forks) {
        const n = g.nodes[id]!;
        if (!inView(n.x, n.y)) continue;
        ctx.moveTo(n.x - arm, n.y);
        ctx.lineTo(n.x + arm, n.y);
        ctx.moveTo(n.x, n.y - arm);
        ctx.lineTo(n.x, n.y + arm);
      }
      ctx.stroke();
    }

    if (demo) this.drawDemo(ctx, demo, px, text);

    if (overlays.spawns) {
      const life = 20;
      for (const e of world.spawnLog) {
        const age = world.time - e.time;
        if (age > life || !inView(e.x, e.y)) continue;
        ctx.globalAlpha = 1 - age / life;
        text(e.kind === 'spawned' ? '+' : 'x', e.x, e.y, 15, e.kind === 'spawned' ? WHITE : ALERT);
      }
      ctx.globalAlpha = 1;
    }

    if (chase) this.drawChase(ctx, chase, px, text);

    if (overlays.bubble && world.focus) {
      const { spawnInner, spawnOuter, despawn } = world.config;
      const f = world.focus;
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.beginPath();
      ctx.rect(view.x0 - 100, view.y0 - 100, view.x1 - view.x0 + 200, view.y1 - view.y0 + 200);
      ctx.arc(f.x, f.y, despawn, 0, Math.PI * 2, true);
      ctx.fill();
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = Math.max(1.3 * px, 0.8);
      for (const [radius, dash, label] of [
        [spawnInner, 3, ''],
        [spawnOuter, 0, 'SPAWN RING'],
        [despawn, 7, 'DELETED BEYOND HERE'],
      ] as const) {
        ctx.setLineDash(dash ? [dash * px * 2, dash * px * 2] : []);
        ctx.beginPath();
        ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        if (label) text(label, f.x, f.y - radius - 12 * em, 12, WHITE, 'center', true);
      }
    }

    if (world.config.weather === 'rain') this.drawRain(ctx, width, height, world.time);
  }

  private path(ctx: Ctx, cls: RoadClass): void {
    const g = this.map.graph;
    ctx.beginPath();
    for (const chain of this.chains[cls]) {
      const first = g.nodes[chain[0]!]!;
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < chain.length; i++) {
        const n = g.nodes[chain[i]!]!;
        ctx.lineTo(n.x, n.y);
      }
    }
  }

  private strokeRoads(ctx: Ctx, cls: RoadClass, width: number, color: string, px: number, inner = false): void {
    // Too small on screen to be hollow: draw a plain line and skip the punch-out.
    const thin = ROAD_SPECS[cls].width < 4.5 * px;
    if (thin && inner) return;
    ctx.strokeStyle = color;
    ctx.lineCap = inner ? 'round' : 'butt';
    ctx.lineWidth = thin ? Math.max(px, ROAD_SPECS[cls].width * 0.4) : width;
    this.path(ctx, cls);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  private centreLines(ctx: Ctx, cls: RoadClass, px: number): void {
    ctx.strokeStyle = DIM;
    ctx.lineWidth = Math.max(0.3, px);
    ctx.setLineDash([4, 6]);
    this.path(ctx, cls);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawVehicles(
    ctx: Ctx,
    world: World,
    cam: Camera,
    inView: (x: number, y: number) => boolean,
    level: number,
    text: (label: string, x: number, y: number, size: number, color: string, align?: CanvasTextAlign, boxed?: boolean) => void,
  ): void {
    const tiny = cam.zoom < 0.55;
    const px = 1 / cam.zoom;
    const blink = Math.floor(world.time * 5) % 2 === 0;
    for (const v of world.vehicles) {
      if (v.level !== level || !inView(v.x, v.y)) continue;
      const type = VEHICLE_TYPES[v.type]!;
      const special = v.kind !== 'civ';
      if (tiny) {
        const size = (special ? 4.5 : 1.8) * px;
        ctx.fillStyle = special ? WHITE : SOFT;
        ctx.fillRect(v.x - size / 2, v.y - size / 2, size, size);
      } else {
        ctx.save();
        ctx.translate(v.x, v.y);
        ctx.rotate(v.heading);
        if (v.kind === 'cop') {
          // Police are hollow boxes that flash solid.
          ctx.fillStyle = blink ? WHITE : BLACK;
          ctx.fillRect(-type.length, -type.width / 2, type.length, type.width);
          ctx.strokeStyle = WHITE;
          ctx.lineWidth = Math.max(0.35, 1.2 * px);
          ctx.strokeRect(-type.length, -type.width / 2, type.length, type.width);
        } else {
          ctx.fillStyle = special ? WHITE : SOFT;
          ctx.fillRect(-type.length, -type.width / 2, type.length, type.width);
        }
        ctx.restore();
      }
      if (special) {
        const lift = tiny ? 9 * px : type.length * 0.5 + 9 * px;
        text(v.kind === 'hero' ? '@' : 'P', v.x, v.y - lift, v.kind === 'hero' ? 22 : 14, WHITE, 'center', true);
      }
    }
  }

  private drawDemo(ctx: Ctx, demo: RouteDemo, px: number, text: (label: string, x: number, y: number, size: number, color: string, align?: CanvasTextAlign, boxed?: boolean) => void): void {
    const g = this.map.graph;
    const showFull = demo.show !== 'coarse';
    const showCoarse = demo.show !== 'full';
    if (showFull) {
      // The full search: a spreading field of small grey dots.
      ctx.fillStyle = MID;
      const r = Math.max(1.5 * px, 1.6);
      const n = Math.min(demo.revealed, demo.full.trace.length);
      for (let i = 0; i < n; i++) {
        const node = g.nodes[demo.full.trace[i]!]!;
        ctx.fillRect(node.x - r, node.y - r, r * 2, r * 2);
      }
    }
    if (showCoarse) {
      // The coarse search: far fewer, bigger, solid white.
      ctx.fillStyle = WHITE;
      const r = Math.max(3.4 * px, 4);
      const n = Math.min(demo.revealed, demo.coarse.trace.length);
      for (let i = 0; i < n; i++) {
        const node = g.nodes[demo.coarse.trace[i]!]!;
        ctx.fillRect(node.x - r, node.y - r, r * 2, r * 2);
      }
    }
    const fullDone = demo.revealed >= demo.full.trace.length;
    const coarseDone = demo.revealed >= demo.coarse.trace.length;
    if ((showFull && fullDone) || (!showFull && coarseDone)) {
      const nodes = showFull ? demo.full.nodes : demo.coarse.nodes;
      for (const [color, width] of [
        [BLACK, Math.max(8 * px, 8)],
        [WHITE, Math.max(3 * px, 3)],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        nodes.forEach((id, i) => {
          const n = g.nodes[id]!;
          if (i) ctx.lineTo(n.x, n.y);
          else ctx.moveTo(n.x, n.y);
        });
        ctx.stroke();
      }
    }
    for (const [id, label] of [
      [demo.from, '[A]'],
      [demo.to, '[B]'],
    ] as const) {
      const n = g.nodes[id]!;
      text(label, n.x, n.y, 18, WHITE, 'center', true);
    }
  }

  private drawChase(ctx: Ctx, chase: Chase, px: number, text: (label: string, x: number, y: number, size: number, color: string, align?: CanvasTextAlign, boxed?: boolean) => void): void {
    const live = chase.outcome === 'running';
    const line = Math.max(1.2 * px, 0.6);

    for (const rb of chase.roadblocks) {
      ctx.save();
      ctx.translate(rb.x, rb.y);
      ctx.rotate(rb.angle);
      ctx.fillStyle = WHITE;
      ctx.fillRect(-1.2, -8, 2.4, 16);
      ctx.restore();
      text('ROADBLOCK', rb.x, rb.y - 16, 11, rb.sees ? ALERT : WHITE, 'center', true);
    }

    if (live) {
      for (const cop of chase.cops) {
        const sees = chase.copState.get(cop.id)?.sees ?? false;
        ctx.beginPath();
        ctx.moveTo(cop.x, cop.y);
        const rays = 16;
        for (let i = 0; i <= rays; i++) {
          const angle = cop.heading - VISION_HALF_ANGLE + (2 * VISION_HALF_ANGLE * i) / rays;
          const r = chase.occlusion.rayLength(cop.x, cop.y, angle, VISION_RANGE);
          ctx.lineTo(cop.x + Math.cos(angle) * r, cop.y + Math.sin(angle) * r);
        }
        ctx.closePath();
        ctx.fillStyle = sees ? 'rgba(255,59,48,0.30)' : 'rgba(255,255,255,0.10)';
        ctx.fill();
        ctx.strokeStyle = sees ? ALERT : MID;
        ctx.lineWidth = line;
        ctx.stroke();
      }
    }

    if (live && !chase.knows) {
      const lk = chase.lastKnown;
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = line;
      ctx.setLineDash([6 * px, 6 * px]);
      ctx.beginPath();
      ctx.arc(lk.x, lk.y, 60 + chase.hiddenFor * 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      text('?', lk.x, lk.y, 20, WHITE, 'center', true);
    }

    if (chase.heli) {
      const h = chase.heli;
      ctx.strokeStyle = h.sees ? ALERT : WHITE;
      ctx.lineWidth = line;
      ctx.setLineDash([3 * px, 5 * px]);
      ctx.beginPath();
      ctx.arc(h.x, h.y, 100, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (h.sees) {
        ctx.fillStyle = 'rgba(255,59,48,0.10)';
        ctx.fill();
      }
      text('[H]', h.x, h.y, 15, h.sees ? ALERT : WHITE, 'center', true);
    }
  }

  /** Rain is a scatter of slashes. */
  private drawRain(ctx: Ctx, width: number, height: number, time: number): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, width / 1300);
    ctx.beginPath();
    const count = Math.round((width * height) / 11000);
    const len = height * 0.03;
    for (let i = 0; i < count; i++) {
      const fx = (i * 0.61803398875) % 1;
      const fy = (i * 0.38196601125 + time * (1.6 + (i % 7) * 0.12)) % 1;
      const x = fx * (width + len) - len * 0.4;
      const y = fy * (height + len) - len;
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * 0.45, y + len);
    }
    ctx.stroke();
  }
}
