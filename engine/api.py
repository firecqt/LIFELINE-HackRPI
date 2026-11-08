import json
import os

import numpy as np
import zmq

from environment import build_grid, make_hiker_fake, make_perimeter_fake
from stream import StreamManager

# Commands from Node (REQ/REP) and frames to Node (PUB/SUB)
IPC_ADDRESS = os.environ.get("LIFELINE_IPC", "ipc:///tmp/lifeline-queue.ipc")
EVENTS_ADDRESS = os.environ.get("LIFELINE_IPC_EVENTS", "ipc:///tmp/lifeline-events.ipc")


def grid_payload(arr: np.ndarray, decimals: int | None = None) -> dict:
    '''Flatten a 2D array into the {data, dims} shape the API serves.'''
    flat = arr.ravel()
    if decimals is not None:
        flat = np.round(flat, decimals)
    return {"data": flat.tolist(), "dims": list(arr.shape)}


def read_params(value: dict) -> tuple[int, float, int]:
    return int(value["N"]), value.get("offset", 1000), int(value["seed"])


def create_fake_sim(value: dict) -> dict:
    '''
    Settle the hyperparameters for a new fake simulation and build everything static about it.
    value: {N, offset?, seed?}. A random seed is drawn when none is given; the returned seed
    is what must be stored to rebuild the sim later.
    '''
    if value.get("seed") is None:
        value = {**value, "seed": int(np.random.default_rng().integers(0, 2**31))}
    N, offset, seed = read_params(value)
    return {
        "seed": seed,
        "environment": {
            "elevation": grid_payload(build_grid("elevation", N, offset, seed), decimals=2),
            "canopy": grid_payload(build_grid("canopy", N, offset, seed)),
            "perimeter": make_perimeter_fake(N),
        },
        "hiker": make_hiker_fake(N, seed),
    }


def handle_message(key, value, streams: StreamManager):

    match key:

        case "PING": return "PONG"
        case "CREATE_FAKE_SIM": return create_fake_sim(value)
        # value: {simID, params, tickRate?}
        case "START_SIM": return streams.start(value["simID"], value["params"], value.get("tickRate"))
        # value: none (stops whichever sim is running)
        case "STOP_SIM": return streams.stop()
        case _: raise ValueError(f"Could not associate an action with key {key}")


def handle_request(message: str, streams: StreamManager) -> str:
    # A REP socket MUST reply to every request, or the Node side hangs,
    # so every failure is turned into an error reply
    try:
        request = json.loads(message)
        data = handle_message(key=request.get("key"), value=request.get("value"), streams=streams)
        response = {"ok": True, "data": data}
    except Exception as err:
        print(f"Error handling message: {err!r}")
        response = {"ok": False, "error": str(err)}
    return json.dumps(response)


def run_server():
    print('server launched')
    context = zmq.Context()

    # commands: Node sends {"key", "value"}, we always reply
    socket = context.socket(zmq.REP)
    socket.bind(IPC_ADDRESS)

    # frames: published as [simID, frame JSON]; Node subscribes and relays to the WebSocket client
    events = context.socket(zmq.PUB)
    events.bind(EVENTS_ADDRESS)
    print(f'listening on {IPC_ADDRESS}, publishing on {EVENTS_ADDRESS}')

    streams = StreamManager(publish=lambda sim_id, frame: events.send_multipart(
        [sim_id.encode(), json.dumps(frame).encode()]))

    poller = zmq.Poller()
    poller.register(socket, zmq.POLLIN)

    try:
        while True:
            # Wait for a command, but no longer than until the next tick is due
            # (None = block until a command arrives, when no sim is running)
            ready = dict(poller.poll(streams.ms_until_next_tick()))

            if socket in ready:
                message = socket.recv_string()
                print(f"Received message from Node: {message[:200]}")
                socket.send_string(handle_request(message, streams))

            streams.tick_due()

    except KeyboardInterrupt:
        print("\nServer shutting down...")

    finally:
        socket.close()
        events.close()
        context.term()

if __name__ == "__main__": run_server()
