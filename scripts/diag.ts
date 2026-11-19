// Quick health check of the traffic sim: speeds, stuck cars, spawn-mode comparison.
import { ROAD_SPECS } from '../src/sim/graph';
import { generateCity } from '../src/sim/mapgen';
import { World, type SpawnMode, type RoutingMode } from '../src/sim/world';

const DT = 1 / 30;

function fixedPop(scale: 'block' | 'district' | 'city', n: number, routing: RoutingMode, seconds: number) {
  const map = generateCity(scale, 1);
  const w = new World(map, 42, { routing });
  w.populate(n);
  const t0 = performance.now();
  for (let i = 0; i < seconds / DT; i++) w.step(DT);
  const ms = performance.now() - t0;
  const speeds = w.vehicles.map((v) => v.v);
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const stopped = speeds.filter((s) => s < 0.3).length;
  console.log(
    `${scale} n=${n} ${routing}: cars=${w.vehicles.length} meanSpeed=${mean.toFixed(1)} m/s stopped=${stopped} ` +
      `routes=${w.stats.routes} avgExpanded=${(w.stats.expandedTotal / Math.max(1, w.stats.routes)).toFixed(0)} ` +
      `simSpeed=${((seconds * 1000) / ms).toFixed(0)}x realtime`,
  );
}

function bubble(mode: SpawnMode) {
  const map = generateCity('city', 1);
  const w = new World(map, 42, { spawn: mode, routing: 'coarse' });
  const hy = map.highwayY!;
  const hero = w.addHero(1700, hy - 150);
  w.fillBubble();
  let nearSum = 0, farSum = 0, hwSum = 0, inner = 0, samples = 0, heroDist = 0, speedSum = 0, speedN = 0;
  for (let i = 0; i < 180 / DT; i++) {
    w.step(DT);
    heroDist += hero.v * DT;
    if (i % 30 === 0 && i > 30 / DT) {
      for (const v of w.vehicles) { speedSum += v.v; speedN++; }
      samples++;
      for (const v of w.vehicles) {
        if (v.kind !== 'civ') continue;
        const cls = w.graph.links[v.link]!.cls;
        const d = Math.hypot(v.x - hero.x, v.y - hero.y);
        if (d < w.config.spawnInner) inner++;
        if (cls === 'highway') hwSum++;
        else if (cls === 'street') {
          if (Math.abs(v.y - hy) < 60) nearSum++;
          else farSum++;
        }
      }
    }
  }
  console.log(
    `bubble ${mode}: cars=${w.vehicles.length} avgInner=${(inner / samples).toFixed(1)} ` +
      `streetCarsNearHighway=${(nearSum / samples).toFixed(1)} streetCarsElsewhere=${(farSum / samples).toFixed(1)} ` +
      `highwayCars=${(hwSum / samples).toFixed(1)} spawned=${w.stats.spawned} heroAvgSpeed=${(heroDist / 180).toFixed(1)} meanSpeed=${(speedSum / speedN).toFixed(1)}`,
  );
}

console.log('speed limits', Object.fromEntries(Object.entries(ROAD_SPECS).map(([k, v]) => [k, v.speed])));
fixedPop('block', 1, 'wander', 60);
fixedPop('block', 10, 'wander', 120);
fixedPop('district', 200, 'wander', 180);
fixedPop('district', 200, 'full', 180);
fixedPop('district', 200, 'coarse', 180);
fixedPop('city', 1500, 'wander', 120);
fixedPop('city', 1500, 'full', 120);
fixedPop('city', 1500, 'coarse', 120);
bubble('radial');
bubble('path');
