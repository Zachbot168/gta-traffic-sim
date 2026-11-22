/**
 * The wanted system: police dispatch, vision cones, searching the last known
 * position, and the hero's escape strategies.
 *
 * The shape follows what is documented about GTA V (line-of-sight cones, a search
 * around the last known position, a hide timer that grows with each star). The
 * numbers and the police tactics are our own. Rockstar's are not public.
 */
import { Occlusion } from './occlusion';
import type { Rng } from './rng';
import { angleDiff, type ChaseHook, type Vehicle, type World } from './world';

/** How the hero tries to get away. */
export type FleeStrategy = 'straight' | 'highway' | 'weave' | 'hide' | 'run' | 'manual';
/** How the police try to stop them. */
export type CopStrategy = 'chase' | 'intercept' | 'roadblock';

export const FLEE_STRATEGIES: FleeStrategy[] = ['straight', 'highway', 'weave', 'hide', 'run'];
export const COP_STRATEGIES: CopStrategy[] = ['chase', 'intercept', 'roadblock'];
/**
 * What the police know. 'search': only what an officer can see, so they have to hunt
 * around the last known position. 'psychic': every unit always knows where the hero is,
 * even though the hide timer still runs on real line of sight.
 */
export type Knowledge = 'search' | 'psychic';
export const KNOWLEDGE: Knowledge[] = ['search', 'psychic'];
export const KNOWLEDGE_LABELS: Record<Knowledge, string> = {
  search: 'Police must search',
  psychic: 'Psychic police',
};

export const FLEE_LABELS: Record<FleeStrategy, string> = {
  straight: 'Floor it in a straight line',
  highway: 'Head for the highway',
  weave: 'Turn at every junction',
  hide: 'Break line of sight, then hide',
  run: 'Break line of sight, then keep moving',
  manual: 'Manual driving',
};
export const COP_LABELS: Record<CopStrategy, string> = {
  chase: 'Chase directly',
  intercept: 'Cut them off',
  roadblock: 'Chase plus roadblocks',
};

/** Indexed by star level, 0 to 5. */
export const UNITS = [0, 2, 3, 5, 7, 9];
/** Seconds the hero must stay unseen to lose the police. */
export const ESCAPE_TIME = [0, 10, 15, 22, 30, 40];
/** Health lost per second for each officer with a clear shot. Nobody shoots below two stars. */
export const DAMAGE = [0, 0, 1.5, 2.5, 3.5, 4.5];
export const ROADBLOCKS = [0, 0, 0, 1, 2, 3];
export const HELI_FROM_STARS = 4;

export const VISION_RANGE = 95;
export const VISION_HALF_ANGLE = 0.65;
const CLOSE_RANGE = 14;
const HELI_RADIUS = 100;
const HELI_SPEED = 30;
const SHOOT_RANGE = 45;
const PIN_RANGE = 9;
const PIN_TIME = 2.5;
export const COP_PACE = 1.5;
export const HERO_PACE = 1.6;

export type Outcome = 'running' | 'escaped' | 'caught' | 'timeout';

export interface ChaseConfig {
  stars: number;
  flee: FleeStrategy;
  cops: CopStrategy;
  /** Give up and call it a failed escape after this many seconds. */
  timeLimit: number;
  knowledge: Knowledge;
  /** Police top speed as a multiple of the speed limit. The hero drives at 1.6. */
  copPace: number;
}

interface CopState {
  goal: number;
  role: 'chase' | 'cut';
  sees: boolean;
  nextThink: number;
  searching: boolean;
}

export interface Roadblock {
  link: number;
  x: number;
  y: number;
  angle: number;
  born: number;
  sees: boolean;
}

export class Chase implements ChaseHook {
  readonly config: ChaseConfig;
  readonly occlusion: Occlusion;
  outcome: Outcome = 'running';
  elapsed = 0;
  /** Is any officer looking at the hero right now? */
  seen = true;
  hiddenFor = 0;
  health = 100;
  lastKnown: { x: number; y: number; node: number };
  readonly copState = new Map<number, CopState>();
  readonly roadblocks: Roadblock[] = [];
  heli: { x: number; y: number; sees: boolean } | null = null;
  /** Manual driving input: turn is -1 left, 0 straight, +1 right at the next fork. */
  input = { turn: 0, brake: false };
  /** Seconds since the chase ended, used to clear the police away. */
  private after = 0;
  private pinnedFor = 0;
  private stoppedAtBlock = 0;
  private dispatchAt = 0;
  private roadblockAt = 6;
  private rng: Rng;
  private deckNodes: number[] = [];

