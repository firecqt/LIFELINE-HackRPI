import numpy as np

from agents import Hiker, draw_found
from bidding import run_auctions
from drones import AIRBORNE, Drone
from environment import build_grid, make_lkp_fake
from prior import probability_map, ring_times, static_layers
from search import LIKELIHOOD_RELAX, SearchGrid, posterior

# Sim time per tick. At 3m cells a lost hiker crosses a cell in a few seconds, so with the
# default 100 ticks (10 min) the rings grow to cover a 100x100 grid.
TICK_SECONDS = 6

# The prior is sent as integers 0..PRIOR_LEVELS relative to its maximum; probability of a cell
# = value / PRIOR_LEVELS * prior.max. Cells span ~4 orders of magnitude, so 1/1000 steps would
# round some reachable cells to 0
PRIOR_LEVELS = 100_000

# Fleet used when a sim's hyperparameters don't list its drones (older sims, calibrate.py)
DEFAULT_DRONES = [
    {"id": f"D-0{k + 1}", "cruiseSpeedMs": 15, "footprintM": 45, "basePod": 0.85, "flightTimeMin": 40, "battery": 100}
    for k in range(4)
]
# A pass that clears a signal as not the subject also lowers the odds nearby (5x5 cells)
CLEARED_LIKELIHOOD = 0.25


