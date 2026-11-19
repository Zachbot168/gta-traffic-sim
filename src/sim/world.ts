/**
 * The simulated world: a city, its vehicles, and the systems that move and spawn them.
 * Nothing in here touches the screen or the clock. Given the same seed and the same
 * sequence of step() calls, it always produces the same result.
 */
import { CoarseGraph } from './coarse';
import { ROAD_SPECS, type RoadGraph } from './graph';
import type { CityMap } from './mapgen';
import { Rng } from './rng';
import { routeFull, type Route } from './route';

/** How civilian cars decide where to go. */
export type RoutingMode = 'wander' | 'full' | 'coarse';
/** How the spawner measures how busy a stretch of road already is. */
export type SpawnMode = 'off' | 'radial' | 'path';

export interface VehicleType {
  name: string;
  length: number;
  width: number;
  /** Peak acceleration, m/s^2. */
  accel: number;
  /** Multiplier on the speed limit this kind of vehicle cruises at. */
  pace: number;
  /** Relative share of traffic. */
  share: number;
}

export const VEHICLE_TYPES: VehicleType[] = [
  { name: 'sedan', length: 4.6, width: 1.9, accel: 2.2, pace: 1.0, share: 6 },
  { name: 'sports', length: 4.3, width: 1.9, accel: 3.4, pace: 1.15, share: 1 },
  { name: 'van', length: 5.4, width: 2.1, accel: 1.7, pace: 0.93, share: 2 },
  { name: 'truck', length: 8.5, width: 2.5, accel: 1.1, pace: 0.85, share: 1 },
];

export interface Vehicle {
  id: number;
  type: number;
  kind: 'civ' | 'hero';
  /** Colour slot, picked once so a car keeps its paint. */
  paint: number;
  /** Personal speed preference, around 1. */
  driver: number;
  /** Planners drive to a destination. The rest just wander, like ambient traffic. */
  planner: boolean;

  link: number;
  /** +1 travels a to b, -1 travels b to a. */
  dir: 1 | -1;
  /** Distance of the front bumper from the start of the link (in travel direction). */
  s: number;
  v: number;
  /** Node behind and node ahead. */
  from: number;
  to: number;
  /** Next link to take at `to`. -1 undecided, -2 leave the world there. */
  next: number;

  route: number[] | null;
  /** Index into route of the node ahead. */
  routeAt: number;
  /** Junction node this vehicle has been cleared through, or -1. */
  cleared: number;
  /** Seconds spent at a standstill. */
  stuck: number;

  x: number;
  y: number;
  heading: number;
  level: number;
  alive: boolean;
}

export interface WorldConfig {
  routing: RoutingMode;
  spawn: SpawnMode;
  /** Multiplier on every road's target traffic density. */
  density: number;
  /** Spawning only happens between these distances from the hero car, metres. */
  spawnInner: number;
  spawnOuter: number;
  /** Civilian cars further than this from the hero are deleted. */
  despawn: number;
  /** Most new routes computed per step, so a routing change doesn't freeze a frame. */
  routesPerStep: number;
  /** Share of cars that plan trips when routing is on. The rest wander. */
  tripShare: number;
}

export const DEFAULT_CONFIG: WorldConfig = {
  routing: 'wander',
  spawn: 'off',
  density: 1,
  spawnInner: 170,
  spawnOuter: 380,
  despawn: 440,
  routesPerStep: 6,
  tripShare: 1,
};

/**
 * A spawner decision worth drawing: either it added a car, or the straight-line
 * check refused a spot that the along-the-road check would have filled.
 */
export interface SpawnEvent {
  x: number;
  y: number;
  time: number;
  kind: 'spawned' | 'wronglyFull';
}

export interface WorldStats {
  routes: number;
  expandedTotal: number;
  lastExpanded: number;
  spawned: number;
  despawned: number;
}

const DT_MAX = 0.1;
const HEADWAY = 1.2;
const MIN_GAP = 2.5;
const COMFORT_BRAKE = 2.6;
/** Longest green while another approach is waiting. Bigger roads get longer. */
const MAX_GREEN: Record<string, number> = { highway: 14, arterial: 14, street: 6, ramp: 6 };
const GREEN_HOLD = 0.2;
/** Braking rate a driver is willing to use to stop for a junction they were refused at. */
const FIRM_BRAKE = 4.5;
const SPAWN_WINDOW = 80;
const SPAWN_LOG_SIZE = 900;
const SPAWN_TRIES = 14;
const STUCK_LIMIT = 25;
/** A side-road driver pulls out only if no main-road car will arrive within this many seconds. */
const GAP_TIME = 1.5;
const CLASS_RANK: Record<string, number> = { highway: 3, arterial: 2, street: 1, ramp: 0 };
const GRAVITY = 9.81;
const GRIP = 0.7;

