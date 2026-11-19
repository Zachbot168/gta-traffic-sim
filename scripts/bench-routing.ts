// Chapter 3 chart data: how much work a route search does on the full graph vs the coarse graph,
// as the city grows. Writes out/routing-bench.csv.
import { mkdirSync, writeFileSync } from 'node:fs';
import { CoarseGraph } from '../src/sim/coarse';
import { generateCityFromParams, SCALE_PRESETS } from '../src/sim/mapgen';
import { Rng } from '../src/sim/rng';
import { routeFull } from '../src/sim/route';

const SIZES: [number, number][] = [
  [6, 6],
  [11, 9],
  [20, 14],
  [28, 20],
  [38, 27],
  [54, 38],
  [76, 54],
];
const TRIPS = 400;

const rows = ['intersections,nodes_full,nodes_coarse,avg_searched_full,avg_searched_coarse,times_less_work,routes_identical,ms_per_route_full,ms_per_route_coarse'];
for (const [cols, rowsN] of SIZES) {
  const map = generateCityFromParams({ ...SCALE_PRESETS.city, cols, rows: rowsN, seed: 1 });
  const g = map.graph;
  const coarse = new CoarseGraph(g);
  const rng = new Rng(99);
  const pairs = Array.from({ length: TRIPS }, () => [rng.int(g.nodes.length), rng.int(g.nodes.length)] as const);

  let full = 0;
  let fast = 0;
  let same = 0;
  let t = performance.now();
  const fullRoutes = pairs.map(([a, b]) => routeFull(g, a, b));
  const fullMs = (performance.now() - t) / TRIPS;
  t = performance.now();
  const fastRoutes = pairs.map(([a, b]) => coarse.route(a, b));
  const fastMs = (performance.now() - t) / TRIPS;
  for (let i = 0; i < TRIPS; i++) {
    full += fullRoutes[i]!.expanded;
    fast += fastRoutes[i]!.expanded;
    if (fullRoutes[i]!.nodes.join() === fastRoutes[i]!.nodes.join()) same++;
  }
  rows.push(
    [cols * rowsN, g.nodes.length, coarse.forks.length, (full / TRIPS).toFixed(0), (fast / TRIPS).toFixed(0), (full / fast).toFixed(1), `${same}/${TRIPS}`, fullMs.toFixed(3), fastMs.toFixed(3)].join(','),
  );
}
mkdirSync('out', { recursive: true });
writeFileSync('out/routing-bench.csv', rows.join('\n') + '\n');
// The same numbers as JSON, for the chart in the app.
const json = rows.slice(1).map((r) => {
  const c = r.split(',');
  return { intersections: Number(c[0]), nodesFull: Number(c[1]), nodesCoarse: Number(c[2]), searchedFull: Number(c[3]), searchedCoarse: Number(c[4]) };
});
writeFileSync('src/app/routing-bench.json', JSON.stringify(json, null, 2) + '\n');
console.log(rows.join('\n'));
