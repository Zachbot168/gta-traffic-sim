import { describe, expect, it } from 'vitest';
import { generateCity } from '../src/sim/mapgen';
import { World, VEHICLE_TYPES, type WorldConfig } from '../src/sim/world';

const DT = 1 / 30;

function run(config: Partial<WorldConfig>, setup: (w: World) => void, seconds: number, scale: 'district' | 'city' = 'district', seed = 42): World {
  const w = new World(generateCity(scale, 1), seed, config);
  setup(w);
  for (let i = 0; i < seconds / DT; i++) w.step(DT);
  return w;
}

const fingerprint = (w: World) => w.vehicles.map((v) => `${v.id}:${v.link}:${v.s.toFixed(6)}:${v.v.toFixed(6)}`).join('|');

describe('traffic sim', () => {
  it('replays identically from the same seed', () => {
    const a = run({ routing: 'coarse' }, (w) => w.populate(150), 60);
    const b = run({ routing: 'coarse' }, (w) => w.populate(150), 60);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('plays out differently from a different seed', () => {
    const a = run({}, (w) => w.populate(150), 30, 'district', 1);
    const b = run({}, (w) => w.populate(150), 30, 'district', 2);
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });

  it('drives the exact same traffic whether trips are planned on the full or the coarse graph', () => {
    const full = run({ routing: 'full' }, (w) => w.populate(150), 60);
    const coarse = run({ routing: 'coarse' }, (w) => w.populate(150), 60);
    expect(fingerprint(coarse)).toBe(fingerprint(full));
    expect(coarse.stats.routes).toBe(full.stats.routes);
    expect(coarse.stats.expandedTotal).toBeLessThan(full.stats.expandedTotal / 3);
  });

  it('keeps a fixed population fixed and moving', () => {
    const w = run({}, (w) => w.populate(200), 90);
    expect(w.vehicles.length).toBe(200);
    const mean = w.vehicles.reduce((sum, v) => sum + v.v, 0) / w.vehicles.length;
    expect(mean).toBeGreaterThan(5);
    for (const v of w.vehicles) {
      expect(Number.isFinite(v.s) && Number.isFinite(v.v) && Number.isFinite(v.x)).toBe(true);
      expect(v.s).toBeGreaterThanOrEqual(0);
      expect(v.s).toBeLessThanOrEqual(w.graph.links[v.link]!.length + 1e-6);
    }
  });

  it('does not let cars in the same lane drive through each other', () => {
    const w = new World(generateCity('district', 1), 42, { routing: 'coarse' });
    w.populate(300);
    let worst = Infinity;
    for (let i = 0; i < 90 / DT; i++) {
      w.step(DT);
      // Cars are scattered at random to start with, so give them a few seconds to sort themselves out.
      if (i % 15 !== 0 || w.time < 10) continue;
      const lanes = new Map<string, typeof w.vehicles>();
      for (const v of w.vehicles) {
        const lanesHere = { street: 1, arterial: 2, highway: 3, ramp: 1 }[w.graph.links[v.link]!.cls];
        const key = `${v.link}/${v.dir}/${v.id % lanesHere}`;
        if (!lanes.has(key)) lanes.set(key, []);
        lanes.get(key)!.push(v);
      }
      for (const list of lanes.values()) {
        list.sort((p, q) => p.s - q.s);
        for (let k = 1; k < list.length; k++) {
          worst = Math.min(worst, list[k]!.s - VEHICLE_TYPES[list[k]!.type]!.length - list[k - 1]!.s);
        }
      }
    }
    // A small overlap can happen for an instant when two lanes merge into one; cars must never pass through each other.
    expect(worst).toBeGreaterThan(-2.5);
  });
});

describe('spawn bubble', () => {
  const bubble = (spawn: 'radial' | 'path') =>
    run({ spawn, routing: 'coarse', tripShare: 0.3 }, (w) => {
      w.pinFocus(1600, w.map.highwayY!);
      w.fillBubble();
    }, 90, 'city');

  it('only ever simulates cars inside the bubble', () => {
    const w = bubble('path');
    expect(w.vehicles.length).toBeGreaterThan(100);
    for (const v of w.vehicles) {
      expect(Math.hypot(v.x - w.focus!.x, v.y - w.focus!.y)).toBeLessThanOrEqual(w.config.despawn + 35);
    }
    expect(w.stats.spawned).toBeGreaterThan(w.vehicles.length);
    expect(w.stats.despawned).toBeGreaterThan(0);
  });

  it('wrongly refuses spots near the highway only when counting by straight-line radius', () => {
    const radial = bubble('radial');
    const path = bubble('path');
    const wrong = radial.spawnLog.filter((e) => e.kind === 'wronglyFull');
    expect(wrong.length).toBeGreaterThan(20);
    expect(path.spawnLog.filter((e) => e.kind === 'wronglyFull').length).toBe(0);
    // Most of the wrong refusals should sit close to the elevated highway.
    const hy = radial.map.highwayY!;
    const near = wrong.filter((e) => Math.abs(e.y - hy) < 90).length;
    expect(near / wrong.length).toBeGreaterThan(0.5);
  });
});
