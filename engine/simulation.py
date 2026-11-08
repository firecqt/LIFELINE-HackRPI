from agents import Hiker, LapDrone
from environment import build_grid, make_hiker_fake


class Simulation:
    '''
    A (fake) simulation: bootstraps everything from its hyperparameters, then advances one
    tick per step(). The clock lives in stream.StreamManager, which calls step() and frame().

    Frame shape (v1):
        {v, simID, tick, maxTimestep, status: "running" | "finished",
         hiker: {current: [row, col]}, drones: [{id, pos: [row, col], laps}]}
    '''

    def __init__(self, sim_id: str, hyperparameters: dict):
        '''
        Initializes a simulation with some hyperparameters: {N, offset, seed, maxTimestep}
        '''
        self.sim_id = sim_id
        self.N = int(hyperparameters["N"])
        self.offset = hyperparameters.get("offset", 1000)
        self.seed = int(hyperparameters["seed"])
        self.max_timestep = int(hyperparameters["maxTimestep"])
        self.tick = 0

        self.build_environment()
        self.build_agents()

    def build_environment(self):
        '''
        Using hyperparameters, build environment features elevations, canopies
        (deterministic from the seed, and cached, so this matches what POST /api/sim returned)
        '''
        self.elevation = build_grid("elevation", self.N, self.offset, self.seed)
        self.canopy = build_grid("canopy", self.N, self.offset, self.seed)

    def build_agents(self):
        '''
        Initialize drone agents, hiker agent
        '''
        route = make_hiker_fake(self.N, self.seed)
        self.hiker_start, self.hiker_end = route["start"], route["end"]
        self.hiker = Hiker(self.hiker_start)
        self.drones = [LapDrone("lap-1", self.N)]

    @property
    def done(self) -> bool:
        return self.tick >= self.max_timestep

    def step(self):
        '''
        This function updates all agents in the simulation, in a fixed order:
        hiker first (ground truth), then drones.
        '''
        self.tick += 1

        # Fake hiker walks a straight line from start (tick 0) to end (tick maxTimestep)
        progress = self.tick / self.max_timestep
        self.hiker.step([round(s + (e - s) * progress) for s, e in zip(self.hiker_start, self.hiker_end)])

        for drone in self.drones:
            drone.move()

    def frame(self) -> dict:
        '''
        The simulation state at the current tick, to be put on the WebSocket stream
        '''
        return {
            "v": 1,
            "simID": self.sim_id,
            "tick": self.tick,
            "maxTimestep": self.max_timestep,
            "status": "finished" if self.done else "running",
            "hiker": {"current": self.hiker.position},
            "drones": [drone.state() for drone in self.drones],
        }
