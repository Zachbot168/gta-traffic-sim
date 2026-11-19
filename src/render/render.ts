/**
 * Draws the world onto a 2D canvas. Works with the browser canvas and with a
 * headless canvas in Node, so the same code makes the live view and test frames.
 */
import { VISION_HALF_ANGLE, VISION_RANGE, type Chase } from '../sim/chase';
import type { CoarseGraph } from '../sim/coarse';
import { ROAD_SPECS, type RoadClass } from '../sim/graph';
import type { CityMap } from '../sim/mapgen';
import type { Route } from '../sim/route';
import { VEHICLE_TYPES, type World } from '../sim/world';

export interface Camera {
  x: number;
  y: number;
  /** Pixels per metre. */
  zoom: number;
}

export interface Overlays {
  /** Low-level nodes and links. */
  graph: boolean;
  /** Forks and the straight coarse links between them. */
  coarse: boolean;
  /** Spawn and despawn rings. */
  bubble: boolean;
  /** Where the spawner recently added a car (green) or wrongly decided a road was full (red). */
  spawns: boolean;
}

/** A route search being replayed on screen. */
export interface RouteDemo {
  from: number;
  to: number;
  full: Route;
  coarse: Route;
  show: 'full' | 'coarse' | 'both';
  /** How many expanded nodes to reveal so far. */
  revealed: number;
}

const COLORS = {
  bg: '#090c12',
  land: '#0d1119',
  river: '#0b2236',
  casing: '#05070b',
  street: '#1a212e',
  arterial: '#232d40',
  ramp: '#27324a',
  highway: '#2d3a57',
  highwayEdge: '#51648f',
  lane: '#3a4763',
  node: '#3b82f6',
  fork: '#ffd166',
  coarse: '#ff9f1c',
  traceFull: '#38d0ff',
  traceCoarse: '#ff9f1c',
  route: '#7dffb0',
  hero: '#ff3b6b',
  bubble: '#7dffb0',
};

const PAINTS = ['#e8ecf4', '#9aa7bd', '#f2c14e', '#5fb0ff', '#c7d0e0', '#ff8a5c', '#7ee0c3', '#b9a3ff'];

type Ctx = CanvasRenderingContext2D;

export class Renderer {
  private chains: Record<RoadClass, number[][]> = { street: [], arterial: [], highway: [], ramp: [] };

  constructor(
    private map: CityMap,
    private coarse: CoarseGraph,
  ) {
    // Roads are drawn as continuous polylines, one per stretch between forks.
    const g = map.graph;
    for (const link of coarse.links) {
      const first = g.links[g.linkBetween(link.chain[0]!, link.chain[1]!)]!;
      this.chains[first.cls].push(link.chain);
    }
  }

  draw(ctx: Ctx, width: number, height: number, cam: Camera, world: World, overlays: Overlays, demo: RouteDemo | null, chase: Chase | null = null): void {
    const g = this.map.graph;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, width, height);

    // World-to-screen transform: everything below is drawn in metres.
    ctx.setTransform(cam.zoom, 0, 0, cam.zoom, width / 2 - cam.x * cam.zoom, height / 2 - cam.y * cam.zoom);
    const px = 1 / cam.zoom;
    const view = {
      x0: cam.x - width / 2 / cam.zoom - 40,
      x1: cam.x + width / 2 / cam.zoom + 40,
      y0: cam.y - height / 2 / cam.zoom - 40,
      y1: cam.y + height / 2 / cam.zoom + 40,
    };

