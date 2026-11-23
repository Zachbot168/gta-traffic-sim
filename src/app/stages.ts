/**
 * Stage presets: one per shot in the video. Each one builds a fresh, seeded world
 * and says how to frame it, so any shot can be recalled and replays identically.
 * No DOM in here; the headless frame renderer uses the same presets.
 */
import { Chase, COP_LABELS, COP_STRATEGIES, FLEE_LABELS, FLEE_STRATEGIES, KNOWLEDGE_LABELS, type ChaseConfig } from '../sim/chase';
import { generateCity, type CityMap, type Scale } from '../sim/mapgen';
import { CAR_SPECS, evalCurve, PERFORMANCE } from '../sim/perf';
import { Rng } from '../sim/rng';
import { routeFull } from '../sim/route';
import { World, type WorldConfig } from '../sim/world';
export { COP_STRATEGIES, FLEE_STRATEGIES };
import { SERIES_COLORS, type ChartSpec } from '../render/charts';
import type { Overlays, RouteDemo } from '../render/render';
import chaseResults from './chase-results.json';
import routingBench from './routing-bench.json';

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
  chase: Chase | null;
  /** Result panels drawn over the city. */
  charts: ChartSpec[] | null;
}

export interface Stage {
  key: string;
  chapter: string;
  title: string;
  caption: string;
  scale: Scale;
  build(map: CityMap): Omit<Scene, 'stage' | 'map' | 'chase' | 'charts'> & { chase?: Chase; charts?: ChartSpec[] };
}

export const none: Overlays = { graph: false, coarse: false, bubble: false, spawns: false };

