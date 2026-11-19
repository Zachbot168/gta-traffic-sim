/**
 * Line of sight. The city blocks between roads are treated as solid buildings:
 * you can see along a street and across a junction, but not through a block.
 *
 * Roads are stamped into a coarse bitmap once; a sight line is clear if every
 * cell it crosses is road.
 */
import { ROAD_SPECS, type RoadGraph } from './graph';

const CELL = 4;
/** How far past the kerb you can still see (pavements, front yards). */
const MARGIN = 5;

export class Occlusion {
  private open: Uint8Array;
  private cols: number;
  private rows: number;
  private x0: number;
  private y0: number;

  constructor(graph: RoadGraph) {
    const b = graph.bounds();
    this.x0 = b.minX - 40;
    this.y0 = b.minY - 40;
    this.cols = Math.ceil((b.maxX - b.minX + 80) / CELL);
    this.rows = Math.ceil((b.maxY - b.minY + 80) / CELL);
    this.open = new Uint8Array(this.cols * this.rows);
    for (const l of graph.links) {
      const a = graph.nodes[l.a]!;
      const c = graph.nodes[l.b]!;
      const reach = Math.ceil((ROAD_SPECS[l.cls].width / 2 + MARGIN) / CELL);
      const steps = Math.max(1, Math.ceil(l.length / CELL));
      for (let i = 0; i <= steps; i++) {
        const cx = Math.floor((a.x + ((c.x - a.x) * i) / steps - this.x0) / CELL);
        const cy = Math.floor((a.y + ((c.y - a.y) * i) / steps - this.y0) / CELL);
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            if (dx * dx + dy * dy > reach * reach) continue;
            const x = cx + dx;
            const y = cy + dy;
            if (x >= 0 && y >= 0 && x < this.cols && y < this.rows) this.open[y * this.cols + x] = 1;
          }
        }
      }
    }
  }

  isOpen(x: number, y: number): boolean {
    const cx = Math.floor((x - this.x0) / CELL);
    const cy = Math.floor((y - this.y0) / CELL);
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows && this.open[cy * this.cols + cx] === 1;
  }

  /** True if nothing solid lies between the two points. */
  visible(ax: number, ay: number, bx: number, by: number): boolean {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(d / (CELL * 0.75));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!this.isOpen(ax + (bx - ax) * t, ay + (by - ay) * t)) return false;
    }
    return true;
  }

  /** How far you can see from a point in a direction, up to a limit. Used to draw vision cones. */
  rayLength(x: number, y: number, angle: number, max: number): number {
    const dx = Math.cos(angle) * CELL * 0.75;
    const dy = Math.sin(angle) * CELL * 0.75;
    const steps = Math.ceil(max / (CELL * 0.75));
    for (let i = 1; i <= steps; i++) {
      if (!this.isOpen(x + dx * i, y + dy * i)) return (i - 1) * CELL * 0.75;
    }
    return max;
  }
}
