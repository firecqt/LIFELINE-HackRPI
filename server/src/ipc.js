import { Request } from "zeromq";

const IPC_ADDRESS = process.env.LIFELINE_IPC ?? "ipc:///tmp/lifeline-queue.ipc";
const TIMEOUT_MS = Number(process.env.LIFELINE_IPC_TIMEOUT_MS ?? 10000);

var socket = null;

// A REQ socket only allows one request in flight, so calls are queued on this chain
var queue = Promise.resolve();

// opens the client connection (connect() succeeds even if Python isn't running yet)
export const openClient = () => {
    if (!socket) {
        socket = new Request({ sendTimeout: TIMEOUT_MS, receiveTimeout: TIMEOUT_MS });
        socket.connect(IPC_ADDRESS);
        console.log(`IPC client connecting to ${IPC_ADDRESS}`);
    }
}

// closes the client
export const closeClient = () => socket.close();

const exchange = async (key, value) => {
    try {
        await socket.send(JSON.stringify({ key, value }));
        const [result] = await socket.receive();
        const response = JSON.parse(result.toString());
        if (!response.ok) throw new Error(`Engine error: ${response.error}`);
        return response.data;
    } catch (err) {
        // After a timeout the REQ socket is stuck mid-exchange; replace it so later calls work
        if (err.code === 'EAGAIN') {
            socket.close();
            socket = null;
            openClient();
            throw Object.assign(new Error('Engine did not respond in time. Is engine/api.py running?'), { status: 503 });
        }
        throw err;
    }
};

// sends {key, value} to the Python engine and resolves with its data
export const useClient = (key, value = null) => {
    const result = queue.then(() => exchange(key, value));
    queue = result.catch(() => {});
    return result;
};
