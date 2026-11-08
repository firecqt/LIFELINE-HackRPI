import { Subscriber } from 'zeromq';
import { WebSocketServer } from 'ws';

/**
 * Simulation frame stream (single client).
 *
 *   Python engine --PUB/SUB--> here --> the one WebSocket client on /ws/sim/stream
 *
 * A newer connection replaces the old one. On connect the client gets the latest frame (if any),
 * so a page reload mid-run picks up where it was. Frame shape is documented in engine/stream.py.
 */

const EVENTS_ADDRESS = process.env.LIFELINE_IPC_EVENTS ?? 'ipc:///tmp/lifeline-events.ipc';
const WS_PATH = '/ws/sim/stream';

let subscriber = null;
let wss = null;
let client = null;
let latest = null;   // latest frame as a JSON string

const send = (json) => {
    if (client && client.readyState === client.OPEN) client.send(json);
};

const listen = async () => {
    for await (const [, message] of subscriber) {
        // One bad frame or send must not end the loop, or no frames reach the client until restart
        try {
            latest = message.toString();
            send(latest);
        } catch (err) {
            console.error('Failed to relay frame:', err);
        }
    }
};

const onConnection = (ws) => {
    client?.close(4409, 'Replaced by a newer connection');
    client = ws;
    ws.on('close', () => { if (client === ws) client = null; });
    if (latest) send(latest);
};

// Starts listening for engine frames and serves the WebSocket on the given HTTP server
export const start = (httpServer) => {
    subscriber = new Subscriber();
    subscriber.connect(EVENTS_ADDRESS);
    subscriber.subscribe();
    listen().catch((err) => {
        if (subscriber) console.error('Frame subscriber stopped:', err);
    });
    console.log(`Frame subscriber connecting to ${EVENTS_ADDRESS}`);

    wss = new WebSocketServer({ noServer: true });
    wss.on('connection', onConnection);
    httpServer.on('upgrade', (req, socket, head) => {
        if (new URL(req.url, 'http://localhost').pathname !== WS_PATH) return socket.destroy();
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
};

export const close = () => {
    client?.close(1001, 'Server shutting down');
    wss?.close();
    const sub = subscriber;
    subscriber = null;
    sub?.close();
};
