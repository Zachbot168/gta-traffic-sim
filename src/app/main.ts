/**
 * Browser front end: runs the sim on a fixed timestep, draws it, and wires up
 * the stage presets and toggles. Everything here is presentation; the sim itself
 * lives in src/sim and never reads the clock or the screen.
 */
import { fitCamera, Renderer, type Camera, type Overlays } from '../render/render';
import { Rng } from '../sim/rng';
import type { RoutingMode } from '../sim/world';
import { buildScene, makeDemo, STAGES, type Scene } from './stages';

const DT = 1 / 30;
const SPEEDS = [0.5, 1, 2, 4, 8];
const MAX_STEPS_PER_FRAME = 16;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const hud = document.getElementById('hud')!;
const bar = document.getElementById('bar')!;

let scene!: Scene;
let renderer!: Renderer;
let cam: Camera = { x: 0, y: 0, zoom: 1 };
let follow = false;
let paused = false;
let speedIndex = 1;
let stageIndex = 0;
let acc = 0;
let last = performance.now();
let demoSeed = 1;
let frames = 0;
let width = 0;
let height = 0;

// ------------------------------------------------------------------ stages

function loadStage(index: number): void {
  stageIndex = (index + STAGES.length) % STAGES.length;
  scene = buildScene(STAGES[stageIndex]!);
  renderer = new Renderer(scene.map, scene.world.coarse);
  acc = 0;
  demoSeed = 1;
  buildBar();
  frame();
  rememberStage();
}

/** Keep the current stage in the address bar so a shot can be reopened directly. */
function rememberStage(): void {
  try {
    history.replaceState(null, '', `#${scene.stage.key}${document.body.classList.contains('clean') ? '-clean' : ''}`);
  } catch {
    // Some embedded viewers don't allow touching the address bar. The sim works without it.
  }
}

/** Point the camera where the stage wants it. */
function frame(): void {
  const f = scene.framing;
  follow = f.kind === 'follow';
  if (f.kind === 'fit') cam = fitCamera(scene.map, width, height - barHeight(), scene.stage.scale === 'block' ? 60 : 90);
  else if (f.kind === 'at') cam = { x: f.x, y: f.y, zoom: f.zoom * viewScale() };
  else cam = { x: scene.world.hero!.x, y: scene.world.hero!.y, zoom: f.zoom * viewScale() };
  if (f.kind === 'fit') cam.y += barHeight() / 2 / cam.zoom;
}

/** Fixed-zoom shots are authored for a 1280px-wide frame; scale them to the real one. */
function viewScale(): number {
  return Math.max(0.45, Math.min(1.6, width / 1280));
}

function barHeight(): number {
  return document.body.classList.contains('clean') ? 0 : bar.offsetHeight;
}

// ------------------------------------------------------------------ loop

function tick(now: number): void {
  const elapsed = Math.min(0.1, (now - last) / 1000);
  last = now;
  const speed = SPEEDS[speedIndex]!;
  if (!paused) {
    acc += elapsed * speed;
    let steps = 0;
    while (acc >= DT && steps < MAX_STEPS_PER_FRAME) {
      scene.world.step(DT);
      acc -= DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) acc = 0;
    if (scene.demo) scene.demo.revealed += scene.demoRate * elapsed * speed;
  }
  if (follow && scene.world.hero) {
    // Ease the camera after the hero so turns don't snap.
    const k = Math.min(1, elapsed * 4);
    cam.x += (scene.world.hero.x - cam.x) * k;
    cam.y += (scene.world.hero.y - cam.y) * k;
  }
  renderer.draw(ctx, canvas.width, canvas.height, { x: cam.x, y: cam.y, zoom: cam.zoom * dpr() }, scene.world, scene.overlays, scene.demo);
  if (frames++ % 6 === 0) drawHud();
  requestAnimationFrame(tick);
}

function dpr(): number {
  return Math.min(2, window.devicePixelRatio || 1);
}

function resize(): void {
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.round(width * dpr());
  canvas.height = Math.round(height * dpr());
}

// ------------------------------------------------------------------ HUD

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

