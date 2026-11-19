// Renders one still per stage preset to out/frames, with no browser involved.
// Usage: npm run frames [-- <seconds> <stage keys...>]
import { createCanvas } from '@napi-rs/canvas';
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildScene, STAGES } from '../src/app/stages';
import { drawChart, layoutCharts } from '../src/render/charts';
import { fitCamera, Renderer, type Camera } from '../src/render/render';

const W = 1280;
const H = 720;
const DT = 1 / 30;
const seconds = Number(process.argv[2] ?? 45);
const only = process.argv.slice(3);

mkdirSync('out/frames', { recursive: true });
for (const stage of STAGES) {
  if (only.length && !only.includes(stage.key)) continue;
  const scene = buildScene(stage);
  for (let i = 0; i < seconds / DT; i++) scene.world.step(DT);
  if (scene.demo) scene.demo.revealed = Infinity;

  let cam: Camera;
  const f = scene.framing;
  if (f.kind === 'fit') cam = fitCamera(scene.map, W, H);
  else if (f.kind === 'follow') cam = { x: scene.world.hero!.x, y: scene.world.hero!.y, zoom: f.zoom };
  else cam = { x: f.x, y: f.y, zoom: f.zoom };

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
  new Renderer(scene.map, scene.world.coarse).draw(ctx, W, H, cam, scene.world, scene.overlays, scene.demo, scene.chase);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (scene.charts) {
    const rects = layoutCharts(scene.charts.length, W, H, 0, 0);
    scene.charts.forEach((chart, i) => drawChart(ctx, rects[i]!, chart));
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = '600 20px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`${stage.key}  ${stage.title}  (${scene.world.vehicles.length} cars, t=${seconds}s)`, 16, 14);
  writeFileSync(`out/frames/${stage.key}.png`, canvas.toBuffer('image/png'));
  console.log(`wrote out/frames/${stage.key}.png`);
}
