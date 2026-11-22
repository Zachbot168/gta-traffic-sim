// The chapter 6 experiment: thousands of simulated police chases.
//
//   npm run chases -- <chases per configuration> [shard/of]   run (part of) the experiment
//   npm run chases -- 40 0/2 psychic                          only one kind of police knowledge
//   npm run chases -- --merge                                 combine shard files into the results
//
// A configuration is one star level x one escape strategy x one police strategy.
// Every configuration is run from the same set of seeded starting points, so strategies
// are compared on identical situations.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Chase, COP_STRATEGIES, FLEE_STRATEGIES, KNOWLEDGE, type CopStrategy, type FleeStrategy, type Knowledge } from '../src/sim/chase';
import { generateCity } from '../src/sim/mapgen';
import { Occlusion } from '../src/sim/occlusion';
import { Rng } from '../src/sim/rng';
import { World } from '../src/sim/world';

const DT = 1 / 30;
const HEADER = 'knowledge,stars,flee,cops,seed,outcome,seconds,health,end';

if (process.argv.includes('--merge')) merge();
else run();

function run(): void {
  const perConfig = Number(process.argv[2] ?? 40);
  const [shard, of] = (process.argv[3] ?? '0/1').split('/').map(Number) as [number, number];
  const kinds = process.argv[4] ? [process.argv[4] as Knowledge] : KNOWLEDGE;
  const map = generateCity('city', 1);
  const occlusion = new Occlusion(map.graph);
  const ground = map.graph.nodes.filter((n) => {
    const b = map.bounds;
    const fx = (n.x - b.minX) / (b.maxX - b.minX);
    const fy = (n.y - b.minY) / (b.maxY - b.minY);
    return n.level === 0 && fx > 0.2 && fx < 0.8 && fy > 0.2 && fy < 0.8;
  });

  const rows: string[] = [HEADER];
  const started = Date.now();
  let done = 0;
  let index = 0;
  for (const knowledge of kinds)
  for (let stars = 1; stars <= 5; stars++) {
    for (const flee of FLEE_STRATEGIES) {
      for (const cops of COP_STRATEGIES) {
        if (index++ % of !== shard) continue;
        for (let seed = 1; seed <= perConfig; seed++) {
          const start = ground[new Rng(seed * 7919).int(ground.length)]!;
          const world = new World(map, 1000 + seed, { spawn: 'path', routing: 'coarse', tripShare: 0.3, density: 1 });
          world.addHero(start.x, start.y);
          world.fillBubble();
          // Let traffic settle for a few seconds before the crime happens.
          for (let i = 0; i < 5 / DT; i++) world.step(DT);
          const chase = new Chase(world, { stars, flee, cops, knowledge }, occlusion);
          while (chase.outcome === 'running') world.step(DT);
          const end = chase.outcome === 'caught' ? (chase.health <= 0 ? 'shot' : 'pinned') : chase.outcome;
          rows.push([knowledge, stars, flee, cops, seed, chase.outcome, chase.elapsed.toFixed(1), Math.max(0, chase.health).toFixed(0), end].join(','));
          done++;
        }
        console.log(`[${shard}/${of}] ${knowledge} stars=${stars} ${flee} vs ${cops}: ${done} chases, ${((Date.now() - started) / 1000).toFixed(0)}s`);
        mkdirSync('out', { recursive: true });
        writeFileSync(`out/chases-${kinds.join('+')}-${shard}-of-${of}.csv`, rows.join('\n') + '\n');
      }
    }
  }
}

interface Cell {
  n: number;
  escaped: number;
  caught: number;
  timeout: number;
  escapeSeconds: number;
}

function merge(): void {
  const files = existsSync('out') ? readdirSync('out').filter((f) => /^chases-.*\.csv$/.test(f)) : [];
  if (files.length === 0) throw new Error('No shard files in out/. Run the experiment first.');
  const rows = files.flatMap((f) => readFileSync(`out/${f}`, 'utf8').trim().split('\n').slice(1));
  rows.sort();
  mkdirSync('data', { recursive: true });
  writeFileSync('data/chase-results.csv', [HEADER, ...rows].join('\n') + '\n');

  const cell = (): Cell => ({ n: 0, escaped: 0, caught: 0, timeout: 0, escapeSeconds: 0 });
  const add = (c: Cell, outcome: string, seconds: number) => {
    c.n++;
    if (outcome === 'escaped') {
      c.escaped++;
      c.escapeSeconds += seconds;
    } else if (outcome === 'caught') c.caught++;
    else c.timeout++;
  };
  const rate = (c: Cell) => (c.n ? Math.round((1000 * c.escaped) / c.n) / 10 : 0);
  const five = [1, 2, 3, 4, 5];
  const summarise = (kind: Knowledge) => {
    const byFlee: Record<string, Cell[]> = {};
    const byCops: Record<string, Cell[]> = {};
    const overall: Cell[] = [0, 1, 2, 3, 4, 5].map(cell);
    for (const f of FLEE_STRATEGIES) byFlee[f] = [0, 1, 2, 3, 4, 5].map(cell);
    for (const c of COP_STRATEGIES) byCops[c] = [0, 1, 2, 3, 4, 5].map(cell);
    let n = 0;
    for (const row of rows) {
      const [knowledge, stars, flee, cops, , outcome, seconds] = row.split(',') as [Knowledge, string, FleeStrategy, CopStrategy, string, string, string];
      if (knowledge !== kind) continue;
      n++;
      add(byFlee[flee]![Number(stars)]!, outcome, Number(seconds));
      add(byCops[cops]![Number(stars)]!, outcome, Number(seconds));
      add(overall[Number(stars)]!, outcome, Number(seconds));
    }
    return {
      chases: n,
      escapeRateByFlee: Object.fromEntries(FLEE_STRATEGIES.map((f) => [f, five.map((s) => rate(byFlee[f]![s]!))])),
      escapeRateByCops: Object.fromEntries(COP_STRATEGIES.map((c) => [c, five.map((s) => rate(byCops[c]![s]!))])),
      escapeRate: five.map((s) => rate(overall[s]!)),
      meanEscapeSeconds: five.map((s) => (overall[s]!.escaped ? Math.round((10 * overall[s]!.escapeSeconds) / overall[s]!.escaped) / 10 : null)),
      samplesPerPoint: { byFlee: byFlee[FLEE_STRATEGIES[0]!]![1]!.n, byCops: byCops[COP_STRATEGIES[0]!]![1]!.n },
    };
  };
  const search = summarise('search');
  const psychic = summarise('psychic');
  // The top-level fields are the police-have-to-search results, which is the main experiment.
  const summary = { ...search, chases: rows.length, stars: five, searchChases: search.chases, psychic };
  writeFileSync('src/app/chase-results.json', JSON.stringify(summary, null, 2) + '\n');
  console.log(`${rows.length} chases merged`);
  console.log('escape rate % by stars 1..5');
  for (const f of FLEE_STRATEGIES) console.log(`  ${f.padEnd(9)} ${summary.escapeRateByFlee[f]!.map((r) => String(r).padStart(6)).join('')}`);
  for (const c of COP_STRATEGIES) console.log(`  vs ${c.padEnd(9)} ${summary.escapeRateByCops[c]!.map((r) => String(r).padStart(6)).join('')}`);
  console.log(`  overall   ${summary.escapeRate.map((r) => String(r).padStart(6)).join('')}`);
}
