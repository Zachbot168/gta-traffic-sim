// Renders the storyboard's shots to video clips, with no browser involved.
//
//   npm run record                     every shot, to recordings/<id>.mp4
//   npm run record -- L3-04 L6-02      just those shots
//   npm run record -- --preview        quick half-size, 10 fps versions in out/preview
//   npm run record -- --shard 0/2      every other section, to split the work across cores
//
// Needs ffmpeg on the PATH. The sim is seeded, so a shot renders the same every time.
import { createCanvas, type Canvas } from '@napi-rs/canvas';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { buildScene, STAGES, type Scene, type Stage } from '../src/app/stages';
import { ESCAPE_TIME } from '../src/sim/chase';
import { drawChart, layoutCharts } from '../src/render/charts';
import { fitCamera, type Camera } from '../src/render/render';
import { MONO_FONT, MonoRenderer } from '../src/render/render-mono';
import { SHOTS } from '../storyboard/shots';
import { duration, type Cam, type CamMove, type SimShot } from '../storyboard/types';

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const shardArg = args.includes('--shard') ? args[args.indexOf('--shard') + 1]! : '0/1';
const [shard, of] = shardArg.split('/').map(Number) as [number, number];
const only = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--shard');

const W = preview ? 960 : 1920;
const H = preview ? 540 : 1080;
const FPS = preview ? 10 : 30;
const DT = 1 / 30;
const OUT = preview ? 'out/preview' : 'recordings';

type Ctx = CanvasRenderingContext2D;

function stageOf(s: string | Stage): Stage {
  if (typeof s !== 'string') return s;
  const found = STAGES.find((x) => x.key === s);
  if (!found) throw new Error(`No stage ${s}`);
  return found;
}

const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));

class SimState {
  scene: Scene;
  renderer: MonoRenderer;
  /** Smoothed hero position, so the camera eases round corners. */
  hx = 0;
  hy = 0;
  acc = 0;

  constructor(stage: Stage) {
    this.scene = buildScene(stage);
    this.renderer = new MonoRenderer(this.scene.map, this.scene.world.coarse);
    const hero = this.scene.world.hero;
    if (hero) {
      this.hx = hero.x;
      this.hy = hero.y;
    }
  }

  advance(simSeconds: number, searchSeconds: number): void {
    this.acc += simSeconds;
    while (this.acc >= DT) {
      this.scene.world.step(DT);
      this.acc -= DT;
    }
    if (this.scene.demo) this.scene.demo.revealed += this.scene.demoRate * searchSeconds;
    const hero = this.scene.world.hero;
    if (hero) {
      const k = Math.min(1, (1 / FPS) * 4);
      this.hx += (hero.x - this.hx) * k;
      this.hy += (hero.y - this.hy) * k;
    }
  }

  resolve(cam: Cam, w: number, h: number): Camera {
    const view = w / 1280;
    if (cam.mode === 'fit') return fitCamera(this.scene.map, w, h, cam.margin ?? (this.scene.stage.scale === 'block' ? 60 : 90));
    if (cam.mode === 'follow') return { x: this.hx, y: this.hy, zoom: cam.zoom * view };
    if (cam.mode === 'focus') {
      const f = this.scene.world.focus ?? { x: this.hx, y: this.hy };
      return { x: f.x, y: f.y, zoom: cam.zoom * view };
    }
    if (cam.mode === 'point') {
      const b = this.scene.map.bounds;
      return { x: b.minX + (b.maxX - b.minX) * cam.fx, y: b.minY + (b.maxY - b.minY) * cam.fy, zoom: cam.zoom * view };
    }
    return { x: cam.x, y: cam.y, zoom: cam.zoom * view };
  }

