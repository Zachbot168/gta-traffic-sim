/**
 * Procedural city generator. One seed and one scale preset give one city, every time.
 *
 * The layout is a jittered street grid with:
 *  - arterials every few blocks (faster, busier)
 *  - some side streets removed so it isn't a perfect grid
 *  - a river crossed only by arterial bridges (chokepoints)
 *  - an elevated highway that passes over the streets without touching them,
 *    joined to the grid by ramps (this gives us overpasses and a parallel road)
 */
import { RoadGraph, type RoadClass } from './graph';
import { Rng } from './rng';

export type Scale = 'block' | 'district' | 'city';

export interface MapParams {
  seed: number;
  cols: number;
  rows: number;
  /** Distance between intersections, metres. */
  block: number;
  /** Distance between low-level nodes along a road, metres. */
  seg: number;
  /** Chance that a side-street block is missing. */
  removal: number;
  river: boolean;
  highway: boolean;
}

export const SCALE_PRESETS: Record<Scale, Omit<MapParams, 'seed'>> = {
  block: { cols: 3, rows: 3, block: 100, seg: 20, removal: 0, river: false, highway: false },
  district: { cols: 11, rows: 9, block: 100, seg: 20, removal: 0.1, river: false, highway: true },
  city: { cols: 38, rows: 27, block: 100, seg: 20, removal: 0.12, river: true, highway: true },
};

