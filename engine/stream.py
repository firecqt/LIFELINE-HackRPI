'''
Runs the started simulation on a clock and publishes one frame per tick.

The main loop in api.py calls ms_until_next_tick() to know how long it may wait for a
command, then tick_due() to step the sim when its tick has come up.

Frames come from Simulation.frame() (see simulation.py) and are published with the simID
as the topic. Stopping a sim publishes its current frame with status "stopped".
'''

import time

from simulation import Simulation

DEFAULT_TICK_RATE = 5      # ticks per second
MAX_TICK_RATE = 60


class StreamManager:
    '''Runs at most one simulation at a time (single-client demo).'''

    def __init__(self, publish):
        '''publish(sim_id, frame) sends one frame to Node'''
        self.publish = publish
        self.sim = None
        self.interval = None
        self.next_at = None

    def start(self, sim_id: str, params: dict, tick_rate: float | None = None) -> dict:
        '''
        Streams a sim from tick 0, replacing any other running sim.
        Starting the sim that is already running does nothing.
        '''
        if self.sim is not None and self.sim.sim_id == sim_id:
            return {"status": "already_running", "tick": self.sim.tick}
        if self.sim is not None:
            self.stop()

        rate = min(max(float(tick_rate or DEFAULT_TICK_RATE), 0.1), MAX_TICK_RATE)
        self.sim = Simulation(sim_id, params)
        self.interval = 1 / rate
        self.next_at = time.monotonic() + self.interval

        # Tick 0 goes out immediately so the client sees the starting state
        self.publish(sim_id, self.sim.frame())
        return {"status": "started", "tick": 0, "tickRate": rate}

    def stop(self) -> dict:
        if self.sim is None:
            return {"status": "not_running"}
        frame = {**self.sim.frame(), "status": "stopped"}
        self.publish(self.sim.sim_id, frame)
        self.sim = None
        return {"status": "stopped", "simID": frame["simID"], "tick": frame["tick"]}

    def ms_until_next_tick(self) -> int | None:
        if self.sim is None:
            return None
        return max(0, round((self.next_at - time.monotonic()) * 1000))

    def tick_due(self):
        now = time.monotonic()
        if self.sim is None or self.next_at > now:
            return

        self.sim.step()
        self.publish(self.sim.sim_id, self.sim.frame())

        if self.sim.done:
            self.sim = None
        else:
            # If a step ran long, skip ahead instead of firing a burst of catch-up ticks
            self.next_at = max(self.next_at + self.interval, now)