export class World {
  readonly graph: RoadGraph;
  readonly coarse: CoarseGraph;
  readonly rng: Rng;
  readonly config: WorldConfig;
  readonly stats: WorldStats = { routes: 0, expandedTotal: 0, lastExpanded: 0, spawned: 0, despawned: 0 };

  time = 0;
  vehicles: Vehicle[] = [];
  hero: Vehicle | null = null;
  /**
   * Centre of the spawn bubble. Follows the hero car unless pinned to a spot,
   * which is how we hold the camera still over one piece of road.
   */
  focus: { x: number; y: number } | null = null;
  private pinned = false;

  private nextId = 1;
  /** Vehicles on each link in each direction, sorted by position. Index is link*2 + (dir>0 ? 1 : 0). */
  private lanes: Vehicle[][];
  private touched: number[] = [];

  // Junction right-of-way: which phase currently has the green at each node.
  // Roads that run straight through a junction share a phase, like a two-phase signal.
  private phaseAt: Int8Array;
  /** At a highway merge, the phase (the highway itself) that never has to stop. -1 at ordinary junctions. */
  private majorPhase: Int8Array;
  private green: Int32Array;
  private greenSince: Float64Array;
  private greenUsed: Float64Array;
  private greenWanted: Uint8Array;
  private greenWantedAt: Float64Array;
  private greenLast: Int32Array;
  private activeJunctions = new Set<number>();
  /**
   * Who is about to turn into each lane of each link. Stops two cars from
   * different approaches from merging into the same lane at the same moment.
   */
  private entryClaims = new Map<number, { by: Vehicle; source: number; node: number }>();

  // Spatial hash of vehicle positions, for radial density checks.
  private cell = 64;
  private buckets = new Map<number, Vehicle[]>();

  /** Recent spawner decisions, newest last. Purely for drawing; the sim never reads it. */
  readonly spawnLog: SpawnEvent[] = [];
  private ring: number[] = [];
  private ringAt = -1;
  /** How many cars the bubble should hold if every road met its target: [streets, highway]. */
  private bubbleTarget: [number, number] = [0, 0];
  private typeBag: number[] = [];
  private routesThisStep = 0;

  constructor(
    readonly map: CityMap,
    seed: number,
    config: Partial<WorldConfig> = {},
  ) {
    this.graph = map.graph;
    this.coarse = new CoarseGraph(this.graph);
    this.rng = new Rng(seed);
    this.config = { ...DEFAULT_CONFIG, ...config };
    const n = this.graph.nodes.length;
    this.lanes = Array.from({ length: this.graph.links.length * 2 }, () => []);
    this.majorPhase = new Int8Array(n).fill(-1);
    this.phaseAt = this.buildPhases();
    this.green = new Int32Array(n).fill(-1);
    this.greenSince = new Float64Array(n);
    this.greenUsed = new Float64Array(n);
    this.greenWanted = new Uint8Array(n);
    this.greenWantedAt = new Float64Array(n);
    this.greenLast = new Int32Array(n).fill(-1);
    VEHICLE_TYPES.forEach((t, i) => {
      for (let k = 0; k < t.share; k++) this.typeBag.push(i);
    });
  }

  // ---------------------------------------------------------------- setup

  /** Put a vehicle on a link. The caller checks the spot is free. */
  addVehicle(link: number, dir: 1 | -1, s: number, kind: Vehicle['kind'] = 'civ', speed = 0): Vehicle {
    const l = this.graph.links[link]!;
    const type = kind === 'hero' ? 1 : this.rng.pick(this.typeBag);
    const v: Vehicle = {
      id: this.nextId++,
      type,
      kind,
      paint: this.rng.int(8),
      driver: kind === 'hero' ? 1 : this.rng.range(0.88, 1.1),
      planner: kind === 'hero' || this.rng.chance(this.config.tripShare),
      link,
      dir,
      s,
      v: speed,
      from: dir > 0 ? l.a : l.b,
      to: dir > 0 ? l.b : l.a,
      next: -1,
      route: null,
      routeAt: 0,
      cleared: -1,
      stuck: 0,
      x: 0,
      y: 0,
      heading: 0,
      level: 0,
      alive: true,
    };
    this.place(v, true);
    this.vehicles.push(v);
    return v;
  }

  /** Scatter a fixed number of cars across the whole map (no spawning or despawning). */
  populate(count: number): void {
    const { graph, rng } = this;
    let guard = count * 30;
    while (count > 0 && guard-- > 0) {
      const link = rng.int(graph.links.length);
      const dir = rng.chance(0.5) ? 1 : -1;
      const l = graph.links[link]!;
      const s = rng.range(0, l.length);
      if (!this.isFree(link, dir, s, 9)) continue;
      this.addVehicle(link, dir, s, 'civ', ROAD_SPECS[l.cls].speed * 0.5);
      this.indexLanes();
      count--;
    }
  }

