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
