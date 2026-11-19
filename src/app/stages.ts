/**
 * Stage presets: one per shot in the video. Each one builds a fresh, seeded world
 * and says how to frame it, so any shot can be recalled and replays identically.
 * No DOM in here; the headless frame renderer uses the same presets.
 */
import { generateCity, type CityMap, type Scale } from '../sim/mapgen';
import { Rng } from '../sim/rng';
import { routeFull } from '../sim/route';
import { World, type WorldConfig } from '../sim/world';
import type { Overlays, RouteDemo } from '../render/render';

export const MAP_SEED = 1;
export const WORLD_SEED = 42;

export type Framing =
  | { kind: 'fit' }
  | { kind: 'follow'; zoom: number }
  | { kind: 'at'; x: number; y: number; zoom: number };

export interface Scene {
  stage: Stage;
  map: CityMap;
  world: World;
  overlays: Overlays;
  framing: Framing;
  demo: RouteDemo | null;
  /** Nodes revealed per second while a route search replays. */
  demoRate: number;
}

export interface Stage {
  key: string;
  chapter: string;
  title: string;
  caption: string;
  scale: Scale;
  build(map: CityMap): Omit<Scene, 'stage' | 'map'>;
}

const none: Overlays = { graph: false, coarse: false, bubble: false, spawns: false };

function world(map: CityMap, config: Partial<WorldConfig> = {}): World {
  return new World(map, WORLD_SEED, config);
}

/** A route search between two far-apart points, ready to replay. */
export function makeDemo(w: World, show: RouteDemo['show'], pick?: Rng): RouteDemo {
  const g = w.graph;
  const b = w.map.bounds;
  let from: number;
  let to: number;
  if (pick) {
    from = pick.int(g.nodes.length);
    to = pick.int(g.nodes.length);
  } else {
    const padX = (b.maxX - b.minX) * 0.08;
    const padY = (b.maxY - b.minY) * 0.12;
    from = g.nearestNode(b.minX + padX, b.maxY - padY, 0);
    to = g.nearestNode(b.maxX - padX, b.minY + padY, 0);
  }
  return {
    from,
    to,
    full: routeFull(g, from, to, true),
    coarse: w.coarse.route(from, to, true),
    show,
    revealed: 0,
  };
}

const cityBubble = (spawn: 'radial' | 'path', pinned: boolean, framing: (map: CityMap) => Framing, show: Partial<Overlays>) => (map: CityMap) => {
  // Ambient traffic: most cars wander, some are on a planned trip.
  // Scenes parked over the highway ramps run a little lighter so the ramps keep flowing.
  const w = world(map, { spawn, routing: 'coarse', tripShare: 0.3, density: pinned ? 1.1 : 1.5 });
  const hy = map.highwayY ?? 0;
  const cx = (map.bounds.minX + map.bounds.maxX) * 0.42;
  if (pinned) w.pinFocus(cx, hy);
  else w.addHero(cx, hy - 250);
  w.fillBubble();
  return { world: w, overlays: { ...none, ...show }, framing: framing(map), demo: null, demoRate: 0 };
};

