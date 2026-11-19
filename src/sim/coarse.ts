/**
 * The coarse graph: the trick at the centre of the patent.
 *
 * A driver only makes a decision at a fork. Every node along a plain stretch of
 * road is just "keep going". So we build a second, much smaller graph that keeps
 * only the forks, and replaces each run of road between two forks with a single
 * link that remembers its total cost and the low-level nodes it stands for.
 *
 * Searching this graph gives the same route as searching the full one, while
 * looking at far fewer nodes. The result is then expanded back into the full
 * node-by-node route.
 */
import { MAX_SPEED, type RoadGraph } from './graph';
import { astar, type Route, type SearchSpace } from './route';

export interface CoarseLink {
  id: number;
  /** Fork at each end (low-level node ids). */
  a: number;
  b: number;
  /** Total travel time along the run. */
  cost: number;
  /** Total length along the run, metres. */
  length: number;
  /** Every low-level node on the run, from a to b inclusive. */
  chain: number[];
  /** costTo[i] is the travel time from a to chain[i]. */
  costTo: number[];
}

export class CoarseGraph {
  readonly links: CoarseLink[] = [];
  /** Low-level ids of the nodes kept in the coarse graph. */
  readonly forks: number[] = [];
  /** isFork[node] is 1 if the low-level node survives into the coarse graph. */
  readonly isFork: Uint8Array;
  /** For each fork, the coarse links touching it. Empty for non-forks. */
  readonly adj: number[][];
  /** For a non-fork node: which coarse link it lies on, and where. */
  readonly linkOf: Int32Array;
  readonly indexOf: Int32Array;

  constructor(readonly graph: RoadGraph) {
    const n = graph.nodes.length;
    this.isFork = new Uint8Array(n);
    this.adj = Array.from({ length: n }, () => []);
    this.linkOf = new Int32Array(n).fill(-1);
    this.indexOf = new Int32Array(n).fill(-1);
    this.build();
  }

  private build(): void {
    const { graph } = this;

    // Step 1: collect the forks. Anything that isn't "one way in, one way out"
    // is a decision point: junctions (3+ links) and dead ends (1 link).
    for (const node of graph.nodes) {
      const d = graph.degree(node.id);
      if (d !== 2 && d > 0) this.isFork[node.id] = 1;
    }

    // Step 2: from each fork, walk along each road until the next fork.
    const used = new Uint8Array(graph.links.length);
    const walkFrom = (start: number) => {
      for (const first of graph.adj[start]!) {
        if (!used[first]) this.walk(start, first, used);
      }
    };
    for (const node of graph.nodes) {
      if (this.isFork[node.id]) walkFrom(node.id);
    }

    // Step 3: a closed loop with no junction on it has no fork to start from.
    // The patent handles this by adding extra nodes; we promote one node on the loop.
    for (const link of graph.links) {
      if (used[link.id]) continue;
      this.isFork[link.a] = 1;
      walkFrom(link.a);
    }

    for (let id = 0; id < this.isFork.length; id++) {
      if (this.isFork[id]) this.forks.push(id);
    }
  }

  private walk(start: number, firstLink: number, used: Uint8Array): void {
    const { graph } = this;
    const chain = [start];
    const costTo = [0];
    let cost = 0;
    let length = 0;
    let node = start;
    let link = firstLink;
    for (;;) {
      used[link] = 1;
      const l = graph.links[link]!;
      cost += l.cost;
      length += l.length;
      node = l.a === node ? l.b : l.a;
      chain.push(node);
      costTo.push(cost);
      if (this.isFork[node]) break;
      const [x, y] = graph.adj[node]! as [number, number];
      link = x === link ? y : x;
    }
    const id = this.links.length;
    this.links.push({ id, a: start, b: node, cost, length, chain, costTo });
    this.adj[start]!.push(id);
    if (node !== start) this.adj[node]!.push(id);
    for (let i = 1; i < chain.length - 1; i++) {
      this.linkOf[chain[i]!] = id;
      this.indexOf[chain[i]!] = i;
    }
  }

