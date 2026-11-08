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
 *  POST   /api/sim         body {N, offset?, seed?, maxTimestep?, cellSize? (metres, default 3),
 *                                drones?: [{id, cruiseSpeedMs, footprintM, basePod (0..1), flightTimeMin, battery?}]}
 *                          (no drones: the engine's default fleet of 4)
 *                          -> 201 {simID, params: {N, offset, seed, maxTimestep, cellSize, drones?}, tickSeconds (sim time per tick),
 *                                  hiker: {start, end}, base: drone staging [row, col],
 *                                  search: {blockSize, blocksW, blocksH, sectors, blocks: [{index, id, sector}],
 *                                           searchArea: {data (0/1), dims}},
 *                                  environment: {elevation, canopy, perimeter, travelTime}}
 *                          elevation/canopy/travelTime are {data, dims}: flattened row-major grids;
 *                          index with dims [rows, cols]. travelTime: minutes to walk from the LKP (hiker start).
 *                          hiker: start = LKP (grid centre), end = where the hiker is found (its walk
 *                          heads there).
 *                          canopy labels: 1 = no, 2 = low, 3 = high interference.
 *                          perimeter: 4 [x, y] corners, read clockwise.
 *  POST   /api/sim/stream  body {simID, tickRate?} -> 202 {status: "started", tick, tickRate}
 *                          (replaces any running sim; 200 {status: "already_running"} if it's this one)
 *  DELETE /api/sim/stream  -> 200 {status: "stopped", simID, tick} | {status: "not_running"}
 *  POST   /api/sim/stream/signal  body {simID, signalId, action: dispatch | dismiss | false_positive |
 *                          not_subject | confirmed} -> 200 {status}; 409 if that sim isn't streaming or
 *                          has no such signal. A ranger's decision on a detection signal (frames carry signals).
 *  WS     /ws/sim/stream   frames, see stream.js
 */

const MAX_N = 1024;
const DEFAULT_MAX_TIMESTEP = 100;
const MAX_TICK_RATE = 60;
const DEFAULT_CELL_SIZE = 3;     // metres per cell
const MAX_CELL_SIZE = 1000;
const MAX_DRONES = 12;
const SIGNAL_ACTIONS = ['dispatch', 'dismiss', 'false_positive', 'not_subject', 'confirmed'];

// Error with an HTTP status attached, turned into a JSON response by the handler at the bottom
const httpError = (status, message) => Object.assign(new Error(message), { status });

const isInt = (v) => Number.isInteger(v);
const isPositive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

// Drone specs for the engine's fleet, or a 400 explaining what is wrong
function readDrones(drones) {
    if (drones === undefined) return undefined;
    if (!Array.isArray(drones) || drones.length > MAX_DRONES)
        throw httpError(400, `drones must be a list of at most ${MAX_DRONES} drone specs`);
    return drones.map((d, k) => {
        const { id, cruiseSpeedMs, footprintM, basePod, flightTimeMin, battery = 100 } = d ?? {};
        if (typeof id !== 'string' || !id) throw httpError(400, `drones[${k}].id must be a string`);
        for (const [name, v] of Object.entries({ cruiseSpeedMs, footprintM, flightTimeMin }))
            if (!isPositive(v)) throw httpError(400, `drones[${k}].${name} must be a positive number`);
        if (!isPositive(basePod) || basePod > 1) throw httpError(400, `drones[${k}].basePod must be in (0, 1]`);
        if (typeof battery !== 'number' || battery < 0 || battery > 100) throw httpError(400, `drones[${k}].battery must be 0..100`);
        return { id, cruiseSpeedMs, footprintM, basePod, flightTimeMin, battery };
    });
}

export const app = express();
app.use(express.json({ limit: '1mb' }));

// Frontend (frontend/index.html) served at /
app.use(express.static(path.join(import.meta.dirname, '../../frontend')));

const api = express.Router();
app.use('/api', api);

api.post('/sim', async (req, res) => {
    const { N, offset = 1000, seed = null, maxTimestep = DEFAULT_MAX_TIMESTEP, cellSize = DEFAULT_CELL_SIZE } = req.body ?? {};
    const drones = readDrones(req.body?.drones);
    if (!isInt(N) || N < 1 || N > MAX_N) throw httpError(400, `N must be an integer from 1 to ${MAX_N}`);
    if (typeof offset !== 'number') throw httpError(400, 'offset must be a number');
    if (seed !== null && (!isInt(seed) || seed < 0)) throw httpError(400, 'seed must be a non-negative integer');
    if (!isInt(maxTimestep) || maxTimestep < 1) throw httpError(400, 'maxTimestep must be a positive integer');
    if (typeof cellSize !== 'number' || cellSize <= 0 || cellSize > MAX_CELL_SIZE)
        throw httpError(400, `cellSize must be a number of metres, above 0 and at most ${MAX_CELL_SIZE}`);

    // The engine settles the seed (random if none given); params alone can rebuild the whole sim
    const created = await IPC.useClient('CREATE_FAKE_SIM', { N, offset, seed, cellSize, maxTimestep, drones });
    // The drones are part of the hyperparameters: a replay needs the same fleet
    const params = { N, offset, seed: created.seed, maxTimestep, cellSize, ...(drones && { drones }) };

    const simID = randomUUID();
    await DB.simulations().insertOne({ _id: simID, params, createdAt: new Date() });
    return res.status(201).json({
        simID, params, tickSeconds: created.tickSeconds, hiker: created.hiker, base: created.base,
        search: created.search, environment: created.environment,
    });
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

api.post('/sim/stream/signal', async (req, res) => {
    const { simID, signalId, action } = req.body ?? {};
    if (typeof simID !== 'string') throw httpError(400, 'simID is required');
    if (typeof signalId !== 'string') throw httpError(400, 'signalId is required');
    if (!SIGNAL_ACTIONS.includes(action)) throw httpError(400, `action must be one of ${SIGNAL_ACTIONS.join(', ')}`);
    try {
        return res.status(200).json(await IPC.useClient('RESOLVE_SIGNAL', { simID, signalId, action }));
    } catch (err) {
        // The engine refuses when that sim isn't streaming or has no such signal
        if (err.message?.startsWith('Engine error:')) throw httpError(409, err.message);
        throw err;
    }
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
