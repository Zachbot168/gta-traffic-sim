// Longer runs: does the bubble stay healthy, and does radial counting starve streets near the highway?
import { generateCity } from '../src/sim/mapgen';
import { World, type SpawnMode } from '../src/sim/world';
const DT = 1 / 30;

function run(mode: SpawnMode, pinned: boolean, seed: number, density = 1) {
  const map = generateCity('city', 1);
  const w = new World(map, seed, { spawn: mode, routing: 'coarse', density });
  const hy = map.highwayY!;
  if (pinned) w.pinFocus(1700, hy);
  else w.addHero(1700, hy - 250);
  w.fillBubble();
  const series: string[] = [];
  let near = 0, far = 0, hw = 0, n = 0;
  for (let i = 1; i <= 600 / DT; i++) {
    w.step(DT);
    if (i % (60 / DT) === 0) {
      const mean = w.vehicles.reduce((a, v) => a + v.v, 0) / Math.max(1, w.vehicles.length);
      series.push(`${w.vehicles.length}@${mean.toFixed(1)}`);
    }
    if (i % 30 === 0 && i > 60 / DT) {
      n++;
      for (const v of w.vehicles) {
        const cls = w.graph.links[v.link]!.cls;
        if (cls === 'highway') hw++;
        else if (cls === 'street' || cls === 'arterial') {
          if (Math.abs(v.y - hy) < 60) near++;
          else far++;
        }
      }
    }
  }
  console.log(`${mode} ${pinned ? 'pinned' : 'follow'} seed=${seed} d=${density}: cars@meanSpeed per minute: ${series.join(' ')}`);
  console.log(`   avg ground cars within 60m of highway=${(near / n).toFixed(1)} elsewhere=${(far / n).toFixed(1)} on highway=${(hw / n).toFixed(1)}`);
}
for (const seed of [42, 7, 3]) {
  run('radial', true, seed);
  run('path', true, seed);
}
run('path', false, 42);
run('path', false, 7);
run('path', false, 7, 1.5);
