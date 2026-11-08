import json
import os

import numpy as np
import zmq

from environment import make_elevation_fake, make_foilage_fake, make_perimeter_fake

IPC_ADDRESS = os.environ.get("LIFELINE_IPC", "ipc:///tmp/lifeline-queue.ipc")


def grid_payload(arr: np.ndarray, decimals: int | None = None) -> dict:
    '''Flatten a 2D array into the {data, dims} shape the API serves.'''
    flat = arr.ravel()
    if decimals is not None:
        flat = np.round(flat, decimals)
    return {"data": flat.tolist(), "dims": list(arr.shape)}


def make_fake_environment(value: dict) -> dict:
    '''
    Generate every fake resource for a new simulation.
    value: {N, offset?, seed?}. A random seed is drawn when none is given so the
    sim can always be regenerated from what is returned.
    '''
    N = int(value["N"])
    offset = value.get("offset", 1000)
    seed = value.get("seed")
    if seed is None:
        seed = int(np.random.default_rng().integers(0, 2**31))

    # Each generator gets its own derived seed so they aren't correlated
    elevation_seed, foilage_seed, hiker_seed = np.random.SeedSequence(seed).generate_state(3)
    rng = np.random.default_rng(hiker_seed)

    return {
        "seed": seed,
        "elevation": grid_payload(make_elevation_fake(N, offset=offset, seed=elevation_seed), decimals=2),
        "canopy": grid_payload(make_foilage_fake(N, seed=foilage_seed)),
        "perimeter": make_perimeter_fake(N),
        "hiker": {
            # [row, col], 0-based grid indices
            "start": rng.integers(0, N, size=2).tolist(),
            "end": rng.integers(0, N, size=2).tolist(),
        },
    }


def handle_message(key, value):

    match key:

        case "PING": return "PONG"
        case "MAKE_FAKE_ENVIRONMENT": return make_fake_environment(value)
        case _: raise ValueError(f"Could not associate an action with key {key}")


def run_server():
    print('server launched')
    context = zmq.Context()

    # opens a socket
    socket = context.socket(zmq.REP)
    socket.bind(IPC_ADDRESS)
    print(f'listening on {IPC_ADDRESS}')

    try:
        while True:

            # Wait for next request from Node.js: {"key": ..., "value": ...}
            message = socket.recv_string()
            print(f"Received message from Node: {message[:200]}")

            # A REP socket MUST reply to every request, or the Node side hangs,
            # so every failure is turned into an error reply
            try:
                request = json.loads(message)
                data = handle_message(key=request.get("key"), value=request.get("value"))
                response = {"ok": True, "data": data}
            except Exception as err:
                print(f"Error handling message: {err!r}")
                response = {"ok": False, "error": str(err)}

            socket.send_string(json.dumps(response))

    except KeyboardInterrupt:
        print("\nServer shutting down...")

    finally:
        socket.close()
        context.term()

if __name__ == "__main__": run_server()
