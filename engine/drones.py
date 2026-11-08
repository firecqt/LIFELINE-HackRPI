'''
Search drones, ported from the frontend's local simulation (app/src/services/simulationService.ts:
makeSimDrone, updateDrone, moveAlongPath, startNextBlock, lawnmower, markSearch, completeBlock,
releaseWork) so engine searches behave like the app's own.

Life cycle:  standby -> preparing -> launching -> en_route <-> searching
             -> low_battery -> returning -> charging -> preparing ...
A drone works through blocks it won at auction (bidding.py): it flies to a block, sweeps it in a
lawnmower pattern, and every cell under its thermal footprint lowers the likelihood there. Sweeping
the hiker's cell may raise a detection signal; the drone then orbits it until a ranger resolves it.

Internally positions are continuous x = column, y = row (like the app); state() reports [row, col].
'''

import math

from search import BLOCK, cell_pod

AGL = 100
AIRBORNE = {"launching", "en_route", "searching", "returning", "low_battery"}
APP_TICK_SECONDS = 20         # the app's tick; per-tick rates below were tuned for it
CHARGE_PER_APP_TICK = 3.2     # battery % gained per app tick on the charger
LOW_BATTERY = 20
FALSE_SIGNAL_AFTER_SECONDS = 25 * APP_TICK_SECONDS
FALSE_SIGNAL_RATE = 0.00028   # per cell pass, scaled by canopy
MAX_FALSE_SIGNALS = 2
TRUE_SIGNAL_MIN_ODDS = 0.55   # a responsive subject is easier to spot than the canopy-limited POD


def lawnmower(bx: int, by: int, px: float, py: float) -> list[tuple]:
    '''Two sweep rows across a block, starting from the corner nearest (px, py): [(x, y, mode)].'''
    x0, y0 = bx * BLOCK, by * BLOCK
    xs = [x0 + 0.5, x0 + BLOCK - 0.5]
    ys = [y0 + 1, y0 + 3]
    sx, sy = min(((xi, yi) for xi in range(2) for yi in range(2)),
                 key=lambda p: math.hypot(xs[p[0]] - px, ys[p[1]] - py))
    a, b = xs[sx], xs[1 - sx]
    r1, r2 = ys[sy], ys[1 - sy]
    return [(a, r1, "transit"), (b, r1, "search"), (b, r2, "search"), (a, r2, "search")]


