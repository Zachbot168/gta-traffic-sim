// How much does the escape ranking depend on how fast the police are?
//
//   npm run sweep -- <chases per point>
//
// Reruns three escape strategies at three and five stars while the police top speed
// goes from slower than the hero (1.6x the limit) to faster. Same seeded starts as
// the main experiment. Writes data/pace-sweep.csv and src/app/pace-sweep.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Chase, HERO_PACE, type FleeStrategy } from '../src/sim/chase';
import { generateCity } from '../src/sim/mapgen';
import { Occlusion } from '../src/sim/occlusion';
import { Rng } from '../src/sim/rng';
import { World } from '../src/sim/world';

const DT = 1 / 30;
const perPoint = Number(process.argv[2] ?? 40);
const PACES = [1.3, 1.5, 1.7, 1.9];
const FLEE: FleeStrategy[] = ['highway', 'run', 'hide'];
const STARS = [3, 5];

const map = generateCity('city', 1);
const occlusion = new Occlusion(map.graph);
const ground = map.graph.nodes.filter((n) => {
  const b = map.bounds;
  const fx = (n.x - b.minX) / (b.maxX - b.minX);
  const fy = (n.y - b.minY) / (b.maxY - b.minY);
  return n.level === 0 && fx > 0.2 && fx < 0.8 && fy > 0.2 && fy < 0.8;
});

const rows = ['stars,flee,copPace,seed,outcome,seconds'];
const summary: { stars: number; flee: string; copPace: number; escapeRate: number; n: number }[] = [];
const started = Date.now();
for (const stars of STARS) {
  for (const flee of FLEE) {
    for (const copPace of PACES) {
      let escaped = 0;
      for (let seed = 1; seed <= perPoint; seed++) {
        const start = ground[new Rng(seed * 7919).int(ground.length)]!;
        const world = new World(map, 1000 + seed, { spawn: 'path', routing: 'coarse', tripShare: 0.3, density: 1 });
        world.addHero(start.x, start.y);
        world.fillBubble();
        for (let i = 0; i < 5 / DT; i++) world.step(DT);
        const chase = new Chase(world, { stars, flee, cops: 'chase', copPace }, occlusion);
        while (chase.outcome === 'running') world.step(DT);
        if (chase.outcome === 'escaped') escaped++;
        rows.push([stars, flee, copPace, seed, chase.outcome, chase.elapsed.toFixed(1)].join(','));
      }
      const escapeRate = Math.round((1000 * escaped) / perPoint) / 10;
      summary.push({ stars, flee, copPace, escapeRate, n: perPoint });
      console.log(`stars=${stars} ${flee.padEnd(8)} police ${copPace}x: ${escapeRate}%  (${((Date.now() - started) / 1000).toFixed(0)}s)`);
    }
  }
}
mkdirSync('data', { recursive: true });
writeFileSync('data/pace-sweep.csv', rows.join('\n') + '\n');
writeFileSync('src/app/pace-sweep.json', JSON.stringify({ heroPace: HERO_PACE, paces: PACES, points: summary }, null, 2) + '\n');
