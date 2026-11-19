// @vitest-environment jsdom
// Boots the real browser front end against a headless canvas and presses every control,
// to catch crashes in the page code that the sim tests can't see.
import { createCanvas } from '@napi-rs/canvas';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { STAGES } from '../src/app/stages';

let runFrames: (n: number) => void;

beforeAll(async () => {
  document.body.innerHTML = '<canvas id="view"></canvas><div id="hud"></div><div id="bar"></div>';
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
  const backing = createCanvas(1280, 720);
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  canvas.getContext = (() => backing.getContext('2d')) as unknown as HTMLCanvasElement['getContext'];
  canvas.setPointerCapture = () => {};

  let pending: FrameRequestCallback | null = null;
  let now = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending = cb;
    return 1;
  });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  runFrames = (n) => {
    for (let i = 0; i < n; i++) {
      now += 1000 / 60;
      const cb = pending;
      pending = null;
      cb?.(now);
    }
  };
  await import('../src/app/main');
});

const press = (key: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key }));
const hudText = () => document.getElementById('hud')!.textContent ?? '';

describe('browser front end', { timeout: 240_000 }, () => {
  it('starts on the first stage and draws', () => {
    runFrames(30);
    expect(hudText()).toContain(STAGES[0]!.title);
    expect(document.querySelectorAll('#bar button').length).toBeGreaterThan(STAGES.length);
  });

  it('steps through every stage without crashing', () => {
    for (const stage of STAGES.slice(1)) {
      // '.' always means next stage. The arrow keys steer on the manual-driving stage.
      press('.');
      runFrames(12);
      expect(hudText()).toContain(stage.title);
    }
  });

  it('survives every control on a bubble stage and a route stage', () => {
    for (const key of ['4', '3', '6']) {
      press(key);
      runFrames(10);
      for (const k of ['g', 'c', 'b', 's', 'f', 'm', 'm', 'p', '-', '+', 'r', 't', 't', 'w', 'u', 'u', 'y', 'k', 'o', 'x', ']', '[', ' ', ' ', '0', 'h', 'Escape']) {
        press(k);
        runFrames(7);
      }
    }
    expect(hudText().length).toBeGreaterThan(20);
  });

  it('shows the wanted level and a result once a chase is running', () => {
    document.querySelectorAll<HTMLButtonElement>('#bar button').forEach((b) => {
      if (b.textContent === '6a') b.click();
    });
    runFrames(20);
    expect(hudText()).toContain('Wanted');
    expect(hudText()).toMatch(/IN SIGHT|hidden|ESCAPED|CAUGHT/);
    // Manual driving: arrow keys steer instead of changing stage.
    for (let i = 0; i < 3; i++) press('k'); // weave -> hide -> run -> manual
    runFrames(8);
    expect(hudText()).toContain('Manual driving');
    press('ArrowLeft');
    runFrames(10);
    expect(hudText()).toContain('6a');
  });

  it('reports the coarse search as cheaper and the route as identical', () => {
    document.querySelectorAll<HTMLButtonElement>('#bar button').forEach((b) => {
      if (b.textContent === '3b') b.click();
    });
    press(']');
    press(']');
    press(']');
    runFrames(150);
    const text = hudText();
    expect(text).toContain('identical');
    expect(text).toMatch(/Work saved\s*\d+(\.\d+)?x fewer nodes/);
  });
});