class Drone:

    def __init__(self, spec: dict, k: int, base: list[int], cell_size: float, tick_seconds: float):
        '''
        spec: {id, cruiseSpeedMs, footprintM, basePod, flightTimeMin, battery?}; k: fleet index;
        base: staging cell [row, col]
        '''
        self.id = str(spec["id"])
        self.index = k
        self.tick_seconds = tick_seconds
        self.cell_size = cell_size
        self.base = base
        self.speed_transit = float(spec["cruiseSpeedMs"]) * tick_seconds / cell_size   # cells per tick
        self.speed_search = self.speed_transit * 0.55
        self.footprint = max(1.02, float(spec["footprintM"]) / cell_size)            # radius in cells
        self.base_pod = float(spec["basePod"])
        self.flight_time_min = float(spec["flightTimeMin"])

        self.x = base[1] + 0.5 + ((k % 3) - 1) * 0.6
        self.y = base[0] + 0.5 + ((k // 3) - 1) * 0.6
        self.status = "standby"
        self.objective = "Standby at base"
        self.battery = max(35.0, float(spec.get("battery", 100)))
        self.agl = 0.0
        self.heading = 0.0
        self.queue: list[int] = []
        self.current_block = -1
        self.path: list[tuple] = []
        self.distance_m = 0.0
        self.cells_searched = 0
        self.blocks_completed = 0
        self.launch_tick = 1 + k * 2
        self.state_ticks = 0
        self.holding_signal = None
        self.low_battery_warned = False
        self.pass_id = 0

    # ------------------------------------------------------------------ state machine

    def set_status(self, status: str, objective: str):
        self.status = status
        self.objective = objective
        self.state_ticks = 0

    def drain(self, sim) -> float:
        '''Battery % used this tick: 100 -> 20 over the rated flight time'''
        ticks = self.flight_time_min * 60 / self.tick_seconds
        return 80 / ticks * (1.08 if self.status == "searching" else 1) * sim.rng.uniform(0.94, 1.06)

    def update(self, sim):
        self.state_ticks += 1
        match self.status:
            case "standby":
                if sim.tick >= self.launch_tick:
                    self.set_status("preparing", "Pre-flight checks · IMU & thermal calibration")
            case "preparing":
                if self.state_ticks >= 2:
                    self.set_status("launching", f"Climbing to {AGL} m AGL")
                    sim.event("launch", droneId=self.id)
            case "launching":
                self.agl = min(AGL, self.agl + 50)
                if self.agl >= AGL:
                    self.set_status("en_route", "Awaiting auction assignment")
            case "charging":
                self.battery = min(100.0, self.battery + CHARGE_PER_APP_TICK * self.tick_seconds / APP_TICK_SECONDS)
                self.objective = f"Charging at base · {round(self.battery)}%"
                if self.battery >= 95:
                    self.low_battery_warned = False
                    self.set_status("preparing", "Battery swap complete · pre-flight checks")
            case "low_battery":
                self.set_status("returning", "Return to base (low battery)")
                self.path = [(self.base[1] + 0.5, self.base[0] + 0.5, "return")]
            case "returning":
                self.move_along_path(sim)
                if not self.path:
                    self.agl = max(0.0, self.agl - 50)
                    if self.agl <= 0:
                        self.set_status("charging", "Charging at base")
                        sim.event("landed", droneId=self.id)
            case "en_route" | "searching":
                self.fly(sim)

        if self.status in AIRBORNE:
            self.battery = max(0.0, self.battery - self.drain(sim))

    def fly(self, sim):
        if self.battery < LOW_BATTERY and not self.low_battery_warned:
            self.low_battery_warned = True
            self.release_work(sim)
            self.holding_signal = None
            self.set_status("low_battery", f"Battery {round(self.battery)}% — return-to-base recommended")
            sim.event("low_battery", droneId=self.id, battery=round(self.battery))
            return
        if self.holding_signal is not None:
            sig = sim.signal(self.holding_signal)
            if sig is not None:
                a = sim.tick * 0.9
                self.x = sig["pos"][1] + math.cos(a) * 0.9
                self.y = sig["pos"][0] + math.sin(a) * 0.9
                self.heading = (math.degrees(a) + 180) % 360
                self.status = "searching"
                self.objective = f"Orbiting potential detection {sig['id']} · awaiting ranger"
            return
        if not self.path:
            self.start_next_block(sim)
        if self.path:
            self.move_along_path(sim)
        else:
            self.status = "en_route"
            self.objective = "Holding · awaiting auction assignment"

    # ------------------------------------------------------------------ movement and sensing

    def move_along_path(self, sim):
        budget = 1.0    # fraction of the tick left
        while budget > 1e-4 and self.path:
            wx, wy, mode = self.path[0]
            speed = self.speed_search if mode == "search" else self.speed_transit
            dx, dy = wx - self.x, wy - self.y
            dist = math.hypot(dx, dy)
            max_dist = budget * speed
            move = min(dist, max_dist)
            if dist > 1e-6:
                self.heading = (math.degrees(math.atan2(dx, -dy)) + 360) % 360
            sx, sy = self.x, self.y
            if dist <= max_dist:
                self.x, self.y = wx, wy
                budget -= dist / speed
                self.path.pop(0)
            else:
                self.x += dx / dist * move
                self.y += dy / dist * move
                budget = 0
            self.distance_m += move * self.cell_size
            if mode == "search":
                n = max(1, math.ceil(move / 0.35))
                for k in range(n + 1):
                    self.mark_search(sim, sx + (self.x - sx) * k / n, sy + (self.y - sy) * k / n)
                    if self.holding_signal is not None:
                        return
            if self.status != "returning" and self.path:
                searching = self.path[0][2] == "search"
                self.status = "searching" if searching else "en_route"
                b = sim.grid.blocks[self.current_block] if self.current_block >= 0 else None
                if b:
                    self.objective = (f"Sweeping {b['id']} · sector {b['sector']}" if searching
                                      else f"Transit to {b['id']} · sector {b['sector']}")
        if not self.path and self.current_block >= 0:
            self.complete_block(sim)

    def mark_search(self, sim, px: float, py: float):
        '''Thermal pass at (px, py): lowers the likelihood under the footprint, inside the current block'''
        g = sim.grid
        if self.current_block < 0:
            return
        b = g.blocks[self.current_block]
        r = self.footprint
        x0, y0 = b["bx"] * BLOCK, b["by"] * BLOCK
        hiker_r, hiker_c = sim.hiker.cell
        for cy in range(max(y0, math.floor(py - r)), min(y0 + BLOCK - 1, g.H - 1, math.floor(py + r)) + 1):
            for cx in range(max(x0, math.floor(px - r)), min(x0 + BLOCK - 1, g.W - 1, math.floor(px + r)) + 1):
                if (cx + 0.5 - px) ** 2 + (cy + 0.5 - py) ** 2 > r * r:
                    continue
                if not g.area[cy, cx] or sim.last_visit[cy, cx] == self.pass_id:
                    continue
                sim.last_visit[cy, cx] = self.pass_id
                pod = cell_pod(self.base_pod, g.density[cy, cx])
                sim.likelihood[cy, cx] *= 1 - pod
                sim.mark_searched(cy, cx, self.index)
                self.cells_searched += 1
                if (cy, cx) == (hiker_r, hiker_c) and not sim.true_signal_open() \
                        and sim.rng.random() < max(pod, TRUE_SIGNAL_MIN_ODDS):
                    self.raise_signal(sim, cx, cy, True)
                    return
                false_count = sum(not s["isTrue"] for s in sim.signals)
                if sim.elapsed_seconds > FALSE_SIGNAL_AFTER_SECONDS and false_count < MAX_FALSE_SIGNALS \
                        and sim.rng.random() < FALSE_SIGNAL_RATE * (0.4 + g.density[cy, cx]):
                    self.raise_signal(sim, cx, cy, False)
                    return

    def raise_signal(self, sim, cx: int, cy: int, is_true: bool):
        conf = sim.rng.uniform(0.74, 0.93) if is_true else sim.rng.uniform(0.34, 0.6)
        sig = {
            "id": f"SIG-{len(sim.signals) + 1:02d}",
            "droneId": self.id,
            "pos": [round(cy + 0.5 + sim.rng.uniform(-0.35, 0.35), 3), round(cx + 0.5 + sim.rng.uniform(-0.35, 0.35), 3)],
            "confidence": round(float(conf), 3),
            "tick": sim.tick,
            "isTrue": is_true,
            "status": "pending",
        }
        sim.signals.append(sig)
        self.release_work(sim)
        self.holding_signal = sig["id"]
        self.objective = f"Orbiting potential detection {sig['id']}"
        b = sim.grid.block_at(cy, cx)
        sim.event("detection", droneId=self.id, signalId=sig["id"],
                  blockId=b["id"] if b else None, sector=b["sector"] if b else None)

    # ------------------------------------------------------------------ blocks

    def start_next_block(self, sim):
        while self.queue:
            bi = self.queue.pop(0)
            b = sim.grid.blocks[bi]
            if not b["cells"]:
                continue
            self.current_block = bi
            self.pass_id = sim.next_pass()
            sim.block_owner[bi] = self.index
            self.path = lawnmower(b["bx"], b["by"], self.x, self.y)
            self.status = "en_route"
            self.objective = f"Transit to {b['id']} · sector {b['sector']}"
            return

    def complete_block(self, sim):
        bi = self.current_block
        self.current_block = -1
        if bi < 0:
            return
        b = sim.grid.blocks[bi]
        sim.block_owner[bi] = -1
        sim.block_search_count[bi] += 1
        self.blocks_completed += 1
        sim.event("block_complete", droneId=self.id, blockId=b["id"], sector=b["sector"])
        sector = b["sector"]
        if sector not in sim.sectors_complete and all(
                x["sector"] != sector or not x["cells"] or sim.block_search_count[x["index"]] > 0 for x in sim.grid.blocks):
            sim.sectors_complete.append(sector)
            sim.event("sector_complete", droneId=self.id, sector=sector)

    def release_work(self, sim):
        '''Hand back the current block and queue (to be auctioned again)'''
        for bi in [self.current_block, *self.queue]:
            if bi >= 0:
                sim.block_owner[bi] = -1
        self.queue = []
        self.current_block = -1
        self.path = []

    def return_to_base(self, objective: str):
        if self.status in AIRBORNE:
            self.set_status("returning", objective)
            self.path = [(self.base[1] + 0.5, self.base[0] + 0.5, "return")]

    # ------------------------------------------------------------------ frame

    def state(self) -> dict:
        return {
            "id": self.id,
            "pos": [round(self.y, 3), round(self.x, 3)],
            "status": self.status,
            "objective": self.objective,
            "battery": round(self.battery, 2),
            "heading": round(self.heading, 1),
            "agl": self.agl,
            "currentBlock": self.current_block,
            "queue": list(self.queue),
            "path": [[round(y, 3), round(x, 3), mode] for x, y, mode in self.path],
            "distanceM": round(self.distance_m, 1),
            "cellsSearched": self.cells_searched,
            "blocksCompleted": self.blocks_completed,
            "holdingSignalId": self.holding_signal,
        }
