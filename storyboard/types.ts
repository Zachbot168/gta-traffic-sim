/**
 * The storyboard: one entry per shot in the video. Each shot carries the line that
 * is spoken over it and everything needed to render its clip, so the script and the
 * footage cannot drift apart.
 */
import type { Scene, Stage } from '../src/app/stages';
import type { ChartSpec } from '../src/render/charts';
import type { Overlays } from '../src/render/render';

export type Tag = 'Rockstar' | 'Patent' | 'Modders' | 'My sim';

/** Where the camera is. Zooms are authored for a 1280px-wide frame, like the stage presets. */
export type Cam =
  | { mode: 'fit'; margin?: number }
  | { mode: 'follow'; zoom: number }
  | { mode: 'focus'; zoom: number }
  /** A point on the map, as fractions of its width and height. */
  | { mode: 'point'; fx: number; fy: number; zoom: number }
  | { mode: 'at'; x: number; y: number; zoom: number };

/** A camera move between two framings, eased, between two times in seconds. */
export interface CamMove {
  from: Cam;
  to: Cam;
  start: number;
  end: number;
}

export interface SimEvent {
  /** Seconds into the clip. */
  at: number;
  run(scene: Scene): void;
}

export type Hud = 'chase' | 'search' | 'cars' | 'spawns' | 'none';

interface Base {
  /** File name of the clip, and the shot's name in the storyboard. */
  id: string;
  section: string;
  /** The line spoken over this shot. */
  vo: string;
  /** What the viewer sees, for the storyboard. */
  onScreen: string;
  tag?: Tag | Tag[];
  /** Clip length. Defaults to the time the line takes at a relaxed pace, plus a beat. */
  seconds?: number;
}

export interface SimShot extends Base {
  kind: 'sim';
  /** A stage key, or a custom stage built for this shot. */
  stage: string | Stage;
  /** Start from the previous shot's world instead of rebuilding it. */
  continues?: boolean;
  /** Simulated seconds to run before the clip starts. */
  warmup?: number;
  /** Simulated seconds per second of video. */
  speed?: number;
  cam?: Cam | CamMove;
  overlays?: Partial<Overlays>;
  hud?: Hud;
  /** Multiplies how fast a route search replays. */
  searchSpeed?: number;
  events?: SimEvent[];
}

export interface SplitShot extends Base {
  kind: 'split';
  left: { stage: string | Stage; label: string };
  right: { stage: string | Stage; label: string };
  warmup?: number;
  speed?: number;
}

export interface ChartShot extends Base {
  kind: 'chart';
  /** The chart at time t (seconds into the clip), so lines can draw in. */
  chart(t: number): ChartSpec;
}

export interface CardShot extends Base {
  kind: 'card';
  draw(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void;
}

export type Shot = SimShot | SplitShot | ChartShot | CardShot;

/** Relaxed narration is about 2.5 words a second. */
export const WORDS_PER_SECOND = 2.5;

export function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function duration(shot: Shot): number {
  return shot.seconds ?? Math.max(4, Math.ceil(words(shot.vo) / WORDS_PER_SECOND + 1.2));
}
