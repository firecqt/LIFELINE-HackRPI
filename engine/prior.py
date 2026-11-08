'''
Behavioural prior for where a lost hiker is, as an NxN probability grid.

Pipeline (static parts are computed once per simulation, rings change with elapsed time):
  1. Travel time from the LKP (static): a slower, off-path Tobler speed per cell, then
     least-cost travel time from the LKP with skimage's MCP_Geometric (8-connected).
  2. Behavioural weights (static), from Koester's lost-hiker heuristics:
       - drainage attraction: people funnel into valley bottoms / drainages
       - downhill bias: lost hikers tend to go downhill from where they were last seen
  3. Isochronic rings (per tick): Koester-style probability rings, but bounded by travel time
     instead of straight-line distance. The outer (95%) ring is the farthest the hiker could have
     walked in the elapsed time; inner rings sit at ISRID hiker quantile ratios of it.
     Each ring gets its share of the probability mass (25/25/25/20%), spread over its cells in
     proportion to the behavioural weights. The 5% beyond the 95% ring is unreachable here and
     is dropped by renormalisation.
'''

from functools import lru_cache

import numpy as np
from scipy.ndimage import gaussian_filter, minimum_filter
from skimage.graph import MCP_Geometric

from environment import build_grid, make_lkp_fake

# Tobler's hiking function scaled by 0.6 (Tobler's own off-path factor): lost hikers are off-trail
OFF_PATH_FACTOR = 0.6
MIN_SPEED_KMH = 0.06

# ISRID (Koester, Lost Person Behavior 2008) straight-line distance from the IPP for the HIKER
# category, temperate / mountainous ecoregion, in km, for the 25/50/75/95% quantiles.
# 25-75% (1.1 / 3.1 / 5.8) agree across secondary sources; the 95% value is reported as 18.3 km in a
# Yosemite study comparing against the ISRID temperate-mountainous subset, but 11.3 km elsewhere.
# Not verified against the book itself: check the table before relying on it.
ISRID_HIKER_KM = np.array([1.1, 3.1, 5.8, 18.3])

# Ring boundaries as fractions of the 95% ring, inner to outer (25%, 50%, 75%, 95%). Only ISRID's
# shape is used: its km are straight-line distances over hours to days, applied here to travel time
# over minutes. The 95% ring is the physical limit (the farthest the hiker could have walked).
RING_FRACTIONS = ISRID_HIKER_KM / ISRID_HIKER_KM[-1]
RING_MASS = np.array([0.25, 0.25, 0.25, 0.20])

DOWNHILL_BOOST = 1.5
UPHILL_PENALTY = 0.7


def tobler_speed_kmh(slope: np.ndarray) -> np.ndarray:
    '''Slower (off-path) Tobler walking speed for a slope given as rise/run.'''
    speed = OFF_PATH_FACTOR * 6.0 * np.exp(-3.5 * np.abs(slope + 0.05))
    return np.maximum(speed, MIN_SPEED_KMH)


def travel_time_minutes(elevation: np.ndarray, cell_size: float, lkp: list[int]) -> np.ndarray:
    '''
    Least-cost walking time from the LKP to every cell, in minutes.
    Slope is the smoothed gradient magnitude, so cost is the same in every direction
    (a simplification: real Tobler is faster slightly downhill than uphill).
    '''
    if min(elevation.shape) < 2:      # np.gradient needs 2+ cells per axis; a 1-cell grid is flat
        slope = np.zeros_like(elevation)
    else:
        dy, dx = np.gradient(gaussian_filter(elevation, sigma=1.0), cell_size)
        slope = np.hypot(dy, dx)
    hours_per_cell = (cell_size / 1000.0) / tobler_speed_kmh(slope)
    hours, _ = MCP_Geometric(hours_per_cell).find_costs([tuple(lkp)])
    return hours * 60.0


def behavioural_weights(elevation: np.ndarray, lkp: list[int]) -> np.ndarray:
    '''
    Relative attractiveness of each cell to a lost hiker (unnormalised, > 0).
      drainage: height above the lowest point in a 5x5 neighbourhood; 0 = valley bottom.
                The decay scale is the grid's median, so it adapts to the terrain's relief.
      downhill: cells below the LKP are boosted, cells above it penalised.
    '''
    drainage_metric = elevation - minimum_filter(elevation, size=5)
    scale = max(float(np.median(drainage_metric)), 1e-6)
    drainage = np.exp(-drainage_metric / scale)

    downhill = np.where(elevation < elevation[tuple(lkp)], DOWNHILL_BOOST, UPHILL_PENALTY)
    return drainage * downhill


def ring_times(elapsed_minutes: float) -> np.ndarray:
    '''Travel-time radii of the 25/50/75/95% rings after this much elapsed time.'''
    return RING_FRACTIONS * elapsed_minutes


def probability_map(travel_time: np.ndarray, weights: np.ndarray, elapsed_minutes: float) -> np.ndarray:
    '''Probability of the hiker being in each cell (sums to 1).'''
    if elapsed_minutes <= 0:
        p = np.zeros_like(travel_time)
        p[np.unravel_index(np.argmin(travel_time), travel_time.shape)] = 1.0
        return p

    rings = ring_times(elapsed_minutes)
    # Ring index per cell: 0..3 inside the rings, 4 = beyond the 95% ring (unreachable)
    ring = np.searchsorted(rings, travel_time, side='left')
    inside = ring < len(rings)

    # Each ring's mass is spread over its cells in proportion to their weights
    ring_weight = np.bincount(ring[inside], weights=weights[inside], minlength=len(rings))
    per_ring = np.divide(RING_MASS, ring_weight, out=np.zeros(len(rings)), where=ring_weight > 0)

    p = np.zeros_like(travel_time)
    p[inside] = weights[inside] * per_ring[ring[inside]]
    total = p.sum()
    return p / total if total > 0 else p


@lru_cache(maxsize=8)
def static_layers(N: int, offset: float, seed: int, cell_size: float) -> tuple[np.ndarray, np.ndarray]:
    '''
    (travel_time_minutes, behavioural_weights) for a sim, from its hyperparameters.
    The LKP is the fake hiker's start. Cached: created and streamed sims share the work.
    '''
    elevation = build_grid("elevation", N, offset, seed, cell_size)
    lkp = make_lkp_fake(N)
    return travel_time_minutes(elevation, cell_size, lkp), behavioural_weights(elevation, lkp)