export function world(map: CityMap, config: Partial<WorldConfig> = {}, seed = WORLD_SEED): World {
  return new World(map, seed, config);
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

export const cityBubble = (spawn: 'radial' | 'path', pinned: boolean, framing: (map: CityMap) => Framing, show: Partial<Overlays>, extra: Partial<WorldConfig> = {}, seed = WORLD_SEED) => (map: CityMap) => {
  // Ambient traffic: most cars wander, some are on a planned trip.
  // Scenes parked over the highway ramps run a little lighter so the ramps keep flowing.
  const w = world(map, { spawn, routing: 'coarse', tripShare: 0.3, density: pinned ? 1.1 : 1.5, ...extra }, seed);
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
    key: '3d',
    chapter: '3. The coarse graph',
    title: 'The saving, measured',
    caption: 'About 8.6 times less work at every city size. The gap is set by how many nodes sit between forks, not by how big the map is.',
    scale: 'district',
    build: (map) => {
      const w = world(map, { routing: 'coarse' });
      w.populate(200);
      return { world: w, overlays: { ...none, coarse: true }, framing: { kind: 'fit' }, demo: null, demoRate: 0, charts: benchChart() };
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
  {
    key: '5a',
    chapter: '5. Every driver is different',
    title: 'Take each car to a test track',
    caption: 'Dots are measurements from a physics model. Lines are the three-number curve that replaces it. Traffic only ever uses the curve.',
    scale: 'district',
    build: (map) => {
      const w = world(map);
      w.populate(120);
      return { world: w, overlays: none, framing: { kind: 'fit' }, demo: null, demoRate: 0, charts: curveCharts() };
    },
  },
  {
    key: '5b',
    chapter: '5. Every driver is different',
    title: 'A dry day',
    caption: 'Sports cars pull away, trucks lumber. Watch the average speed.',
    scale: 'city',
    build: cityBubble('path', false, () => ({ kind: 'follow', zoom: 2.2 }), {}),
  },
  {
    key: '5c',
    chapter: '5. Every driver is different',
    title: 'Then it rains',
    caption: 'Same city, same seed, wet-road curves. Everyone brakes earlier, corners slower, and leaves more room.',
    scale: 'city',
    build: cityBubble('path', false, () => ({ kind: 'follow', zoom: 2.2 }), {}, { weather: 'rain' }),
  },
  {
    key: '6a',
    chapter: '6. Five stars',
    title: 'One star',
    caption: 'Each officer sees a cone, blocked by buildings. Stay out of every cone until the timer runs out.',
    scale: 'city',
    build: cityChase({ stars: 1, flee: 'weave', cops: 'chase' }, 1.9),
  },
  {
    key: '6b',
    chapter: '6. Five stars',
    title: 'Three stars',
    caption: 'More units, they shoot, and half of them try to cut you off. The yellow ring is where they are searching.',
    scale: 'city',
    build: cityChase({ stars: 3, flee: 'run', cops: 'intercept' }, 1.6),
  },
  {
    key: '6c',
    chapter: '6. Five stars',
    title: 'Five stars',
    caption: 'Nine units, roadblocks ahead, and a helicopter that sees over buildings.',
    scale: 'city',
    build: cityChase({ stars: 5, flee: 'highway', cops: 'roadblock' }, 1.3),
  },
  {
    key: '6d',
    chapter: '6. Five stars',
    title: 'Drive it yourself',
    caption: 'Arrow keys: left and right pick your turn at the next junction, down brakes. On a phone use the Left, Straight and Right buttons.',
    scale: 'city',
    build: cityChase({ stars: 2, flee: 'manual', cops: 'intercept' }, 1.9),
  },
  {
    key: '6e',
    chapter: '6. Five stars',
    title: 'The experiment',
    caption: `${chaseResults.searchChases.toLocaleString('en-US')} simulated chases, every strategy run from the same starting points.`,
    scale: 'city',
    build: (map) => {
      const w = world(map);
      return { world: w, overlays: none, framing: { kind: 'fit' }, demo: null, demoRate: 0, charts: resultCharts() };
    },
  },
  {
    key: '6f',
    chapter: '6. Five stars',
    title: 'Psychic police',
    caption: 'A two-star chase where the car breaks line of sight and parks. Every unit knows where it parked anyway. Press J to make them search instead.',
    scale: 'city',
    build: cityChase({ stars: 2, flee: 'hide', cops: 'chase', knowledge: 'psychic' }, 1.7, 40),
  },
  {
    key: '6g',
    chapter: '6. Five stars',
    title: 'Does searching matter?',
    caption: 'Every chase run twice from the same start: once against police who must search, once against police who always know.',
    scale: 'city',
    build: (map) => {
      const w = world(map);
      return { world: w, overlays: none, framing: { kind: 'fit' }, demo: null, demoRate: 0, charts: knowledgeCharts() };
    },
  },
];

/** A chase in the city. A different seed gives different traffic, and so a different chase. */
export function cityChase(config: Partial<ChaseConfig>, zoom: number, seed = WORLD_SEED) {
  return (map: CityMap) => {
    const scene = cityBubble('path', false, () => ({ kind: 'follow', zoom }), {}, { density: 1.2 }, seed)(map);
    // Let traffic settle, then the crime is witnessed.
    for (let i = 0; i < 90; i++) scene.world.step(1 / 30);
    return { ...scene, chase: new Chase(scene.world, config) };
  };
}

const pct = (v: number) => `${v}%`;

function curveCharts(): ChartSpec[] {
  const cars = [0, 1, 3];
  const launch: ChartSpec = {
    title: 'Full throttle from a standstill',
    subtitle: 'Dry road. Speed reached after t seconds.',
    xLabel: 'Seconds',
    yLabel: 'Speed (m/s)',
    xRange: [0, 40],
    yRange: [0, 80],
    xTicks: [0, 10, 20, 30, 40],
    yTicks: [0, 20, 40, 60, 80],
    series: cars.map((type, i) => {
      const p = PERFORMANCE[type]!.dry;
      const line: [number, number][] = [];
      for (let t = 0; t <= 40; t += 1) line.push([t, Math.max(0, evalCurve(p.launch, t))]);
      return {
        label: CAR_SPECS[type]!.name,
        color: SERIES_COLORS[i]!,
        line,
        dots: p.launchSamples.filter((_, k) => k % 4 === 0).map((s) => [s.x, s.y] as [number, number]),
      };
    }),
  };
  const sedan = PERFORMANCE[0]!;
  const corner = (weather: 'dry' | 'rain', dashed: boolean) => {
    const p = sedan[weather];
    const line: [number, number][] = [];
    for (let r = 5; r <= 150; r += 5) line.push([r, evalCurve(p.corner, r)]);
    return { label: `sedan, ${weather}`, color: SERIES_COLORS[0]!, line, dashed, dots: p.cornerSamples.map((s) => [s.x, s.y] as [number, number]) };
  };
  const cornering: ChartSpec = {
    title: 'Fastest speed through a corner',
    subtitle: 'Same car, dry road against wet road.',
    xLabel: 'Corner radius (m)',
    yLabel: 'Speed (m/s)',
    xRange: [0, 150],
    yRange: [0, 40],
    xTicks: [0, 50, 100, 150],
    yTicks: [0, 10, 20, 30, 40],
    series: [corner('dry', false), corner('rain', true)],
  };
  return [launch, cornering];
}

export function resultCharts(): ChartSpec[] {
  const base = {
    xLabel: 'Wanted level (stars)',
    yLabel: 'Chases escaped',
    xRange: [0.7, 5.3] as [number, number],
    yRange: [0, 100] as [number, number],
    xTicks: [1, 2, 3, 4, 5],
    yTicks: [0, 25, 50, 75, 100],
    yFormat: pct,
  };
  const points = (rates: number[]): [number, number][] => rates.map((r, i) => [i + 1, r]);
  const flee = chaseResults.escapeRateByFlee as Record<string, number[]>;
  const cops = chaseResults.escapeRateByCops as Record<string, number[]>;
  return [
    {
      ...base,
      title: 'Which escape strategy works?',
      subtitle: `${chaseResults.samplesPerPoint.byFlee} chases per point.`,
      series: FLEE_STRATEGIES.map((f, i) => ({ label: FLEE_LABELS[f], color: SERIES_COLORS[i]!, line: points(flee[f]!) })),
    },
    {
      ...base,
      title: 'Which police tactic works?',
      subtitle: `${chaseResults.samplesPerPoint.byCops} chases per point. Lower is better for the police.`,
      series: COP_STRATEGIES.map((c, i) => ({ label: COP_LABELS[c], color: SERIES_COLORS[i]!, line: points(cops[c]!) })),
    },
  ];
}

export function knowledgeCharts(): ChartSpec[] {
  const base = {
    xLabel: 'Wanted level (stars)',
    yLabel: 'Chases escaped',
    xRange: [0.7, 5.3] as [number, number],
    yRange: [0, 100] as [number, number],
    xTicks: [1, 2, 3, 4, 5],
    yTicks: [0, 25, 50, 75, 100],
    yFormat: pct,
  };
  const points = (rates: number[]): [number, number][] => rates.map((r, i) => [i + 1, r]);
  const psychic = chaseResults.psychic;
  const flee = psychic.escapeRateByFlee as Record<string, number[]>;
  return [
    {
      ...base,
      title: 'Searching police against psychic police',
      subtitle: 'All escape strategies pooled. Same starting points for both.',
      series: [
        { label: KNOWLEDGE_LABELS.search, color: SERIES_COLORS[0]!, line: points(chaseResults.escapeRate) },
        { label: KNOWLEDGE_LABELS.psychic, color: SERIES_COLORS[1]!, line: points(psychic.escapeRate) },
      ],
    },
    {
      ...base,
      title: 'Escape strategies against psychic police',
      subtitle: `${psychic.samplesPerPoint.byFlee} chases per point.`,
      series: FLEE_STRATEGIES.map((f, i) => ({ label: FLEE_LABELS[f], color: SERIES_COLORS[i]!, line: points(flee[f]!) })),
    },
  ];
}

/** Chapter 3 payoff chart: search work on each graph as the city grows. */
export function benchChart(): ChartSpec[] {
  const max = routingBench[routingBench.length - 1]!;
  return [
    {
      title: 'Work per trip as the city grows',
      subtitle: 'Average road nodes searched, 400 random trips per city size.',
      xLabel: 'Intersections in the city',
      yLabel: 'Nodes searched',
      xRange: [0, max.intersections],
      yRange: [0, 8000],
      xTicks: [0, 1000, 2000, 3000, 4000],
      yTicks: [0, 2000, 4000, 6000, 8000],
      xFormat: (v) => v.toLocaleString('en-US'),
      yFormat: (v) => v.toLocaleString('en-US'),
      series: [
        { label: 'Full graph', color: SERIES_COLORS[0]!, line: routingBench.map((r) => [r.intersections, r.searchedFull]) },
        { label: 'Coarse graph', color: SERIES_COLORS[1]!, line: routingBench.map((r) => [r.intersections, r.searchedCoarse]) },
      ],
    },
  ];
}

const mapCache = new Map<Scale, CityMap>();

export function buildScene(stage: Stage): Scene {
  let map = mapCache.get(stage.scale);
  if (!map) {
    map = generateCity(stage.scale, MAP_SEED);
    mapCache.set(stage.scale, map);
  }
  return { chase: null, charts: null, stage, map, ...stage.build(map) };
}
