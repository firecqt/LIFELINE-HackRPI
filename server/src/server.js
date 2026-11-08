import express from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as IPC from './ipc.js';
import * as DB from './db.js';

/**
 * LIFELINE API (single client demo)
 *
 * A simulation is created once from hyperparameters. Static data (environment, hiker start/end)
 * comes back in the create response; everything that changes over time arrives as frames on the
 * WebSocket. The Python engine owns the clock while a sim is streaming.
 *
 * Client flow: create the sim -> connect the WebSocket -> start the stream -> receive frames.
 *
 *  POST   /api/sim         body {N, offset?, seed?, maxTimestep?}
 *                          -> 201 {simID, params: {N, offset, seed, maxTimestep}, hiker: {start, end},
 *                                  environment: {elevation: {data, dims}, canopy: {data, dims}, perimeter}}
 *                          elevation/canopy are flattened row-major grids; index with dims [rows, cols].
 *                          canopy labels: 1 = no, 2 = low, 3 = high interference.
 *                          perimeter: 4 [x, y] corners, read clockwise.
 *  POST   /api/sim/stream  body {simID, tickRate?} -> 202 {status: "started", tick, tickRate}
 *                          (replaces any running sim; 200 {status: "already_running"} if it's this one)
 *  DELETE /api/sim/stream  -> 200 {status: "stopped", simID, tick} | {status: "not_running"}
 *  WS     /ws/sim/stream   frames, see stream.js
 */

const MAX_N = 1024;
const DEFAULT_MAX_TIMESTEP = 100;
const MAX_TICK_RATE = 60;

// Error with an HTTP status attached, turned into a JSON response by the handler at the bottom
const httpError = (status, message) => Object.assign(new Error(message), { status });

const isInt = (v) => Number.isInteger(v);

export const app = express();
app.use(express.json({ limit: '1mb' }));

// Frontend (frontend/index.html) served at /
app.use(express.static(path.join(import.meta.dirname, '../../frontend')));

const api = express.Router();
app.use('/api', api);

api.post('/sim', async (req, res) => {
    const { N, offset = 1000, seed = null, maxTimestep = DEFAULT_MAX_TIMESTEP } = req.body ?? {};
    if (!isInt(N) || N < 1 || N > MAX_N) throw httpError(400, `N must be an integer from 1 to ${MAX_N}`);
    if (typeof offset !== 'number') throw httpError(400, 'offset must be a number');
    if (seed !== null && (!isInt(seed) || seed < 0)) throw httpError(400, 'seed must be a non-negative integer');
    if (!isInt(maxTimestep) || maxTimestep < 1) throw httpError(400, 'maxTimestep must be a positive integer');

    // The engine settles the seed (random if none given); params alone can rebuild the whole sim
    const created = await IPC.useClient('CREATE_FAKE_SIM', { N, offset, seed });
    const params = { N, offset, seed: created.seed, maxTimestep };

    const simID = randomUUID();
    await DB.simulations().insertOne({ _id: simID, params, createdAt: new Date() });
    return res.status(201).json({ simID, params, hiker: created.hiker, environment: created.environment });
});

api.post('/sim/stream', async (req, res) => {
    const { simID, tickRate } = req.body ?? {};
    if (typeof simID !== 'string') throw httpError(400, 'simID is required');
    if (tickRate !== undefined && (typeof tickRate !== 'number' || tickRate <= 0 || tickRate > MAX_TICK_RATE))
        throw httpError(400, `tickRate must be ticks per second, above 0 and at most ${MAX_TICK_RATE}`);

    const sim = await DB.simulations().findOne({ _id: simID });
    if (!sim) throw httpError(404, `Simulation ${simID} not found`);

    const result = await IPC.useClient('START_SIM', { simID, params: sim.params, tickRate });
    return res.status(result.status === 'started' ? 202 : 200).json(result);
});

api.delete('/sim/stream', async (req, res) => {
    return res.status(200).json(await IPC.useClient('STOP_SIM'));
});

// Unknown /api routes get a JSON 404 instead of Express's HTML page
api.use((req) => { throw httpError(404, `No endpoint ${req.method} ${req.originalUrl}`); });

// Express 5 forwards errors thrown in async handlers here
app.use((err, req, res, next) => {
    const status = err.status ?? err.statusCode ?? 500;
    const expected = err.status !== undefined || err.statusCode !== undefined;
    if (!expected) console.error(err);
    return res.status(status).json({ error: expected ? err.message : 'Internal server error' });
});
