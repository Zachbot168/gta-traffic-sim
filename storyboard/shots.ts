/**
 * The shot list. Edit the narration here and the storyboard follows; edit a shot's
 * stage, camera or seconds here and `npm run record -- <id>` re-renders just that clip.
 */
import chaseResults from '../src/app/chase-results.json';
import paceSweep from '../src/app/pace-sweep.json';
import routingBench from '../src/app/routing-bench.json';
import { cityChase, knowledgeCharts, none, resultCharts, STAGES, world, type Stage } from '../src/app/stages';
import type { ChartSpec, Series } from '../src/render/charts';
import type { ChaseConfig } from '../src/sim/chase';
import { numberCard, overpassDiagram, textCard } from './cards';
import type { Shot } from './types';

const GREY = '#8a8a8a';
const stage = (key: string): Stage => STAGES.find((s) => s.key === key)!;

/** A chase that is not one of the app's presets. The seed picks the traffic, and so how the chase plays out. */
function chase(config: Partial<ChaseConfig>, zoom: number, seed: number): Stage {
  return { ...stage('6b'), key: `chase-${seed}`, build: cityChase(config, zoom, seed) };
}

/** 1,500 cars in the whole city, wandering or routed, for the side-by-side. */
function cityTraffic(routing: 'wander' | 'full'): Stage {
  return {
    ...stage('2c'),
    key: `city-${routing}`,
    build: (map) => {
      const w = world(map, { routing });
      w.populate(1500);
      return { world: w, overlays: none, framing: { kind: 'fit' }, demo: null, demoRate: 0 };
    },
  };
}

/**
 * Draws a chart's lines in over time. `starts` gives, per series, the second its line
 * begins to draw; each line takes `drawTime` seconds. A series with no start is hidden.
 */
function reveal(spec: ChartSpec, t: number, starts: (number | null)[], drawTime = 1.8): ChartSpec {
  const series: Series[] = spec.series.map((s, i) => {
    const start = starts[i];
    const line = s.line ?? [];
    if (start == null || t <= start) return { ...s, line: [] };
    const k = Math.min(1, (t - start) / drawTime);
    const pos = k * (line.length - 1);
    const whole = Math.floor(pos);
    const shown = line.slice(0, whole + 1);
    if (whole < line.length - 1) {
      const [x0, y0] = line[whole]!;
      const [x1, y1] = line[whole + 1]!;
      const f = pos - whole;
      shown.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]);
    }
    return { ...s, line: shown };
  });
  return { ...spec, series };
}

const stars = { xLabel: 'Wanted level (stars)', yLabel: 'Chases escaped', xRange: [0.7, 5.3] as [number, number], yRange: [0, 100] as [number, number], xTicks: [1, 2, 3, 4, 5], yTicks: [0, 25, 50, 75, 100], yFormat: (v: number) => `${v}%` };
const byStar = (rates: number[]): [number, number][] => rates.map((r, i) => [i + 1, r]);

const savingChart: ChartSpec = {
  title: 'How much work the fork map saves',
  subtitle: '400 random trips at each city size.',
  xLabel: 'Intersections in the city',
  yLabel: 'Times less work',
  xRange: [0, 4200],
  yRange: [0, 12],
  xTicks: [0, 1000, 2000, 3000, 4000],
  yTicks: [0, 3, 6, 9, 12],
  xFormat: (v) => v.toLocaleString('en-US'),
  yFormat: (v) => `${v}x`,
  series: [{ label: 'Saving', color: '#ffffff', line: routingBench.map((r) => [r.intersections, Math.round((10 * r.searchedFull) / r.searchedCoarse) / 10]) }],
};