function drawHud(): void {
  const { world, stage, demo } = scene;
  const rows: string[] = [];
  const row = (label: string, value: string, cls = '') => rows.push(`<div class="${cls}"><span>${label}</span><span>${value}</span></div>`);

  row('Cars simulated', fmt(world.vehicles.length));
  row('Road nodes', `${fmt(world.graph.nodes.length)} full · ${fmt(world.coarse.forks.length)} coarse`);
  if (demo) {
    const full = Math.min(demo.revealed, demo.full.trace.length);
    const coarse = Math.min(demo.revealed, demo.coarse.trace.length);
    if (demo.show !== 'coarse') row('Full graph: nodes searched', fmt(full), 'cool');
    if (demo.show !== 'full') row('Coarse graph: nodes searched', fmt(coarse), 'hot');
    if (demo.show === 'both' && demo.revealed >= demo.full.trace.length) {
      row('Work saved', `${(demo.full.expanded / Math.max(1, demo.coarse.expanded)).toFixed(1)}x fewer nodes`, 'hot');
      row('Same route?', demo.full.nodes.join() === demo.coarse.nodes.join() ? 'identical' : 'DIFFERENT');
    }
  }
  if (world.config.routing !== 'wander' && world.stats.routes > 0) {
    row('Trips planned', fmt(world.stats.routes));
    row(
      `Nodes searched per trip (${world.config.routing})`,
      fmt(world.stats.expandedTotal / world.stats.routes),
      world.config.routing === 'coarse' ? 'hot' : 'cool',
    );
  }
  if (world.config.spawn !== 'off') {
    row('Density check', world.config.spawn === 'radial' ? 'straight-line radius' : 'along the road');
    row('Spawned / removed', `${fmt(world.stats.spawned)} / ${fmt(world.stats.despawned)}`);
  }
  row('Sim time', `${world.time.toFixed(0)}s${paused ? ' (paused)' : ` at ${SPEEDS[speedIndex]}x`}`);

  hud.innerHTML =
    `<div class="chapter">${stage.chapter}</div><div class="title">${stage.key} · ${stage.title}</div>` +
    `<div class="caption">${stage.caption}</div><div class="stats">${rows.join('')}</div>`;
}

// ------------------------------------------------------------------ controls

interface Control {
  label: () => string;
  key?: string;
  on?: () => boolean;
  run: () => void;
}

const ROUTING: RoutingMode[] = ['wander', 'full', 'coarse'];

function toggle(name: keyof Overlays): Control['run'] {
  return () => {
    scene.overlays = { ...scene.overlays, [name]: !scene.overlays[name] };
  };
}

function newDemo(show?: 'full' | 'coarse' | 'both'): void {
  const mode = show ?? scene.demo?.show ?? 'both';
  scene.demo = makeDemo(scene.world, mode, new Rng(demoSeed++ * 7919));
  if (scene.demoRate === 0) scene.demoRate = scene.stage.scale === 'city' ? 900 : 90;
}

const controls: Control[] = [
  { label: () => (paused ? 'Play' : 'Pause'), key: 'Space', on: () => paused, run: () => (paused = !paused) },
  { label: () => `Speed ${SPEEDS[speedIndex]}x`, key: ']', run: () => (speedIndex = (speedIndex + 1) % SPEEDS.length) },
  { label: () => 'Replay', key: '0', run: () => loadStage(stageIndex) },
  { label: () => 'Graph', key: 'G', on: () => scene.overlays.graph, run: toggle('graph') },
  { label: () => 'Forks', key: 'C', on: () => scene.overlays.coarse, run: toggle('coarse') },
  { label: () => 'Bubble', key: 'B', on: () => scene.overlays.bubble, run: toggle('bubble') },
  { label: () => 'Spawn marks', key: 'S', on: () => scene.overlays.spawns, run: toggle('spawns') },
  {
    label: () => 'Follow car',
    key: 'F',
    on: () => follow,
    run: () => {
      if (!scene.world.hero) return;
      follow = !follow;
      if (follow && cam.zoom < 1) cam.zoom = 2 * viewScale();
    },
  },
  {
    label: () => `Routing: ${scene.world.config.routing}`,
    key: 'M',
    run: () => {
      const c = scene.world.config;
      c.routing = ROUTING[(ROUTING.indexOf(c.routing) + 1) % ROUTING.length]!;
      Object.assign(scene.world.stats, { routes: 0, expandedTotal: 0, lastExpanded: 0 });
    },
  },
  {
    label: () => `Spawn check: ${scene.world.config.spawn}`,
    key: 'P',
    run: () => {
      const c = scene.world.config;
      if (c.spawn === 'off') return; // fixed-population scenes have no bubble to switch
      c.spawn = c.spawn === 'radial' ? 'path' : 'radial';
    },
  },
  {
    label: () => 'Fewer cars',
    key: '-',
    run: () => {
      const w = scene.world;
      if (w.config.spawn === 'off') w.removeVehicles(Math.ceil(w.vehicles.length / 3));
      else w.config.density = Math.max(0.3, w.config.density / 1.25);
    },
  },
  {
    label: () => 'More cars',
    key: '+',
    run: () => {
      const w = scene.world;
      if (w.config.spawn === 'off') w.populate(Math.max(1, Math.ceil(w.vehicles.length / 2)));
      else w.config.density = Math.min(3, w.config.density * 1.25);
    },
  },
  { label: () => 'New route', key: 'R', run: () => newDemo() },
  {
    label: () => `Search view: ${scene.demo?.show ?? 'off'}`,
    key: 'T',
    run: () => {
      if (!scene.demo) return newDemo('both');
      const order = ['full', 'coarse', 'both'] as const;
      scene.demo.show = order[(order.indexOf(scene.demo.show) + 1) % order.length]!;
      scene.demo.revealed = 0;
    },
  },
  { label: () => 'Hide panels', key: 'H', run: () => setClean(true) },
];

