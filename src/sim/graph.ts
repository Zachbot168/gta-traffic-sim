/**
 * The low-level road graph: closely spaced nodes joined by links.
 * Nodes are points on a road, links are the stretches of road between them.
 * Links are two-way; a vehicle on a link carries its own direction.
 */

export type RoadClass = 'street' | 'arterial' | 'highway' | 'ramp';

export interface RoadSpec {
  /** Speed limit in metres per second. */
  speed: number;
  /** Lanes per direction. */
  lanes: number;
  /** Target spacing between vehicles per direction, in metres. Smaller means busier. */
  spacing: number;
  /** Drawn width in metres. */
  width: number;
}

export const ROAD_SPECS: Record<RoadClass, RoadSpec> = {
  street: { speed: 11, lanes: 1, spacing: 85, width: 8 },
  arterial: { speed: 17, lanes: 2, spacing: 48, width: 13 },
  highway: { speed: 30, lanes: 3, spacing: 24, width: 17 },
  ramp: { speed: 14, lanes: 1, spacing: 60, width: 7 },
};

export const MAX_SPEED = 30;

export interface RoadNode {
  id: number;
  x: number;
  y: number;
  /** 0 is ground level, 1 is elevated (the highway deck). */
  level: number;
  /** True for nodes on the edge of the world where traffic enters and leaves. */
  edge: boolean;
}

export interface RoadLink {
  id: number;
  a: number;
  b: number;
  cls: RoadClass;
  /** Length in metres. */
  length: number;
  /** Travel time at the speed limit, in seconds. This is the routing cost. */
  cost: number;
  level: number;
  bridge: boolean;
}

export class RoadGraph {
  readonly nodes: RoadNode[] = [];
  readonly links: RoadLink[] = [];
  /** For each node, the ids of the links touching it. */
  readonly adj: number[][] = [];

  addNode(x: number, y: number, level = 0, edge = false): number {
    const id = this.nodes.length;
    this.nodes.push({ id, x, y, level, edge });
    this.adj.push([]);
    return id;
  }

  addLink(a: number, b: number, cls: RoadClass, opts: { bridge?: boolean } = {}): number {
    const na = this.nodes[a]!;
    const nb = this.nodes[b]!;
    const length = Math.hypot(nb.x - na.x, nb.y - na.y);
    const id = this.links.length;
    this.links.push({
      id,
      a,
      b,
      cls,
      length,
      cost: length / ROAD_SPECS[cls].speed,
      level: Math.max(na.level, nb.level),
      bridge: opts.bridge ?? false,
    });
    this.adj[a]!.push(id);
    this.adj[b]!.push(id);
    return id;
  }

  degree(node: number): number {
    return this.adj[node]!.length;
  }

  /** The node at the far end of a link from the given node. */
  other(link: number, node: number): number {
    const l = this.links[link]!;
    return l.a === node ? l.b : l.a;
  }

  linkBetween(a: number, b: number): number {
    for (const id of this.adj[a]!) {
      if (this.other(id, a) === b) return id;
    }
    return -1;
  }

  bounds(): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of this.nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    return { minX, minY, maxX, maxY };
  }

  /** Nearest node to a point. Linear scan; fine for setup and UI, not for the sim loop. */
  nearestNode(x: number, y: number, level?: number): number {
    let best = -1;
    let bestD = Infinity;
    for (const n of this.nodes) {
      if (level !== undefined && n.level !== level) continue;
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }
}
