// Finds seeds that give a particular kind of chase, for picking shots to record.
//   npx tsx scripts/scout.ts <stars> <flee> <cops> <knowledge> <firstSeed> <lastSeed>
import { STAGES, buildScene, cityChase } from '../src/app/stages';
import type { ChaseConfig } from '../src/sim/chase';

const [stars, flee, cops, knowledge, a, b] = process.argv.slice(2);
const base = STAGES.find((s) => s.key === '6b')!;
for (let seed = Number(a); seed <= Number(b); seed++) {
  const scene = buildScene({ ...base, build: cityChase({ stars: Number(stars), flee, cops, knowledge } as Partial<ChaseConfig>, 1.6, seed) });
  const c = scene.chase!;
  let lost = -1;
  let found = -1;
  let longestHidden = 0;
  while (c.outcome === 'running') {
    scene.world.step(1 / 30);
    if (!c.seen && lost < 0 && c.elapsed > 2) lost = c.elapsed;
    if (c.seen && lost >= 0 && found < 0 && c.elapsed > lost + 3) found = c.elapsed;
    longestHidden = Math.max(longestHidden, c.hiddenFor);
  }
  console.log(`seed ${seed}: ${c.outcome} at ${c.elapsed.toFixed(0)}s, first lost sight ${lost.toFixed(0)}s, seen again ${found.toFixed(0)}s, longest hidden ${longestHidden.toFixed(0)}s, health ${c.health.toFixed(0)}`);
}