class Simulation:
    '''
    A (fake) simulation: bootstraps everything from its hyperparameters, then advances one
    tick per step(). The clock lives in stream.StreamManager, which calls step() and frame().

    Frame shape (v2):
        {v, simID, tick, maxTimestep, elapsedMinutes, status: "running" | "finished" | "located",
         hiker: {current: [row, col], position: [row, col] (continuous), moving,
                 footprint: [[row, col, weight], ...]},
         drones: [{id, pos: [row, col] (continuous), status, objective, battery, heading, agl,
                   currentBlock, queue, path: [[row, col, mode]], distanceM, cellsSearched,
                   blocksCompleted, holdingSignalId}]     (see drones.Drone.state)
         rings: [25%, 50%, 75%, 95% ring radii in travel-time minutes from the LKP],
         prior: {data: [flattened ints 0..100000], dims, max},
         likelihood: {data: [flattened floats], dims}   chance the hiker was missed in each cell;
                                                          posterior = prior x likelihood, renormalised
         blockOwner: [drone index or -1, per block], blockSearchCount: [passes completed, per block],
         searched: [[flat cell index, drone index], ...]  cells swept since the last frame
         auctions: [rounds since the last frame]          (see bidding.run_auctions)
         signals: [{id, droneId, pos, confidence, tick, isTrue, status: pending | released | confirmed}]
         events: [{kind, tick, ...}] since the last frame: launch, landed, low_battery, block_complete,
                 sector_complete, detection
         check: {probability, massAbove, ring}}   how well the prior predicts the true hiker
    frame() hands out the per-tick lists (searched, auctions, events) and clears them, so call it
    once per published frame.
    '''

    def __init__(self, sim_id: str | None, hyperparameters: dict):
        '''
        Initializes a simulation with some hyperparameters:
        {N, offset, seed, maxTimestep, cellSize, drones?: [{id, cruiseSpeedMs, footprintM, basePod,
        flightTimeMin, battery?}]}
        '''
        self.sim_id = sim_id
        self.N = int(hyperparameters["N"])
        self.offset = hyperparameters.get("offset", 1000)
        self.seed = int(hyperparameters["seed"])
        self.max_timestep = int(hyperparameters["maxTimestep"])
        self.cell_size = float(hyperparameters.get("cellSize", 3))
        drones = hyperparameters.get("drones")
        self.drone_specs = DEFAULT_DRONES if drones is None else drones    # [] = no drones
        self.tick = 0
        self.located = False

        self.build_environment()
        self.build_agents()

    def build_environment(self):
        '''
        Using hyperparameters, build environment features elevations, canopies
        (deterministic from the seed, and cached, so this matches what POST /api/sim returned)
        '''
        self.elevation = build_grid("elevation", self.N, self.offset, self.seed, self.cell_size)
        self.canopy = build_grid("canopy", self.N, self.offset, self.seed, self.cell_size)
        # Static inputs to the prior: travel time from the LKP and behavioural weights
        self.travel_time, self.weights = static_layers(self.N, self.offset, self.seed, self.cell_size)
        total_minutes = self.max_timestep * TICK_SECONDS / 60
        self.grid = SearchGrid(self.elevation, self.canopy, self.travel_time, total_minutes)

        # Search state (drones update it in place)
        self.likelihood = np.ones((self.N, self.N))
        self.last_visit = np.zeros((self.N, self.N), dtype=int)
        self.block_owner = np.full(len(self.grid.blocks), -1, dtype=int)
        self.block_search_count = np.zeros(len(self.grid.blocks), dtype=int)
        self.sectors_complete: list[str] = []
        self.signals: list[dict] = []
        self.pass_seq = 0
        self.rng = np.random.default_rng([self.seed, 3])
        self.prior_map = self.probability()

        # Per-frame outputs, handed out (and cleared) by frame()
        self.events: list[dict] = []
        self.auctions: list[dict] = []
        self.searched: list[list[int]] = []

    def build_agents(self):
        '''
        Initialize drone agents, hiker agent
        '''
        self.lkp = make_lkp_fake(self.N)
        total_minutes = self.max_timestep * TICK_SECONDS / 60
        self.found = draw_found(self.travel_time, self.lkp, total_minutes, self.seed)
        self.hiker = Hiker(self.elevation, self.travel_time, self.cell_size, self.lkp, self.found, self.max_timestep, self.seed)
        # Drones stage at the LKP (where the search starts)
        self.base = list(self.lkp)
        self.drones = [Drone(spec, k, self.base, self.cell_size, TICK_SECONDS) for k, spec in enumerate(self.drone_specs)]

    @property
    def elapsed_minutes(self) -> float:
        return self.tick * TICK_SECONDS / 60

    @property
    def elapsed_seconds(self) -> float:
        return self.tick * TICK_SECONDS

    @property
    def done(self) -> bool:
        return self.located or self.tick >= self.max_timestep

    def step(self):
        '''
        This function updates all agents in the simulation, in a fixed order:
        hiker (ground truth) -> prior -> drones (flight, sweeps, detections) -> auction.
        '''
        self.tick += 1
        self.hiker.step()
        self.prior_map = self.probability()
        # Old negative evidence fades a little (the hiker may have walked into a searched cell)
        searched = self.likelihood < 1
        self.likelihood[searched] = 1 - (1 - self.likelihood[searched]) * LIKELIHOOD_RELAX

        for drone in self.drones:
            drone.update(self)
        self.auctions += run_auctions(self, posterior(self.prior_map, self.likelihood))

    # ------------------------------------------------------------------ hooks for drones and bidding

    def event(self, kind: str, **fields):
        self.events.append({"kind": kind, "tick": self.tick, **fields})

    def next_pass(self) -> int:
        self.pass_seq += 1
        return self.pass_seq

    def signal(self, signal_id: str) -> dict | None:
        return next((s for s in self.signals if s["id"] == signal_id), None)

    def true_signal_open(self) -> bool:
        return any(s["isTrue"] and s["status"] != "released" for s in self.signals)

    def mark_searched(self, row: int, col: int, drone_index: int):
        self.searched.append([row * self.N + col, drone_index])

    # ------------------------------------------------------------------ ranger commands

    def resolve_signal(self, signal_id: str, action: str) -> dict:
        '''
        A ranger's decision on a signal:
          dispatch                          ground team sent; the drone keeps orbiting
          dismiss                           ranger dismissed it; the drone resumes searching
          false_positive | not_subject      the team found something else there: the drone resumes
                                            and the area nearby counts as searched
          confirmed                         subject found: the sim ends and drones return to base
        '''
        sig = self.signal(signal_id)
        if sig is None:
            raise ValueError(f"Unknown signal {signal_id}")
        if action == "dispatch":
            return {"status": sig["status"]}
        if action == "confirmed":
            sig["status"] = "confirmed"
            self.located = True
            for d in self.drones:
                d.holding_signal = None
                if d.status in AIRBORNE:
                    d.release_work(self)
                    d.return_to_base("Mission complete — returning to base")
            return {"status": "confirmed"}
        if action not in ("dismiss", "false_positive", "not_subject"):
            raise ValueError(f"Unknown signal action {action}")
        sig["status"] = "released"
        for d in self.drones:
            if d.holding_signal == signal_id:
                d.holding_signal = None
        if action != "dismiss":
            r, c = int(sig["pos"][0]), int(sig["pos"][1])
            self.likelihood[max(0, r - 2):r + 3, max(0, c - 2):c + 3] *= CLEARED_LIKELIHOOD
        return {"status": "released"}

    def probability(self) -> np.ndarray:
        '''Probability map for the hiker's location at the current elapsed time'''
        return probability_map(self.travel_time, self.weights, self.elapsed_minutes)

    def check(self, p: np.ndarray) -> dict:
        '''
        How well the prior predicts the true hiker (for evaluation; drones never see this):
          probability: prior probability of the hiker's cell
          massAbove:   share of probability in cells the prior rates higher than the hiker's cell
                       (0 = the prior's best guess, near 1 = the prior thinks it's very unlikely)
          ring:        which ring the hiker is in (0..3 = 25/50/75/95%, 4 = outside the 95% ring)
        '''
        r, c = self.hiker.cell
        here = p[r, c]
        ring = int(np.searchsorted(ring_times(self.elapsed_minutes), self.travel_time[r, c], side='left'))
        return {
            "probability": float(here),
            "massAbove": round(float(p[p > here].sum()), 4),
            "ring": ring,
        }

    def frame(self) -> dict:
        '''
        The simulation state at the current tick, to be put on the WebSocket stream
        '''
        p = self.prior_map
        peak = float(p.max())
        levels = np.round(p / peak * PRIOR_LEVELS).astype(int) if peak > 0 else np.zeros_like(p, dtype=int)
        frame = {
            "v": 2,
            "simID": self.sim_id,
            "tick": self.tick,
            "maxTimestep": self.max_timestep,
            "elapsedMinutes": round(self.elapsed_minutes, 3),
            "status": "located" if self.located else "finished" if self.done else "running",
            "hiker": self.hiker.state(),
            "drones": [drone.state() for drone in self.drones],
            "rings": [round(float(r), 3) for r in ring_times(self.elapsed_minutes)],
            "prior": {"data": levels.ravel().tolist(), "dims": list(p.shape), "max": peak},
            "likelihood": {"data": [float(f"{v:.4g}") for v in self.likelihood.ravel()], "dims": [self.N, self.N]},
            "blockOwner": self.block_owner.tolist(),
            "blockSearchCount": self.block_search_count.tolist(),
            "searched": self.searched,
            "auctions": self.auctions,
            "signals": [dict(s) for s in self.signals],
            "events": self.events,
            "check": self.check(p),
        }
        self.searched, self.auctions, self.events = [], [], []
        return frame
