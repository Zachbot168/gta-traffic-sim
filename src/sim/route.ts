/**
 * A* search, written against a small interface so the exact same search code
 * runs on the full road graph and on the coarse graph. (The patent calls the
 * object that hides which graph is being searched a "delegator".)
 */
import { MAX_SPEED, type RoadGraph } from './graph';

export interface SearchSpace {
  /** Calls visit(neighbour, cost, edgeId) for every step available from a node. */
  expand(node: number, visit: (to: number, cost: number, edge: number) => void): void;
  /** Lower bound on the remaining cost from a node to the target position. */
  heuristic(node: number, tx: number, ty: number): number;
}

export interface SearchResult {
  found: boolean;
  /** Nodes on the path, in the search space's own ids, start to end. */
  path: number[];
  /** Edge ids between consecutive path nodes. */
  edges: number[];
  cost: number;
  /** How many nodes the search pulled off its queue. This is the "work done" number. */
  expanded: number;
  /** Order in which nodes were expanded, if tracing was requested. */
  trace: number[];
}

/** Minimal binary heap keyed by priority. */
class Heap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      keys[i] = keys[p]!;
      vals[i] = vals[p]!;
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  pop(): number {
    const { keys, vals } = this;
    const top = vals[0]!;
    const key = keys.pop()!;
    const val = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1]! < keys[c]!) c++;
        if (keys[c]! >= key) break;
        keys[i] = keys[c]!;
        vals[i] = vals[c]!;
        i = c;
      }
      keys[i] = key;
      vals[i] = val;
    }
    return top;
  }
}

const GOAL = -1;

/**
 * A* from a set of start nodes (each with an entry cost) to a set of goal nodes
 * (each with an exit cost). Plain point-to-point search is one start and one goal
 * with zero costs. The coarse graph uses the extra costs to attach a start or
 * target that sits in the middle of a road.
 */
export function astar(
  space: SearchSpace,
  starts: ReadonlyArray<readonly [node: number, cost: number]>,
  goals: ReadonlyArray<readonly [node: number, cost: number]>,
  tx: number,
  ty: number,
  trace = false,
): SearchResult {
  const g = new Map<number, number>();
  const cameFrom = new Map<number, number>();
  const cameEdge = new Map<number, number>();
  const closed = new Set<number>();
  const goalCost = new Map<number, number>();
  for (const [n, c] of goals) {
    const prev = goalCost.get(n);
    if (prev === undefined || c < prev) goalCost.set(n, c);
  }

  const open = new Heap();
  for (const [n, c] of starts) {
    const prev = g.get(n);
    if (prev === undefined || c < prev) {
      g.set(n, c);
      open.push(c + space.heuristic(n, tx, ty), n);
    }
  }

  const order: number[] = [];
  let expanded = 0;
  let bestGoal = Infinity;
  let goalFrom = -1;

  while (open.size > 0) {
    const node = open.pop();
    if (node === GOAL) {
      // The virtual goal came off the queue: nothing cheaper can still be waiting.
      const path: number[] = [];
      const edges: number[] = [];
      let cur = goalFrom;
      while (cur !== undefined) {
        path.push(cur);
        const e = cameEdge.get(cur);
        if (e === undefined) break;
        edges.push(e);
        cur = cameFrom.get(cur)!;
      }
      path.reverse();
      edges.reverse();
      return { found: true, path, edges, cost: bestGoal, expanded, trace: order };
    }
    if (closed.has(node)) continue;
    closed.add(node);
    expanded++;
    if (trace) order.push(node);

    const gNode = g.get(node)!;
    const exit = goalCost.get(node);
    if (exit !== undefined && gNode + exit < bestGoal) {
      bestGoal = gNode + exit;
      goalFrom = node;
      open.push(bestGoal, GOAL);
    }

    space.expand(node, (to, cost, edge) => {
      if (closed.has(to)) return;
      const next = gNode + cost;
      const prev = g.get(to);
      if (prev === undefined || next < prev) {
        g.set(to, next);
        cameFrom.set(to, node);
        cameEdge.set(to, edge);
        open.push(next + space.heuristic(to, tx, ty), to);
      }
    });
  }
  return { found: false, path: [], edges: [], cost: Infinity, expanded, trace: order };
}

/** Search space over the full low-level road graph. */
export function fullSpace(graph: RoadGraph): SearchSpace {
  return {
    expand(node, visit) {
      for (const id of graph.adj[node]!) {
        const l = graph.links[id]!;
        visit(l.a === node ? l.b : l.a, l.cost, id);
      }
    },
    heuristic(node, tx, ty) {
      const n = graph.nodes[node]!;
      // Straight-line distance at the fastest possible speed can never overestimate.
      return Math.hypot(n.x - tx, n.y - ty) / MAX_SPEED;
    },
  };
}

export interface Route {
  found: boolean;
  /** Low-level node ids from start to target. */
  nodes: number[];
  cost: number;
  expanded: number;
  /** Low-level node ids in expansion order (forks only, when searching the coarse graph). */
  trace: number[];
}

/** Route on the full graph. */
export function routeFull(graph: RoadGraph, from: number, to: number, trace = false): Route {
  const t = graph.nodes[to]!;
  const r = astar(fullSpace(graph), [[from, 0]], [[to, 0]], t.x, t.y, trace);
  return { found: r.found, nodes: r.path, cost: r.cost, expanded: r.expanded, trace: r.trace };
}
