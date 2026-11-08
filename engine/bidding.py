'''
Bidding auction for multi-drone search allocation, ported from the frontend's runAuctions
(app/src/services/simulationService.ts) so the app's auction visualizer shows engine rounds as is.

Each tick, if some drone needs work, the highest-value unallocated blocks are offered one at a time
(up to 3 rounds). A block's value is the posterior probability it holds times the chance of
spotting the hiker there. Each eligible drone bids that value discounted by the flight (distance
and climb from where its queue ends) and by its current load; a drone that couldn't fly there and
keep a 20% battery reserve bids 0. The highest bid wins and the block joins that drone's queue.
'''

import math

import numpy as np

EXPLORATION_BONUS = 1.6       # never-searched blocks are worth more
CANDIDATES = 8
MAX_ROUNDS = 3
MAX_LOAD = 3                  # blocks a drone may hold (current + queue)
RESERVE = 20                  # battery % a drone must keep after the flight


def run_auctions(sim, probability: np.ndarray) -> list[dict]:
    '''Allocates blocks to drones for this tick; returns the auction rounds held (app's AuctionRound shape)'''
    g = sim.grid
    bidders = [d for d in sim.drones
               if d.status in ("en_route", "searching", "launching") and d.holding_signal is None and d.battery >= 22]

    def load(d):
        return len(d.queue) + (1 if d.current_block >= 0 else 0)

    def needs(d):
        # Room in the queue and enough battery reserve to take on another block
        return load(d) < 2 and d.battery - load(d) * 3 >= 24

    if not any(needs(d) for d in bidders):
        return []

    queued = {bi for d in sim.drones for bi in d.queue}
    values = []
    for b in g.blocks:
        if not b["cells"] or sim.block_owner[b["index"]] >= 0 or b["index"] in queued:
            continue
        rows, cols = zip(*b["cells"])
        v = float((probability[rows, cols] * g.pod[rows, cols]).sum())
        if sim.block_search_count[b["index"]] == 0:
            v *= EXPLORATION_BONUS
        if v > 0:
            values.append((b["index"], v))
    values.sort(key=lambda bv: -bv[1])
    candidates = values[:CANDIDATES]

    rounds = []
    while len(rounds) < MAX_ROUNDS and candidates and any(needs(d) for d in bidders):
        target_bi, target_v = candidates.pop(0)
        b = g.blocks[target_bi]
        b_row, b_col = b["center"]
        bids = []
        for d in bidders:
            l = load(d)
            if l >= MAX_LOAD:
                continue
            last = g.blocks[d.queue[-1]] if d.queue else (g.blocks[d.current_block] if d.current_block >= 0 else None)
            if last:
                f_row, f_col = last["center"]
                from_elev = last["meanElevation"]
            else:
                f_row, f_col = d.y, d.x
                from_elev = float(g.elevation[min(g.H - 1, int(f_row)), min(g.W - 1, int(f_col))])
            horizontal_m = math.hypot(b_col - f_col, b_row - f_row) * sim.cell_size
            vertical_m = abs(b["meanElevation"] - from_elev)
            battery_pct = horizontal_m / 1000 * 1.1 + vertical_m / 100 * 0.7 + 1.4
            feasible = d.battery - l * 3 - battery_pct >= RESERVE
            ev = target_v * 1e4
            score = ev / (1 + horizontal_m / 600 + vertical_m / 250) / (1 + 0.9 * l) if feasible else 0.0
            bids.append({"droneId": d.id, "horizontalM": round(horizontal_m, 1), "verticalM": round(vertical_m, 1),
                         "batteryPct": round(battery_pct, 2), "expectedValue": ev, "load": l, "score": score})
        if not bids:
            break
        bids.sort(key=lambda x: -x["score"])
        win = bids[0] if bids[0]["score"] > 0 else None
        if win is None:
            continue            # nobody can take this block: offer the next one
        rounds.append({
            "tick": sim.tick,
            "blockIndex": target_bi,
            "blockId": b["id"],
            "center": [b_row, b_col],
            "expectedValue": target_v,
            "candidates": [{"blockId": g.blocks[bi]["id"], "blockIndex": bi, "value": v}
                           for bi, v in [(target_bi, target_v), *candidates][:6]],
            "bids": bids,
            "winnerId": win["droneId"],
        })
        drone = next(d for d in sim.drones if d.id == win["droneId"])
        drone.queue.append(target_bi)
        sim.block_owner[target_bi] = drone.index
    return rounds
