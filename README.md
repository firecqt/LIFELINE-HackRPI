# LIFELINE
### Contributors: Sam S, Jacob H

## What is LIFELINE?
Every day, hikers go missing. The probability of finding a missing hiker dramatically decreases after 24 hours, showing a need for an efficient search strategy. Current strategies are limited by equipment, finances, and manpower. To fix this, LIFELINE proposes a cost-effective unmanned search strategy invovling a coordinated drone swarm. By using a terrain-derived bayesian prior of the park, drones work together to optimally explore. Our rough estimates indicate an exponential speedup in search time, growing logarithmically with drone count, perimeter size, and the prevalence of sensor-interfering canopy coverage.

## Why is LIFELINE efficient?
LIFELINE makes extensive use of **Lost Person Behavior** research, which combines environmental features with human psychology to produce analytical models about movement. LIFELINE's movement model combines Koester rings with elevation change to produce a **Probability Density Function** over the region. Armed with this prior, drones have an information advantage that allows them to explore the world.

## Why is LIFELINE effective?
LIFELINE isn't just fast, but also considers real-world constraints, such as flight trajectory, search assignment, entropy reduction, and sensor occlusion. A comprehensive probability model is used, which embraces false negatives and Probability of Detection approaches to write a fault-first perspective.

## How to run me
1. go to `/server` and do npm install
2. go to `/engine` and make a virtual environment named `.venv`
3. activate the venv then install from requirements.txt
4. in that same terminal, run `python api.py`
5. in a different terminal, go to `/server`
6. run `npm run dev` in that terminal

## Frontend — SAR drone command center (prototype)

LIFELINE is an interactive search-and-rescue command center that shows how autonomous drones,
terrain analysis and probabilistic search modeling can help park rangers find a missing hiker.

**Everything runs locally on mock data.** There are no backend services, external APIs, real
terrain datasets or drone links. Every number shown is produced by a deterministic local simulation
and is labeled **SIMULATED** in the UI.

### Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
```

### Pages

| Page | What it shows |
|---|---|
| **Overview** (`/`) | "Needs your attention" queue (sightings, teams on scene, new reports, launches, low batteries), a card per active search with its stage and one primary action, fleet and activity |
| **Search map** (`/map/:missionId`) | Full-bleed terrain map (Terrain / Elevation / Vegetation) with violet search-probability shading; right panel always shows the next step, search progress, drones, activity and case details; playback bar below |
| **Missing persons** (`/people`) | Reports grouped New / Searching / Found; start a search from a new report |
| **Ground team** (`/ground`) | Field view: team ETA, the subject's profile next to what the team found, and the on-scene confirmation form |
| **Drones** (`/drones`) | Live table of every drone: status, battery, position, mission, assigned cells and current task |
| **Recovery** (`/recovery/:missionId`) | After confirmation: last known position, found position, likely travel corridor and fastest route |

Every search moves through **Plan → Search → Verify → Found** and is never paused: it is either not started or actively searching. `src/lib/missionPhase.ts` derives
the phase and the single "next action" that the sidebar, Overview and Search map all show.

**Color meanings** are fixed app-wide: blue = actions / in progress, orange = the missing person,
green = found / healthy, gold = waiting, rose = urgent, violet = search probability.

### Demo script

1. **Overview** → **Start search** on a new report (or **Missing persons** → pick a *New* report → **Start search**).
2. **Search map**: press **Launch drones**, then set the speed to 5× or 10×. Switch base maps and toggle
   layers (Layers menu). Click a spot to inspect it.
3. When a drone reports a **possible sighting**, a chime plays (the other drones keep searching), the map
   flies to it and the right panel turns red. Review the mock thermal frame, then **Send ground
   team to check** or mark it **Not a person**.
4. **Ground Team**: when the team is on scene, answer *Is it a person?* and *Is this the
   subject?* (tick at least two identity checks), record their condition and confirm. Only this
   confirmation ends the search; "not a person" or "a different person" clears the area and the
   drones keep searching.
5. **Recovery Map** opens automatically: last known position, where the subject was found, the
   likely travel corridor (shaded) and the fastest walking route.
6. **Drones**: follow battery, position and cell assignments; **Map** jumps to a drone.

Audio is limited to the detection alert and can be muted from the top bar.

### Architecture

```
src/
  types/        Stable contracts: TerrainGrid/TerrainCell, Drone/SimDrone, ProbabilitySnapshot, Mission…
  data/         Centralized mock data (parks, reports, missions, fleet, history, activity)
  services/
    terrainService       procedural terrain → TerrainGrid (swap for DEM + land-cover loader)
    probabilityService   Tobler travel time, lost-person prior, Bayesian posterior, stats, number[][] adapters
    missionService       MissionEnvironment: search area, 4×4 search blocks, sectors
    simulationService    discrete-time engine: drones, lawnmower sweeps, auction, detections, ground teams
    droneService         fleet ⇄ live telemetry helpers
    audioService         detection alert: WebAudio chime + browser speech
  store/appStore.ts      zustand store: sessions {env, sim}, alerts, activity, settings
  hooks/                 global simulation loop, mission/session hook, tick timing for interpolation
  components/
    terrain/             Canvas renderer (TerrainMap), cached rasterizer, legend, controls
    simulation/          SimulationControls, ProbabilityTimeline, AuctionVisualizer
    operations/          Mission details panel, detection banner, mock thermal frame
    dashboard/ missions/ fleet/ alerts/ layout/ ui/
  pages/                 Overview (dashboard), MapPage, Drones, MissingPersons
```

#### Rendering vs. simulation

Rendering and simulation are kept separate:

- The renderers only consume data. `TerrainMap` draws a `TerrainGrid`, a `SimState` (drone
  positions, cell ownership) and a probability `Float32Array`.
- Terrain is rasterized once per view mode and cached.
- The heatmap, cell ownership and travel-range layers are small offscreen canvases. They are
  updated only when the simulation version changes.
- Drones are interpolated between ticks inside the animation loop.

#### Replacing mock data

| Replace | With | Contract |
|---|---|---|
| `terrainService.getTerrain` | DEM / land-cover loader | `TerrainGrid` |
| `probabilityService` output | backend PDF model | `ProbabilitySnapshot` (`fromProbabilityMatrix` accepts `number[][]`) |
| `simulationService.stepSimulation` | telemetry / planner stream | `SimState`, `Drone` |
| `data/*` | mission & report APIs | `Mission`, `MissingPersonReport` |

#### Model notes (illustrative only)

- **Travel time** from the last known position (LKP) is a Dijkstra search using Tobler's hiking
  function `v = 6·exp(−3.5·|tanθ + 0.05|)`, with vegetation drag, a trail bonus, slow river
  crossings and impassable lakes.
- **Prior:** a time-dependent ring-shaped density inside the reachable area, weighted by trail and
  drainage affinity and a downhill bias.
- **Update:** each sensor pass multiplies the cell's non-detection likelihood by
  `(1 − POD)`, where `POD = sensor POD × (1 − 0.72·vegetation density)`. The posterior is the
  renormalized `prior × likelihood`.
- **Travel corridor (recovery):** `detour(c) = T(LKP→c) + T(c→found) − T(LKP→found)`, weight
  `exp(−detour/τ)` with τ = 12% of the fastest walking time. It's a reconstruction, not a track.
- **Auction:** each drone bids
  `score = EDV / (1 + d/600 m + Δh/250 m) / (1 + 0.9·load)`, where EDV is the expected detection
  value. Bids that would leave less than a 20% battery reserve are infeasible.

None of these outputs are validated predictions.