  /** Remove a number of civilian cars, newest first. */
  removeVehicles(count: number): void {
    for (let i = this.vehicles.length - 1; i >= 0 && count > 0; i--) {
      if (this.vehicles[i]!.kind !== 'civ') continue;
      this.vehicles[i]!.alive = false;
      count--;
    }
    this.vehicles = this.vehicles.filter((v) => v.alive);
  }

  /** Create the hero car that the camera and the spawn bubble follow. */
  addHero(nearX: number, nearY: number): Vehicle {
    const node = this.graph.nearestNode(nearX, nearY, 0);
    const link = this.graph.adj[node]![0]!;
    const l = this.graph.links[link]!;
    const hero = this.addVehicle(link, l.a === node ? 1 : -1, 1, 'hero');
    this.hero = hero;
    if (!this.pinned) this.focus = { x: hero.x, y: hero.y };
    return hero;
  }

  /** Hold the spawn bubble at a fixed point instead of following the hero. */
  pinFocus(x: number, y: number): void {
    this.focus = { x, y };
    this.pinned = true;
  }

  /** Fill the whole bubble at once, so a scene starts busy instead of filling up. */
  fillBubble(): void {
    if (!this.focus || this.config.spawn === 'off') return;
    this.indexLanes();
    this.indexBuckets();
    const all: number[] = [];
    const r = this.config.spawnOuter;
    for (const l of this.graph.links) {
      const [mx, my] = this.mid(l.id);
      if (Math.hypot(mx - this.focus.x, my - this.focus.y) < r) all.push(l.id);
    }
    for (let i = 0; i < all.length * 6; i++) this.trySpawn(this.rng.pick(all), 0.6);
  }

  // ---------------------------------------------------------------- stepping