  space(): SearchSpace {
    const { graph, links, adj } = this;
    return {
      expand(node, visit) {
        for (const id of adj[node]!) {
          const l = links[id]!;
          if (l.a === l.b) continue; // a loop back to the same fork is never on a shortest path
          visit(l.a === node ? l.b : l.a, l.cost, id);
        }
      },
      heuristic(node, tx, ty) {
        const n = graph.nodes[node]!;
        return Math.hypot(n.x - tx, n.y - ty) / MAX_SPEED;
      },
    };
  }

  /**
   * Ways to get from a low-level node onto the coarse graph: a fork is already on it;
   * any other node can travel along its road to the fork at either end.
   */
  private attach(node: number): Array<[fork: number, cost: number]> {
    if (this.isFork[node]) return [[node, 0]];
    const l = this.links[this.linkOf[node]!]!;
    const c = l.costTo[this.indexOf[node]!]!;
    return [
      [l.a, c],
      [l.b, l.cost - c],
    ];
  }

  /** Low-level nodes from `node` to the fork at one end of its road (inclusive both ends). */
  private stub(node: number, fork: number, cost: number): number[] {
    if (this.isFork[node]) return [node];
    const l = this.links[this.linkOf[node]!]!;
    const i = this.indexOf[node]!;
    const viaA = l.costTo[i]!;
    // When both ends are the same fork (a loop), the cost tells us which way round.
    const towardA = l.a === fork && (l.b !== fork || Math.abs(viaA - cost) <= Math.abs(l.cost - viaA - cost));
    return towardA ? l.chain.slice(0, i + 1).reverse() : l.chain.slice(i);
  }

  /** Route between two low-level nodes by searching the coarse graph, then expanding. */
  route(from: number, to: number, trace = false): Route {
    const { graph } = this;
    if (from === to) return { found: true, nodes: [from], cost: 0, expanded: 0, trace: [] };

    const starts = this.attach(from);
    const goals = this.attach(to);
    const t = graph.nodes[to]!;
    const r = astar(this.space(), starts, goals, t.x, t.y, trace);

    // Both ends on the same stretch of road: driving straight along it may beat any detour.
    let direct: { nodes: number[]; cost: number } | null = null;
    if (!this.isFork[from] && !this.isFork[to] && this.linkOf[from] === this.linkOf[to]) {
      const l = this.links[this.linkOf[from]!]!;
      const i = this.indexOf[from]!;
      const j = this.indexOf[to]!;
      const nodes = i < j ? l.chain.slice(i, j + 1) : l.chain.slice(j, i + 1).reverse();
      direct = { nodes, cost: Math.abs(l.costTo[i]! - l.costTo[j]!) };
    }
    if (direct && (!r.found || direct.cost <= r.cost)) {
      return { found: true, nodes: direct.nodes, cost: direct.cost, expanded: r.expanded, trace: r.trace };
    }
    if (!r.found) return { found: false, nodes: [], cost: Infinity, expanded: r.expanded, trace: r.trace };

    // Expand: start stub, then each coarse link's chain, then target stub.
    const first = r.path[0]!;
    const last = r.path[r.path.length - 1]!;
    const startCost = Math.min(...starts.filter(([f]) => f === first).map(([, c]) => c));
    const goalCost = Math.min(...goals.filter(([f]) => f === last).map(([, c]) => c));
    const nodes = this.stub(from, first, startCost);
    let at = first;
    for (const id of r.edges) {
      const l = this.links[id]!;
      const forward = l.a === at;
      const chain = forward ? l.chain : [...l.chain].reverse();
      for (let k = 1; k < chain.length; k++) nodes.push(chain[k]!);
      at = forward ? l.b : l.a;
    }
    const tail = this.stub(to, last, goalCost).reverse();
    for (let k = 1; k < tail.length; k++) nodes.push(tail[k]!);
    return { found: true, nodes, cost: r.cost, expanded: r.expanded, trace: r.trace };
  }
}
