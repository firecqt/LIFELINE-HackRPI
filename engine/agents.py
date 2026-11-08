import numpy as np

from prior import RING_FRACTIONS


# ---------------------------------- hiker (ground truth) ----------------------------------
#
# A simple random walk toward the hiker's (fake) found location. Each tick the heading is a mix of
#   momentum   the direction of the last step
#   downhill   minus the terrain gradient, capped at unit length (full pull at SLOPE_CAP and steeper)
#   goal       unit vector toward the found location, pulling harder as time runs out
#   noise      Gaussian jitter
# Pauses: a Koester-style ring around the LKP grows to reach the found location on the last tick.
# Like the prior's rings it is an isochrone (travel time from the LKP), not a circle. A step that
# would take the hiker outside it becomes a rest (it waits for the ring), and the hiker also rests at
# random now and then.

MOMENTUM_WEIGHT = 0.6
DOWNHILL_WEIGHT = 0.3
GOAL_WEIGHT = 0.4             # grows to 3x by the last tick, so the walk ends at the found location
NOISE = 0.5                   # std of the jitter added to the heading vector
SLOPE_CAP = 0.3               # slope (rise/run) at which the downhill pull saturates
STEP_CELLS = 1.0              # distance walked per moving tick
REST_CHANCE = 0.1             # chance of resting on any tick
RING_SLACK_SECONDS = 4.0      # slack on the pacing ring, so slow hikers can take whole steps
FOOTPRINT_SIGMA_CELLS = 1.0   # "fat path": the hiker's position is spread over nearby cells
FOOTPRINT_MIN_WEIGHT = 0.01


# Where the hiker is found. Its travel time from the LKP, as a share of the sim's length ("reach"),
# is drawn from ISRID's hiker distance quantiles: 25/50/75/95% of hikers within RING_FRACTIONS of
# the 95% ring. Since the ring paces the walk to make linear progress, a hiker's reach stays about the same
# throughout the sim, so the population fills the prior's rings in ISRID's proportions.
# Reach is capped at MAX_REACH: further than that the walk can't get there in time.
MAX_REACH = 0.6
REACH_QUANTILES = np.concatenate([[0.0], RING_FRACTIONS, [1.0]])
REACH_PROBS = np.array([0.0, 0.25, 0.5, 0.75, 0.95, 1.0])


def draw_found(travel_time: np.ndarray, lkp: list[int], total_minutes: float, seed: int) -> list[int]:
    '''
    The (fake) found location as [row, col]: in a random direction from the LKP, at the cell
    whose travel time is closest to the drawn reach * total_minutes (or the grid edge). Deterministic.
    '''
    rng = np.random.default_rng([seed, 2])
    reach = min(float(np.interp(rng.random(), REACH_PROBS, REACH_QUANTILES)), MAX_REACH)
    target = reach * total_minutes
    angle = rng.uniform(0, 2 * np.pi)
    direction = np.array([np.sin(angle), np.cos(angle)])
    N = travel_time.shape[0]
    found = list(lkp)
    for d in np.arange(0, 2 * N, 0.25):
        r, c = np.round(np.array(lkp) + d * direction).astype(int)
        if not (0 <= r < N and 0 <= c < N):
            break
        if travel_time[r, c] > target:
            # the first cell past the target or the last one before it, whichever is closer in time
            if travel_time[r, c] - target < target - travel_time[tuple(found)]:
                found = [int(r), int(c)]
            break
        found = [int(r), int(c)]
    return found


class Hiker:
    '''
    The lost hiker (ground truth). Walks from `start` (the LKP) toward `found`, one tick per step().
    Deterministic from its seed, so a replayed sim follows the same path.
    '''

    def __init__(self, elevation: np.ndarray, travel_time: np.ndarray, cell_size: float, start: list[int],
                 found: list[int], max_timestep: int, seed: int):
        self.N = elevation.shape[0]
        self.start_cell = list(start)
        self.found = list(found)
        self.max_timestep = max(1, max_timestep)
        self.rng = np.random.default_rng([seed, 1])

        # Downhill direction per cell as [d_row, d_col], length <= 1
        if min(elevation.shape) < 2:
            self.downhill = np.zeros(elevation.shape + (2,))
        else:
            slope = np.stack(np.gradient(elevation, cell_size), axis=-1)
            self.downhill = -slope / np.maximum(np.linalg.norm(slope, axis=-1, keepdims=True), SLOPE_CAP)

        self.start = np.array(start, dtype=float)
        self.pos = self.start.copy()
        self.goal = np.array(found, dtype=float)
        self.travel_time = travel_time                          # minutes from the LKP, per cell
        self.found_minutes = float(travel_time[tuple(found)])
        self.heading = np.zeros(2)
        self.moving = False
        self.tick = 0

    def step(self):
        '''
        Moves (or rests) for one tick
        '''
        self.tick += 1
        to_goal = self.goal - self.pos
        dist = float(np.linalg.norm(to_goal))
        ring = self.tick / self.max_timestep        # how far the ring has grown, 0..1
        limit = ring * self.found_minutes + RING_SLACK_SECONDS / 60   # the ring, in travel-time minutes

        self.moving = False
        if dist == 0 or self.rng.random() < REST_CHANCE:
            return
        if dist <= STEP_CELLS:                      # close enough: step onto the found location
            new = self.goal.copy()
        else:
            r, c = self.cell
            v = (MOMENTUM_WEIGHT * self.heading
                 + DOWNHILL_WEIGHT * self.downhill[r, c]
                 + GOAL_WEIGHT * (1 + 2 * ring) * to_goal / dist
                 + self.rng.normal(0, NOISE, 2))
            norm = np.linalg.norm(v)
            if norm == 0:
                return
            self.heading = v / norm
            new = np.clip(self.pos + STEP_CELLS * self.heading, 0, self.N - 1)
        r, c = np.round(new).astype(int)
        if self.travel_time[r, c] > limit and dist > STEP_CELLS:   # would leave the ring: wait for it
            return
        self.pos = new
        self.moving = True

    @property
    def position(self) -> list[float]:
        return self.pos.tolist()

    @property
    def cell(self) -> list[int]:
        return [int(round(v)) for v in self.pos]

    @property
    def end(self) -> list[int]:
        return list(self.found)

    def footprint(self) -> list[list]:
        '''
        The "fat path": the hiker's position spread over nearby cells as a Gaussian of
        FOOTPRINT_SIGMA_CELLS, as [[row, col, weight], ...] with weights summing to 1.
        '''
        r0, c0 = self.pos
        reach = int(np.ceil(3 * FOOTPRINT_SIGMA_CELLS))
        rows = np.arange(max(0, int(r0) - reach), min(self.N, int(r0) + reach + 2))
        cols = np.arange(max(0, int(c0) - reach), min(self.N, int(c0) + reach + 2))
        rr, cc = np.meshgrid(rows, cols, indexing='ij')
        w = np.exp(-((rr - r0) ** 2 + (cc - c0) ** 2) / (2 * FOOTPRINT_SIGMA_CELLS ** 2))
        w /= w.sum()
        keep = w >= FOOTPRINT_MIN_WEIGHT
        w = w[keep] / w[keep].sum()
        return [[int(r), int(c), round(float(x), 4)] for r, c, x in zip(rr[keep], cc[keep], w)]

    def state(self) -> dict:
        return {
            "current": self.cell,
            "position": [round(v, 3) for v in self.position],
            "moving": bool(self.moving),
            "footprint": self.footprint(),
        }