  constructor(
    private world: World,
    config: Partial<ChaseConfig> = {},
    occlusion?: Occlusion,
  ) {
    this.config = { stars: 1, flee: 'weave', cops: 'chase', timeLimit: 150, knowledge: 'search', copPace: COP_PACE, ...config };
    this.occlusion = occlusion ?? new Occlusion(world.graph);
    this.rng = world.rng.fork();
    const hero = world.hero!;
    this.lastKnown = { x: hero.x, y: hero.y, node: hero.to };
    hero.emergency = true;
    hero.pace = HERO_PACE;
    hero.route = null;
    // Places to get onto the highway: the deck nodes where ramps join.
    const g = world.graph;
    for (const n of g.nodes) {
      if (n.level === 1 && g.degree(n.id) >= 3) this.deckNodes.push(n.id);
    }
    world.chase = this;
    // The crime was witnessed by a patrol car a little way behind. Backup is on its way.
    this.spawnWitness();
    if (UNITS[this.config.stars]! > 1) this.spawnCop();
  }

  /** The patrol car that saw it happen: on the hero's road, a few car lengths back, facing them. */
  private spawnWitness(): void {
    const { world } = this;
    const g = world.graph;
    const hero = world.hero!;
    let node = hero.from;
    let ahead = hero.to;
    let link = -1;
    for (let hop = 0; hop < 3; hop++) {
      const back = this.predictStep(ahead, node);
      if (back < 0) break;
      link = back;
      ahead = node;
      node = g.other(back, node);
    }
    if (link < 0) {
      this.spawnCop();
      return;
    }
    // `ahead` is the end of the link nearer the hero.
    const dir = g.links[link]!.b === ahead ? 1 : -1;
    const cop = world.addVehicle(link, dir, 1, 'cop', 8);
    cop.emergency = true;
    cop.pace = this.config.copPace;
    this.state(cop);
  }

  /** Do the police know where the hero is right now? */
  get knows(): boolean {
    return this.seen || this.config.knowledge === 'psychic';
  }

  get cops(): Vehicle[] {
    return this.world.vehicles.filter((v) => v.kind === 'cop');
  }

  /** Change the wanted level mid-chase. */
  setStars(stars: number): void {
    this.config.stars = Math.max(1, Math.min(5, stars));
  }

  // ---------------------------------------------------------------- per-step update

  update(dt: number): void {
    const { world } = this;
    const hero = world.hero;
    if (!hero) return;
    if (this.outcome !== 'running') {
      this.windDown(dt);
      return;
    }
    this.elapsed += dt;
    const stars = this.config.stars;
    const cops = this.cops;

    // --- Who can see the hero?
    let seen = false;
    let shooters = 0;
    let nearest = Infinity;
    for (const cop of cops) {
      const st = this.state(cop);
      const d = Math.hypot(hero.x - cop.x, hero.y - cop.y);
      nearest = Math.min(nearest, d);
      const inCone = d < CLOSE_RANGE || (d < VISION_RANGE && Math.abs(angleDiff(Math.atan2(hero.y - cop.y, hero.x - cop.x), cop.heading)) < VISION_HALF_ANGLE);
      st.sees = inCone && this.occlusion.visible(cop.x, cop.y, hero.x, hero.y);
      if (st.sees) {
        seen = true;
        if (d < SHOOT_RANGE) shooters++;
      }
    }
    for (const rb of this.roadblocks) {
      const d = Math.hypot(hero.x - rb.x, hero.y - rb.y);
      nearest = Math.min(nearest, d);
      rb.sees = d < 55 && this.occlusion.visible(rb.x, rb.y, hero.x, hero.y);
      if (rb.sees) {
        seen = true;
        if (d < SHOOT_RANGE) shooters += 2;
      }
    }
    this.updateHeli(dt, hero);
    if (this.heli?.sees) seen = true;

    this.seen = seen;
    if (seen) {
      this.lastKnown = { x: hero.x, y: hero.y, node: hero.to };
      this.hiddenFor = 0;
    } else {
      this.hiddenFor += dt;
    }

    // --- Ways for it to end.
    this.health -= DAMAGE[stars]! * Math.min(shooters, 4) * dt;
    this.pinnedFor = hero.v < 1.5 && nearest < PIN_RANGE ? this.pinnedFor + dt : Math.max(0, this.pinnedFor - dt);
    if (this.health <= 0 || this.pinnedFor >= PIN_TIME) return this.finish('caught');
    if (this.hiddenFor >= ESCAPE_TIME[stars]!) return this.finish('escaped');
    if (this.elapsed >= this.config.timeLimit) return this.finish('timeout');

    // --- Dispatch.
    if (this.elapsed >= this.dispatchAt && cops.length < UNITS[stars]!) {
      this.spawnCop();
      this.dispatchAt = this.elapsed + 1.5;
    }
    this.updateRoadblocks(hero);
    for (const cop of this.cops) this.think(cop, hero);

    // --- The hero's own state.
    if (this.config.flee === 'manual') hero.halt = this.input.brake;
    else if (this.config.flee === 'hide') hero.halt = !seen && this.hiddenFor > 4;
    else hero.halt = false;
    this.escapeRoadblock(dt, hero);
  }

