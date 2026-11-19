import { describe, expect, it } from 'vitest';
import { CoarseGraph } from '../src/sim/coarse';
import { RoadGraph } from '../src/sim/graph';
import { generateCity, type Scale } from '../src/sim/mapgen';
import { Rng } from '../src/sim/rng';
import { routeFull } from '../src/sim/route';

function pathCost(graph: RoadGraph, nodes: number[]): number {
  let cost = 0;
  for (let i = 1; i < nodes.length; i++) {
    const link = graph.linkBetween(nodes[i - 1]!, nodes[i]!);
    expect(link, `nodes ${nodes[i - 1]} and ${nodes[i]} must be joined by a link`).toBeGreaterThanOrEqual(0);
    cost += graph.links[link]!.cost;
  }
  return cost;
}

describe('map generation', () => {
  it('gives the same city for the same seed', () => {
    const a = generateCity('district', 7).graph;
    const b = generateCity('district', 7).graph;
    expect(a.nodes).toEqual(b.nodes);
    expect(a.links).toEqual(b.links);
  });

  it('gives a different city for a different seed', () => {
    const a = generateCity('district', 7).graph;
    const b = generateCity('district', 8).graph;
    expect(a.nodes).not.toEqual(b.nodes);
  });

  it.each(['block', 'district', 'city'] as Scale[])('%s is fully connected', (scale) => {
    const g = generateCity(scale, 3).graph;
    const seen = new Uint8Array(g.nodes.length);
    const stack = [0];
    seen[0] = 1;
    let count = 1;
    while (stack.length) {
      const n = stack.pop()!;
      for (const l of g.adj[n]!) {
        const m = g.other(l, n);
        if (!seen[m]) {
          seen[m] = 1;
          count++;
          stack.push(m);
        }
      }
    }
    expect(count).toBe(g.nodes.length);
  });
});

describe('coarse graph', () => {
  it('covers every low-level link exactly once', () => {
    const g = generateCity('city', 11).graph;
    const coarse = new CoarseGraph(g);
    const steps = coarse.links.reduce((sum, l) => sum + l.chain.length - 1, 0);
    expect(steps).toBe(g.links.length);
    const total = coarse.links.reduce((sum, l) => sum + l.cost, 0);
    expect(total).toBeCloseTo(g.links.reduce((sum, l) => sum + l.cost, 0), 6);
  });

  it('is much smaller than the full graph', () => {
    const g = generateCity('city', 11).graph;
    const coarse = new CoarseGraph(g);
    expect(coarse.forks.length).toBeLessThan(g.nodes.length / 3);
  });

  it.each([
    ['block', 1],
    ['district', 2],
    ['district', 99],
    ['city', 3],
    ['city', 2026],
  ] as [Scale, number][])('finds routes of identical cost to full search (%s, seed %i)', (scale, seed) => {
    const g = generateCity(scale, seed).graph;
    const coarse = new CoarseGraph(g);
    const rng = new Rng(seed * 31 + 5);
    let fullWork = 0;
    let coarseWork = 0;
    for (let i = 0; i < 300; i++) {
      const from = rng.int(g.nodes.length);
      const to = rng.int(g.nodes.length);
      const full = routeFull(g, from, to);
      const fast = coarse.route(from, to);
      expect(fast.found).toBe(full.found);
      expect(fast.cost).toBeCloseTo(full.cost, 6);
      // The expanded route must be a real drivable path with the cost it claims.
      expect(fast.nodes[0]).toBe(from);
      expect(fast.nodes[fast.nodes.length - 1]).toBe(to);
      expect(pathCost(g, fast.nodes)).toBeCloseTo(fast.cost, 6);
      expect(pathCost(g, full.nodes)).toBeCloseTo(full.cost, 6);
      fullWork += full.expanded;
      coarseWork += fast.expanded;
    }
    if (scale !== 'block') expect(coarseWork).toBeLessThan(fullWork / 2);
  });

  it('gives the identical node-by-node route, not just the same cost', () => {
    const g = generateCity('city', 5).graph;
    const coarse = new CoarseGraph(g);
    const rng = new Rng(77);
    let same = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const from = rng.int(g.nodes.length);
      const to = rng.int(g.nodes.length);
      if (routeFull(g, from, to).nodes.join() === coarse.route(from, to).nodes.join()) same++;
    }
    expect(same).toBe(trials);
  });

  it('handles a closed loop with no junctions', () => {
    const g = new RoadGraph();
    const ids = [0, 1, 2, 3, 4, 5].map((i) => g.addNode(Math.cos(i) * 50, Math.sin(i) * 50));
    ids.forEach((id, i) => g.addLink(id, ids[(i + 1) % ids.length]!, 'street'));
    const coarse = new CoarseGraph(g);
    expect(coarse.forks.length).toBe(1);
    for (const from of ids) {
      for (const to of ids) {
        const full = routeFull(g, from, to);
        const fast = coarse.route(from, to);
        expect(fast.cost).toBeCloseTo(full.cost, 6);
        expect(pathCost(g, fast.nodes)).toBeCloseTo(fast.cost, 6);
      }
    }
  });

  it('handles a lollipop: a loop hanging off a single junction', () => {
    const g = new RoadGraph();
    const stem = g.addNode(-100, 0);
    const hub = g.addNode(0, 0);
    g.addLink(stem, hub, 'street');
    const ring = [g.addNode(30, 30), g.addNode(60, 0), g.addNode(30, -40)];
    g.addLink(hub, ring[0]!, 'street');
    g.addLink(ring[0]!, ring[1]!, 'street');
    g.addLink(ring[1]!, ring[2]!, 'street');
    g.addLink(ring[2]!, hub, 'street');
    const coarse = new CoarseGraph(g);
    for (const from of g.nodes) {
      for (const to of g.nodes) {
        const full = routeFull(g, from.id, to.id);
        const fast = coarse.route(from.id, to.id);
        expect(fast.cost).toBeCloseTo(full.cost, 6);
        expect(fast.nodes[0]).toBe(from.id);
        expect(fast.nodes[fast.nodes.length - 1]).toBe(to.id);
        expect(pathCost(g, fast.nodes)).toBeCloseTo(fast.cost, 6);
      }
    }
  });
});