function setClean(on: boolean): void {
  document.body.classList.toggle('clean', on);
  rememberStage();
}

function buildBar(): void {
  bar.innerHTML = '';
  const stages = document.createElement('div');
  stages.className = 'row';
  STAGES.forEach((s, i) => {
    const b = document.createElement('button');
    b.textContent = s.key;
    b.title = `${s.chapter}: ${s.title}`;
    if (i === stageIndex) b.className = 'on';
    b.onclick = () => loadStage(i);
    stages.appendChild(b);
  });
  bar.appendChild(stages);

  const row = document.createElement('div');
  row.className = 'row';
  for (const c of controls) {
    const b = document.createElement('button');
    const paint = () => {
      b.innerHTML = `${c.label()}${c.key ? `<span class="k">${c.key}</span>` : ''}`;
      b.classList.toggle('on', c.on?.() ?? false);
    };
    paint();
    b.onclick = () => {
      c.run();
      refreshBar();
    };
    (b as HTMLButtonElement & { paint: () => void }).paint = paint;
    row.appendChild(b);
  }
  bar.appendChild(row);
}

function refreshBar(): void {
  bar.querySelectorAll('button').forEach((b) => (b as HTMLButtonElement & { paint?: () => void }).paint?.());
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (key === 'ArrowRight' || key === '.') return loadStage(stageIndex + 1);
  if (key === 'ArrowLeft' || key === ',') return loadStage(stageIndex - 1);
  if (key === 'Escape' || (key === 'H' && document.body.classList.contains('clean'))) return setClean(false);
  if (key === '[') {
    speedIndex = Math.max(0, speedIndex - 1);
    return refreshBar();
  }
  if (key === '=') return controls.find((c) => c.key === '+')!.run();
  if (key >= '1' && key <= '9') {
    const first = STAGES.findIndex((s) => s.key.startsWith(key));
    if (first >= 0) return loadStage(first);
  }
  const control = controls.find((c) => c.key === key);
  if (control) {
    e.preventDefault();
    control.run();
    refreshBar();
  }
});

// ------------------------------------------------------------------ camera input

const pointers = new Map<number, { x: number; y: number }>();
let pinch = 0;

function zoomAt(sx: number, sy: number, factor: number): void {
  const wx = cam.x + (sx - width / 2) / cam.zoom;
  const wy = cam.y + (sy - height / 2) / cam.zoom;
  cam.zoom = Math.max(0.05, Math.min(12, cam.zoom * factor));
  if (!follow) {
    cam.x = wx - (sx - width / 2) / cam.zoom;
    cam.y = wy - (sy - height / 2) / cam.zoom;
  }
}

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (document.body.classList.contains('clean') && e.pointerType === 'touch' && pointers.size === 3) setClean(false);
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  if (pointers.size === 1) {
    cam.x -= (e.clientX - p.x) / cam.zoom;
    cam.y -= (e.clientY - p.y) / cam.zoom;
    if (follow && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 2) {
      follow = false;
      refreshBar();
    }
  }
  p.x = e.clientX;
  p.y = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch);
    pinch = d;
  }
});
const release = (e: PointerEvent) => {
  pointers.delete(e.pointerId);
  pinch = 0;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
}, { passive: false });
canvas.addEventListener('dblclick', () => setClean(!document.body.classList.contains('clean')));

// ------------------------------------------------------------------ start

window.addEventListener('resize', () => {
  resize();
  frame();
});

resize();
const wanted = location.hash.replace('#', '').split('-');
if (wanted.includes('clean')) document.body.classList.add('clean');
loadStage(Math.max(0, STAGES.findIndex((s) => s.key === wanted[0])));
requestAnimationFrame(tick);