  private finish(outcome: Outcome): void {
    this.outcome = outcome;
    const hero = this.world.hero!;
    hero.emergency = false;
    hero.halt = outcome === 'caught';
    for (const cop of this.cops) {
      cop.halt = outcome === 'caught';
      if (outcome !== 'caught') {
        cop.emergency = false;
        cop.route = null;
      }
    }
  }

  /** After the chase: the police drift away and the roadblocks clear. */
  private windDown(dt: number): void {
    this.after += dt;
    if (this.outcome === 'caught' || this.after < 4) return;
    for (const cop of this.cops) cop.alive = false;
    this.world.vehicles = this.world.vehicles.filter((v) => v.alive);
    for (const rb of this.roadblocks) this.world.blocked.delete(rb.link);
    this.roadblocks.length = 0;
    this.heli = null;
  }

  private state(cop: Vehicle): CopState {
    let st = this.copState.get(cop.id);
    if (!st) {
      st = { goal: -1, role: this.copState.size % 2 === 1 ? 'cut' : 'chase', sees: false, nextThink: 0, searching: false };
      this.copState.set(cop.id, st);
    }
    return st;
  }

  // ---------------------------------------------------------------- police

  /** Bring in a new unit somewhere near the action but out of the hero's sight. */
  private spawnCop(): boolean {
    const { world, rng } = this;
    const g = world.graph;
    const hero = world.hero!;
    const anchor = this.knows ? hero : this.lastKnown;
    for (let attempt = 0; attempt < 60; attempt++) {
      const node = g.nodes[rng.int(g.nodes.length)]!;
      if (node.level !== 0 || g.degree(node.id) < 2) continue;
      const d = Math.hypot(node.x - anchor.x, node.y - anchor.y);
      if (d < 170 || d > 360) continue;
      const fromHero = Math.hypot(node.x - hero.x, node.y - hero.y);
      if (fromHero < 150 && this.occlusion.visible(node.x, node.y, hero.x, hero.y)) continue;
      // Face the unit towards the action.
      let best = -1;
      let bestD = Infinity;
      for (const id of g.adj[node.id]!) {
        const o = g.nodes[g.other(id, node.id)]!;
        const od = Math.hypot(o.x - anchor.x, o.y - anchor.y);
        if (od < bestD) {
          bestD = od;
          best = id;
        }
      }
      const dir = g.links[best]!.a === node.id ? 1 : -1;
      if (!world.isFree(best, dir, 1, 8)) continue;
      const cop = world.addVehicle(best, dir, 1, 'cop', 6);
      cop.emergency = true;
      cop.pace = this.config.copPace;
      this.state(cop);
      return true;
    }
    return false;
  }

