/**
 * Driver performance curves, the way the patent describes them.
 *
 * Instead of running real physics for every traffic car, each kind of vehicle is
 * taken to a test track once: floor it from a standstill, and take corners of
 * different radii faster and faster until it slides. The measurements are then
 * boiled down to a curve with just three numbers,
 *
 *     y = a + b * exp(-c * x)
 *
 * stored per vehicle, per surface condition. At run time a car only evaluates the curve.
 */

export type Weather = 'dry' | 'rain';
export const WEATHERS: Weather[] = ['dry', 'rain'];

/** Tyre grip (friction coefficient) on the road in each condition. */
export const GRIP: Record<Weather, number> = { dry: 0.9, rain: 0.55 };

const GRAVITY = 9.81;
const AIR_DENSITY = 1.2;
/** Drivers corner at a fraction of the true sliding limit. */
const CORNER_COMFORT = 0.8;

/** The "real" car used on the test track. Traffic never sees these numbers directly. */
export interface CarSpec {
  name: string;
  mass: number;
  /** Engine power, watts. */
  power: number;
  /** Drag coefficient times frontal area, m^2. */
  dragArea: number;
  /** Share of the weight on the driven wheels. */
  traction: number;
  /** Speed the car is geared for, m/s. */
  topSpeed: number;
  /** How well its tyres and suspension hold a corner, relative to an ordinary car. */
  handling: number;
}

export const CAR_SPECS: CarSpec[] = [
  { name: 'sedan', mass: 1500, power: 110_000, dragArea: 0.7, traction: 0.5, topSpeed: 50, handling: 1 },
  { name: 'sports', mass: 1400, power: 300_000, dragArea: 0.6, traction: 0.62, topSpeed: 75, handling: 1.2 },
  { name: 'van', mass: 2300, power: 105_000, dragArea: 1.2, traction: 0.5, topSpeed: 42, handling: 0.88 },
  { name: 'truck', mass: 9000, power: 230_000, dragArea: 5, traction: 0.55, topSpeed: 32, handling: 0.72 },
];

export interface Curve {
  a: number;
  b: number;
  c: number;
}

export const evalCurve = (k: Curve, x: number): number => k.a + k.b * Math.exp(-k.c * x);

export interface Sample {
  x: number;
  y: number;
}

export interface Performance {
  /** Speed (m/s) reached t seconds into a full-throttle run from a standstill. */
  launch: Curve;
  /** Fastest comfortable speed (m/s) as a function of corner radius (m). */
  corner: Curve;
  /** The raw track measurements the curves were fitted to, kept for the charts. */
  launchSamples: Sample[];
  cornerSamples: Sample[];
  /** Root-mean-square error of each fit, in m/s. */
  launchError: number;
  cornerError: number;
}

/**
 * Acceleration available at a given speed, read off the launch curve.
 * If v(t) = a + b*exp(-c*t), then dv/dt = c * (a - v): the closer to top speed, the less is left.
 */
export const accelAt = (p: Performance, v: number): number => Math.max(0.05, p.launch.c * (p.launch.a - v));

/** Physics model used only on the test track. */
function trackAccel(car: CarSpec, grip: number, v: number): number {
  const tractionLimit = grip * GRAVITY * car.traction;
  const engine = car.power / (car.mass * Math.max(v, 2));
  const drag = (0.5 * AIR_DENSITY * car.dragArea * v * v) / car.mass + 0.12;
  return Math.min(tractionLimit, engine) - drag;
}

/** Test 1: full throttle from a standstill for 40 seconds, logging speed against time. */
function launchRun(car: CarSpec, grip: number): Sample[] {
  const samples: Sample[] = [];
  const dt = 0.05;
  let v = 0;
  for (let step = 0; step <= 800; step++) {
    if (step % 20 === 0) samples.push({ x: step * dt, y: v });
    v = Math.min(car.topSpeed, v + Math.max(0, trackAccel(car, grip, v)) * dt);
  }
  return samples;
}

/** Test 2: for each corner radius, speed up lap by lap until the tyres let go. */
function corneringRun(car: CarSpec, grip: number): Sample[] {
  const samples: Sample[] = [];
  for (const radius of [5, 7, 9, 12, 16, 21, 28, 36, 46, 58, 72, 90, 115, 150]) {
    let v = 1;
    while (v < car.topSpeed * 0.75 && ((v + 0.25) ** 2) / radius <= grip * car.handling * GRAVITY * CORNER_COMFORT) v += 0.25;
    samples.push({ x: radius, y: v });
  }
  return samples;
}

/**
 * Least-squares fit of y = a + b*exp(-c*x). For any fixed c the best a and b come
 * from ordinary linear regression, so we only have to search over c.
 */
export function fitOffsetExponential(samples: Sample[]): { curve: Curve; error: number } {
  const solve = (c: number): { curve: Curve; sse: number } => {
    let n = 0;
    let sz = 0;
    let szz = 0;
    let sy = 0;
    let szy = 0;
    for (const s of samples) {
      const z = Math.exp(-c * s.x);
      n++;
      sz += z;
      szz += z * z;
      sy += s.y;
      szy += z * s.y;
    }
    const det = n * szz - sz * sz;
    const b = Math.abs(det) < 1e-12 ? 0 : (n * szy - sz * sy) / det;
    const a = (sy - b * sz) / n;
    let sse = 0;
    for (const s of samples) sse += (a + b * Math.exp(-c * s.x) - s.y) ** 2;
    return { curve: { a, b, c }, sse };
  };

  // Coarse scan across several orders of magnitude, then narrow in around the best.
  let lo = 1e-4;
  let hi = 3;
  let best = solve(lo);
  for (let pass = 0; pass < 4; pass++) {
    const steps = 80;
    let bestC = best.curve.c;
    for (let i = 0; i <= steps; i++) {
      const c = lo * Math.pow(hi / lo, i / steps);
      const trial = solve(c);
      if (trial.sse < best.sse) {
        best = trial;
        bestC = c;
      }
    }
    const span = Math.pow(hi / lo, 2 / steps);
    lo = bestC / span;
    hi = bestC * span;
  }
  return { curve: best.curve, error: Math.sqrt(best.sse / samples.length) };
}

function measure(car: CarSpec, weather: Weather): Performance {
  const launchSamples = launchRun(car, GRIP[weather]);
  const cornerSamples = corneringRun(car, GRIP[weather]);
  const launch = fitOffsetExponential(launchSamples);
  const corner = fitOffsetExponential(cornerSamples);
  return {
    launch: launch.curve,
    corner: corner.curve,
    launchSamples,
    cornerSamples,
    launchError: launch.error,
    cornerError: corner.error,
  };
}

/** PERFORMANCE[vehicle type][weather]: measured once, when the sim loads. */
export const PERFORMANCE: Record<Weather, Performance>[] = CAR_SPECS.map((car) => ({
  dry: measure(car, 'dry'),
  rain: measure(car, 'rain'),
}));
