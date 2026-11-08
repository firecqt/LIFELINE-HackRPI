'''
Calibration check: how often does the simulated hiker fall inside each of the prior's rings?

For a well-calibrated prior, the share of hikers inside the 25/50/75/95% rings should be close to
25/50/75/95%. Run from engine/:   .venv/bin/python calibrate.py [--seeds 200]

The walker's found locations are drawn from ISRID's hiker distance quantiles and its walk is paced on
the same travel-time rings, so the ring shares mostly confirm that pacing works (the 95% ring is always
100%: nobody can walk further). The real test of the prior is its behavioural weights (drainage,
downhill), which the walker doesn't use. Don't tune the prior to fit the walker: change either only
when real data (ISRID etc.) says so.
'''

import argparse

import numpy as np

from prior import RING_FRACTIONS, ring_times
from simulation import TICK_SECONDS, Simulation


def run(seeds: int, N: int, cell_size: float, max_timestep: int, ticks: list[int]):
    # No drones: only the hiker's walk is measured
    base = {'N': N, 'offset': 1000, 'maxTimestep': max_timestep, 'cellSize': cell_size, 'drones': []}
    rings_at = {t: [] for t in ticks}
    reach_at = {t: [] for t in ticks}
    resting, edge = [], 0

    for seed in range(seeds):
        sim = Simulation(None, {**base, 'seed': seed})
        positions, moving = [sim.hiker.pos.copy()], []
        while not sim.done:
            sim.step()
            positions.append(sim.hiker.pos.copy())
            moving.append(sim.hiker.moving)
        trajectory = np.array(positions)
        resting.append(1 - np.mean(moving))
        for t in ticks:
            r, c = (int(round(v)) for v in trajectory[t])
            elapsed = t * TICK_SECONDS / 60
            T = sim.travel_time[r, c]
            rings_at[t].append(int(np.searchsorted(ring_times(elapsed), T, side='left')))
            reach_at[t].append(T / elapsed)
        if np.any(trajectory[-1] <= 0.5) or np.any(trajectory[-1] >= N - 1.5):
            edge += 1

    print(f"{seeds} seeds, {N}x{N} cells of {cell_size} m, {TICK_SECONDS} s per tick")
    print("Share of hikers inside each ring (a calibrated prior matches the ring's name):")
    print(f"{'tick':>5} {'min':>5} | {'25%':>5} {'50%':>5} {'75%':>5} {'95%':>5} | median reach (T_hiker / elapsed)")
    for t in ticks:
        rings = np.array(rings_at[t])
        inside = [(rings <= k).mean() * 100 for k in range(4)]
        print(f"{t:5} {t * TICK_SECONDS / 60:5.1f} | " + " ".join(f"{v:4.0f}%" for v in inside)
              + f" | {np.median(reach_at[t]):.2f}")
    pooled = np.array([r for t in ticks for r in rings_at[t]])
    print(f"{'all':>11} | " + " ".join(f"{(pooled <= k).mean() * 100:4.0f}%" for k in range(4)))

    # The walker population's distance shape vs ISRID's
    reach = np.array([r for t in ticks for r in reach_at[t]])
    q = np.quantile(reach, [0.25, 0.5, 0.75, 0.95])
    print(f"walker reach 25/50/75% as a share of its 95%: {np.round(q[:3] / q[3], 3).tolist()}"
          f"  (ISRID hiker: {np.round(RING_FRACTIONS[:3], 3).tolist()})")
    print(f"resting share: mean {np.mean(resting) * 100:.0f}% | walks ending at the grid edge: {edge}/{seeds}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--seeds', type=int, default=200)
    parser.add_argument('--N', type=int, default=100)
    parser.add_argument('--cell-size', type=float, default=3.0)
    parser.add_argument('--max-timestep', type=int, default=100)
    args = parser.parse_args()
    ticks = sorted({max(1, round(args.max_timestep * f)) for f in (0.2, 0.4, 0.6, 0.8, 1.0)})
    run(args.seeds, args.N, args.cell_size, args.max_timestep, ticks)