  /** Decide where a unit is heading. Runs about once a second per unit. */
  private think(cop: Vehicle, hero: Vehicle): void {
    const st = this.state(cop);
    if (this.elapsed < st.nextThink) return;
    st.nextThink = this.elapsed + 0.8 + (cop.id % 5) * 0.05;
    const g = this.world.graph;

    let goal: number;
    if (this.knows) {
      st.searching = false;
      const cut = this.config.cops === 'intercept' && st.role === 'cut';
      const gap = Math.hypot(hero.x - cop.x, hero.y - cop.y);
      goal = cut && gap > 60 ? this.predict(hero, Math.max(80, Math.min(320, gap * 0.7))) : hero.to;
    } else {
      // Lost them: go to where they were last seen, then sweep the streets around it.
      const goalNode = st.goal >= 0 ? g.nodes[st.goal]! : null;
      const arrived = goalNode !== null && Math.hypot(goalNode.x - cop.x, goalNode.y - cop.y) < 30;
      if (!st.searching) {
        st.searching = true;
        goal = this.lastKnown.node;
      } else if (arrived || goalNode === null) {
        goal = this.nodeNear(this.lastKnown.x, this.lastKnown.y, 60 + this.hiddenFor * 9);
      } else {
        goal = st.goal;
      }
    }
    st.goal = goal;

    const r = this.world.coarse.route(cop.to, goal);
    if (!r.found || r.nodes.length < 2) {
      cop.route = null;
      cop.halt = false;
      return;
    }
    // The quickest way there is back the way we came: swing the car round.
    if (r.nodes[1] === cop.from && g.degree(cop.to) > 1) {
      if (cop.v < 7) {
        this.world.reverse(cop);
        const back = this.world.coarse.route(cop.to, goal);
        cop.route = back.found && back.nodes.length >= 2 ? back.nodes : null;
        cop.routeAt = 0;
      } else {
        cop.halt = true;
        st.nextThink = this.elapsed + 0.2;
      }
      return;
    }
    cop.halt = false;
    cop.route = r.nodes;
    cop.routeAt = 0;
    cop.next = -1;
  }

  /** Where the hero will be if they carry straight on for a given distance. */
  private predict(hero: Vehicle, distance: number): number {
    const g = this.world.graph;
    let node = hero.to;
    let from = hero.from;
    let travelled = 0;
    while (travelled < distance) {
      const a = g.nodes[from]!;
      const b = g.nodes[node]!;
      const heading = Math.atan2(b.y - a.y, b.x - a.x);
      let best = -1;
      let bestTurn = Infinity;
      for (const id of g.adj[node]!) {
        const other = g.other(id, node);
        if (other === from) continue;
        const c = g.nodes[other]!;
        const turn = Math.abs(angleDiff(Math.atan2(c.y - b.y, c.x - b.x), heading));
        if (turn < bestTurn) {
          bestTurn = turn;
          best = id;
        }
      }
      if (best < 0) break;
      travelled += g.links[best]!.length;
      from = node;
      node = g.other(best, node);
    }
    return node;
  }

  private nodeNear(x: number, y: number, radius: number): number {
    const g = this.world.graph;
    for (let attempt = 0; attempt < 40; attempt++) {
      const n = g.nodes[this.rng.int(g.nodes.length)]!;
      if (Math.hypot(n.x - x, n.y - y) < radius) return n.id;
    }
    return this.lastKnown.node;
  }

  private updateHeli(dt: number, hero: Vehicle): void {
    if (this.config.stars < HELI_FROM_STARS) {
      this.heli = null;
      return;
    }
    if (!this.heli) {
      const angle = this.rng.range(0, Math.PI * 2);
      this.heli = { x: hero.x + Math.cos(angle) * 420, y: hero.y + Math.sin(angle) * 420, sees: false };
    }
    const heli = this.heli;
    // Follow the hero while they are in view; otherwise circle the last known position.
    let tx = hero.x;
    let ty = hero.y;
    if (!heli.sees && this.config.knowledge !== 'psychic') {
      tx = this.lastKnown.x + Math.cos(this.elapsed * 0.35) * 70;
      ty = this.lastKnown.y + Math.sin(this.elapsed * 0.35) * 70;
    }
    const d = Math.hypot(tx - heli.x, ty - heli.y);
    if (d > 1) {
      const step = Math.min(d, HELI_SPEED * dt);
      heli.x += ((tx - heli.x) / d) * step;
      heli.y += ((ty - heli.y) / d) * step;
    }
    // The helicopter sees over buildings, but not through the highway deck.
    const hy = this.world.map.highwayY;
    const underDeck = hy !== null && hero.level === 0 && Math.abs(hero.y - hy) < 10;
    heli.sees = !underDeck && Math.hypot(hero.x - heli.x, hero.y - heli.y) < HELI_RADIUS;
  }

