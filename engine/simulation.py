import numpy as np

from agents import Hiker, LapDrone, draw_found
from environment import build_grid, make_lkp_fake
from prior import probability_map, ring_times, static_layers

# Sim time per tick. At 3m cells a lost hiker crosses a cell in a few seconds, so with the
# default 100 ticks (10 min) the rings grow to cover a 100x100 grid.
TICK_SECONDS = 6

# The prior is sent as integers 0..PRIOR_LEVELS relative to its maximum; probability of a cell
# = value / PRIOR_LEVELS * prior.max. Cells span ~4 orders of magnitude, so 1/1000 steps would
# round some reachable cells to 0
PRIOR_LEVELS = 100_000


class Simulation:
    '''
    A (fake) simulation: bootstraps everything from its hyperparameters, then advances one
    tick per step(). The clock lives in stream.StreamManager, which calls step() and frame().

    Frame shape (v1):
        {v, simID, tick, maxTimestep, elapsedMinutes, status: "running" | "finished",
         hiker: {current: [row, col], position: [row, col] (continuous), moving,
                 footprint: [[row, col, weight], ...]},
         drones: [{id, pos: [row, col], laps}],
         rings: [25%, 50%, 75%, 95% ring radii in travel-time minutes from the LKP],
         prior: {data: [flattened ints 0..100000], dims, max},
         check: {probability, massAbove, ring}}   how well the prior predicts the true hiker
    '''

    def __init__(self, sim_id: str | None, hyperparameters: dict):
        '''
        Initializes a simulation with some hyperparameters: {N, offset, seed, maxTimestep, cellSize}
        '''
        self.sim_id = sim_id
        self.N = int(hyperparameters["N"])
        self.offset = hyperparameters.get("offset", 1000)
        self.seed = int(hyperparameters["seed"])
        self.max_timestep = int(hyperparameters["maxTimestep"])
        self.cell_size = float(hyperparameters.get("cellSize", 3))
        self.tick = 0

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

    def build_agents(self):
        '''
        Initialize drone agents, hiker agent
        '''
        self.lkp = make_lkp_fake(self.N)
        total_minutes = self.max_timestep * TICK_SECONDS / 60
        self.found = draw_found(self.travel_time, self.lkp, total_minutes, self.seed)
        self.hiker = Hiker(self.elevation, self.travel_time, self.cell_size, self.lkp, self.found, self.max_timestep, self.seed)
        self.drones = [LapDrone("lap-1", self.N)]

    @property
    def elapsed_minutes(self) -> float:
        return self.tick * TICK_SECONDS / 60

    @property
    def done(self) -> bool:
        return self.tick >= self.max_timestep

    def step(self):
        '''
        This function updates all agents in the simulation, in a fixed order:
        hiker first (ground truth), then drones.
        '''
        self.tick += 1
        self.hiker.step()
        for drone in self.drones:
            drone.move()

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
        p = self.probability()
        peak = float(p.max())
        levels = np.round(p / peak * PRIOR_LEVELS).astype(int) if peak > 0 else np.zeros_like(p, dtype=int)
        return {
            "v": 1,
            "simID": self.sim_id,
            "tick": self.tick,
            "maxTimestep": self.max_timestep,
            "elapsedMinutes": round(self.elapsed_minutes, 3),
            "status": "finished" if self.done else "running",
            "hiker": self.hiker.state(),
            "drones": [drone.state() for drone in self.drones],
            "rings": [round(float(r), 3) for r in ring_times(self.elapsed_minutes)],
            "prior": {"data": levels.ravel().tolist(), "dims": list(p.shape), "max": peak},
            "check": self.check(p),
        }
