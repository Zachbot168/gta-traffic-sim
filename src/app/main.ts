/**
 * Browser front end: runs the sim on a fixed timestep, draws it, and wires up
 * the stage presets and toggles. Everything here is presentation; the sim itself
 * lives in src/sim and never reads the clock or the screen.
 */
import { drawChart, layoutCharts, type HitPoint } from '../render/charts';
import { fitCamera, Renderer, type Camera, type Overlays } from '../render/render';
import { Chase, COP_LABELS, COP_STRATEGIES, ESCAPE_TIME, FLEE_LABELS, FLEE_STRATEGIES, type ChaseConfig, type FleeStrategy } from '../sim/chase';
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
const tip = document.createElement('div');
tip.id = 'tip';
document.body.appendChild(tip);
let hits: HitPoint[] = [];

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
  renderer.draw(ctx, canvas.width, canvas.height, { x: cam.x, y: cam.y, zoom: cam.zoom * dpr() }, scene.world, scene.overlays, scene.demo, scene.chase);
  hits = [];
  if (scene.charts) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const clean = document.body.classList.contains('clean');
    const top = clean ? 0 : (hud.offsetTop + hud.offsetHeight) * dpr();
    const rects = layoutCharts(scene.charts.length, canvas.width, canvas.height, width < 900 ? top : 0, barHeight() * dpr(), dpr());
    scene.charts.forEach((chart, i) => hits.push(...drawChart(ctx, rects[i]!, chart, dpr())));
  }
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

  if (!scene.charts) row('Cars simulated', fmt(world.vehicles.length));
  if (!scene.chase && !scene.charts) row('Road nodes', `${fmt(world.graph.nodes.length)} full · ${fmt(world.coarse.forks.length)} coarse`);
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
  if (scene.chase) chaseRows(scene.chase, row);
  if (world.config.spawn !== 'off' && !scene.chase) {
    const civ = world.vehicles.filter((v) => v.kind === 'civ');
    const mean = civ.reduce((sum, v) => sum + v.v, 0) / Math.max(1, civ.length);
    row(`Average speed (${world.config.weather})`, `${(mean * 3.6).toFixed(0)} km/h`, world.config.weather === 'rain' ? 'cool' : '');
  }
  if (world.config.spawn !== 'off' && !scene.chase && !scene.charts) {
    row('Density check', world.config.spawn === 'radial' ? 'straight-line radius' : 'along the road');
    row('Spawned / removed', `${fmt(world.stats.spawned)} / ${fmt(world.stats.despawned)}`);
  }
  if (!scene.charts) row('Sim time', `${world.time.toFixed(0)}s${paused ? ' (paused)' : ` at ${SPEEDS[speedIndex]}x`}`);

  hud.innerHTML =
    `<div class="chapter">${stage.chapter}</div><div class="title">${stage.key} · ${stage.title}</div>` +
    `<div class="caption">${stage.caption}</div><div class="stats">${rows.join('')}</div>`;
}

function chaseRows(chase: Chase, row: (label: string, value: string, cls?: string) => void): void {
  const { stars } = chase.config;
  row('Wanted', '★'.repeat(stars) + '☆'.repeat(5 - stars), 'hot');
  const need = ESCAPE_TIME[stars]!;
  if (chase.outcome === 'running') {
    row('Status', chase.seen ? 'IN SIGHT' : `hidden ${chase.hiddenFor.toFixed(1)} of ${need}s`, chase.seen ? 'hot' : 'cool');
  } else {
    const text = { escaped: `ESCAPED in ${chase.elapsed.toFixed(0)}s`, caught: `CAUGHT after ${chase.elapsed.toFixed(0)}s`, timeout: `still running at ${chase.elapsed.toFixed(0)}s` }[chase.outcome];
    row('Result', text, chase.outcome === 'escaped' ? 'cool' : 'hot');
  }
  row('Health', `${Math.max(0, chase.health).toFixed(0)}`);
  const extras = [chase.heli ? 'helicopter' : '', chase.roadblocks.length ? `${chase.roadblocks.length} roadblock${chase.roadblocks.length > 1 ? 's' : ''}` : ''].filter(Boolean);
  row('Police units', `${chase.cops.length}${extras.length ? ` + ${extras.join(' + ')}` : ''}`);
  row('Escape plan', FLEE_LABELS[chase.config.flee]);
  row('Police tactic', COP_LABELS[chase.config.cops]);
}