  private updateRoadblocks(hero: Vehicle): void {
    const { world } = this;
    const g = world.graph;
    for (let i = this.roadblocks.length - 1; i >= 0; i--) {
      const rb = this.roadblocks[i]!;
      if (this.elapsed - rb.born > 45 || Math.hypot(rb.x - hero.x, rb.y - hero.y) > 480) {
        world.blocked.delete(rb.link);
        this.roadblocks.splice(i, 1);
      }
    }
    if (this.config.cops !== 'roadblock' || !this.seen || this.elapsed < this.roadblockAt) return;
    if (this.roadblocks.length >= ROADBLOCKS[this.config.stars]!) return;
    this.roadblockAt = this.elapsed + 7;

    // Put it on the road ahead of the hero, far enough away that they can't see it being set up.
    let node = hero.to;
    let from = hero.from;
    let travelled = g.links[hero.link]!.length - hero.s;
    for (let hop = 0; hop < 30 && travelled < 330; hop++) {
      const ahead = this.predictStep(from, node);
      if (ahead < 0) return;
      const l = g.links[ahead]!;
      const far = g.other(ahead, node);
      travelled += l.length;
      if (travelled > 170 && l.level === 0 && !world.blocked.has(ahead)) {
        const a = g.nodes[node]!;
        const b = g.nodes[far]!;
        const x = (a.x + b.x) / 2;
        const y = (a.y + b.y) / 2;
        if (!this.occlusion.visible(hero.x, hero.y, x, y)) {
          world.blocked.add(ahead);
          this.roadblocks.push({ link: ahead, x, y, angle: Math.atan2(b.y - a.y, b.x - a.x), born: this.elapsed, sees: false });
          return;
        }
      }
      from = node;
      node = far;
    }
  }

  /** The link that carries straight on through a node. */
  private predictStep(from: number, node: number): number {
    const g = this.world.graph;
    const a = g.nodes[from]!;
    const b = g.nodes[node]!;
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    let best = -1;
    let bestTurn = Infinity;
    for (const id of g.adj[node]!) {
      const other = g.other(id, node);
      if (other === from) continue;
      const c = g.nodes[other]!;
      const turn = Math.abs(angleDiff(Math.atan2(c.y - b.y, c.x - b.x), heading));
      if (turn < bestTurn) {
        bestTurn = turn;
        best = id;
      }
    }
    return best;
  }

  /** If the hero has been stopped by a roadblock, throw the car round and run the other way. */
  private escapeRoadblock(dt: number, hero: Vehicle): void {
    const blockedAhead = this.blockedWithin(hero.link, hero.to, this.world.graph.links[hero.link]!.length - hero.s, 25) || this.world.blocked.has(hero.link);
    this.stoppedAtBlock = hero.v < 2 && blockedAhead && !hero.halt ? this.stoppedAtBlock + dt : 0;
    if (this.stoppedAtBlock > 0.6 && this.config.flee !== 'manual') {
      this.world.reverse(hero);
      this.stoppedAtBlock = 0;
    }
  }

  /** Is there a roadblock on the plain stretch of road beyond a node, within some distance? */
  private blockedWithin(link: number, node: number, start: number, reach: number): boolean {
    const g = this.world.graph;
    let dist = start;
    let at = node;
    let cur = link;
    while (dist < reach) {
      const around = g.adj[at]!;
      if (around.length !== 2) return false;
      cur = around[0] === cur ? around[1]! : around[0]!;
      if (this.world.blocked.has(cur)) return true;
      dist += g.links[cur]!.length;
      at = g.other(cur, at);
    }
    return false;
  }

