import { describe, expect, it } from 'vitest';
import { Chase, ESCAPE_TIME, UNITS, type ChaseConfig } from '../src/sim/chase';
import { generateCity } from '../src/sim/mapgen';
import { Occlusion } from '../src/sim/occlusion';
import { World } from '../src/sim/world';

const DT = 1 / 30;
const map = generateCity('city', 1);
const occlusion = new Occlusion(map.graph);

function chase(config: Partial<ChaseConfig>, seed = 7) {
  const world = new World(map, seed, { spawn: 'path', routing: 'coarse', tripShare: 0.3 });
  world.addHero(1500, 900);
  world.fillBubble();
  const c = new Chase(world, config, occlusion);
  return { world, chase: c };
}

function finish(config: Partial<ChaseConfig>, seed = 7) {
  const run = chase(config, seed);
  let maxCops = 0;
  while (run.chase.outcome === 'running') {
    run.world.step(DT);
    maxCops = Math.max(maxCops, run.chase.cops.length);
  }
  return { ...run, maxCops };
}

describe('line of sight', () => {
  it('sees along a street but not through a city block', () => {
    const g = map.graph;
    // Row 2 is an arterial, which the map generator never removes.
    const a = g.nodes[map.grid[4]![2]!]!;
    const alongStreet = g.nodes[map.grid[5]![2]!]!;
    const acrossBlock = g.nodes[map.grid[5]![3]!]!;
    expect(occlusion.visible(a.x, a.y, alongStreet.x, alongStreet.y)).toBe(true);
    expect(occlusion.visible(a.x, a.y, acrossBlock.x, acrossBlock.y)).toBe(false);
  });
});

describe('police chase', () => {
  it('starts with a patrol car that can see the hero', () => {
    const { world, chase: c } = chase({ stars: 1 });
    world.step(DT);
    expect(c.cops.length).toBeGreaterThanOrEqual(1);
    expect(c.seen).toBe(true);
  });

  it('always ends, and replays identically from the same seed', () => {
    const a = finish({ stars: 3, flee: 'run', cops: 'intercept' });
    const b = finish({ stars: 3, flee: 'run', cops: 'intercept' });
    expect(['escaped', 'caught', 'timeout']).toContain(a.chase.outcome);
    expect(a.chase.outcome).toBe(b.chase.outcome);
    expect(a.chase.elapsed).toBe(b.chase.elapsed);
    expect(a.chase.health).toBe(b.chase.health);
  });

  it('never sends more units than the star level allows', () => {
    for (const stars of [1, 3, 5]) {
      const r = finish({ stars, flee: 'straight' });
      expect(r.maxCops).toBeLessThanOrEqual(UNITS[stars]!);
    }
  });

  it('only calls it an escape after the full hide time out of sight', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const r = finish({ stars: 2, flee: 'run' }, seed);
      if (r.chase.outcome === 'escaped') {
        expect(r.chase.hiddenFor).toBeGreaterThanOrEqual(ESCAPE_TIME[2]!);
        expect(r.chase.elapsed).toBeGreaterThanOrEqual(ESCAPE_TIME[2]!);
      }
    }
  });

  it('does not shoot at one star', () => {
    const r = finish({ stars: 1, flee: 'straight' });
    expect(r.chase.health).toBe(100);
  });

  it('sends a helicopter only at four stars and above', () => {
    const three = chase({ stars: 3 });
    const five = chase({ stars: 5 });
    for (let i = 0; i < 30; i++) {
      three.world.step(DT);
      five.world.step(DT);
    }
    expect(three.chase.heli).toBeNull();
    expect(five.chase.heli).not.toBeNull();
  });

  it('clears the police away after an escape', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const r = finish({ stars: 1, flee: 'highway' }, seed);
      if (r.chase.outcome !== 'escaped') continue;
      for (let i = 0; i < 6 / DT; i++) r.world.step(DT);
      expect(r.chase.cops.length).toBe(0);
      expect(r.world.blocked.size).toBe(0);
      return;
    }
    throw new Error('expected at least one escape at one star');
  });
});