  camera(spec: Cam | CamMove | undefined, t: number, w: number, h: number): Camera {
    if (!spec) {
      const f = this.scene.framing;
      const cam: Cam = f.kind === 'fit' ? { mode: 'fit' } : f.kind === 'follow' ? { mode: 'follow', zoom: f.zoom } : { mode: 'at', x: f.x, y: f.y, zoom: f.zoom };
      return this.resolve(cam, w, h);
    }
    if ('mode' in spec) return this.resolve(spec, w, h);
    const a = this.resolve(spec.from, w, h);
    const b = this.resolve(spec.to, w, h);
    const k = ease((t - spec.start) / (spec.end - spec.start));
    // Zoom moves evenly in log space, and the centre is weighted so the subject stays in frame.
    const zoom = Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * k);
    const pan = a.zoom === b.zoom ? k : (1 / a.zoom - 1 / zoom) / (1 / a.zoom - 1 / b.zoom);
    return { x: a.x + (b.x - a.x) * pan, y: a.y + (b.y - a.y) * pan, zoom };
  }

  draw(ctx: Ctx, w: number, h: number, cam: Camera): void {
    this.renderer.draw(ctx, w, h, cam, this.scene.world, this.scene.overlays, this.scene.demo, this.scene.chase);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

function label(ctx: Ctx, lines: { text: string; color?: string }[], x: number, y: number, align: CanvasTextAlign = 'left'): void {
  const px = Math.round(H * 0.03);
  ctx.font = `700 ${px}px ${MONO_FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const width = Math.max(...lines.map((l) => ctx.measureText(l.text).width));
  const pad = px * 0.5;
  ctx.fillStyle = 'rgba(0,0,0,0.82)';
  const left = align === 'left' ? x - pad : align === 'right' ? x - width - pad : x - width / 2 - pad;
  ctx.fillRect(left, y - pad, width + pad * 2, lines.length * px * 1.35 + pad * 1.4);
  lines.forEach((l, i) => {
    ctx.fillStyle = l.color ?? '#ffffff';
    ctx.fillText(l.text, x, y + i * px * 1.35);
  });
}

/** The small readout baked into a clip, so a shot reads without the app's panels. */
function hud(ctx: Ctx, shot: SimShot, scene: Scene): void {
  const kind = shot.hud ?? (scene.chase ? 'chase' : scene.demo ? 'search' : 'none');
  const x = W * 0.025;
  const y = H * 0.04;
  const n = (v: number) => Math.round(v).toLocaleString('en-US');
  if (kind === 'chase' && scene.chase) {
    const c = scene.chase;
    const stars = Array.from({ length: 5 }, (_, i) => (i < c.config.stars ? '*' : '.')).join(' ');
    const lines: { text: string; color?: string }[] = [{ text: `WANTED  ${stars}` }];
    lines.push({ text: c.config.knowledge === 'psychic' ? 'POLICE: ALWAYS KNOW WHERE YOU ARE' : 'POLICE: ONLY KNOW WHAT THEY SEE', color: '#b8b8b8' });
    if (c.outcome === 'escaped') lines.push({ text: 'ESCAPED' });
    else if (c.outcome === 'caught') lines.push({ text: 'CAUGHT', color: '#ff3b30' });
    else if (c.seen) lines.push({ text: 'SEEN', color: '#ff3b30' });
    else lines.push({ text: `OUT OF SIGHT  ${c.hiddenFor.toFixed(0)}s of ${ESCAPE_TIME[c.config.stars]}s` });
    label(ctx, lines, x, y);
  } else if (kind === 'search' && scene.demo) {
    const d = scene.demo;
    const lines: { text: string; color?: string }[] = [];
    if (d.show !== 'coarse') lines.push({ text: `EVERY POINT:  ${n(Math.min(d.revealed, d.full.trace.length))} checked` });
    if (d.show !== 'full') lines.push({ text: `FORKS ONLY:   ${n(Math.min(d.revealed, d.coarse.trace.length))} checked` });
    label(ctx, lines, x, y);
  } else if (kind === 'cars') {
    label(ctx, [{ text: `CARS BEING SIMULATED: ${n(scene.world.vehicles.length)}` }], x, y);
  } else if (kind === 'spawns') {
    const wrong = scene.world.spawnLog.filter((e) => e.kind === 'wronglyFull').length;
    const mode = scene.world.config.spawn === 'radial' ? 'COUNTING BY STRAIGHT-LINE DISTANCE' : 'COUNTING ALONG THE ROAD';
    label(ctx, [{ text: mode }, { text: `RECENT WRONG REFUSALS: ${wrong}`, color: wrong ? '#ff3b30' : '#ffffff' }], x, y);
  }
}

async function encode(file: string, frames: number, render: (frame: number, t: number) => Canvas): Promise<void> {
  const ff = spawn(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(FPS), '-i', '-', '-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'medium', '-crf', preview ? '28' : '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', file],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  for (let f = 0; f < frames; f++) {
    const canvas = render(f, f / FPS);
    if (!ff.stdin.write(canvas.data())) await once(ff.stdin, 'drain');
  }
  ff.stdin.end();
  const [code] = (await once(ff, 'close')) as [number];
  if (code !== 0) throw new Error(`ffmpeg failed on ${file}`);
}

mkdirSync(OUT, { recursive: true });
const sections = [...new Set(SHOTS.map((s) => s.section))];
let carried: SimState | null = null;
const started = Date.now();

for (const shot of SHOTS) {
  const wanted = only.length ? only.includes(shot.id) : sections.indexOf(shot.section) % of === shard;
  // A shot that continues from the one before needs that one simulated even when it is not wanted.
  const next = SHOTS[SHOTS.indexOf(shot) + 1];
  const feedsNext = next?.kind === 'sim' && next.continues === true && (only.length ? only.includes(next.id) : wanted);
  if (!wanted && !feedsNext) {
    if (shot.kind !== 'sim' || !shot.continues) carried = null;
    continue;
  }
  const seconds = duration(shot);
  const frames = Math.round(seconds * FPS);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as Ctx;
  let render: (frame: number, t: number) => Canvas;

  if (shot.kind === 'sim') {
    let state: SimState;
    if (shot.continues && carried) state = carried;
    else {
      state = new SimState(stageOf(shot.stage));
      state.advance(shot.warmup ?? 0, 0);
      const hero = state.scene.world.hero;
      if (hero) {
        state.hx = hero.x;
        state.hy = hero.y;
      }
    }
    carried = state;
    if (shot.overlays) Object.assign(state.scene.overlays, shot.overlays);
    const pending = [...(shot.events ?? [])].sort((a, b) => a.at - b.at);
    const speed = shot.speed ?? 1;
    render = (frame, t) => {
      while (pending.length && pending[0]!.at <= t) pending.shift()!.run(state.scene);
      if (frame > 0) state.advance(speed / FPS, (shot.searchSpeed ?? 1) / FPS);
      if (wanted) {
        state.draw(ctx, W, H, state.camera(shot.cam, t, W, H));
        hud(ctx, shot, state.scene);
      }
      return canvas;
    };
    if (!wanted) {
      // Only here to carry the world forward for the next shot.
      for (let f = 0; f < frames; f++) render(f, f / FPS);
      continue;
    }
  } else if (shot.kind === 'split') {
    carried = null;
    const half = createCanvas(W / 2, H);
    const hctx = half.getContext('2d') as unknown as Ctx;
    const sides = [shot.left, shot.right].map((side) => {
      const state = new SimState(stageOf(side.stage));
      state.advance(shot.warmup ?? 0, 0);
      return { state, label: side.label };
    });
    render = (frame) => {
      sides.forEach((side, i) => {
        if (frame > 0) side.state.advance((shot.speed ?? 1) / FPS, 0);
        side.state.draw(hctx, W / 2, H, side.state.resolve({ mode: 'fit', margin: 60 }, W / 2, H));
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(half as unknown as CanvasImageSource, i * (W / 2), 0);
        label(ctx, [{ text: side.label }], i * (W / 2) + W / 4, H * 0.04, 'center');
      });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(W / 2 - 1, 0, 2, H);
      return canvas;
    };
  } else if (shot.kind === 'chart') {
    carried = null;
    const scale = (H / 1080) * 2.3;
    render = (_frame, t) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, H);
      const rect = layoutCharts(1, W, H, 0, 0, scale)[0]!;
      drawChart(ctx, rect, shot.chart(t), scale, 'mono');
      return canvas;
    };
  } else {
    carried = null;
    render = (_frame, t) => {
      shot.draw(ctx, t, W, H);
      return canvas;
    };
  }

  await encode(`${OUT}/${shot.id}.mp4`, frames, render);
  console.log(`${shot.id}  ${seconds}s  (${((Date.now() - started) / 1000).toFixed(0)}s elapsed)`);
}