  // ---------------------------------------------------------------- choosing where to go

  chooseNext(v: Vehicle): number | null {
    if (this.outcome !== 'running') return null;
    return v.kind === 'cop' ? this.copNext(v) : this.heroNext(v);
  }

  private copNext(cop: Vehicle): number | null {
    const g = this.world.graph;
    const node = cop.to;
    const route = cop.route;
    if (route && route[cop.routeAt] === node && cop.routeAt + 1 < route.length) {
      return g.linkBetween(node, route[cop.routeAt + 1]!);
    }
    // No plan right now: take whichever exit points most directly at the target.
    const target = this.knows ? this.world.hero! : this.lastKnown;
    let best = -1;
    let bestD = Infinity;
    for (const id of g.adj[node]!) {
      if (id === cop.link && g.degree(node) > 1) continue;
      const o = g.nodes[g.other(id, node)]!;
      const d = Math.hypot(o.x - target.x, o.y - target.y);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best >= 0 ? best : cop.link;
  }

  private heroNext(hero: Vehicle): number | null {
    const { world, rng } = this;
    const g = world.graph;
    const node = hero.to;
    const options = g.adj[node]!.filter((id) => id !== hero.link);
    if (options.length === 0) return hero.link;

    const a = g.nodes[hero.from]!;
    const b = g.nodes[node]!;
    const heading = Math.atan2(b.y - a.y, b.x - a.x);
    const flee = this.config.flee;
    const cops = this.cops;
    const onHighway = g.links[hero.link]!.cls === 'highway';

    // For "head for the highway": the first step of the quickest way to the nearest ramp.
    let towardsRamp = -1;
    if (flee === 'highway' && !onHighway && this.deckNodes.length > 0) {
      let target = this.deckNodes[0]!;
      let bestD = Infinity;
      for (const id of this.deckNodes) {
        const n = g.nodes[id]!;
        const d = Math.hypot(n.x - b.x, n.y - b.y);
        if (d < bestD) {
          bestD = d;
          target = id;
        }
      }
      const r = world.coarse.route(node, target);
      if (r.found && r.nodes.length >= 2) towardsRamp = g.linkBetween(node, r.nodes[1]!);
    }

    let best = options[0]!;
    let bestScore = -Infinity;
    for (const id of options) {
      const far = g.nodes[g.other(id, node)]!;
      const signed = angleDiff(Math.atan2(far.y - b.y, far.x - b.x), heading);
      const turn = Math.abs(signed);
      const straight = 1 - turn / Math.PI;
      const turning = turn > 0.5 ? 1 : 0;
      let score = rng.next() * 0.5;

      if (flee === 'manual') {
        const wanted = this.input.turn * 1.4;
        score = -Math.abs(signed - wanted);
      } else if (flee === 'straight') {
        score += straight * 10;
      } else if (flee === 'highway') {
        score += onHighway ? straight * 10 : id === towardsRamp ? 12 : straight * 3;
      } else if (flee === 'weave' || this.seen) {
        // In view of the police: take turns to break their line of sight.
        score += turning * 8 + rng.next() * 3;
      } else if (flee === 'hide') {
        score += turning * 4 + rng.next() * 3;
      } else {
        // 'run', out of sight: put distance between us and the last place they saw us.
        score += Math.hypot(far.x - this.lastKnown.x, far.y - this.lastKnown.y) / 25 - Math.hypot(b.x - this.lastKnown.x, b.y - this.lastKnown.y) / 25 + straight * 2;
      }

      if (flee !== 'manual') {
        // Don't drive straight at a police car, or into a roadblock we can see.
        for (const cop of cops) {
          if (Math.hypot(cop.x - far.x, cop.y - far.y) < 35) score -= 12;
        }
        if (world.blocked.has(id) || this.blockedWithin(id, g.other(id, node), g.links[id]!.length, 90)) {
          const rb = this.roadblocks.find((r) => Math.hypot(r.x - far.x, r.y - far.y) < 110);
          if (rb && this.occlusion.visible(hero.x, hero.y, rb.x, rb.y)) score -= 40;
        }
        // The highway ends at the edge of the map. Don't run off the end of it.
        if (far.edge) score -= 20;
      }
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }
}
