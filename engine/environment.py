from functools import lru_cache

import numpy as np


def _perlin(N: int, cells: int, rng: np.random.Generator) -> np.ndarray:
    '''
    Single octave of 2D gradient (Perlin) noise sampled on an NxN grid.
    `cells` is how many noise cells span the grid (higher = more detail).
    Output is roughly in [-0.7, 0.7].
    '''
    # Random unit gradient vector at each lattice corner
    angles = rng.uniform(0, 2 * np.pi, (cells + 1, cells + 1))
    grads = np.stack([np.cos(angles), np.sin(angles)], axis=-1)

    # Sample positions in lattice space
    coords = np.linspace(0, cells, N, endpoint=False)
    x, y = np.meshgrid(coords, coords)
    xi, yi = x.astype(int), y.astype(int)
    xf, yf = x - xi, y - yi

    def corner(dx_i, dy_i):
        g = grads[yi + dy_i, xi + dx_i]
        return g[..., 0] * (xf - dx_i) + g[..., 1] * (yf - dy_i)

    # Smoothstep fade curve so cell borders aren't visible
    u = 6 * xf**5 - 15 * xf**4 + 10 * xf**3
    v = 6 * yf**5 - 15 * yf**4 + 10 * yf**3

    top = corner(0, 0) + u * (corner(1, 0) - corner(0, 0))
    bottom = corner(0, 1) + u * (corner(1, 1) - corner(0, 1))
    return top + v * (bottom - top)


def _fractal_noise(N: int, base_cells: int, octaves: int, persistence: float,
                   rng: np.random.Generator) -> np.ndarray:
    '''
    Sum several Perlin octaves (each double the frequency, `persistence` times the
    amplitude of the last) and normalize the result to [-1, 1].
    '''
    total = np.zeros((N, N))
    amplitude = 1.0
    for octave in range(octaves):
        total += amplitude * _perlin(N, base_cells * 2**octave, rng)
        amplitude *= persistence

    span = total.max() - total.min()
    if span == 0:
        return np.zeros((N, N))
    return 2 * (total - total.min()) / span - 1


def make_elevation_fake(N: int, offset: int = 1000, amplitude: float = 200.0,
                        seed: int | None = None) -> np.ndarray:
    '''
    Use perlin noise around an offset to simulate natural hiking terrain.
    Returns an NxN float array of elevations in [offset - amplitude, offset + amplitude].
    '''
    rng = np.random.default_rng(seed)
    noise = _fractal_noise(N, base_cells=4, octaves=5, persistence=0.5, rng=rng)
    return offset + amplitude * noise


def make_foilage_fake(N: int, seed: int | None = None) -> np.ndarray:
    '''
    Distribute labels 1, 2, 3 on the same N-size grid, where these labels should be broad clusters.
      1 = no interference, 2 = low interference, 3 = high interference
    Returns an NxN int8 array with roughly a third of the cells in each class.
    '''
    rng = np.random.default_rng(seed)
    # Low frequency + few octaves -> big smooth blobs with slightly ragged edges
    noise = _fractal_noise(N, base_cells=3, octaves=2, persistence=0.4, rng=rng)

    low, high = np.quantile(noise, [1 / 3, 2 / 3])
    labels = np.full((N, N), 2, dtype=np.int8)
    labels[noise < low] = 1
    labels[noise >= high] = 3
    return labels


def make_perimeter_fake(N: int):
    '''
    Return the dimensions of the grid
    '''
    return [
        [0, N], [N, N], [N, 0], [0, 0]
    ]


def derived_seeds(seed: int) -> dict:
    '''
    Each generator gets its own seed derived from the sim seed, so they aren't correlated
    and each one can be rebuilt on its own.
    '''
    elevation, canopy, hiker = np.random.SeedSequence(seed).generate_state(3)
    return {"elevation": int(elevation), "canopy": int(canopy), "hiker": int(hiker)}


def make_lkp_fake(N: int) -> list[int]:
    '''
    Hiker's last known position (LKP) as [row, col], 0-based: always the centre of the grid, so
    the walk is least likely to reach the border. Where the hiker goes from there is simulated by
    agents.Hiker.
    '''
    return [N // 2, N // 2]


# Fake terrain amplitude as a fraction of the grid's side length: +-10m over 300m keeps slopes
# walkable (median ~23%) whatever N and cell size are
RELIEF_RATIO = 1 / 30


@lru_cache(maxsize=8)
def build_grid(field: str, N: int, offset: float, seed: int, cell_size: float) -> np.ndarray:
    '''
    Deterministically rebuild one environment grid from a sim's hyperparameters.
    Cached so a sim that is created and then streamed only builds its grids once.
    '''
    seeds = derived_seeds(seed)
    match field:
        case "elevation":
            amplitude = RELIEF_RATIO * N * cell_size
            return make_elevation_fake(N, offset=offset, amplitude=amplitude, seed=seeds["elevation"])
        case "canopy": return make_foilage_fake(N, seed=seeds["canopy"])
        case _: raise ValueError(f"Unknown environment field {field}")