    const b = this.map.bounds;
    ctx.fillStyle = COLORS.land;
    ctx.fillRect(b.minX - 60, b.minY - 60, b.maxX - b.minX + 120, b.maxY - b.minY + 120);
    if (this.map.river) {
      const r = this.map.river;
      ctx.fillStyle = COLORS.river;
      ctx.fillRect(r.x0, b.minY - 60, r.x1 - r.x0, b.maxY - b.minY + 120);
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const dimRoads = overlays.graph || overlays.coarse || demo !== null;

    // Ground-level roads, then ground vehicles, then the elevated highway on top.
    this.strokeRoads(ctx, ['street', 'arterial', 'ramp'], 2.4, () => COLORS.casing);
    this.strokeRoads(ctx, ['street', 'arterial', 'ramp'], 0, (c) => COLORS[c]);
    if (cam.zoom > 1.1 && !dimRoads) this.centreLines(ctx, 'arterial', px);
    this.drawVehicles(ctx, world, cam, view, 0);

    if (this.chains.highway.length) {
      ctx.save();
      ctx.translate(3, 5);
      ctx.globalAlpha = 0.45;
      this.strokeRoads(ctx, ['highway'], 2, () => '#000000');
      ctx.restore();
      this.strokeRoads(ctx, ['highway'], 1.6, () => COLORS.highwayEdge);
      this.strokeRoads(ctx, ['highway'], 0, () => COLORS.highway);
      if (cam.zoom > 1.1 && !dimRoads) this.centreLines(ctx, 'highway', px);
    }
    this.drawVehicles(ctx, world, cam, view, 1);

    if (overlays.graph) {
      // Every low-level link and node.
      ctx.strokeStyle = COLORS.node;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = Math.max(1.2 * px, 0.6);
      ctx.beginPath();
      for (const l of g.links) {
        const p = g.nodes[l.a]!;
        const q = g.nodes[l.b]!;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = COLORS.node;
      const r = Math.max(2.2 * px, 1.4);
      ctx.beginPath();
      for (const n of g.nodes) {
        if (n.x < view.x0 || n.x > view.x1 || n.y < view.y0 || n.y > view.y1) continue;
        ctx.moveTo(n.x + r, n.y);
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (overlays.coarse) {
      // Only the forks, joined by straight lines: what the coarse search sees.
      ctx.strokeStyle = COLORS.coarse;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = Math.max(2 * px, 1);
      ctx.beginPath();
      for (const l of this.coarse.links) {
        const p = g.nodes[l.a]!;
        const q = g.nodes[l.b]!;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.fork;
      const r = Math.max(3.5 * px, 2.4);
      ctx.beginPath();
      for (const id of this.coarse.forks) {
        const n = g.nodes[id]!;
        if (n.x < view.x0 || n.x > view.x1 || n.y < view.y0 || n.y > view.y1) continue;
        ctx.moveTo(n.x + r, n.y);
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    if (demo) this.drawDemo(ctx, demo, px);

    if (overlays.spawns) {
      const life = 20;
      for (const e of world.spawnLog) {
        const age = world.time - e.time;
        if (age > life) continue;
        const good = e.kind === 'spawned';
        ctx.globalAlpha = (1 - age / life) * (good ? 0.95 : 0.7);
        ctx.fillStyle = good ? COLORS.bubble : '#ff4d5e';
        const r = Math.max(3.5 * px, 3.5);
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (chase) this.drawChase(ctx, chase, world, px);

    if (overlays.bubble && world.focus) {
      const { spawnInner, spawnOuter, despawn } = world.config;
      const f = world.focus;
      // Shade everything the game would never bother to simulate.
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.rect(view.x0 - 100, view.y0 - 100, view.x1 - view.x0 + 200, view.y1 - view.y0 + 200);
      ctx.arc(f.x, f.y, despawn, 0, Math.PI * 2, true);
      ctx.fill();
      ctx.fillStyle = 'rgba(125,255,176,0.07)';
      ctx.beginPath();
      ctx.arc(f.x, f.y, spawnOuter, 0, Math.PI * 2);
      ctx.arc(f.x, f.y, spawnInner, 0, Math.PI * 2, true);
      ctx.fill();
      ctx.strokeStyle = COLORS.bubble;
      ctx.lineWidth = Math.max(1.5 * px, 1);
      for (const [radius, dash] of [
        [spawnInner, 6],
        [spawnOuter, 0],
        [despawn, 2],
      ] as const) {
        ctx.setLineDash(dash ? [dash * px * 2, dash * px * 2] : []);
        ctx.globalAlpha = radius === spawnOuter ? 0.9 : 0.5;
        ctx.beginPath();
        ctx.arc(f.x, f.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    if (world.config.weather === 'rain') this.drawRain(ctx, width, height, world.time);
  }

  /** Police: vision cones clipped by buildings, roadblocks, the helicopter, and the last known position. */
  private drawChase(ctx: Ctx, chase: Chase, world: World, px: number): void {
    const hero = world.hero;
    const live = chase.outcome === 'running';

    for (const rb of chase.roadblocks) {
      ctx.save();
      ctx.translate(rb.x, rb.y);
      ctx.rotate(rb.angle);
      ctx.fillStyle = rb.sees ? 'rgba(255,77,94,0.22)' : 'rgba(255,209,102,0.10)';
      ctx.beginPath();
      ctx.arc(0, 0, 55, 0, Math.PI * 2);
      ctx.fill();
      for (const side of [-1, 1]) {
        ctx.fillStyle = '#f4f6fb';
        ctx.fillRect(-1.1, side * 3.4 - 2.3, 2.2, 4.6);
        ctx.fillStyle = Math.floor(world.time * 5) % 2 === (side > 0 ? 0 : 1) ? '#ff3b4e' : '#3b82f6';
        ctx.fillRect(-1.1, side * 3.4 - 0.5, 2.2, 1);
      }
      ctx.restore();
    }

    if (live) {
      for (const cop of chase.cops) {
        const sees = chase.copState.get(cop.id)?.sees ?? false;
        ctx.fillStyle = sees ? 'rgba(255,77,94,0.30)' : 'rgba(255,209,102,0.14)';
        ctx.beginPath();
        ctx.moveTo(cop.x, cop.y);
        const rays = 16;
        for (let i = 0; i <= rays; i++) {
          const angle = cop.heading - VISION_HALF_ANGLE + (2 * VISION_HALF_ANGLE * i) / rays;
          const r = chase.occlusion.rayLength(cop.x, cop.y, angle, VISION_RANGE);
          ctx.lineTo(cop.x + Math.cos(angle) * r, cop.y + Math.sin(angle) * r);
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    if (live && !chase.seen && hero) {
      // Where the police think the hero is, and how far the search has spread.
      const lk = chase.lastKnown;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = Math.max(1.5 * px, 1);
      ctx.setLineDash([6 * px, 6 * px]);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(lk.x, lk.y, 60 + chase.hiddenFor * 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      const r = Math.max(8 * px, 7);
      ctx.fillStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(lk.x, lk.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b0f17';
      ctx.font = `700 ${r * 1.4}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', lk.x, lk.y + r * 0.08);
    }

    if (chase.heli) {
      const h = chase.heli;
      ctx.fillStyle = h.sees ? 'rgba(255,77,94,0.13)' : 'rgba(120,190,255,0.07)';
      ctx.strokeStyle = h.sees ? 'rgba(255,77,94,0.8)' : 'rgba(120,190,255,0.6)';
      ctx.lineWidth = Math.max(1.5 * px, 1);
      ctx.beginPath();
      ctx.arc(h.x, h.y, 100, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const size = Math.max(7, 7 * px);
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.fillStyle = '#dfe7f5';
      ctx.beginPath();
      ctx.ellipse(0, 0, size * 0.9, size * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.rotate(world.time * 14);
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = size * 0.14;
      ctx.beginPath();
      ctx.moveTo(-size * 1.5, 0);
      ctx.lineTo(size * 1.5, 0);
      ctx.moveTo(0, -size * 1.5);
      ctx.lineTo(0, size * 1.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  /** A cool tint and slanted streaks, drawn in screen space. Purely cosmetic. */
  private drawRain(ctx: Ctx, width: number, height: number, time: number): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(60,95,150,0.13)';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(190,215,255,0.20)';
    ctx.lineWidth = Math.max(1, width / 1100);
    ctx.beginPath();
    const count = Math.round((width * height) / 9000);
    const len = height * 0.035;
    for (let i = 0; i < count; i++) {
      // Cheap repeatable scatter: each streak falls on its own loop.
      const fx = (i * 0.61803398875) % 1;
      const fy = (i * 0.38196601125 + time * (1.6 + (i % 7) * 0.12)) % 1;
      const x = fx * (width + len) - len * 0.4;
      const y = fy * (height + len) - len;
      ctx.moveTo(x, y);
      ctx.lineTo(x - len * 0.35, y + len);
    }
    ctx.stroke();
  }

  private strokeRoads(ctx: Ctx, classes: RoadClass[], extra: number, color: (c: RoadClass) => string): void {
    const g = this.map.graph;
    for (const cls of classes) {
      ctx.strokeStyle = color(cls);
      ctx.lineWidth = ROAD_SPECS[cls].width + extra;
      ctx.beginPath();
      for (const chain of this.chains[cls]) {
        const first = g.nodes[chain[0]!]!;
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < chain.length; i++) {
          const n = g.nodes[chain[i]!]!;
          ctx.lineTo(n.x, n.y);
        }
      }
      ctx.stroke();
    }
  }

  private centreLines(ctx: Ctx, cls: RoadClass, px: number): void {
    const g = this.map.graph;
    ctx.strokeStyle = COLORS.lane;
    ctx.lineWidth = Math.max(0.35, px);
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    for (const chain of this.chains[cls]) {
      const first = g.nodes[chain[0]!]!;
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < chain.length; i++) {
        const n = g.nodes[chain[i]!]!;
        ctx.lineTo(n.x, n.y);
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private drawVehicles(ctx: Ctx, world: World, cam: Camera, view: { x0: number; x1: number; y0: number; y1: number }, level: number): void {
    const tiny = cam.zoom < 0.55;
    for (const v of world.vehicles) {
      if (v.level !== level) continue;
      if (v.x < view.x0 || v.x > view.x1 || v.y < view.y0 || v.y > view.y1) continue;
      const type = VEHICLE_TYPES[v.type]!;
      const hero = v.kind === 'hero';
      const cop = v.kind === 'cop';
      const flash = Math.floor(world.time * 6 + v.id) % 2 === 0;
      if (cop) {
        ctx.fillStyle = flash ? 'rgba(255,59,78,0.25)' : 'rgba(59,130,246,0.28)';
        ctx.beginPath();
        ctx.arc(v.x, v.y, Math.max(7, 6 / cam.zoom), 0, Math.PI * 2);
        ctx.fill();
      }
      if (hero) {
        ctx.fillStyle = 'rgba(255,59,107,0.22)';
        ctx.beginPath();
        ctx.arc(v.x, v.y, Math.max(9, 9 / cam.zoom), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = hero ? COLORS.hero : cop ? (tiny ? (flash ? '#ff3b4e' : '#3b82f6') : '#f4f6fb') : PAINTS[v.paint]!;
      if (tiny) {
        // Zoomed far out: a dot is all you can see, so make sure you can see it.
        const size = (hero || cop ? 4 : 2.2) / cam.zoom;
        ctx.fillRect(v.x - size / 2, v.y - size / 2, size, size);
        continue;
      }
      ctx.save();
      ctx.translate(v.x, v.y);
      ctx.rotate(v.heading);
      // The car's position is its front bumper, so the body extends backwards.
      ctx.fillRect(-type.length, -type.width / 2, type.length, type.width);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(-type.length * 0.42, -type.width / 2 + 0.25, type.length * 0.22, type.width - 0.5);
      if (cop) {
        // Black-and-white livery with a light bar.
        ctx.fillStyle = '#10141c';
        ctx.fillRect(-type.length, -type.width / 2, type.length * 0.3, type.width);
        ctx.fillRect(-type.length * 0.22, -type.width / 2, type.length * 0.22, type.width);
        ctx.fillStyle = flash ? '#ff3b4e' : '#3b82f6';
        ctx.fillRect(-type.length * 0.6, -type.width / 2, type.length * 0.14, type.width / 2);
        ctx.fillStyle = flash ? '#3b82f6' : '#ff3b4e';
        ctx.fillRect(-type.length * 0.6, 0, type.length * 0.14, type.width / 2);
      }
      ctx.restore();
    }
  }

  private drawDemo(ctx: Ctx, demo: RouteDemo, px: number): void {
    const g = this.map.graph;
    const dots = (trace: number[], count: number, color: string, radius: number) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      const n = Math.min(count, trace.length);
      for (let i = 0; i < n; i++) {
        const node = g.nodes[trace[i]!]!;
        ctx.moveTo(node.x + radius, node.y);
        ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      }
      ctx.fill();
    };
    const line = (nodes: number[], color: string, width: number) => {
      if (nodes.length < 2) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      const first = g.nodes[nodes[0]!]!;
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < nodes.length; i++) {
        const n = g.nodes[nodes[i]!]!;
        ctx.lineTo(n.x, n.y);
      }
      ctx.stroke();
    };

    const showFull = demo.show !== 'coarse';
    const showCoarse = demo.show !== 'full';
    if (showFull) {
      ctx.globalAlpha = 0.8;
      dots(demo.full.trace, demo.revealed, COLORS.traceFull, Math.max(2.6 * px, 3));
    }
    if (showCoarse) {
      ctx.globalAlpha = 1;
      dots(demo.coarse.trace, demo.revealed, COLORS.traceCoarse, Math.max(4 * px, 5));
    }
    ctx.globalAlpha = 1;

    // The finished route appears once its search has finished replaying.
    const fullDone = demo.revealed >= demo.full.trace.length;
    const coarseDone = demo.revealed >= demo.coarse.trace.length;
    if ((showFull && fullDone) || (!showFull && coarseDone)) {
      line(showFull ? demo.full.nodes : demo.coarse.nodes, '#04130b', Math.max(7 * px, 7));
      line(showFull ? demo.full.nodes : demo.coarse.nodes, COLORS.route, Math.max(3.5 * px, 3.5));
    }

    for (const [id, label] of [
      [demo.from, 'A'],
      [demo.to, 'B'],
    ] as const) {
      const n = g.nodes[id]!;
      const r = Math.max(9 * px, 9);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b0f17';
      ctx.font = `700 ${r * 1.3}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, n.x, n.y + r * 0.08);
    }
  }
}

/** Camera that shows the whole map with a margin. */
export function fitCamera(map: CityMap, width: number, height: number, margin = 80): Camera {
  const b = map.bounds;
  const w = b.maxX - b.minX + margin * 2;
  const h = b.maxY - b.minY + margin * 2;
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, zoom: Math.min(width / w, height / h) };
}
