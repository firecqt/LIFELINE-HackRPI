/**
 * simulationService — SIMULATED discrete-time search engine.
 *
 * Each tick (TICK_SEC simulated seconds) advances, in order:
 *   prior evolution → drone state machine & movement → sensor sweeps (likelihood update,
 *   detections) → posterior → auction allocation → signals / ground teams → stats,
 *   snapshots and logs.
 *
 * It is a pure TypeScript module with no React dependency, so it can be swapped for a
 * backend stream that emits the same `SimState` contract.
 */
import type { FleetDrone, SimDrone, Waypoint } from '../types/drone';
import type { Mission } from '../types/mission';
import type { AuctionRound, Bid, DetectionSignal, FieldReport, LogType, MissionEnvironment, SimEvent, SimState, SimStats } from '../types/simulation';
import { Rng, hashString } from '../lib/rng';
import { formatClock, formatDuration } from '../lib/format';
import { BLOCK } from './missionService';
import { cellPod, computePosterior, computePrior, computeStats, makeSnapshot } from './probabilityService';

export const TICK_SEC = 20;
export const BASE_TICK_MS = 600;
/** Sim seconds per tick for a search: the engine's tick for engine searches, TICK_SEC otherwise. */
export const tickSecOf = (env: { tickSec?: number }) => env.tickSec ?? TICK_SEC;
export const SNAPSHOT_EVERY = 15; // ticks → 5 simulated minutes
const HISTORY_EVERY = 3;
const MAX_TICKS = 1440; // 8 simulated hours
const AGL = 100;
const LOG_CAP = 500;