  step(dt: number): void {
    dt = Math.min(dt, DT_MAX);
    this.time += dt;
    this.routesThisStep = 0;
    this.indexLanes();

    const accel = new Float64Array(this.vehicles.length);
    for (let i = 0; i < this.vehicles.length; i++) accel[i] = this.drive(this.vehicles[i]!);

    let died = false;
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i]!;
      v.v = Math.max(0, v.v + accel[i]! * dt);
      v.s += v.v * dt;
      v.stuck = v.v < 0.3 ? v.stuck + dt : 0;
      this.advance(v);
      if (v.alive) this.place(v, false, dt);
      else died = true;
    }

    this.releaseJunctions();
    if (this.hero && !this.pinned) this.focus = { x: this.hero.x, y: this.hero.y };
    const focus = this.focus;

    if (focus && this.config.spawn !== 'off') {
      const far = this.config.despawn;
      for (const v of this.vehicles) {
        if (v.kind !== 'civ' || !v.alive) continue;
        const d = Math.hypot(v.x - focus.x, v.y - focus.y);
        // Too far away, or hopelessly stuck somewhere out of view: remove it.
        // (Games quietly delete jammed ambient traffic for the same reason.)
        if (d > far || (v.stuck > STUCK_LIMIT && d > this.config.spawnInner)) {
          v.alive = false;
          this.stats.despawned++;
          died = true;
        }
      }
    }
    if (died) this.vehicles = this.vehicles.filter((v) => v.alive);

    if (focus && this.config.spawn !== 'off') {
      this.indexLanes();
      this.indexBuckets();
      this.refreshRing();
      // A safety net: never fill far past what the bubble should hold, so a jam can't snowball.
      // Streets and the highway are capped separately so one can't starve the other.
      const count: [number, number] = [0, 0];
      for (const v of this.vehicles) count[this.graph.links[v.link]!.cls === 'highway' ? 1 : 0]++;
      for (let i = 0; i < SPAWN_TRIES && this.ring.length > 0; i++) {
        const link = this.rng.pick(this.ring);
        const group = this.graph.links[link]!.cls === 'highway' ? 1 : 0;
        if (count[group] >= this.bubbleTarget[group] * 1.3) continue;
        if (this.trySpawn(link, 0.85)) count[group]++;
      }
    }
  }

  /** Work out this vehicle's acceleration for the step (intelligent driver model). */
  private drive(v: Vehicle): number {
    const { graph } = this;
    const link = graph.links[v.link]!;
    const type = VEHICLE_TYPES[v.type]!;
    if (v.next === -1) this.chooseNext(v);

    const toEnd = link.length - v.s;
    let gap = Infinity;
    let leadSpeed = 0;

    // Leader on the same stretch of road.
    const ahead = this.leaderOnLink(v);
    if (ahead) {
      gap = ahead.s - VEHICLE_TYPES[ahead.type]!.length - v.s;
      leadSpeed = ahead.v;
    }
    if (v.next >= 0 && v.next !== v.link) {
      // Also look down the road we are about to take, far enough to stop for whatever is there.
      // (The car ahead of us on this link may be going somewhere else.)
      const horizon = (v.v * v.v) / (2 * COMFORT_BRAKE) + 25;
      let link = v.next;
      let node = v.to;
      let dist = toEnd;
      let step = v.routeAt + 1;
      while (dist < horizon && dist < gap) {
        const dir = this.dirFrom(link, node);
        const lane = this.laneOn(v, link);
        let first: Vehicle | undefined;
        for (const o of this.lanes[this.laneKey(link, dir)]!) {
          if (o !== v && this.laneOn(o, link) === lane) {
            first = o;
            break;
          }
        }
        if (first) {
          const g = dist + first.s - VEHICLE_TYPES[first.type]!.length;
          if (g < gap) {
            gap = g;
            leadSpeed = first.v;
          }
          break;
        }
        dist += graph.links[link]!.length;
        node = graph.other(link, node);
        // Keep going along a plain road, or along our planned route. Stop at a fork we haven't chosen at yet.
        const around = graph.adj[node]!;
        if (around.length === 2) link = around[0] === link ? around[1]! : around[0]!;
        else if (v.route && v.route[step] === node && step + 1 < v.route.length) link = graph.linkBetween(node, v.route[step + 1]!);
        else break;
        step++;
      }
    } else if (v.next === v.link) {
      const first = this.firstOnNext(v);
      if (first) {
        const g = toEnd + first.s - VEHICLE_TYPES[first.type]!.length;
        if (g < gap) {
          gap = g;
          leadSpeed = first.v;
        }
      }
    }

    // Junctions: ask for right-of-way in time to stop if refused.
    if (graph.degree(v.to) >= 3 && v.cleared !== v.to) {
      const stopLine = toEnd - 3;
      const commit = (v.v * v.v) / (2 * FIRM_BRAKE) + 6;
      if (stopLine < commit) {
        if (this.requestGreen(v)) v.cleared = v.to;
        else if (stopLine < gap) {
          gap = Math.max(0.01, stopLine);
          leadSpeed = 0;
        }
      }
    }
    if (v.cleared === v.to) {
      // A car that has ground to a halt short of the junction gives its clearance back,
      // so it can't hold the green while stuck in a queue.
      if (v.v < 0.2 && toEnd > 6) v.cleared = -1;
      else this.greenUsed[v.to] = this.time;
    }

    // Desired speed: the limit, the driver, and slowing for the turn ahead.
    let desired = ROAD_SPECS[link.cls].speed * type.pace * v.driver;
    if (v.next >= 0) {
      const corner = this.cornerSpeed(v);
      if (corner < desired) desired = Math.min(desired, Math.sqrt(corner * corner + 2 * COMFORT_BRAKE * toEnd));
    }

    const free = 1 - Math.pow(v.v / Math.max(desired, 0.1), 4);
    if (gap === Infinity) return Math.max(-9, type.accel * free);
    const closing = v.v - leadSpeed;
    const wanted = MIN_GAP + Math.max(0, v.v * HEADWAY + (v.v * closing) / (2 * Math.sqrt(type.accel * COMFORT_BRAKE)));
    const g = Math.max(gap, 0.01);
    return Math.max(-9, type.accel * (free - (wanted / g) ** 2));
  }

  /** Move a vehicle across node boundaries after its position has been integrated. */
  private advance(v: Vehicle): void {
    const { graph } = this;
    for (;;) {
      const link = graph.links[v.link]!;
      if (v.s < link.length) return;

      // Never roll through a junction without right-of-way.
      if (graph.degree(v.to) >= 3 && v.cleared !== v.to) {
        v.s = link.length - 0.01;
        v.v = 0;
        return;
      }
      if (v.next === -2 && v.kind === 'civ') {
        v.alive = false;
        this.stats.despawned++;
        return;
      }
      if (v.next === -1) this.chooseNext(v);
      const over = v.s - link.length;
      const node = v.to;
      const next = v.next;
      if (next === v.link) {
        // U-turn at a dead end.
        v.dir = v.dir > 0 ? -1 : 1;
        v.v = Math.min(v.v, 1);
      } else {
        v.dir = this.dirFrom(next, node);
        v.link = next;
      }
      v.from = node;
      v.to = graph.other(v.link, node);
      v.s = over;
      v.next = -1;
      if (v.route) v.routeAt++;
      if (v.cleared === node) {
        this.greenUsed[node] = this.time;
        v.cleared = -1;
      }
    }
  }

  // ---------------------------------------------------------------- decisions

  private chooseNext(v: Vehicle): void {
    const { graph, rng, config } = this;
    const node = v.to;

    if ((config.routing === 'wander' || !v.planner) && v.route) v.route = null;
    if (config.routing !== 'wander' && v.planner) {
      const route = v.route;
      if (route && route[v.routeAt] === node && v.routeAt + 1 < route.length) {
        v.next = graph.linkBetween(node, route[v.routeAt + 1]!);
        return;
      }
      // Arrived (or no route yet): pick somewhere new to go.
      if (this.routesThisStep < config.routesPerStep) {
        this.routesThisStep++;
        for (let attempt = 0; attempt < 4; attempt++) {
          const dest = rng.int(graph.nodes.length);
          if (dest === node) continue;
          const r = this.findRoute(node, dest);
          if (!r.found || r.nodes.length < 2) continue;
          // Never start a trip by turning round in the middle of the road.
          if (r.nodes[1] === v.from && graph.degree(node) > 1) continue;
          v.route = r.nodes;
          v.routeAt = 0;
          v.next = graph.linkBetween(node, r.nodes[1]!);
          return;
        }
      }
      v.route = null;
    }

    // Wander: any exit except the way we came in.
    const options = graph.adj[node]!.filter((id) => id !== v.link);
    if (options.length === 0) {
      v.next = v.kind === 'civ' && graph.nodes[node]!.edge && config.spawn !== 'off' ? -2 : v.link;
      return;
    }
    // Drivers mostly carry straight on, and mostly stay on the highway once they are on it.
    const here = graph.links[v.link]!;
    const a = graph.nodes[v.from]!;
    const b = graph.nodes[node]!;
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    const weights = options.map((id) => {
      const c = graph.nodes[graph.other(id, node)]!;
      const straight = Math.abs(angleDiff(Math.atan2(c.y - b.y, c.x - b.x), heading)) < 0.5;
      const sameRoad = graph.links[id]!.cls === here.cls;
      return (straight ? 3 : 1) * (sameRoad && here.cls === 'highway' ? 4 : 1);
    });
    let roll = rng.next() * weights.reduce((sum, w) => sum + w, 0);
    let choice = options.length - 1;
    for (let i = 0; i < options.length; i++) {
      roll -= weights[i]!;
      if (roll < 0) {
        choice = i;
        break;
      }
    }
    v.next = options[choice]!;
  }

  /** Route with whichever graph the config says, and record how much work it took. */
  findRoute(from: number, to: number, trace = false): Route {
    const r = this.config.routing === 'coarse' ? this.coarse.route(from, to, trace) : routeFull(this.graph, from, to, trace);
    this.stats.routes++;
    this.stats.expandedTotal += r.expanded;
    this.stats.lastExpanded = r.expanded;
    return r;
  }

  /** Fastest comfortable speed through the turn onto the next link. */
  private cornerSpeed(v: Vehicle): number {
    if (v.next === v.link) return 2.5;
    const { graph } = this;
    const a = graph.nodes[v.from]!;
    const b = graph.nodes[v.to]!;
    const c = graph.nodes[graph.other(v.next, v.to)]!;
    const turn = Math.abs(angleDiff(Math.atan2(c.y - b.y, c.x - b.x), Math.atan2(b.y - a.y, b.x - a.x)));
    if (turn < 0.25) return Infinity;
    const radius = 9 / Math.tan(Math.min(turn, 3) / 2);
    return Math.max(2.5, Math.sqrt(GRIP * GRAVITY * radius));
  }

  // ---------------------------------------------------------------- junctions

  /**
   * Right-of-way works like a tiny actuated signal. One approach holds the green
   * at a time; cars following each other through share it; and if someone else is
   * waiting, the green is taken away after a few seconds.
   */
  private requestGreen(v: Vehicle): boolean {
    if (v.next < 0 || v.next === v.link) return this.rightOfWay(v);
    const node = v.to;
    const nextDir = this.dirFrom(v.next, node);
    const target = (this.laneKey(v.next, nextDir) << 2) | this.laneOn(v, v.next);
    const source = (this.laneKey(v.link, v.dir) << 2) | this.laneOn(v, v.link);
    const claim = this.entryClaims.get(target);
    if (claim && claim.by !== v && claim.source !== source) {
      const c = claim.by;
      const approaching = c.alive && c.to === claim.node && c.cleared === claim.node && c.next === v.next;
      const entering = c.alive && c.link === v.next && c.from === claim.node && c.s - VEHICLE_TYPES[c.type]!.length < 2;
      if (approaching || entering) return false;
    }
    if (!this.rightOfWay(v)) return false;
    this.entryClaims.set(target, { by: v, source, node });
    return true;
  }

  private rightOfWay(v: Vehicle): boolean {
    const node = v.to;
    // Don't block the box: only go if there is room on the far side.
    if (v.next >= 0 && v.next !== v.link) {
      const first = this.firstOnNext(v);
      if (first && first.s - VEHICLE_TYPES[first.type]!.length < 6) return false;
    }
    const phase = this.phaseAt[v.link * 2 + (this.graph.links[v.link]!.a === node ? 0 : 1)]!;

    // Highway merge: the highway never stops, and the ramp waits for a gap in the lane it will join.
    const major = this.majorPhase[node]!;
    if (major >= 0) return phase === major || this.majorIsClear(v, major);

    const holder = this.green[node]!;
    // A request from another approach only counts for a few seconds, in case that car has gone.
    const contested = this.greenWanted[node] === 1 && this.time - this.greenWantedAt[node]! < 3;
    if (holder === -1) {
      // Whoever just had the green goes to the back of the queue if someone else is waiting.
      if (contested && this.greenLast[node] === phase) return false;
      this.green[node] = phase;
      this.greenLast[node] = phase;
      this.greenSince[node] = this.time;
      this.greenUsed[node] = this.time;
      this.greenWanted[node] = 0;
      this.activeJunctions.add(node);
      return true;
    }
    if (holder === phase) {
      return !contested || this.time - this.greenSince[node]! < MAX_GREEN[this.graph.links[v.link]!.cls]!;
    }
    this.greenWanted[node] = 1;
    this.greenWantedAt[node] = this.time;
    return false;
  }

  private releaseJunctions(): void {
    for (const node of this.activeJunctions) {
      if (this.time - this.greenUsed[node]! > GREEN_HOLD) {
        this.green[node] = -1;
        this.activeJunctions.delete(node);
      }
    }
  }

  // ---------------------------------------------------------------- spawning

  /** The links inside the spawn ring around the hero. Refreshed twice a second. */
  private refreshRing(): void {
    const tick = Math.floor(this.time * 2);
    if (tick === this.ringAt || !this.focus) return;
    this.ringAt = tick;
    this.ring.length = 0;
    this.bubbleTarget = [0, 0];
    const { spawnInner, spawnOuter, density } = this.config;
    for (const l of this.graph.links) {
      const [mx, my] = this.mid(l.id);
      const d = Math.hypot(mx - this.focus.x, my - this.focus.y);
      if (d > spawnOuter) continue;
      this.bubbleTarget[l.cls === 'highway' ? 1 : 0] += ((2 * l.length) / ROAD_SPECS[l.cls].spacing) * density;
      if (d >= spawnInner) this.ring.push(l.id);
    }
  }

  /**
   * Density-based spawning. Compare how many vehicles are near a candidate spot
   * with how many that kind of road should have. Spawn only if it's short.
   */
  private trySpawn(linkId: number, speedFactor: number): boolean {
    const { graph, rng, config } = this;
    const link = graph.links[linkId]!;
    const spec = ROAD_SPECS[link.cls];
    const s = rng.range(0, link.length);
    let dir: 1 | -1 = rng.chance(0.5) ? 1 : -1;

    // Lean towards traffic that is heading into view, so the middle stays busy.
    if (this.focus && rng.chance(0.2)) {
      const a = graph.nodes[link.a]!;
      const b = graph.nodes[link.b]!;
      const inward = (b.x - a.x) * (this.focus.x - a.x) + (b.y - a.y) * (this.focus.y - a.y);
      dir = inward > 0 ? 1 : -1;
    }
    if (!this.isFree(linkId, dir, s, 10)) return false;

    // Both directions, across a window SPAWN_WINDOW metres either side.
    const fromA = dir > 0 ? s : link.length - s;
    const target = ((2 * 2 * SPAWN_WINDOW) / spec.spacing) * config.density;
    const present = config.spawn === 'radial' ? this.countRadial(linkId, fromA) : this.countAlongRoads(linkId, fromA);
    const shortfall = target - present;
    const spawned = shortfall > 0 && rng.chance(Math.min(1, shortfall));
    // For the overlay only: was this spot refused because of cars that can't even be driven to?
    const wronglyFull = !spawned && shortfall <= 0 && config.spawn === 'radial' && target - this.countAlongRoads(linkId, fromA) >= 1;
    if (spawned || wronglyFull) {
      const [x, y] = this.pointOn(linkId, fromA);
      this.spawnLog.push({ x, y, time: this.time, kind: spawned ? 'spawned' : 'wronglyFull' });
      if (this.spawnLog.length > SPAWN_LOG_SIZE) this.spawnLog.splice(0, this.spawnLog.length - SPAWN_LOG_SIZE);
    }
    if (!spawned) return false;

    this.insertLane(this.addVehicle(linkId, dir, s, 'civ', spec.speed * speedFactor));
    this.stats.spawned++;
    return true;
  }

  /**
   * The naive check: count everything within a straight-line radius.
   * This also counts cars on the overpass above and on the parallel street next door.
   */
  private countRadial(linkId: number, s: number): number {
    const [x, y] = this.pointOn(linkId, s);
    const r = SPAWN_WINDOW;
    let count = 0;
    const c0 = Math.floor((x - r) / this.cell);
    const c1 = Math.floor((x + r) / this.cell);
    const r0 = Math.floor((y - r) / this.cell);
    const r1 = Math.floor((y + r) / this.cell);
    for (let cx = c0; cx <= c1; cx++) {
      for (let cy = r0; cy <= r1; cy++) {
        const bucket = this.buckets.get(cx * 100003 + cy);
        if (!bucket) continue;
        for (const v of bucket) {
          if (v.alive && (v.x - x) ** 2 + (v.y - y) ** 2 <= r * r) count++;
        }
      }
    }
    return count;
  }

  /**
   * The patent's fix: measure distance along connected roads. A car only counts
   * if you could actually drive to it within the window.
   */
  private countAlongRoads(linkId: number, s: number): number {
    const { graph } = this;
    const reach = SPAWN_WINDOW;
    const link = graph.links[linkId]!;
    const dist = new Map<number, number>();
    const queue: number[] = [];
    const offer = (node: number, d: number) => {
      if (d > reach) return;
      const prev = dist.get(node);
      if (prev === undefined || d < prev) {
        dist.set(node, d);
        queue.push(node);
      }
    };
    offer(link.a, s);
    offer(link.b, link.length - s);
    const links = new Set<number>([linkId]);
    while (queue.length) {
      const node = queue.pop()!;
      const d = dist.get(node)!;
      for (const id of graph.adj[node]!) {
        links.add(id);
        offer(graph.other(id, node), d + graph.links[id]!.length);
      }
    }
    let count = 0;
    for (const id of links) {
      const l = graph.links[id]!;
      const da = dist.get(l.a) ?? Infinity;
      const db = dist.get(l.b) ?? Infinity;
      for (const dirBit of [0, 1]) {
        for (const v of this.lanes[id * 2 + dirBit]!) {
          const fromA = dirBit ? v.s : l.length - v.s;
          let d = Math.min(da + fromA, db + l.length - fromA);
          if (id === linkId) d = Math.min(d, Math.abs(fromA - s));
          if (d <= reach) count++;
        }
      }
    }
    return count;
  }

  /** Group the roads meeting at each junction into phases: roads that line up share one. */
  private buildPhases(): Int8Array {
    const { graph } = this;
    const phaseAt = new Int8Array(graph.links.length * 2);
    for (const node of graph.nodes) {
      const ids = graph.adj[node.id]!;
      if (ids.length < 3) continue;
      const angle = ids.map((id) => {
        const o = graph.nodes[graph.other(id, node.id)]!;
        return Math.atan2(o.y - node.y, o.x - node.x);
      });
      const phase = ids.map(() => -1);
      let count = 0;
      for (let i = 0; i < ids.length; i++) {
        if (phase[i] !== -1) continue;
        phase[i] = count;
        for (let j = i + 1; j < ids.length; j++) {
          if (phase[j] === -1 && Math.abs(angleDiff(angle[i]!, angle[j]! + Math.PI)) < 0.6) {
            phase[j] = count;
            break;
          }
        }
        count++;
      }
      ids.forEach((id, i) => {
        phaseAt[id * 2 + (graph.links[id]!.a === node.id ? 0 : 1)] = phase[i]!;
      });

      // A highway running through is the main road: ramps yield to it.
      const rank: number[] = new Array(count).fill(-1);
      ids.forEach((id, i) => {
        rank[phase[i]!] = Math.max(rank[phase[i]!]!, CLASS_RANK[graph.links[id]!.cls]!);
      });
      const top = Math.max(...rank);
      if (top === CLASS_RANK.highway && rank.filter((r) => r === top).length === 1) {
        this.majorPhase[node.id] = rank.indexOf(top);
      }
    }
    return phaseAt;
  }

  /** True if no highway vehicle is about to arrive in the lane this vehicle wants to merge into. */
  private majorIsClear(v: Vehicle, major: number): boolean {
    const { graph } = this;
    const node = v.to;
    const lane = this.laneOn(v, v.next);
    for (const first of graph.adj[node]!) {
      if (first === v.next) continue;
      if (this.phaseAt[first * 2 + (graph.links[first]!.a === node ? 0 : 1)] !== major) continue;
      // Walk back up the main road, checking traffic heading this way.
      let link = first;
      let at = node;
      let dist = 0;
      while (dist < 110) {
        const l = graph.links[link]!;
        for (const u of this.lanes[this.laneKey(link, l.b === at ? 1 : -1)]!) {
          if (this.laneOn(u, v.next) === lane && (dist + l.length - u.s) / Math.max(u.v, 3) < GAP_TIME) return false;
        }
        dist += l.length;
        const up = l.a === at ? l.b : l.a;
        const around = graph.adj[up]!;
        if (around.length !== 2) break;
        link = around[0] === link ? around[1]! : around[0]!;
        at = up;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- helpers

  /** Which lane a vehicle uses on a given link. Fixed per vehicle, so there is no lane changing. */
  private laneOn(v: Vehicle, link: number): number {
    return v.id % ROAD_SPECS[this.graph.links[link]!.cls].lanes;
  }

  /**
   * The next vehicle ahead on the same link that is in our way: either in our lane,
   * or in another lane but about to merge into the same lane of the same next link.
   */
  private leaderOnLink(v: Vehicle): Vehicle | undefined {
    const list = this.lanes[this.laneKey(v.link, v.dir)]!;
    const lane = this.laneOn(v, v.link);
    const nextLane = v.next >= 0 ? this.laneOn(v, v.next) : -1;
    for (let i = list.indexOf(v) + 1; i < list.length; i++) {
      const o = list[i]!;
      if (this.laneOn(o, v.link) === lane) return o;
      if (nextLane >= 0 && o.next === v.next && this.laneOn(o, v.next) === nextLane) return o;
    }
    return undefined;
  }

  /** The rearmost vehicle in the lane this vehicle will take on its next link. */
  private firstOnNext(v: Vehicle): Vehicle | undefined {
    const list = this.lanes[this.laneKey(v.next, this.dirFrom(v.next, v.to))]!;
    const lane = this.laneOn(v, v.next);
    for (const other of list) {
      if (other !== v && this.laneOn(other, v.next) === lane) return other;
    }
    return undefined;
  }

  private laneKey(link: number, dir: number): number {
    return link * 2 + (dir > 0 ? 1 : 0);
  }

  /** Travel direction on a link when entering it from a given node. */
  private dirFrom(link: number, node: number): 1 | -1 {
    return this.graph.links[link]!.a === node ? 1 : -1;
  }

  private indexLanes(): void {
    for (const key of this.touched) this.lanes[key]!.length = 0;
    this.touched.length = 0;
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const key = this.laneKey(v.link, v.dir);
      const lane = this.lanes[key]!;
      if (lane.length === 0) this.touched.push(key);
      lane.push(v);
    }
    for (const key of this.touched) {
      const lane = this.lanes[key]!;
      if (lane.length > 1) lane.sort((p, q) => p.s - q.s || p.id - q.id);
    }
  }

  private insertLane(v: Vehicle): void {
    const key = this.laneKey(v.link, v.dir);
    const lane = this.lanes[key]!;
    if (lane.length === 0) this.touched.push(key);
    lane.push(v);
    lane.sort((p, q) => p.s - q.s || p.id - q.id);
    const cell = Math.floor(v.x / this.cell) * 100003 + Math.floor(v.y / this.cell);
    const bucket = this.buckets.get(cell);
    if (bucket) bucket.push(v);
    else this.buckets.set(cell, [v]);
  }

  private indexBuckets(): void {
    this.buckets.clear();
    for (const v of this.vehicles) {
      if (!v.alive) continue;
      const key = Math.floor(v.x / this.cell) * 100003 + Math.floor(v.y / this.cell);
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(v);
      else this.buckets.set(key, [v]);
    }
  }

  /** True if no vehicle in the same direction is within `room` metres of position s. */
  private isFree(link: number, dir: number, s: number, room: number): boolean {
    for (const v of this.lanes[this.laneKey(link, dir)]!) {
      if (Math.abs(v.s - s) < room) return false;
    }
    return true;
  }

  private mid(linkId: number): [number, number] {
    const l = this.graph.links[linkId]!;
    const a = this.graph.nodes[l.a]!;
    const b = this.graph.nodes[l.b]!;
    return [(a.x + b.x) / 2, (a.y + b.y) / 2];
  }

  /** World position of a point s metres from node a along a link. */
  private pointOn(linkId: number, s: number): [number, number] {
    const l = this.graph.links[linkId]!;
    const a = this.graph.nodes[l.a]!;
    const b = this.graph.nodes[l.b]!;
    const t = l.length > 0 ? s / l.length : 0;
    return [a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t];
  }

  /** Update a vehicle's world position and heading from its place on its link. */
  private place(v: Vehicle, snap: boolean, dt = 0): void {
    const link = this.graph.links[v.link]!;
    const a = this.graph.nodes[v.from]!;
    const b = this.graph.nodes[v.to]!;
    const t = link.length > 0 ? Math.min(1, v.s / link.length) : 0;
    const dx = (b.x - a.x) / (link.length || 1);
    const dy = (b.y - a.y) / (link.length || 1);
    const spec = ROAD_SPECS[link.cls];
    const laneWidth = spec.width / 2 / spec.lanes;
    const offset = ((v.id % spec.lanes) + 0.5) * laneWidth;
    // Drive on the right: shift to the right-hand side of the direction of travel.
    v.x = a.x + (b.x - a.x) * t - dy * offset;
    v.y = a.y + (b.y - a.y) * t + dx * offset;
    v.level = link.level;
    const target = Math.atan2(dy, dx);
    if (snap) v.heading = target;
    else v.heading += angleDiff(target, v.heading) * Math.min(1, dt * 7);
  }
}

/** Smallest signed difference between two angles. */
export function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
