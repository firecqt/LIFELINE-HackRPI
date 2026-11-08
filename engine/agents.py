class Drone:

    def __init__(self, hyperparameters):
        '''
        Initialize a drone with hyperparameters
        Build its value grid
        '''
        pass

    def observe(self, signal):
        '''
        Updates the value grid using the PDF signal
        '''
        pass

    def move(self, data):
        '''
        Executes a move operation
        '''
        pass

class Hiker:

    def __init__(self, start: list[int]):
        '''
        Initializes a hiker with a state: its current [row, col]
        '''
        self.position = list(start)

    def step(self, location: list[int]):
        '''
        Steps to this location at the current timestamp
        '''
        self.position = list(location)


def lap_path(N: int) -> list[list[int]]:
    '''
    Border cells of an NxN grid as [row, col], clockwise from the top-left corner:
    top row left to right, right column down, bottom row right to left, left column up.
    '''
    if N == 1:
        return [[0, 0]]
    last = N - 1
    top = [[0, c] for c in range(last)]
    right = [[r, last] for r in range(last)]
    bottom = [[last, c] for c in range(last, 0, -1)]
    left = [[r, 0] for r in range(last, 0, -1)]
    return top + right + bottom + left


class LapDrone:
    '''
    Simplest possible agent: flies laps around the border of the grid, one cell per tick,
    starting at the top-left corner. Ignores the environment and the hiker.
    '''

    def __init__(self, drone_id: str, N: int):
        self.id = drone_id
        self.path = lap_path(N)
        self.index = 0

    @property
    def position(self) -> list[int]:
        return self.path[self.index % len(self.path)]

    @property
    def laps(self) -> int:
        return self.index // len(self.path)

    def move(self):
        self.index += 1

    def state(self) -> dict:
        return {"id": self.id, "pos": self.position, "laps": self.laps}
