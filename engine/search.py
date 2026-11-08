'''
Search geometry and belief for the drone search, mirroring the frontend's model
(app/src/services/missionService.ts createEnvironment, probabilityService.ts cellPod) so the
engine's blocks, sectors and detection odds are the ones the app draws.

  Search area  the cells a hiker could have walked to by the end of the sim, clamped to a workable
               number of cells (closest by travel time first)
  Blocks       4x4-cell squares over the grid: the unit the drone auction allocates. Ids "C-0412",
               index = by * blocksW + bx; sectors A..F split the grid 3 columns x 2 rows
  Likelihood   per cell, the product of (1 - POD) over drone passes: the chance the hiker would
               have been missed there. Posterior = prior x likelihood, renormalised
'''

import numpy as np

BLOCK = 4
SECTOR_COLS, SECTOR_ROWS = 3, 2
SECTOR_NAMES = "ABCDEF"
MIN_AREA_CELLS = 1400
MAX_AREA_CELLS = 3400

# Canopy label -> vegetation density, as the app maps it (backendAdapter.ts CANOPY_TO_VEG)
CANOPY_DENSITY = {1: 0.18, 2: 0.62, 3: 0.9}
NOMINAL_POD = 0.9            # sensor quality used to value blocks in the auction
LIKELIHOOD_RELAX = 0.9985    # old negative evidence fades a little each tick (the hiker may move)


def block_label(index: int) -> str:
    return f"C-{index:04d}"


def cell_pod(base_pod: float, density):
    '''Probability a pass detects the hiker in a cell, for a sensor of base_pod under this canopy.'''
    return base_pod * (1 - 0.72 * density)


class SearchGrid:
    '''Static search geometry for one sim (all [row, col]; block centres are continuous [row, col]).'''

    def __init__(self, elevation: np.ndarray, canopy: np.ndarray, travel_time: np.ndarray, total_minutes: float):
        self.H, self.W = elevation.shape
        self.elevation = elevation
        self.density = np.vectorize(lambda c: CANOPY_DENSITY.get(int(c), CANOPY_DENSITY[2]))(canopy).astype(float)
        self.pod = cell_pod(NOMINAL_POD, self.density)

        # Search area: cells within the walk's reach at the end of the sim, clamped like the app
        reachable = np.sort(travel_time[np.isfinite(travel_time)].ravel())
        nominal = int((reachable <= total_minutes).sum())
        target = min(len(reachable), max(MIN_AREA_CELLS, min(MAX_AREA_CELLS, nominal)))
        limit = reachable[max(0, target - 1)] if len(reachable) else 0.0
        self.area = travel_time <= limit
        self.area_cells = int(self.area.sum())

        self.blocks_w = -(-self.W // BLOCK)
        self.blocks_h = -(-self.H // BLOCK)
        self.blocks = []
        for by in range(self.blocks_h):
            for bx in range(self.blocks_w):
                index = by * self.blocks_w + bx
                rows = slice(by * BLOCK, min(self.H, by * BLOCK + BLOCK))
                cols = slice(bx * BLOCK, min(self.W, bx * BLOCK + BLOCK))
                rr, cc = np.nonzero(self.area[rows, cols])
                cells = [(int(r) + rows.start, int(c) + cols.start) for r, c in zip(rr, cc)]
                sc = min(SECTOR_COLS - 1, int(bx / self.blocks_w * SECTOR_COLS))
                sr = min(SECTOR_ROWS - 1, int(by / self.blocks_h * SECTOR_ROWS))
                self.blocks.append({
                    "index": index,
                    "id": block_label(index),
                    "bx": bx,
                    "by": by,
                    "cells": cells,
                    "sector": SECTOR_NAMES[sr * SECTOR_COLS + sc],
                    "center": (by * BLOCK + BLOCK / 2, bx * BLOCK + BLOCK / 2),
                    # The app divides by BLOCK*BLOCK even for edge blocks; match it
                    "meanElevation": float(elevation[rows, cols].sum() / (BLOCK * BLOCK)),
                })
        self.sectors = [s for s in SECTOR_NAMES if any(b["sector"] == s and b["cells"] for b in self.blocks)]

    def block_at(self, row: float, col: float) -> dict | None:
        r, c = int(row // BLOCK), int(col // BLOCK)
        if 0 <= r < self.blocks_h and 0 <= c < self.blocks_w:
            return self.blocks[r * self.blocks_w + c]
        return None

    def payload(self) -> dict:
        '''Static geometry for POST /api/sim (blocks without search-area cells are left out).'''
        return {
            "blockSize": BLOCK,
            "blocksW": self.blocks_w,
            "blocksH": self.blocks_h,
            "sectors": self.sectors,
            "blocks": [{"index": b["index"], "id": b["id"], "sector": b["sector"]} for b in self.blocks if b["cells"]],
            "searchArea": {"data": self.area.astype(int).ravel().tolist(), "dims": [self.H, self.W]},
        }


def posterior(prior: np.ndarray, likelihood: np.ndarray) -> np.ndarray:
    p = prior * likelihood
    total = p.sum()
    return p / total if total > 0 else p