export const STAGES: Stage[] = [
  {
    key: '1a',
    chapter: '1. A city is a graph',
    title: 'One block, one car',
    caption: 'Roads are dots joined by lines. A car just moves from dot to dot, picking a random exit at each fork.',
    scale: 'block',
    build: (map) => {
      const w = world(map);
      w.populate(1);
      return { world: w, overlays: { ...none, graph: true }, framing: { kind: 'fit' }, demo: null, demoRate: 0 };
    },
  },
  {
    key: '1b',
    chapter: '1. A city is a graph',
    title: 'Ten cars',
    caption: 'Same rule, more cars. They follow each other and take turns at junctions.',
    scale: 'block',
    build: (map) => {
      const w = world(map);
      w.populate(10);
      return { world: w, overlays: { ...none, graph: true }, framing: { kind: 'fit' }, demo: null, demoRate: 0 };
    },
  },
  {
    key: '1c',
    chapter: '1. A city is a graph',
    title: 'A district of wanderers',
    caption: '250 cars, none of them going anywhere in particular.',
    scale: 'district',
    build: (map) => {
      const w = world(map);
      w.populate(250);
      return { world: w, overlays: none, framing: { kind: 'fit' }, demo: null, demoRate: 0 };
    },
  },
  {
    key: '2a',
    chapter: '2. Giving cars a destination',
    title: 'Finding a route',
    caption: 'A* search spreads out from A, one node at a time, until it reaches B.',
    scale: 'district',
    build: (map) => {
      const w = world(map);
      return { world: w, overlays: { ...none, graph: true }, framing: { kind: 'fit' }, demo: makeDemo(w, 'full'), demoRate: 90 };
    },
  },
  {
    key: '2b',
    chapter: '2. Giving cars a destination',
    title: 'The same search across a whole city',
    caption: 'On a real map the search touches thousands of nodes for a single trip.',
    scale: 'city',
    build: (map) => {
      const w = world(map);
      return { world: w, overlays: none, framing: { kind: 'fit' }, demo: makeDemo(w, 'full'), demoRate: 900 };
    },
  },
  {
    key: '2c',
    chapter: '2. Giving cars a destination',
    title: 'Every car with somewhere to be',
    caption: '1,500 cars, each planning its own trip on the full graph.',
    scale: 'city',
    build: (map) => {
      const w = world(map, { routing: 'full' });
      w.populate(1500);
      return { world: w, overlays: none, framing: { kind: 'fit' }, demo: null, demoRate: 0 };
    },
  },
  {
    key: '3a',
    chapter: '3. The coarse graph',
    title: 'Only the forks matter',
    caption: 'Keep the nodes where a driver makes a choice. Collapse every plain stretch of road into one link.',
    scale: 'district',
    build: (map) => {
      const w = world(map);
      return { world: w, overlays: { ...none, graph: true, coarse: true }, framing: { kind: 'fit' }, demo: null, demoRate: 0 };
    },
  },
  {
    key: '3b',
    chapter: '3. The coarse graph',
    title: 'Same route, a fraction of the work',
    caption: 'Blue is the full search. Orange is the coarse search. Both end with the identical route.',
    scale: 'city',
    build: (map) => {
      const w = world(map);
      return { world: w, overlays: none, framing: { kind: 'fit' }, demo: makeDemo(w, 'both'), demoRate: 900 };
    },
  },
  {
    key: '3c',
    chapter: '3. The coarse graph',
    title: 'The whole city on the coarse graph',
    caption: 'The same 1,500 trips, planned on the small graph.',
    scale: 'city',
    build: (map) => {
      const w = world(map, { routing: 'coarse' });
      w.populate(1500);
      return { world: w, overlays: none, framing: { kind: 'fit' }, demo: null, demoRate: 0 };
    },
  },
  {
    key: '4a',
    chapter: '4. The city is fake',
    title: 'A busy city',
    caption: 'Follow one car through traffic. It feels like the whole city is alive.',
    scale: 'city',
    build: cityBubble('path', false, () => ({ kind: 'follow', zoom: 2.2 }), {}),
  },
  {
    key: '4b',
    chapter: '4. The city is fake',
    title: 'The reveal',
    caption: 'Zoom out. Traffic only exists in a bubble around the player. Cars appear in the ring and vanish outside it.',
    scale: 'city',
    build: cityBubble('path', false, () => ({ kind: 'fit' }), { bubble: true }),
  },
  {
    key: '4c',
    chapter: '4. The city is fake',
    title: 'The overpass bug',
    caption: 'Counting cars by straight-line radius. Red dots: "this road is full". Highway traffic overhead makes the streets beside it look full, so nothing spawns there.',
    scale: 'city',
    build: cityBubble('radial', true, (map) => ({ kind: 'at', x: (map.bounds.minX + map.bounds.maxX) * 0.42, y: map.highwayY ?? 0, zoom: 1.15 }), { spawns: true }),
  },
  {
    key: '4d',
    chapter: '4. The city is fake',
    title: 'The fix: measure along the road',
    caption: 'Count only cars you could actually drive to. Green dots: a car was added. The streets by the highway spawn traffic again.',
    scale: 'city',
    build: cityBubble('path', true, (map) => ({ kind: 'at', x: (map.bounds.minX + map.bounds.maxX) * 0.42, y: map.highwayY ?? 0, zoom: 1.15 }), { spawns: true }),
  },
];

const mapCache = new Map<Scale, CityMap>();

export function buildScene(stage: Stage): Scene {
  let map = mapCache.get(stage.scale);
  if (!map) {
    map = generateCity(stage.scale, MAP_SEED);
    mapCache.set(stage.scale, map);
  }
  return { stage, map, ...stage.build(map) };
}