export interface StepOptions {
  detection: boolean;
  quiet?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------
export function createSimulation(env: MissionEnvironment, mission: Mission, fleet: FleetDrone[], clockBase: number): SimState {
  const { grid } = env;
  const W = grid.width;
  const N = W * grid.height;
  const seed = hashString(`${mission.id}:${env.report.id}`);
  const rng = new Rng(seed);
  const prior = new Float32Array(N);
  const mobileHours = computePrior(env.travelTime, env.behavior, env.hoursMissingAtStart, prior, env.mobileScale);
  const likelihood = new Float32Array(N).fill(1);
  const probability = new Float32Array(prior);
  const cellStatus = new Uint8Array(N);

  // Hidden ground truth sampled from a sharpened prior (deterministic per mission).
  let total = 0;
  // Subjects are found more often where sensors can see them: weight by prior^1.5 × POD^0.5.
  const hw = (i: number) => Math.pow(prior[i], 1.5) * Math.sqrt(env.pod[i]);
  for (let i = 0; i < N; i++) total += hw(i);
  let r = rng.next() * total;
  let hikerI = env.lkp.y * W + env.lkp.x;
  for (let i = 0; i < N; i++) {
    r -= hw(i);
    if (r <= 0) {
      hikerI = i;
      break;
    }
  }

  const drones: SimDrone[] = fleet.map((f, k) => makeSimDrone(f, k, env));
  const stats = buildStats(env, prior, likelihood, probability, cellStatus, drones, mobileHours, new Uint16Array(env.blocks.length));

  const s: SimState = {
    missionId: mission.id,
    version: 0,
    seed,
    tick: 0,
    elapsedSec: 0,
    status: 'ready',
    outcome: null,
    speed: 1,
    clockBase,
    drones,
    owner: new Int8Array(N).fill(-1),
    cellStatus,
    lastVisit: new Int32Array(N),
    likelihood,
    prior,
    probability,
    blockOwner: new Int8Array(env.blocks.length).fill(-1),
    blockSearchCount: new Uint16Array(env.blocks.length),
    hiker: { x: hikerI % W, y: Math.floor(hikerI / W) },
    stats,
    snapshots: [makeSnapshot(probability, W, grid.height, 0, stats, 0)],
    coverageHistory: [{ minute: 0, coverage: 0, unexplored: 1, pos: 0, peak: stats.peak.probability }],
    log: [],
    auctionLog: [],
    auctions: [],
    signals: [],
    sectorsComplete: [],
    priorityAlerted: false,
    events: [],
    rng,
    logSeq: 0,
    passSeq: 0,
    auctionSeq: 0,
    mobileHours,
  };
  addLog(s, 'system', `Mission ${mission.id} initialized — ${env.park.name} (simulated terrain)`);
  addLog(s, 'system', `Search area: ${(env.searchAreaCells * (grid.cellSizeM / 1000) ** 2).toFixed(1)} km² · ${env.searchAreaCells.toLocaleString()} cells · ${env.blocks.filter((b) => b.cells.length).length} search blocks`);
  addLog(s, 'probability', `Initial PDF generated (Tobler travel model, ${formatDuration(env.hoursMissingAtStart)} elapsed, ${mobileHours.toFixed(2)} h mobile)`);
  addLog(s, 'drone', `Fleet ready: ${drones.map((d) => d.id).join(', ')} at ${env.grid.landmarks.find((l) => l.type === 'ranger')?.name ?? 'base'}`);
  return s;
}

function makeSimDrone(f: FleetDrone, k: number, env: MissionEnvironment): SimDrone {
  const cell = env.grid.cellSizeM;
  const speedTransit = (f.spec.cruiseSpeedMs * TICK_SEC) / cell;
  const bx = env.base.x + 0.5 + ((k % 3) - 1) * 0.6;
  const by = env.base.y + 0.5 + (Math.floor(k / 3) - 1) * 0.6;
  return {
    id: f.id,
    name: f.name,
    status: 'standby',
    battery: Math.max(35, f.battery),
    x: bx,
    y: by,
    prevX: bx,
    prevY: by,
    altitude: env.grid.elevation[env.base.y * env.grid.width + env.base.x],
    agl: 0,
    heading: 0,
    assignedCells: [],
    color: f.color,
    model: `${f.spec.manufacturer} ${f.spec.model}`,
    queue: [],
    currentBlock: -1,
    path: [],
    trail: [{ x: bx, y: by }],
    objective: 'Standby at base',
    distanceM: 0,
    cellsSearched: 0,
    blocksCompleted: 0,
    speedTransit,
    speedSearch: speedTransit * 0.55,
    footprint: Math.max(1.02, f.spec.footprintM / cell),
    basePod: f.spec.basePod,
    flightTimeMin: f.spec.flightTimeMin,
    launchTick: 1 + k * 2,
    stateTicks: 0,
    holdingSignalId: null,
    lowBatteryWarned: false,
    passId: 0,
    fleetIndex: k,
  };
}

// ---------------------------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------------------------
export function stepSimulation(prev: SimState, env: MissionEnvironment, opts: StepOptions): SimState {
  if (prev.status === 'complete') return prev;
  const s: SimState = { ...prev, events: [] };
  const W = env.grid.width;
  s.tick += 1;
  s.elapsedSec += TICK_SEC;
  const hours = env.hoursMissingAtStart + s.elapsedSec / 3600;

  // 1. Prior evolves with elapsed time; old negative evidence slowly relaxes (subject may move).
  s.mobileHours = computePrior(env.travelTime, env.behavior, hours, s.prior, env.mobileScale);
  const L = s.likelihood;
  for (let i = 0; i < L.length; i++) if (L[i] < 1) L[i] = 1 - (1 - L[i]) * 0.9985;

  // 2. Drones
  for (const d of s.drones) {
    d.prevX = d.x;
    d.prevY = d.y;
    updateDrone(s, env, d, opts);
  }

  // 3. Posterior after this tick's observations
  computePosterior(s.prior, s.likelihood, s.probability);

  // 4. Auction for unallocated high-value blocks
  runAuctions(s, env, opts);

  // 5. Ground-team verification
  for (const sig of s.signals) {
    if (sig.status === 'verifying' && sig.etaTick !== null && s.tick >= sig.etaTick) groundTeamArrives(s, env, sig, opts);
  }

  // 6. Stats, history, snapshots
  s.stats = buildStats(env, s.prior, s.likelihood, s.probability, s.cellStatus, s.drones, s.mobileHours, s.blockSearchCount);
  if (s.tick % HISTORY_EVERY === 0) {
    s.coverageHistory = [
      ...s.coverageHistory,
      { minute: s.elapsedSec / 60, coverage: s.stats.coverage, unexplored: s.stats.unexploredMass, pos: s.stats.cumulativePos, peak: s.stats.peak.probability },
    ];
  }
  if (s.tick % SNAPSHOT_EVERY === 0) {
    s.snapshots = [...s.snapshots, makeSnapshot(s.probability, W, env.grid.height, s.elapsedSec, s.stats, s.stats.coverage)].slice(-240);
    if (!opts.quiet)
      addLog(
        s,
        'probability',
        `Probability distribution updated — peak ${(s.stats.peak.probability * 100).toFixed(3)}% at (${s.stats.peak.x}, ${s.stats.peak.y}); unexplored mass ${(s.stats.unexploredMass * 100).toFixed(1)}%`,
      );
  }

  // 7. Response-window escalation
  if (!s.priorityAlerted && hours > env.report.responseWindowH) {
    s.priorityAlerted = true;
    pushEvent(s, opts, {
      kind: 'priority',
      severity: 'warning',
      title: 'Response window exceeded',
      message: `${env.report.name} missing ${formatDuration(hours)} — beyond the ${env.report.responseWindowH} h expected response window. Consider escalating resources.`,
      voice: 'Mission priority alert. Search duration has exceeded the expected response window.',
    });
    addLog(s, 'warning', `Search duration exceeded expected response window (${env.report.responseWindowH} h)`);
  }

  if (s.tick >= MAX_TICKS && s.status !== 'complete') {
    s.status = 'complete';
    s.outcome = 'suspended';
    addLog(s, 'system', 'Operational period ended — search suspended pending ranger review');
    pushEvent(s, opts, { kind: 'mission_complete', severity: 'info', title: 'Operational period ended', message: 'Simulation reached its 8-hour operational limit.' });
  }

  s.version = prev.version + 1;
  return s;
}

// ---------------------------------------------------------------------------------------------
// Drones
// ---------------------------------------------------------------------------------------------
const AIRBORNE = new Set(['launching', 'en_route', 'searching', 'returning', 'low_battery']);

function drainPerTick(d: SimDrone, s: SimState): number {
  // battery 100→20 over the rated flight time
  return (80 / ((d.flightTimeMin * 60) / TICK_SEC)) * (d.status === 'searching' ? 1.08 : 1) * (s.rng.range(0.94, 1.06));
}

function updateDrone(s: SimState, env: MissionEnvironment, d: SimDrone, opts: StepOptions) {
  const g = env.grid;
  d.stateTicks++;
  switch (d.status) {
    case 'standby':
      if (s.tick >= d.launchTick) setStatus(d, 'preparing', 'Pre-flight checks · IMU & thermal calibration');
      break;
    case 'preparing':
      if (d.stateTicks >= 2) {
        setStatus(d, 'launching', `Climbing to ${AGL} m AGL`);
        if (!opts.quiet) addLog(s, 'drone', `${d.id} launched from base`, d.id);
        pushEvent(s, opts, { kind: 'launch', severity: 'info', title: `${d.id} launched`, message: `${d.id} airborne — climbing to search altitude`, droneId: d.id });
      }
      break;
    case 'launching':
      d.agl = Math.min(AGL, d.agl + 50);
      if (d.agl >= AGL) setStatus(d, 'en_route', 'Awaiting auction assignment');
      break;
    case 'charging':
      d.battery = Math.min(100, d.battery + 3.2);
      d.objective = `Charging at base · ${Math.round(d.battery)}%`;
      if (d.battery >= 95) {
        d.lowBatteryWarned = false;
        setStatus(d, 'preparing', 'Battery swap complete · pre-flight checks');
      }
      break;
    case 'low_battery':
      setStatus(d, 'returning', 'Return to base (low battery)');
      d.path = [{ x: env.base.x + 0.5, y: env.base.y + 0.5, mode: 'return' }];
      break;
    case 'returning':
      moveAlongPath(s, env, d, opts);
      if (!d.path.length) {
        d.agl = Math.max(0, d.agl - 50);
        if (d.agl <= 0) {
          setStatus(d, 'charging', 'Charging at base');
          if (!opts.quiet) addLog(s, 'drone', `${d.id} landed — battery swap / charging`, d.id);
        }
      }
      break;
    case 'en_route':
    case 'searching': {
      if (d.battery < 20 && !d.lowBatteryWarned) {
        d.lowBatteryWarned = true;
        releaseWork(s, env, d);
        if (d.holdingSignalId) d.holdingSignalId = null;
        setStatus(d, 'low_battery', `Battery ${Math.round(d.battery)}% — return-to-base recommended`);
        if (!opts.quiet) addLog(s, 'warning', `${d.id} battery below 20% (${Math.round(d.battery)}%) — returning to base`, d.id);
        pushEvent(s, opts, {
          kind: 'low_battery',
          severity: 'warning',
          title: `${d.id} low battery`,
          message: `${d.id} battery at ${Math.round(d.battery)}%. Return-to-base initiated; assigned cells released to auction.`,
          droneId: d.id,
          voice: `Drone ${spellId(d.id)} battery level is below twenty percent.`,
        });
        break;
      }
      if (d.holdingSignalId) {
        const sig = s.signals.find((x) => x.id === d.holdingSignalId);
        if (sig) {
          const a = s.tick * 0.9;
          d.x = sig.x + Math.cos(a) * 0.9;
          d.y = sig.y + Math.sin(a) * 0.9;
          d.heading = ((a * 180) / Math.PI + 180) % 360;
          d.status = 'searching';
          d.objective = `Orbiting potential detection ${sig.id} · awaiting ranger`;
        }
        break;
      }
      if (!d.path.length) startNextBlock(s, env, d);
      if (d.path.length) moveAlongPath(s, env, d, opts);
      else {
        d.status = 'en_route';
        d.objective = 'Holding · awaiting auction assignment';
      }
      break;
    }
  }
  if (AIRBORNE.has(d.status) || d.status === 'charging') {
    if (d.status !== 'charging') d.battery = Math.max(0, d.battery - drainPerTick(d, s));
  }
  const cx = Math.min(g.width - 1, Math.max(0, Math.floor(d.x)));
  const cy = Math.min(g.height - 1, Math.max(0, Math.floor(d.y)));
  d.altitude = g.elevation[cy * g.width + cx] + d.agl;
  const last = d.trail[d.trail.length - 1];
  if (!last || Math.hypot(last.x - d.x, last.y - d.y) > 0.25) {
    d.trail.push({ x: d.x, y: d.y });
    if (d.trail.length > 220) d.trail.shift();
  }
  d.assignedCells = [d.currentBlock, ...d.queue].filter((b) => b >= 0).map((b) => env.blocks[b].id);
}

function setStatus(d: SimDrone, status: SimDrone['status'], objective: string) {
  d.status = status;
  d.objective = objective;
  d.stateTicks = 0;
}

export function spellId(id: string): string {
  return id.replace('D-0', 'D ').replace('D-', 'D ');
}

function moveAlongPath(s: SimState, env: MissionEnvironment, d: SimDrone, opts: StepOptions) {
  let budget = 1; // fraction of the tick
  while (budget > 1e-4 && d.path.length) {
    const wp = d.path[0];
    const speed = wp.mode === 'search' ? d.speedSearch : d.speedTransit;
    const dx = wp.x - d.x;
    const dy = wp.y - d.y;
    const dist = Math.hypot(dx, dy);
    const maxDist = budget * speed;
    const move = Math.min(dist, maxDist);
    if (dist > 1e-6) d.heading = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
    const sx = d.x;
    const sy = d.y;
    if (dist <= maxDist) {
      d.x = wp.x;
      d.y = wp.y;
      budget -= dist / speed;
      d.path.shift();
    } else {
      d.x += (dx / dist) * move;
      d.y += (dy / dist) * move;
      budget = 0;
    }
    d.distanceM += move * env.grid.cellSizeM;
    if (wp.mode === 'search') {
      const n = Math.max(1, Math.ceil(move / 0.35));
      for (let k = 0; k <= n; k++) {
        markSearch(s, env, d, sx + (d.x - sx) * (k / n), sy + (d.y - sy) * (k / n), opts);
        if (d.holdingSignalId) return;
      }
    }
    if (d.status !== 'returning' && d.path.length) {
      const searching = d.path[0].mode === 'search';
      d.status = searching ? 'searching' : 'en_route';
      const b = env.blocks[d.currentBlock];
      if (b) d.objective = searching ? `Sweeping ${b.id} · sector ${b.sector}` : `Transit to ${b.id} · sector ${b.sector}`;
    }
  }
  if (!d.path.length && d.currentBlock >= 0) completeBlock(s, env, d, opts);
}

function startNextBlock(s: SimState, env: MissionEnvironment, d: SimDrone) {
  while (d.queue.length) {
    const bi = d.queue.shift()!;
    const b = env.blocks[bi];
    if (!b || !b.cells.length) continue;
    const k = d.fleetIndex;
    d.currentBlock = bi;
    d.passId = ++s.passSeq;
    s.blockOwner[bi] = k;
    for (const c of b.cells) {
      s.owner[c] = k;
      if (s.cellStatus[c] === 0) s.cellStatus[c] = 1;
    }
    d.path = lawnmower(b.bx, b.by, d.x, d.y);
    d.status = 'en_route';
    d.objective = `Transit to ${b.id} · sector ${b.sector}`;
    return;
  }
}

function lawnmower(bx: number, by: number, px: number, py: number): Waypoint[] {
  const x0 = bx * BLOCK;
  const y0 = by * BLOCK;
  const xs = [x0 + 0.5, x0 + BLOCK - 0.5];
  const ys = [y0 + 1, y0 + 3];
  let best: [number, number] = [0, 0];
  let bd = Infinity;
  for (let xi = 0; xi < 2; xi++)
    for (let yi = 0; yi < 2; yi++) {
      const dd = Math.hypot(xs[xi] - px, ys[yi] - py);
      if (dd < bd) {
        bd = dd;
        best = [xi, yi];
      }
    }
  const [sx, sy] = best;
  const r1 = ys[sy];
  const r2 = ys[1 - sy];
  const a = xs[sx];
  const b = xs[1 - sx];
  return [
    { x: a, y: r1, mode: 'transit' },
    { x: b, y: r1, mode: 'search' },
    { x: b, y: r2, mode: 'search' },
    { x: a, y: r2, mode: 'search' },
  ];
}

function markSearch(s: SimState, env: MissionEnvironment, d: SimDrone, px: number, py: number, opts: StepOptions) {
  const g = env.grid;
  const W = g.width;
  const b = env.blocks[d.currentBlock];
  if (!b) return;
  const r = d.footprint;
  const x0 = b.bx * BLOCK;
  const y0 = b.by * BLOCK;
  const hikerI = s.hiker.y * W + s.hiker.x;
  for (let cy = Math.max(y0, Math.floor(py - r)); cy <= Math.min(y0 + BLOCK - 1, g.height - 1, Math.floor(py + r)); cy++) {
    for (let cx = Math.max(x0, Math.floor(px - r)); cx <= Math.min(x0 + BLOCK - 1, W - 1, Math.floor(px + r)); cx++) {
      if ((cx + 0.5 - px) ** 2 + (cy + 0.5 - py) ** 2 > r * r) continue;
      const i = cy * W + cx;
      if (!env.searchArea[i] || s.lastVisit[i] === d.passId) continue;
      s.lastVisit[i] = d.passId;
      const pod = cellPod(d.basePod, g.vegetationDensity[i]);
      s.likelihood[i] *= 1 - pod;
      s.cellStatus[i] = 2;
      s.owner[i] = d.fleetIndex;
      d.cellsSearched++;
      if (!opts.detection) continue;
      const hasTrueOpen = s.signals.some((x) => x.isTrue && x.status !== 'dismissed');
      // A responsive subject (movement, signalling) is easier to spot than the canopy-limited POD.
      if (i === hikerI && !hasTrueOpen && s.rng.next() < Math.max(pod, 0.55)) {
        raiseSignal(s, env, d, cx, cy, true, opts);
        return;
      }
      const falseCount = s.signals.filter((x) => !x.isTrue).length;
      if (s.tick > 25 && falseCount < 2 && s.rng.next() < 0.00028 * (0.4 + g.vegetationDensity[i])) {
        raiseSignal(s, env, d, cx, cy, false, opts);
        return;
      }
    }
  }
}

function raiseSignal(s: SimState, env: MissionEnvironment, d: SimDrone, cx: number, cy: number, isTrue: boolean, opts: StepOptions) {
  const conf = isTrue ? s.rng.range(0.74, 0.93) : s.rng.range(0.34, 0.6);
  const sig: DetectionSignal = {
    id: `SIG-${String(s.signals.length + 1).padStart(2, '0')}`,
    droneId: d.id,
    x: cx + 0.5 + s.rng.range(-0.35, 0.35),
    y: cy + 0.5 + s.rng.range(-0.35, 0.35),
    confidence: conf,
    tick: s.tick,
    clock: clockStr(s),
    status: 'pending',
    isTrue,
    etaTick: null,
    dispatchTick: null,
    sensor: 'LWIR thermal + RGB',
    fieldReport: null,
  };
  s.signals = [...s.signals, sig];
  releaseWork(s, env, d);
  d.holdingSignalId = sig.id;
  d.objective = `Orbiting potential detection ${sig.id}`;
  const b = env.blocks[Math.floor(cy / BLOCK) * env.blocksW + Math.floor(cx / BLOCK)];
  addLog(s, 'detection', `Potential detection signal received — ${d.id} at cell (${cx}, ${cy}) · confidence ${(conf * 100).toFixed(0)}% · ranger verification required`, d.id);
  pushEvent(s, opts, {
    kind: 'detection',
    severity: 'critical',
    title: 'Potential detection',
    message: `${d.id} identified a possible human presence in ${b?.id ?? 'cell'} (sector ${b?.sector ?? '—'}). Confidence ${(conf * 100).toFixed(0)}%. Ranger verification required.`,
    x: sig.x,
    y: sig.y,
    droneId: d.id,
    signalId: sig.id,
    voice: `Potential human detected in sector ${b?.sector ?? ''}.`,
  });
}

function completeBlock(s: SimState, env: MissionEnvironment, d: SimDrone, opts: StepOptions) {
  const bi = d.currentBlock;
  const b = env.blocks[bi];
  d.currentBlock = -1;
  if (!b) return;
  s.blockOwner[bi] = -1;
  s.blockSearchCount[bi]++;
  d.blocksCompleted++;
  if (!opts.quiet) addLog(s, 'search', `Cell ${b.id} searched by ${d.id} (sector ${b.sector})`, d.id);
  // Sector completion
  if (!s.sectorsComplete.includes(b.sector)) {
    const done = env.blocks.every((x) => x.sector !== b.sector || !x.cells.length || s.blockSearchCount[x.index] > 0);
    if (done) {
      s.sectorsComplete = [...s.sectorsComplete, b.sector];
      addLog(s, 'search', `Sector ${b.sector} completed — probability redistributed`);
      pushEvent(s, opts, {
        kind: 'sector_complete',
        severity: 'success',
        title: `Sector ${b.sector} completed`,
        message: `All blocks in sector ${b.sector} searched at least once. Probability mass redistributed to remaining areas.`,
        droneId: d.id,
        voice: `Drone ${spellId(d.id)} has completed its assigned search sector.`,
      });
    }
  }
}

function releaseWork(s: SimState, env: MissionEnvironment, d: SimDrone) {
  for (const bi of [d.currentBlock, ...d.queue]) {
    if (bi < 0) continue;
    s.blockOwner[bi] = -1;
    for (const c of env.blocks[bi].cells) {
      if (s.cellStatus[c] === 1) {
        s.cellStatus[c] = 0;
        s.owner[c] = -1;
      }
    }
  }
  d.queue = [];
  d.currentBlock = -1;
  d.path = [];
}

// ---------------------------------------------------------------------------------------------
// Auction
// ---------------------------------------------------------------------------------------------
function runAuctions(s: SimState, env: MissionEnvironment, opts: StepOptions) {
  const g = env.grid;
  const bidders = s.drones.filter((d) => (d.status === 'en_route' || d.status === 'searching' || d.status === 'launching') && !d.holdingSignalId && d.battery >= 22);
  const load = (d: SimDrone) => d.queue.length + (d.currentBlock >= 0 ? 1 : 0);
  // A drone "needs work" only if it has queue room and enough battery reserve to accept a block.
  const needs = (d: SimDrone) => load(d) < 2 && d.battery - load(d) * 3 >= 24;
  if (!bidders.some(needs)) return;

  const values: { bi: number; v: number }[] = [];
  for (const b of env.blocks) {
    if (!b.cells.length || s.blockOwner[b.index] >= 0) continue;
    if (s.drones.some((d) => d.queue.includes(b.index))) continue;
    let v = 0;
    for (const c of b.cells) v += s.probability[c] * env.pod[c];
    if (s.blockSearchCount[b.index] === 0) v *= 1.6; // exploration bonus for never-searched blocks
    if (v > 0) values.push({ bi: b.index, v });
  }
  values.sort((a, b) => b.v - a.v);
  const candidates = values.slice(0, 8);
  let rounds = 0;
  while (rounds < 3 && candidates.length && bidders.some(needs)) {
    const target = candidates.shift()!;
    const b = env.blocks[target.bi];
    const bids: Bid[] = [];
    for (const d of bidders) {
      const l = load(d);
      if (l >= 3) continue;
      const lastB = d.queue.length ? env.blocks[d.queue[d.queue.length - 1]] : d.currentBlock >= 0 ? env.blocks[d.currentBlock] : null;
      const fx = lastB ? lastB.center.x : d.x;
      const fy = lastB ? lastB.center.y : d.y;
      const fromElev = lastB ? lastB.meanElevation : g.elevation[Math.floor(Math.min(g.height - 1, fy)) * g.width + Math.floor(Math.min(g.width - 1, fx))];
      const horizontalM = Math.hypot(b.center.x - fx, b.center.y - fy) * g.cellSizeM;
      const verticalM = Math.abs(b.meanElevation - fromElev);
      const batteryPct = (horizontalM / 1000) * 1.1 + (verticalM / 100) * 0.7 + 1.4;
      const feasible = d.battery - l * 3 - batteryPct >= 20;
      const ev = target.v * 1e4;
      const score = feasible ? ev / (1 + horizontalM / 600 + verticalM / 250) / (1 + 0.9 * l) : 0;
      bids.push({ droneId: d.id, color: d.color, horizontalM, verticalM, batteryPct, expectedValue: ev, load: l, score });
    }
    if (!bids.length) break;
    bids.sort((a, b) => b.score - a.score);
    const win = bids[0].score > 0 ? bids[0] : null;
    if (!win) continue; // no feasible bidder for this cell — offer the next candidate
    const round: AuctionRound = {
      id: ++s.auctionSeq,
      tick: s.tick,
      clock: clockStr(s),
      blockIndex: b.index,
      blockId: b.id,
      center: b.center,
      expectedValue: target.v,
      candidates: [target, ...candidates].slice(0, 6).map((c) => ({ blockId: env.blocks[c.bi].id, blockIndex: c.bi, value: c.v })),
      bids,
      winnerId: win?.droneId ?? null,
    };
    s.auctions = [...s.auctions, round].slice(-30);
    if (win) {
      const d = s.drones.find((x) => x.id === win.droneId)!;
      d.queue.push(b.index);
      s.blockOwner[b.index] = d.fleetIndex;
      for (const c of b.cells) {
        s.owner[c] = d.fleetIndex;
        if (s.cellStatus[c] === 0) s.cellStatus[c] = 1;
      }
    }
    if (!opts.quiet && rounds === 0) {
      const clock = round.clock;
      const entries = bids.map((bd) => ({ id: 0, clock, kind: 'bid' as const, droneId: bd.droneId, message: `Drone ${bd.droneId} submitted bid ${bd.score.toFixed(1)} for cell ${b.id}` }));
      if (win) {
        entries.push({ id: 0, clock, kind: 'win' as any, droneId: win.droneId, message: `${win.droneId} won cell ${b.id}` });
        entries.push({ id: 0, clock, kind: 'update' as any, droneId: win.droneId, message: `Cell ownership updated — ${b.id} → ${win.droneId}` });
        addLog(s, 'auction', `${win.droneId} won auction for ${b.id} (sector ${b.sector}) · bid ${win.score.toFixed(1)} vs ${bids.length - 1} other bid${bids.length === 2 ? '' : 's'}`, win.droneId);
      }
      let seq = s.auctionLog.length ? s.auctionLog[s.auctionLog.length - 1].id : 0;
      s.auctionLog = [...s.auctionLog, ...entries.map((e) => ({ ...e, id: ++seq }))].slice(-300);
    }
    rounds++;
  }
}

// ---------------------------------------------------------------------------------------------
// Ranger actions on signals
// ---------------------------------------------------------------------------------------------
export function dispatchGroundTeam(prev: SimState, env: MissionEnvironment, signalId: string): SimState {
  const s: SimState = { ...prev, events: [] };
  const d = Math.hypot(env.base.x - 0, env.base.y - 0);
  s.signals = s.signals.map((sig) => {
    if (sig.id !== signalId || sig.status !== 'pending') return sig;
    const dist = Math.hypot(sig.x - env.base.x, sig.y - env.base.y);
    // 6..24 ticks of TICK_SEC, converted to this search's ticks so the ETA is the same in sim time
    const eta = Math.round((Math.min(24, Math.max(6, dist / 3)) * TICK_SEC) / tickSecOf(env));
    addLog(s, 'ranger', `Ranger dispatched hasty ground team to ${sig.id} — ETA ${Math.round((eta * tickSecOf(env)) / 60)} min (sim)`);
    return { ...sig, status: 'verifying', etaTick: s.tick + eta, dispatchTick: s.tick };
  });
  void d;
  s.version = prev.version + 1;
  return s;
}

export function dismissSignal(prev: SimState, signalId: string): SimState {
  const s: SimState = { ...prev, events: [] };
  s.signals = s.signals.map((sig) => (sig.id === signalId && (sig.status === 'pending' || sig.status === 'verifying') ? { ...sig, status: 'dismissed' } : sig));
  for (const d of s.drones) if (d.holdingSignalId === signalId) d.holdingSignalId = null;
  addLog(s, 'ranger', `Ranger dismissed ${signalId} — drones resuming search pattern`);
  s.version = prev.version + 1;
  return s;
}

function groundTeamArrives(s: SimState, env: MissionEnvironment, sig: DetectionSignal, opts: StepOptions) {
  s.signals = s.signals.map((x) => (x.id === sig.id ? { ...x, status: 'on_scene' } : x));
  const b = env.blocks[Math.floor(sig.y / BLOCK) * env.blocksW + Math.floor(sig.x / BLOCK)];
  addLog(s, 'ranger', `Ground team on scene at ${sig.id} — awaiting field confirmation`);
  pushEvent(s, opts, {
    kind: 'ground_on_scene',
    severity: 'warning',
    title: `Ground team on scene at ${sig.id}`,
    message: `The team reached the signal in ${b?.id ?? 'the search area'}. Open the Ground Team view to confirm what they found.`,
    x: sig.x,
    y: sig.y,
    signalId: sig.id,
  });
}

/**
 * Applies the ground team's field confirmation. Only the team's verdict decides the outcome:
 * a confirmed subject ends the mission; anything else clears the area and the search continues.
 */
export function confirmSignal(prev: SimState, env: MissionEnvironment, signalId: string, report: Omit<FieldReport, 'tick' | 'clock'>): SimState {
  const sig = prev.signals.find((x) => x.id === signalId);
  if (!sig || (sig.status !== 'on_scene' && sig.status !== 'verifying')) return prev;
  const s: SimState = { ...prev, events: [] };
  const opts = { detection: true };
  const fieldReport: FieldReport = { ...report, tick: s.tick, clock: clockStr(s) };
  if (report.verdict === 'subject') {
    s.signals = s.signals.map((x) => (x.id === sig.id ? { ...x, status: 'confirmed', fieldReport } : x));
    s.status = 'complete';
    s.outcome = 'located';
    for (const d of s.drones) {
      d.holdingSignalId = null;
      if (AIRBORNE.has(d.status)) {
        releaseWork(s, env, d);
        setStatus(d, 'returning', 'Mission complete — returning to base');
        d.path = [{ x: env.base.x + 0.5, y: env.base.y + 0.5, mode: 'return' }];
      }
    }
    addLog(s, 'ranger', `Ground team confirms ${env.report.name} located at ${sig.id}. Rescue and medical evaluation in progress.`);
    pushEvent(s, opts, {
      kind: 'located',
      severity: 'success',
      title: 'Subject located — confirmed by ground team',
      message: `${env.report.name} confirmed at ${sig.id}. Drones returning to base.`,
      x: sig.x,
      y: sig.y,
      signalId: sig.id,
    });
  } else {
    const status = report.verdict === 'other_person' ? 'not_subject' : 'false_positive';
    s.signals = s.signals.map((x) => (x.id === sig.id ? { ...x, status, fieldReport } : x));
    const W = env.grid.width;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = Math.floor(sig.x) + dx;
        const y = Math.floor(sig.y) + dy;
        if (x < 0 || y < 0 || x >= W || y >= env.grid.height) continue;
        s.likelihood[y * W + x] *= 0.25;
      }
    computePosterior(s.prior, s.likelihood, s.probability);
    for (const d of s.drones) if (d.holdingSignalId === sig.id) d.holdingSignalId = null;
    const what = report.verdict === 'other_person' ? 'a different person, not the subject' : 'no person (animal or heat source)';
    addLog(s, 'ranger', `Ground team at ${sig.id}: ${what}. Area cleared, search continues.`);
    pushEvent(s, opts, {
      kind: 'false_positive',
      severity: 'info',
      title: `${sig.id} cleared — ${report.verdict === 'other_person' ? 'not the subject' : 'not a person'}`,
      message: `Ground team reports ${what}. Probability redistributed; the search continues.`,
      x: sig.x,
      y: sig.y,
      signalId: sig.id,
    });
  }
  s.version = prev.version + 1;
  return s;
}