export interface CityMap {
  graph: RoadGraph;
  params: MapParams;
  /** Intersection node ids, indexed [col][row]. */
  grid: number[][];
  river: { x0: number; x1: number; y0: number; y1: number } | null;
  highwayY: number | null;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const RIVER_GAP = 90;

export function generateCity(scale: Scale, seed: number): CityMap {
  return generateCityFromParams({ ...SCALE_PRESETS[scale], seed });
}

export function generateCityFromParams(params: MapParams): CityMap {
  const { cols, rows, block, seg } = params;
  const rng = new Rng(params.seed);
  const graph = new RoadGraph();

  const big = cols >= 6 && rows >= 6;
  const isArterialCol = (c: number) => big && c % 4 === 2;
  const isArterialRow = (r: number) => big && r % 4 === 2;
  const riverCol = params.river ? Math.floor(cols * 0.6) : -1;
  // The highway sits between two ordinary street rows, so its ramps never land on an arterial crossing.
  let highwayRow = -1;
  if (params.highway) {
    highwayRow = Math.floor(rows * 0.4);
    while (isArterialRow(highwayRow) || isArterialRow(highwayRow + 1)) highwayRow++;
  }

  const colX = (c: number) => c * block + (riverCol >= 0 && c > riverCol ? RIVER_GAP : 0);

  // Intersections, nudged off the perfect grid. The jitter also makes route costs
  // unique, so the shortest path between two points is unambiguous.
  const grid: number[][] = [];
  for (let c = 0; c < cols; c++) {
    grid.push([]);
    for (let r = 0; r < rows; r++) {
      const j = block * 0.07;
      grid[c]!.push(graph.addNode(colX(c) + rng.range(-j, j), r * block + rng.range(-j, j)));
    }
  }

  // Candidate grid edges between neighbouring intersections.
  interface GridEdge {
    a: number;
    b: number;
    cls: RoadClass;
    bridge: boolean;
    removable: boolean;
  }
  const edges: GridEdge[] = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (c + 1 < cols) {
        const crossesRiver = c === riverCol;
        const arterial = isArterialRow(r);
        if (!crossesRiver || arterial) {
          edges.push({
            a: grid[c]![r]!,
            b: grid[c + 1]![r]!,
            cls: arterial ? 'arterial' : 'street',
            bridge: crossesRiver,
            removable: !arterial && r > 0 && r < rows - 1,
          });
        }
      }
      if (r + 1 < rows) {
        const arterial = isArterialCol(c);
        edges.push({
          a: grid[c]![r]!,
          b: grid[c]![r + 1]!,
          cls: arterial ? 'arterial' : 'street',
          bridge: false,
          removable: !arterial && c > 0 && c < cols - 1,
        });
      }
    }
  }

  // Knock out some side streets, but never disconnect the city.
  const alive = edges.map(() => true);
  if (params.removal > 0) {
    const order = edges.map((_, i) => i).filter((i) => edges[i]!.removable);
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const target = Math.floor(order.length * params.removal);
    let removed = 0;
    for (const idx of order) {
      if (removed >= target) break;
      alive[idx] = false;
      if (isConnected(cols * rows, edges, alive)) removed++;
      else alive[idx] = true;
    }
  }

  // Lay each surviving edge as a chain of short links.
  const chain = (a: number, b: number, cls: RoadClass, bridge: boolean) => {
    const na = graph.nodes[a]!;
    const nb = graph.nodes[b]!;
    const n = Math.max(1, Math.round(Math.hypot(nb.x - na.x, nb.y - na.y) / seg));
    let prev = a;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const mid = graph.addNode(na.x + (nb.x - na.x) * t, na.y + (nb.y - na.y) * t);
      graph.addLink(prev, mid, cls, { bridge });
      prev = mid;
    }
    graph.addLink(prev, b, cls, { bridge });
  };
  edges.forEach((e, i) => {
    if (alive[i]) chain(e.a, e.b, e.cls, e.bridge);
  });

  // Elevated highway, running between two street rows and over every cross street.
  let highwayY: number | null = null;
  if (highwayRow >= 0 && highwayRow + 1 < rows) {
    highwayY = (highwayRow + 0.5) * block;
    const x0 = colX(0) - block * 0.8;
    const x1 = colX(cols - 1) + block * 0.8;
    const n = Math.round((x1 - x0) / seg);
    const deck: number[] = [];
    for (let i = 0; i <= n; i++) {
      deck.push(graph.addNode(x0 + ((x1 - x0) * i) / n, highwayY, 1, i === 0 || i === n));
      if (i > 0) graph.addLink(deck[i - 1]!, deck[i]!, 'highway');
    }
    const deckAt = (x: number) => deck[Math.max(1, Math.min(n - 1, Math.round(((x - x0) / (x1 - x0)) * n)))]!;

    // Ramps down to the grid at every arterial column, one to each side.
    for (let c = 0; c < cols; c++) {
      if (!isArterialCol(c)) continue;
      const x = colX(c);
      for (const side of [-1, 1]) {
        const target = grid[c]![side < 0 ? highwayRow : highwayRow + 1]!;
        const top = deckAt(x + side * -block * 0.45);
        const mid = graph.addNode(x + side * -block * 0.2, highwayY + side * block * 0.27, 0);
        graph.addLink(top, mid, 'ramp');
        graph.addLink(mid, target, 'ramp');
      }
    }
  }

  const bounds = graph.bounds();
  const river =
    riverCol >= 0
      ? { x0: colX(riverCol) + block * 0.32, x1: colX(riverCol + 1) - block * 0.32, y0: bounds.minY - 400, y1: bounds.maxY + 400 }
      : null;

  return { graph, params, grid, river, highwayY, bounds };
}

function isConnected(nodeCount: number, edges: { a: number; b: number }[], alive: boolean[]): boolean {
  const adj: number[][] = Array.from({ length: nodeCount }, () => []);
  edges.forEach((e, i) => {
    if (!alive[i]) return;
    adj[e.a]!.push(e.b);
    adj[e.b]!.push(e.a);
  });
  const seen = new Uint8Array(nodeCount);
  const stack = [0];
  seen[0] = 1;
  let count = 1;
  while (stack.length) {
    const n = stack.pop()!;
    for (const m of adj[n]!) {
      if (!seen[m]) {
        seen[m] = 1;
        count++;
        stack.push(m);
      }
    }
  }
  return count === nodeCount;
}