/** Start a fresh chase on the current scene, clearing away any previous one. */
function startChase(config: Partial<ChaseConfig>): void {
  const w = scene.world;
  if (!w.hero || w.config.spawn === 'off') return;
  w.vehicles = w.vehicles.filter((v) => v.kind !== 'cop');
  w.blocked.clear();
  w.hero.halt = false;
  scene.chase = new Chase(w, config, scene.chase?.occlusion);
  follow = true;
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
  {
    label: () => `Weather: ${scene.world.config.weather}`,
    key: 'W',
    on: () => scene.world.config.weather === 'rain',
    run: () => (scene.world.config.weather = scene.world.config.weather === 'rain' ? 'dry' : 'rain'),
  },
  {
    label: () => (scene.chase ? 'Restart chase' : 'Start a chase'),
    key: 'X',
    run: () => startChase(scene.chase ? { ...scene.chase.config } : { stars: 2, flee: 'run', cops: 'intercept' }),
  },
  { label: () => 'Star down', key: 'Y', run: () => scene.chase?.setStars(scene.chase.config.stars - 1) },
  { label: () => 'Star up', key: 'U', run: () => scene.chase?.setStars(scene.chase.config.stars + 1) },
  {
    label: () => `Escape: ${scene.chase?.config.flee ?? 'none'}`,
    key: 'K',
    run: () => {
      if (!scene.chase) return;
      const order: FleeStrategy[] = [...FLEE_STRATEGIES, 'manual'];
      scene.chase.config.flee = order[(order.indexOf(scene.chase.config.flee) + 1) % order.length]!;
      scene.chase.input.turn = 0;
      scene.chase.input.brake = false;
    },
  },
  {
    label: () => `Police: ${scene.chase?.config.cops ?? 'none'}`,
    key: 'O',
    run: () => {
      if (!scene.chase) return;
      scene.chase.config.cops = COP_STRATEGIES[(COP_STRATEGIES.indexOf(scene.chase.config.cops) + 1) % COP_STRATEGIES.length]!;
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

  // On-screen steering for the drive-it-yourself stage.
  if (scene.chase) {
    const drive = document.createElement('div');
    drive.className = 'row drive';
    const steer: [string, () => void, () => boolean][] = [
      ['Left', () => (scene.chase!.input.turn = -1), () => scene.chase?.input.turn === -1],
      ['Straight', () => (scene.chase!.input.turn = 0), () => scene.chase?.input.turn === 0],
      ['Right', () => (scene.chase!.input.turn = 1), () => scene.chase?.input.turn === 1],
      ['Brake', () => (scene.chase!.input.brake = !scene.chase!.input.brake), () => scene.chase?.input.brake === true],
    ];
    for (const [label, run, on] of steer) {
      const b = document.createElement('button') as HTMLButtonElement & { paint: () => void };
      b.textContent = label;
      b.paint = () => {
        b.classList.toggle('on', on());
        drive.style.display = scene.chase?.config.flee === 'manual' ? '' : 'none';
      };
      b.paint();
      b.onclick = () => {
        run();
        refreshBar();
      };
      drive.appendChild(b);
    }
    bar.appendChild(drive);
  }
}

const manualDriving = () => scene.chase?.config.flee === 'manual' && scene.chase.outcome === 'running';

window.addEventListener('keyup', (e) => {
  if (!scene.chase) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') scene.chase.input.turn = 0;
  if (e.key === 'ArrowDown') scene.chase.input.brake = false;
  refreshBar();
});

function refreshBar(): void {
  bar.querySelectorAll('button').forEach((b) => (b as HTMLButtonElement & { paint?: () => void }).paint?.());
}

window.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (manualDriving() && key.startsWith('Arrow')) {
    e.preventDefault();
    if (key === 'ArrowLeft') scene.chase!.input.turn = -1;
    if (key === 'ArrowRight') scene.chase!.input.turn = 1;
    if (key === 'ArrowUp') scene.chase!.input.turn = 0;
    if (key === 'ArrowDown') scene.chase!.input.brake = true;
    return refreshBar();
  }
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
  if (!p) {
    // Hovering a chart: show the value under the pointer.
    let best: HitPoint | null = null;
    let bestD = 22 * dpr();
    for (const h of hits) {
      const d = Math.hypot(h.x - e.clientX * dpr(), h.y - e.clientY * dpr());
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    tip.style.display = best ? 'block' : 'none';
    if (best) {
      tip.textContent = best.text;
      tip.style.left = `${Math.min(width - 240, best.x / dpr() + 12)}px`;
      tip.style.top = `${best.y / dpr() - 34}px`;
    }
    return;
  }
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