const knowledgeChart = knowledgeCharts()[0]!;
const strategyChart = resultCharts()[0]!;
const hideChart: ChartSpec = {
  ...stars,
  title: 'Hiding, against each kind of police',
  subtitle: 'Break line of sight, then park. 120 chases per point.',
  series: [
    { label: 'Police must search', color: '#ffffff', line: byStar((chaseResults.escapeRateByFlee as Record<string, number[]>).hide!) },
    { label: 'Psychic police', color: '#ffffff', line: byStar((chaseResults.psychic.escapeRateByFlee as Record<string, number[]>).hide!) },
  ],
};
const sweepLine = (starsAt: number, flee: string): [number, number][] => paceSweep.points.filter((p) => p.stars === starsAt && p.flee === flee).map((p) => [p.copPace, p.escapeRate]);
const sweepChart: ChartSpec = {
  title: 'Does it only work because my car is faster?',
  subtitle: 'My car does 1.6x the limit. 40 chases per point.',
  xLabel: 'Police top speed (times the speed limit)',
  yLabel: 'Chases escaped',
  xRange: [1.25, 1.95],
  yRange: [0, 100],
  xTicks: [1.3, 1.5, 1.7, 1.9],
  yTicks: [0, 25, 50, 75, 100],
  xFormat: (v) => `${v}x`,
  yFormat: (v) => `${v}%`,
  series: [
    { label: 'Highway, 3 stars', color: '#ffffff', line: sweepLine(3, 'highway') },
    { label: 'Highway, 5 stars', color: '#ffffff', line: sweepLine(5, 'highway') },
    { label: 'Hide, 3 stars', color: '#ffffff', line: sweepLine(3, 'hide') },
    { label: 'Hide, 5 stars', color: '#ffffff', line: sweepLine(5, 'hide') },
  ],
};

/** The matched pair at the heart of the video: the same two-star chase, hiding, against each kind of police. */
const HIDE_SEED = 40;
const hideFromSearchers = chase({ stars: 2, flee: 'hide', cops: 'chase', knowledge: 'search' }, 1.7, HIDE_SEED);
const hideFromPsychics = chase({ stars: 2, flee: 'hide', cops: 'chase', knowledge: 'psychic' }, 1.7, HIDE_SEED);