export function standDown(prev: SimState, env: MissionEnvironment): SimState {
  const s: SimState = { ...prev, events: [], status: 'complete', outcome: 'stood_down' };
  for (const d of s.drones) {
    d.holdingSignalId = null;
    if (AIRBORNE.has(d.status)) {
      releaseWork(s, env, d);
      setStatus(d, 'returning', 'Mission stood down — returning to base');
    }
  }
  addLog(s, 'ranger', 'Mission stood down by ranger. Drones released to fleet.');
  s.version = prev.version + 1;
  return s;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
function buildStats(
  env: MissionEnvironment,
  prior: Float32Array,
  likelihood: Float32Array,
  p: Float32Array,
  cellStatus: Uint8Array,
  drones: SimDrone[],
  mobileHours: number,
  blockSearchCount: Uint16Array,
): SimStats {
  const base = computeStats(prior, likelihood, p, cellStatus, env.grid.width);
  let searched = 0;
  for (let i = 0; i < cellStatus.length; i++) if (cellStatus[i] === 2 && env.searchArea[i]) searched++;
  let blocksSearched = 0;
  let totalBlocks = 0;
  for (const b of env.blocks) {
    if (!b.cells.length) continue;
    totalBlocks++;
    if (blockSearchCount[b.index] > 0) blocksSearched++;
  }
  return {
    ...base,
    coverage: env.searchAreaCells ? searched / env.searchAreaCells : 0,
    cellsSearched: searched,
    searchAreaCells: env.searchAreaCells,
    blocksSearched,
    totalBlocks,
    distanceKm: drones.reduce((a, d) => a + d.distanceM, 0) / 1000,
    dronesAirborne: drones.filter((d) => AIRBORNE.has(d.status)).length,
    travelHours: mobileHours,
  };
}

function clockStr(s: SimState): string {
  return formatClock(s.clockBase + s.elapsedSec * 1000);
}

export function simClockMs(s: SimState): number {
  return s.clockBase + s.elapsedSec * 1000;
}

function addLog(s: SimState, type: LogType, message: string, droneId?: string) {
  s.logSeq += 1;
  const entry = { id: s.logSeq, t: s.elapsedSec, clock: clockStr(s), type, message, droneId };
  s.log = s.log.length >= LOG_CAP ? [...s.log.slice(-LOG_CAP + 1), entry] : [...s.log, entry];
}

function pushEvent(s: SimState, opts: StepOptions, e: SimEvent) {
  if (opts.quiet) return;
  s.events = [...s.events, e];
}

/** Fast-forward a fresh simulation headlessly (used to seed already-active missions). */
export function warmUp(sim: SimState, env: MissionEnvironment, targetCoverage: number, maxTicks: number): SimState {
  let s: SimState = { ...sim, status: 'running' };
  while (s.tick < maxTicks && s.stats.coverage < targetCoverage) {
    s = stepSimulation(s, env, { detection: false, quiet: true });
  }
  s.status = 'paused';
  s.events = [];
  addLog(s, 'system', `Session resynchronized — ${s.tick} timesteps replayed from mission record`);
  return s;
}

// ---------------------------------------------------------------------------------------------
// External engine (backend) frames
// ---------------------------------------------------------------------------------------------

/** One engine frame in frontend coordinates (x = col, y = row; drone x/y are cell centres). */
export interface EngineFrame {
  tick: number;
  maxTimestep: number;
  status: 'running' | 'finished' | 'stopped';
  hiker: { x: number; y: number } | null;
  drones: { id: string; x: number; y: number; laps?: number }[];
  /** Sim seconds since the start, on the engine's clock. */
  elapsedSec?: number;
  /** The engine's prior (row-major, sums to 1). Used instead of the local prior when present. */
  prior?: Float32Array | null;
}

/**
 * Applies a frame from the backend engine. The engine owns the clock, the prior, and the hiker and
 * drone positions; this keeps everything the engine does not send yet (Bayesian coverage update,
 * sightings, ground-team timing, stats) consistent with those so every view renders as usual.
 */
export function applyEngineFrame(prev: SimState, env: MissionEnvironment, f: EngineFrame, templates: SimDrone[] = prev.drones): SimState {
  const s: SimState = { ...prev, events: [] };
  const opts: StepOptions = { detection: true };
  const g = env.grid;
  const W = g.width;
  const firstFrame = !prev.drones.length || !prev.drones.some((d) => d.objective.startsWith('Engine'));
  const dt = Math.max(0, f.tick - prev.tick);
  s.tick = f.tick;
  s.elapsedSec = f.elapsedSec ?? f.tick * tickSecOf(env);
  if (f.hiker && f.hiker.x >= 0 && f.hiker.y >= 0 && f.hiker.x < W && f.hiker.y < g.height) s.hiker = { x: f.hiker.x, y: f.hiker.y };

  if (dt > 0 || firstFrame) {
    if (f.prior && f.prior.length === s.prior.length) {
      // The engine's prior counts time from the LKP, so the hiker has been mobile for the elapsed time
      s.prior.set(f.prior);
      s.mobileHours = s.elapsedSec / 3600;
    } else {
      const hours = env.hoursMissingAtStart + s.elapsedSec / 3600;
      s.mobileHours = computePrior(env.travelTime, env.behavior, hours, s.prior, env.mobileScale);
    }
    const relax = Math.pow(0.9985, dt);
    const L = s.likelihood;
    for (let i = 0; i < L.length; i++) if (L[i] < 1) L[i] = 1 - (1 - L[i]) * relax;
  }

  // Drones: keep identity per engine id; borrow airframe specs from the template airframes.
  s.drones = f.drones.map((ed, k) => {
    const old = prev.drones.find((d) => d.id === ed.id);
    const t = old ?? templates[k % templates.length];
    if (!t) throw new Error('applyEngineFrame needs at least one template drone');
    const px = old ? old.x : ed.x;
    const py = old ? old.y : ed.y;
    const step = Math.hypot(ed.x - px, ed.y - py);
    const d: SimDrone = {
      ...t,
      id: ed.id,
      name: old?.name ?? `Engine drone ${ed.id}`,
      fleetIndex: k,
      status: f.status === 'running' ? 'searching' : 'standby',
      prevX: px,
      prevY: py,
      x: ed.x,
      y: ed.y,
      heading: step > 0 ? ((Math.atan2(ed.x - px, -(ed.y - py)) * 180) / Math.PI + 360) % 360 : t.heading,
      agl: 90,
      altitude: g.elevation[Math.min(g.height - 1, Math.max(0, Math.floor(ed.y))) * W + Math.min(W - 1, Math.max(0, Math.floor(ed.x)))] + 90,
      distanceM: (old?.distanceM ?? 0) + step * g.cellSizeM,
      trail: [...(old?.trail ?? []), { x: ed.x, y: ed.y }].slice(-160),
      objective: `Engine-controlled${ed.laps !== undefined ? ` · lap ${ed.laps + 1}` : ''}`,
      queue: [],
      currentBlock: -1,
      path: [],
      holdingSignalId: old?.holdingSignalId ?? null,
      passId: f.tick,
      cellsSearched: old?.cellsSearched ?? 0,
    };
    observeAt(s, env, d, ed.x, ed.y, opts);
    return d;
  });

  computePosterior(s.prior, s.likelihood, s.probability);
  for (const sig of s.signals) {
    if (sig.status === 'verifying' && sig.etaTick !== null && s.tick >= sig.etaTick) groundTeamArrives(s, env, sig, opts);
  }
  s.stats = buildStats(env, s.prior, s.likelihood, s.probability, s.cellStatus, s.drones, s.mobileHours, s.blockSearchCount);
  if (s.tick % HISTORY_EVERY === 0 || firstFrame) {
    s.coverageHistory = [...s.coverageHistory, { minute: s.elapsedSec / 60, coverage: s.stats.coverage, unexplored: s.stats.unexploredMass, pos: s.stats.cumulativePos, peak: s.stats.peak.probability }];
  }
  if (s.tick > 0 && s.tick % SNAPSHOT_EVERY === 0) s.snapshots = [...s.snapshots, makeSnapshot(s.probability, W, g.height, s.elapsedSec, s.stats, s.stats.coverage)].slice(-240);

  if (firstFrame) {
    addLog(s, 'system', `Engine stream connected — ${f.drones.length} engine drone${f.drones.length === 1 ? '' : 's'}, ${f.maxTimestep} timesteps`);
    pushEvent(s, opts, { kind: 'launch', severity: 'info', title: 'Engine stream started', message: `${f.drones.map((d) => d.id).join(', ') || 'No drones'} reporting from the engine.` });
  }
  if (f.status === 'running') {
    if (s.status !== 'complete') s.status = 'running';
  } else if (prev.status !== 'complete' && s.status !== 'complete') {
    addLog(s, 'system', f.status === 'finished' ? `Engine run finished at timestep ${f.tick}` : `Engine stream stopped at timestep ${f.tick}`);
    // Keep running only while a sighting is still being worked, so the ground team can finish.
    const open = s.signals.some((x) => x.status === 'pending' || x.status === 'verifying' || x.status === 'on_scene');
    if (!open) {
      s.status = 'complete';
      s.outcome = 'suspended';
      pushEvent(s, opts, { kind: 'mission_complete', severity: 'info', title: 'Engine run ended', message: `The engine reached timestep ${f.tick} without a confirmed find.` });
    }
  }
  s.version = prev.version + 1;
  return s;
}

/** Thermal footprint pass at (px, py) for a drone not driven by the local auction. */
function observeAt(s: SimState, env: MissionEnvironment, d: SimDrone, px: number, py: number, opts: StepOptions) {
  const g = env.grid;
  const W = g.width;
  const r = d.footprint;
  const hikerI = s.hiker.y * W + s.hiker.x;
  for (let cy = Math.max(0, Math.floor(py - r)); cy <= Math.min(g.height - 1, Math.floor(py + r)); cy++)
    for (let cx = Math.max(0, Math.floor(px - r)); cx <= Math.min(W - 1, Math.floor(px + r)); cx++) {
      if ((cx + 0.5 - px) ** 2 + (cy + 0.5 - py) ** 2 > r * r) continue;
      const i = cy * W + cx;
      if (s.lastVisit[i] === d.passId) continue;
      s.lastVisit[i] = d.passId;
      const pod = cellPod(d.basePod, g.vegetationDensity[i]);
      s.likelihood[i] *= 1 - pod;
      s.cellStatus[i] = 2;
      s.owner[i] = d.fleetIndex;
      d.cellsSearched++;
      const open = s.signals.some((x) => x.isTrue && x.status !== 'dismissed' && x.status !== 'false_positive');
      if (i === hikerI && !open && !d.holdingSignalId && s.rng.next() < Math.max(pod, 0.55)) raiseSignal(s, env, d, cx, cy, true, opts);
    }
}

/** After the engine stops, advance only the local clock for ground-team travel to a sighting. */
export function tickGroundTeamOnly(prev: SimState, env: MissionEnvironment): SimState {
  if (prev.status !== 'running') return prev;
  const s: SimState = { ...prev, events: [] };
  s.tick += 1;
  s.elapsedSec += tickSecOf(env);
  for (const sig of s.signals) {
    if (sig.status === 'verifying' && sig.etaTick !== null && s.tick >= sig.etaTick) groundTeamArrives(s, env, sig, { detection: false });
  }
  s.version = prev.version + 1;
  return s;
}
