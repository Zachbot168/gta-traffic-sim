# GTA Traffic Sim

A 2D top-down city that rebuilds, piece by piece, the kind of traffic system open-world games use to make a city feel alive. Built for a YouTube video.

**What this is based on.** The routing and spawning ideas come from a public Take-Two patent, US 11,071,916 ("System and method for virtual navigation in a gaming environment"), plus what modders have documented about GTA V's data files. Rockstar has never confirmed what ships in any particular game, so treat this as "the system they patented", not a look inside GTA VI. No Rockstar code, art, or assets are used.

## What's in it so far

| Chapter | Idea | What you can toggle |
|---|---|---|
| 1 | A city is a graph of nodes and links | Graph overlay, car count |
| 2 | A* routing gives cars a destination | Search replay, routing on or off |
| 3 | The coarse graph: keep only the forks | Fork overlay, full vs coarse search |
| 4 | Traffic only exists in a bubble around the player | Bubble overlay, radial vs along-the-road density check |
| 5 | Every car drives from a three-number curve, per weather | Weather, curve charts |
| 6 | Police: vision cones, last known position, dispatch by stars | Stars, escape strategy, police tactic, manual driving |

The police numbers (units per star, hide timers, damage) and tactics are this project's own. Only the overall shape follows what is documented about GTA V.

## Run it

```
npm install
npm run dev        # open the printed URL
```

Other commands:

```
npm test                 # sim, routing, and front-end smoke tests
npm run build            # one self-contained dist/index.html
npm run frames           # render a still of every stage to out/frames (no browser needed)
npm run bench:routing    # full vs coarse search cost as the city grows
npm run health           # quick traffic health numbers
npm run chases -- 40     # the escape experiment: 40 chases per configuration (75 configurations)
npm run chases -- --merge  # combine shard files into data/chase-results.csv and the in-app chart
```

The experiment can be split across cores: `npm run chases -- 40 0/2` and `npm run chases -- 40 1/2` in two terminals, then merge.

## Controls

| Key | Action |
|---|---|
| Left / Right | Previous / next stage |
| 1 to 6 | Jump to a chapter |
| 0 | Replay the current stage from the start |
| Space | Pause |
| [ and ] | Slower / faster |
| G, C, B, S | Graph, forks, bubble, spawn marks |
| F | Follow the hero car |
| M | Routing: wander, full graph, coarse graph |
| P | Density check: radial or along the road |
| - and + | Fewer / more cars |
| R, T | New route, switch search view |
| W | Weather: dry or rain |
| X | Start or restart a police chase (any stage with the hero car) |
| Y and U | Wanted level down / up |
| K | Escape strategy (the last option is manual driving) |
| O | Police tactic |
| Arrow keys | In manual driving: left / right pick the turn at the next junction, down brakes. Use , and . to change stage |
| H | Hide panels for recording (Esc or double-click to bring them back) |

Drag to pan, scroll or pinch to zoom. The stage is kept in the URL (`#3b`, or `#3b-clean` with panels hidden), so a shot can be reopened directly.

## Reproducibility

Every random choice goes through a seeded generator and the sim runs on a fixed timestep, so a stage replays identically every time. That is what lets footage be recorded last, straight from the stage presets.

## Layout

```
src/sim      the simulation: graph, map generator, A*, coarse graph, traffic, spawner
src/render   canvas drawing (shared by the browser and the headless frame renderer)
src/app      stage presets and the browser front end
scripts      headless tools: frames, benchmarks, health checks
tests        vitest suites
data         benchmark results used in the video
```

## Measured so far

Full vs coarse search over 400 random trips per city size (`data/routing-bench.csv`):

| Intersections | Nodes (full) | Nodes (coarse) | Searched per trip (full) | Searched per trip (coarse) | Less work | Identical routes |
|---|---|---|---|---|---|---|
| 36 | 291 | 31 | 101 | 11 | 8.8x | 400/400 |
| 1,026 | 8,503 | 983 | 2,042 | 237 | 8.6x | 400/400 |
| 4,104 | 34,028 | 3,931 | 7,577 | 877 | 8.6x | 400/400 |

The saving is flat at about 8.6x. It tracks how many low-level nodes sit between forks, not how big the city is.