export const SHOTS: Shot[] = [
  // ------------------------------------------------------------------ hook
  {
    id: 'H-01',
    section: 'Hook',
    kind: 'sim',
    stage: hideFromPsychics,
    vo: "If you've ever parked behind a building in GTA, sure the cops had lost you, and watched them drive straight to you anyway, you weren't imagining it.",
    onScreen: 'A two-star chase. The car breaks line of sight and parks. Police drive straight to it.',
    tag: 'My sim',
    seconds: 14,
    speed: 1.2,
  },
  {
    id: 'H-02',
    section: 'Hook',
    kind: 'card',
    vo: "When GTA 6 came out, Rockstar's VP of Technology said it plainly. In the older games, the cops were always able to pinpoint the player's exact location.",
    onScreen: 'Quote card with name, title and outlet.',
    tag: 'Rockstar',
    draw: textCard(
      [
        { text: '"Previously, cops were always able to pinpoint the player\'s exact location."', size: 0.062, at: 0.4 },
        { text: 'David Hynd, Vice President of Technology, Rockstar Games', size: 0.03, color: GREY, at: 5.5, gap: 1.6 },
        { text: 'quoted by Press Start, 18 November 2026', size: 0.026, color: GREY, at: 6.5, gap: 0.5 },
      ],
      { typeRate: 22 },
    ),
  },
  {
    id: 'H-03',
    section: 'Hook',
    kind: 'sim',
    stage: hideFromSearchers,
    vo: 'So how do you build police that actually have to look for you? And how do you fill a whole city with traffic for them to chase you through?',
    onScreen: 'The same chase against police who only know what they see. They head for the question mark, not the car.',
    tag: 'My sim',
    seconds: 14,
    speed: 1.2,
  },
  {
    id: 'H-04',
    section: 'Hook',
    kind: 'card',
    vo: "That same engineer's name is on a patent about how game traffic works. It's public. Anyone can read it.",
    onScreen: 'Patent details as a text card.',
    tag: 'Patent',
    draw: textCard(
      [
        { text: 'US 11,071,916', size: 0.085, at: 0.3 },
        { text: 'System and method for virtual navigation in a gaming environment', size: 0.04, at: 1.4, gap: 0.8 },
        { text: 'Filed 24 April 2019. Assigned to Take-Two Interactive.', size: 0.03, color: GREY, at: 3.6, gap: 1.4 },
        { text: 'Inventors: Simon Parr, David Hynd', size: 0.03, color: GREY, at: 4.8, gap: 0.5 },
      ],
      { typeRate: 45 },
    ),
  },
  {
    id: 'H-05',
    section: 'Hook',
    kind: 'sim',
    stage: '4b',
    vo: 'So I read it, rebuilt it as a little 2D city, added police, and ran six thousand chases to see what changes when the cops have to search.',
    onScreen: 'Street level, then a fast pull back to the whole city.',
    tag: 'My sim',
    overlays: { bubble: false },
    speed: 1.5,
    cam: { from: { mode: 'follow', zoom: 2.6 }, to: { mode: 'fit' }, start: 2, end: 10 },
  },
  {
    id: 'H-06',
    section: 'Hook',
    kind: 'card',
    vo: "Quick honesty note. This is a patent, some things modders have dug out of the older games, and my own rebuild. It is not Rockstar's code, and I'll tell you which is which as we go.",
    onScreen: 'The four source badges, appearing one by one.',
    draw: textCard(
      [
        { text: '[ROCKSTAR]  said on record by Rockstar', size: 0.036, at: 0.5 },
        { text: '[PATENT]    in the patent, not confirmed in any game', size: 0.036, at: 2.5, gap: 1 },
        { text: '[MODDERS]   documented from the older games', size: 0.036, at: 5, gap: 1 },
        { text: '[MY SIM]    measured in my rebuild, not in GTA', size: 0.036, at: 8, gap: 1 },
      ],
      { label: 'WHERE EACH CLAIM COMES FROM', typeRate: 60 },
    ),
  },

  // ------------------------------------------------------------------ loop 1
  {
    id: 'L1-01',
    section: 'Loop 1: the city is mostly empty',
    kind: 'sim',
    stage: '4a',
    vo: "Start with the traffic. Here's one car driving through my city. Busy streets, cars at every junction. How many cars would you guess the city is simulating right now?",
    onScreen: 'Follow one car through busy streets.',
    tag: 'My sim',
    hud: 'none',
  },
  {
    id: 'L1-02',
    section: 'Loop 1: the city is mostly empty',
    kind: 'sim',
    stage: '4a',
    continues: true,
    vo: "The honest way to do it is to simulate every car on every street, all the time. For a map this size that's well over a thousand cars nobody is looking at.",
    onScreen: 'Same drive, continuing.',
    tag: 'My sim',
    hud: 'none',
  },
  {
    id: 'L1-03',
    section: 'Loop 1: the city is mostly empty',
    kind: 'card',
    vo: 'The patent has a section on how games usually cheat here, and one line will sound familiar. Cars that fade out of existence as the player approaches.',
    onScreen: 'Short patent quote as a card.',
    tag: 'Patent',
    draw: textCard(
      [
        { text: '"...fade out of existence as the player approaches."', size: 0.06, at: 3.5 },
        { text: 'US 11,071,916, describing conventional game traffic', size: 0.028, color: GREY, at: 7, gap: 1.6 },
      ],
      { typeRate: 24 },
    ),
  },
  {
    id: 'L1-04',
    section: 'Loop 1: the city is mostly empty',
    kind: 'sim',
    stage: '4a',
    continues: true,
    vo: "So let's zoom out.",
    onScreen: 'The reveal. The camera pulls back from the car to the whole city. Hold in silence.',
    tag: 'My sim',
    seconds: 10,
    hud: 'none',
    cam: { from: { mode: 'follow', zoom: 2.2 }, to: { mode: 'fit' }, start: 1.5, end: 7.5 },
  },
  {
    id: 'L1-05',
    section: 'Loop 1: the city is mostly empty',
    kind: 'sim',
    stage: '4a',
    continues: true,
    vo: "That's all of it. A bubble of traffic about 380 meters across, in a city ten times that wide. Everything outside it is empty road.",
    onScreen: 'Whole city. The bubble outline switches on, with a live count of cars.',
    tag: 'My sim',
    hud: 'cars',
    cam: { mode: 'fit' },
    events: [{ at: 1.5, run: (s) => void (s.overlays.bubble = true) }],
  },
  {
    id: 'L1-06',
    section: 'Loop 1: the city is mostly empty',
    kind: 'sim',
    stage: '4a',
    continues: true,
    vo: "Drive anywhere and the bubble comes with you. Cars get created just ahead of you and deleted just behind you. From the driver's seat, it looks like a full city.",
    onScreen: 'Half zoom, following the car, so you can see traffic appear at the front edge and vanish at the back.',
    tag: 'My sim',
    hud: 'cars',
    speed: 2,
    cam: { from: { mode: 'fit' }, to: { mode: 'follow', zoom: 0.75 }, start: 0, end: 4 },
  },
  {
    id: 'L1-07',
    section: 'Loop 1: the city is mostly empty',
    kind: 'sim',
    stage: '4a',
    continues: true,
    vo: 'So the game only has to get a few hundred cars right. Which raises the next question. What are those cars actually doing?',
    onScreen: 'Push back in to street level.',
    tag: 'My sim',
    hud: 'none',
    events: [{ at: 3, run: (s) => void (s.overlays.bubble = false) }],
    cam: { from: { mode: 'follow', zoom: 0.75 }, to: { mode: 'follow', zoom: 2.4 }, start: 1, end: 7 },
  },

  // ------------------------------------------------------------------ loop 2
  {
    id: 'L2-01',
    section: 'Loop 2: most cars have nowhere to be',
    kind: 'sim',
    stage: '1a',
    vo: 'Strip the map down and a road is just dots joined by lines. A car sits on a dot and has one job, which is picking the next dot.',
    onScreen: 'One block drawn as dots and lines, with one car.',
    tag: 'My sim',
    cam: { mode: 'fit', margin: 12 },
  },
  {
    id: 'L2-02',
    section: 'Loop 2: most cars have nowhere to be',
    kind: 'sim',
    stage: '1b',
    vo: 'The cheapest rule is to pick a random exit at every junction. No destination, no plan. The car just wanders.',
    onScreen: 'Ten cars on the block, each taking random turns.',
    tag: 'My sim',
    speed: 1.5,
    cam: { mode: 'fit', margin: 12 },
  },
  {
    id: 'L2-03',
    section: 'Loop 2: most cars have nowhere to be',
    kind: 'card',
    vo: "The patent calls this the conventional approach. And modders who documented GTA 5's driving functions found one that does exactly this. Drive around with no destination.",
    onScreen: 'Two short lines, one from the patent, one from modder documentation.',
    tag: ['Patent', 'Modders'],
    draw: textCard(
      [
        { text: '[PATENT]', size: 0.028, color: GREY, at: 0.3 },
        { text: 'Conventional vehicles "may make arbitrary decisions at junctions"', size: 0.044, at: 0.6, gap: 0.4 },
        { text: '[MODDERS]', size: 0.028, color: GREY, at: 5, gap: 2 },
        { text: 'TASK_VEHICLE_DRIVE_WANDER: drive with no destination set', size: 0.044, at: 5.3, gap: 0.4 },
      ],
      { typeRate: 40 },
    ),
  },
  {
    id: 'L2-04',
    section: 'Loop 2: most cars have nowhere to be',
    kind: 'sim',
    stage: '1c',
    vo: "It's cheap, and up close it looks fine. But look at the whole district. Traffic is spread evenly over every street. Real cities don't look like that. Real cities have main roads.",
    onScreen: 'A whole district of wandering cars, evenly spread.',
    tag: 'My sim',
    warmup: 40,
    speed: 2,
  },
  {
    id: 'L2-05',
    section: 'Loop 2: most cars have nowhere to be',
    kind: 'sim',
    stage: '2a',
    vo: 'The upgrade is to give each car a destination and let it search for a route. The search spreads out from the start, one dot at a time, until it reaches the goal.',
    onScreen: 'A route search flooding out from A until it reaches B, with a counter.',
    tag: 'My sim',
    searchSpeed: 0.9,
  },
  {
    id: 'L2-06',
    section: 'Loop 2: most cars have nowhere to be',
    kind: 'split',
    left: { stage: cityTraffic('wander'), label: 'EVERY CAR WANDERS' },
    right: { stage: cityTraffic('full'), label: 'EVERY CAR HAS A ROUTE' },
    vo: 'Give every car a route and the picture changes. Traffic drains off the side streets and piles onto the main roads and the highway. Same city, same number of cars.',
    onScreen: 'Split screen. Left: wandering, evenly spread. Right: routed, piled onto main roads.',
    tag: 'My sim',
    warmup: 90,
    speed: 3,
  },
  {
    id: 'L2-07',
    section: 'Loop 2: most cars have nowhere to be',
    kind: 'sim',
    stage: '2b',
    vo: 'The problem is cost. This trip, corner to corner, checks about six thousand dots. A typical trip in this city is about two thousand. Now do that for every car, over and over.',
    onScreen: 'One search flooding across the whole city, counter climbing.',
    tag: 'My sim',
    searchSpeed: 0.75,
  },

  // ------------------------------------------------------------------ loop 3
  {
    id: 'L3-01',
    section: "Loop 3: the patent's main trick",
    kind: 'sim',
    stage: '3a',
    vo: "So which of those dots actually matter? Most of them sit on a plain stretch of road where there's no decision to make. You just keep going.",
    onScreen: 'The district as dots, zoomed in on a few blocks.',
    tag: 'My sim',
    overlays: { graph: true, coarse: false },
    cam: { from: { mode: 'fit' }, to: { mode: 'point', fx: 0.5, fy: 0.5, zoom: 2.4 }, start: 1, end: 7 },
  },
  {
    id: 'L3-02',
    section: "Loop 3: the patent's main trick",
    kind: 'sim',
    stage: '3a',
    continues: true,
    vo: 'The only places a route can change are the forks. So the patent builds a second map with nothing but forks, and searches that instead.',
    onScreen: 'Forks light up as plus signs. Pull back to see the whole fork map.',
    tag: 'Patent',
    events: [{ at: 2.5, run: (s) => void (s.overlays.coarse = true) }],
    cam: { from: { mode: 'point', fx: 0.5, fy: 0.5, zoom: 2.4 }, to: { mode: 'fit' }, start: 5, end: 10 },
  },
  {
    id: 'L3-03',
    section: "Loop 3: the patent's main trick",
    kind: 'card',
    vo: "The patent's claim is that you get the same route while checking far fewer points. That's something I can test.",
    onScreen: 'My city as two numbers: every point against forks only.',
    tag: ['Patent', 'My sim'],
    draw: numberCard([
      { big: '8,503', small: 'points on my city map', at: 0.5 },
      { big: '983', small: 'of them are forks', at: 3 },
    ]),
  },
  {
    id: 'L3-04',
    section: "Loop 3: the patent's main trick",
    kind: 'sim',
    stage: '3b',
    vo: 'Same trip, both ways. The fine dots are the full search, about six thousand points. The big squares are the fork search, about seven hundred. And the route they find is identical.',
    onScreen: 'Both searches on one trip across the city, with both counters.',
    tag: 'My sim',
    seconds: 14,
    searchSpeed: 0.75,
  },
  {
    id: 'L3-05',
    section: "Loop 3: the patent's main trick",
    kind: 'card',
    vo: 'Across 400 random trips, that came out to about eight and a half times less work. And every single route matched.',
    onScreen: 'The headline number and the check.',
    tag: 'My sim',
    draw: numberCard([
      { big: '8.6x', small: 'less work per trip', at: 2.5 },
      { big: '400/400', small: 'routes identical', at: 6 },
    ]),
  },
  {
    id: 'L3-06',
    section: "Loop 3: the patent's main trick",
    kind: 'chart',
    vo: "Here's where I was wrong. I expected the saving to grow as the city got bigger. It doesn't. From a 36 intersection town to a 4,000 intersection city, it stays flat at about eight and a half.",
    onScreen: 'Chart: the saving against city size. A flat line.',
    tag: 'My sim',
    chart: (t) => reveal(savingChart, t, [4], 5),
  },
  {
    id: 'L3-07',
    section: "Loop 3: the patent's main trick",
    kind: 'sim',
    stage: '3a',
    vo: "The saving depends on how many dots sit between forks, and that doesn't change with the size of the map. It's also not a new idea. Collapsing straight roads is standard in routing. The patent is one specific system built around it.",
    onScreen: 'Close on one road: a run of plain dots between two forks.',
    tag: 'My sim',
    overlays: { graph: true, coarse: true },
    cam: { from: { mode: 'point', fx: 0.5, fy: 0.5, zoom: 3.2 }, to: { mode: 'point', fx: 0.5, fy: 0.5, zoom: 5 }, start: 0, end: 16 },
  },
  {
    id: 'L3-08',
    section: "Loop 3: the patent's main trick",
    kind: 'sim',
    stage: '4b',
    vo: 'So routes are cheap and the city is mostly empty. But filling that bubble has a bug in it, and the patent describes that too.',
    onScreen: 'Back to the bubble, slowly pushing in toward the highway.',
    tag: 'My sim',
    hud: 'none',
    warmup: 20,
    cam: { from: { mode: 'fit' }, to: { mode: 'follow', zoom: 0.9 }, start: 0, end: 10 },
  },

  // ------------------------------------------------------------------ loop 4
  {
    id: 'L4-01',
    section: 'Loop 4: the overpass bug',
    kind: 'sim',
    stage: '4d',
    vo: 'How does the bubble decide where to put a new car? Every road has a target for how busy it should be. Before adding a car, the game counts the cars already nearby.',
    onScreen: 'The bubble sitting over the elevated highway, no marks yet.',
    tag: 'Patent',
    hud: 'none',
    overlays: { spawns: false, bubble: true },
    warmup: 15,
  },
  {
    id: 'L4-02',
    section: 'Loop 4: the overpass bug',
    kind: 'card',
    vo: 'The obvious way to count nearby is a straight line distance. The patent shows why that breaks. A car up on a highway overpass gets counted as if it were on the street underneath, even though the two roads never connect.',
    onScreen: 'My diagram of the patent example: a highway car lands inside the street\'s counting circle.',
    tag: 'Patent',
    draw: overpassDiagram(),
  },
  {
    id: 'L4-03',
    section: 'Loop 4: the overpass bug',
    kind: 'sim',
    stage: '4c',
    vo: "So I built the straight line version on purpose, to see if the bug is real. Every red mark is a spot where the game decided the road was full when it wasn't.",
    onScreen: 'Red marks building up, sped up, with a count.',
    tag: 'My sim',
    hud: 'spawns',
    speed: 3,
  },
  {
    id: 'L4-04',
    section: 'Loop 4: the overpass bug',
    kind: 'sim',
    stage: '4c',
    continues: true,
    vo: 'They hug the highway. More than half of them land within 90 meters of it, and the streets alongside end up noticeably thinner.',
    onScreen: 'Same shot, pushing in on the marks along the highway.',
    tag: 'My sim',
    hud: 'spawns',
    speed: 3,
    cam: { from: { mode: 'focus', zoom: 1.15 }, to: { mode: 'focus', zoom: 1.9 }, start: 0, end: 8 },
  },
  {
    id: 'L4-05',
    section: 'Loop 4: the overpass bug',
    kind: 'sim',
    stage: '4d',
    vo: "The patent's fix is to measure along the road and only count cars you could actually drive to. Same city, same seed. The red marks are gone.",
    onScreen: 'Counting along the road. No red marks appear.',
    tag: ['Patent', 'My sim'],
    hud: 'spawns',
    speed: 3,
  },
  {
    id: 'L4-06',
    section: 'Loop 4: the overpass bug',
    kind: 'sim',
    stage: '4a',
    vo: 'Now the city holds up. Time to commit a crime in it.',
    onScreen: 'Street level, following the car through traffic.',
    tag: 'My sim',
    hud: 'none',
    warmup: 25,
    seconds: 6,
  },

  // ------------------------------------------------------------------ loop 5
  {
    id: 'L5-01',
    section: 'Loop 5: how the police find you',
    kind: 'sim',
    stage: chase({ stars: 1, flee: 'weave', cops: 'chase' }, 1.9, 44),
    vo: 'One star, one patrol car. This is roughly what GTA 5 shows you on the minimap. Every officer has a cone of vision, and buildings block it.',
    onScreen: 'A one-star chase. The patrol car and its vision cone, clipped by buildings.',
    tag: 'Modders',
  },
  {
    id: 'L5-02',
    section: 'Loop 5: how the police find you',
    kind: 'sim',
    stage: chase({ stars: 1, flee: 'weave', cops: 'chase' }, 1.9, 44),
    continues: true,
    vo: "Get out of every cone and they don't just give up. They drive to the last place they saw you and search outward from there. Stay hidden long enough and you're clear.",
    onScreen: 'The car breaks line of sight. A question mark marks where police last saw it. The timer runs out.',
    tag: 'My sim',
  },
  {
    id: 'L5-03',
    section: 'Loop 5: how the police find you',
    kind: 'card',
    vo: "It takes longer the more stars you have. In my version it's ten seconds at one star and forty at five. Those numbers are mine. The patent barely mentions chases, so the police rules here are my own design.",
    onScreen: 'My wanted-level rules as a small table.',
    tag: 'My sim',
    draw: textCard(
      [
        { text: 'STARS    UNITS   STAY HIDDEN FOR   ALSO', size: 0.034, color: GREY, at: 0.3 },
        { text: '*          2        10 s', size: 0.04, at: 1, gap: 0.8 },
        { text: '* *        3        15 s', size: 0.04, at: 2 },
        { text: '* * *      5        22 s          roadblocks', size: 0.04, at: 3 },
        { text: '* * * *    7        30 s          helicopter', size: 0.04, at: 4 },
        { text: '* * * * *  9        40 s', size: 0.04, at: 5 },
        { text: 'My own design. Not from the patent, not from GTA.', size: 0.028, color: GREY, at: 9, gap: 1.6 },
      ],
      { label: 'THE POLICE RULES IN MY SIM', typeRate: 90 },
    ),
  },
  {
    id: 'L5-04',
    section: 'Loop 5: how the police find you',
    kind: 'sim',
    stage: hideFromSearchers,
    vo: "Here's a two star chase where the police only know what they can see. Watch the question mark. That's where they think I am. They're heading there, and I'm not.",
    onScreen: 'Police converge on the question mark while the car sits parked nearby.',
    tag: 'My sim',
    warmup: 3,
    seconds: 15,
  },
  {
    id: 'L5-05',
    section: 'Loop 5: how the police find you',
    kind: 'sim',
    stage: hideFromPsychics,
    vo: 'Now the same chase with the kind of police Rockstar described. Psychic police. No question mark, no search. Every unit knows exactly where I parked.',
    onScreen: 'Same start, same car. Police drive straight to it.',
    tag: ['Rockstar', 'My sim'],
    warmup: 3,
    seconds: 15,
  },
  {
    id: 'L5-06',
    section: 'Loop 5: how the police find you',
    kind: 'sim',
    stage: chase({ stars: 5, flee: 'highway', cops: 'roadblock' }, 1.25, 40),
    vo: 'At four stars a helicopter joins in. It sees over buildings, but not under the highway.',
    onScreen: 'Five stars: units, a roadblock, and the helicopter circling.',
    tag: 'My sim',
    warmup: 12,
    seconds: 10,
  },
  {
    id: 'L5-07',
    section: 'Loop 5: how the police find you',
    kind: 'card',
    vo: 'I came up with five ways to run. Head for the highway. Floor it in a straight line. Break line of sight and keep moving. Turn at every junction. Or break line of sight and hide. Pick one now.',
    onScreen: 'The five plans, listed one by one. Hold on the full list.',
    tag: 'My sim',
    draw: textCard(
      [
        { text: '1  Head for the highway', size: 0.05, at: 2.2 },
        { text: '2  Floor it in a straight line', size: 0.05, at: 4, gap: 0.7 },
        { text: '3  Break line of sight, keep moving', size: 0.05, at: 6, gap: 0.7 },
        { text: '4  Turn at every junction', size: 0.05, at: 9, gap: 0.7 },
        { text: '5  Break line of sight, then hide', size: 0.05, at: 11, gap: 0.7 },
      ],
      { label: 'FIVE WAYS TO RUN', typeRate: 60 },
    ),
  },

  // ------------------------------------------------------------------ loop 6
  {
    id: 'L6-01',
    section: 'Loop 6: the experiment',
    kind: 'sim',
    stage: chase({ stars: 5, flee: 'highway', cops: 'roadblock' }, 1.3, 43),
    vo: 'Then I ran all five, against three police tactics, at every star level. Once against psychic police and once against police who have to search. Six thousand chases, same starting points for both.',
    onScreen: 'A five-star chase at double speed, ending in a capture.',
    tag: 'My sim',
    seconds: 17,
    speed: 2,
  },
  {
    id: 'L6-02',
    section: 'Loop 6: the experiment',
    kind: 'chart',
    vo: 'Psychic police first. One star is easy. By five stars you get away about two percent of the time.',
    onScreen: 'Chart: escape rate by stars. The psychic line draws in.',
    tag: 'My sim',
    chart: (t) => reveal(knowledgeChart, t, [null, 1.2], 4),
  },
  {
    id: 'L6-03',
    section: 'Loop 6: the experiment',
    kind: 'chart',
    vo: "Make them search and five stars goes from two percent to about sixteen. Still brutal, but now it's possible.",
    onScreen: 'Same chart. The searching line draws in above it.',
    tag: 'My sim',
    chart: (t) => reveal(knowledgeChart, t, [0.8, -10], 4),
  },
  {
    id: 'L6-04',
    section: 'Loop 6: the experiment',
    kind: 'chart',
    vo: 'The bigger change is hiding. At two stars, hiding from psychic police works eight percent of the time. Against police who have to search, about sixty.',
    onScreen: 'Chart: hiding only. Psychic line first, then the searching line.',
    tag: 'My sim',
    chart: (t) => reveal(hideChart, t, [6.5, 1.5], 3),
  },
  {
    id: 'L6-05',
    section: 'Loop 6: the experiment',
    kind: 'sim',
    stage: hideFromSearchers,
    vo: "That's a whole way of playing that only exists because of one design decision. If the police always know where you are, there's no such thing as hiding.",
    onScreen: 'The parked car waits while police search the wrong spot. The timer runs out: escaped.',
    tag: 'My sim',
    warmup: 12,
    seconds: 14,
    speed: 1.25,
  },
  {
    id: 'L6-06',
    section: 'Loop 6: the experiment',
    kind: 'chart',
    vo: "Here's the twist though. Even with police who search, hiding is the worst plan from two stars up. At four and five stars it never worked once. The best plan at every level was the highway. Forty one percent at five stars.",
    onScreen: 'Chart: all five plans against searching police. Hiding draws in last, underneath everything.',
    tag: 'My sim',
    // Series order in the chart: straight, highway, weave, hide, run.
    chart: (t) => reveal(strategyChart, t, [9, 11, 7, 2.5, 8], 2.5),
  },
  {
    id: 'L6-07',
    section: 'Loop 6: the experiment',
    kind: 'sim',
    stage: chase({ stars: 3, flee: 'hide', cops: 'chase', knowledge: 'search' }, 1.5, 42),
    vo: 'The reason is how they search. They sweep outward from the last place they saw you, so a car parked near that spot gets found before the timer runs out. Distance beats cover.',
    onScreen: 'Three stars. The car parks, the search ring spreads out from the question mark, and a unit finds it.',
    tag: 'My sim',
    warmup: 4,
    speed: 1.3,
  },
  {
    id: 'L6-08',
    section: 'Loop 6: the experiment',
    kind: 'chart',
    vo: "My car is slightly faster than the police, so I checked that wasn't the whole story. I reran it with police slower than me and faster than me. The ranking didn't flip.",
    onScreen: 'Chart: escape rate against police speed. Highway lines stay above hiding lines all the way across.',
    tag: 'My sim',
    chart: (t) => reveal(sweepChart, t, [4, 5, 7, 8], 2.5),
  },
  {
    id: 'L6-09',
    section: 'Loop 6: the experiment',
    kind: 'card',
    vo: 'One big caveat. These are rules and numbers I picked. This is a result about my simulation, not about GTA.',
    onScreen: 'The caveat as plain text.',
    tag: 'My sim',
    draw: textCard(
      [
        { text: 'A result about my simulation.', size: 0.06, at: 1.5 },
        { text: 'Not about GTA.', size: 0.06, at: 5, gap: 0.5 },
      ],
      { typeRate: 30 },
    ),
  },

  // ------------------------------------------------------------------ close
  {
    id: 'C-01',
    section: 'Close',
    kind: 'sim',
    stage: '4b',
    vo: "So that's what I found. Traffic is mostly cars with nowhere to be, living in a bubble that follows you around. And police that have to search are what make hiding possible at all.",
    onScreen: 'The bubble drifting through the empty city.',
    tag: 'My sim',
    hud: 'none',
    warmup: 30,
    speed: 2,
    cam: { mode: 'follow', zoom: 0.6 },
  },
  {
    id: 'C-02',
    section: 'Close',
    kind: 'card',
    vo: 'Everything here came from a public patent, what modders have documented, and my own rebuild. Rockstar has never said this patent is in any GTA game.',
    onScreen: 'The three sources, and the caveat.',
    draw: textCard(
      [
        { text: 'A public patent: US 11,071,916', size: 0.04, at: 0.5 },
        { text: 'What modders documented from the older games', size: 0.04, at: 3, gap: 0.8 },
        { text: 'My own 2D rebuild and 6,000 simulated chases', size: 0.04, at: 5, gap: 0.8 },
        { text: 'Rockstar has not said this patent is used in any game.', size: 0.03, color: GREY, at: 7.5, gap: 1.8 },
      ],
      { label: 'SOURCES', typeRate: 60 },
    ),
  },
  {
    id: 'C-03',
    section: 'Close',
    kind: 'sim',
    stage: chase({ stars: 5, flee: 'highway', cops: 'roadblock' }, 1.0, 45),
    vo: 'The whole thing runs in your browser and the code is open. Links and every source are in the description. See if you can beat forty one percent.',
    onScreen: 'A five-star highway run that gets away. End screen goes over this.',
    tag: 'My sim',
    warmup: 92,
    seconds: 26,
  },
];
