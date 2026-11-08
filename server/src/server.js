import express from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import * as IPC from './ipc.js';
import * as Store from './store.js';

/**
 * Server structure
 *
 * API Strategy:
 *  This backend's primary purpose is to serve data about a simulation
 *  A simulation is generated from an Engine, which takes parameters
 *  The simulation will use a fake or real engine, which has different logic for generating data but returns it in the same form
 *  Every simulation has a current timestep. Moving the timestep forward keeps all resources in sync:
 *  reading any resource by simID returns that resource as of the sim's current timestep.
 *
 * ENDPOINTS:
 *
 * -- Simulations endpoints manage generating and saving simulation data.
 *      POSTing to a simulation creates a new simulation (and records in other resources)
 *      GETting to a simulation samples the simulation at timestep t (for the fake stuff)
 *      DELETEing to a simulation removes it and all data from the other resources
 *
 *  /simulations:
 *      POST ?type=fake|real - body {N, offset?, seed?, maxTimestep?} -> 201 {simID, dims, seed, maxTimestep}
 *                             (type=real -> 501 until the real engine exists)
 *      GET /:simID/:timestep - moves the sim to timestep (0..maxTimestep) -> 204, no body
 *      DELETE /:simID - removes the sim and all its resources -> 204
 *
 * ------------------------------------------------------------------------------------
 *
 * -- Environment endpoints for reading the environment associated with a simulation
 *      Elevations returns a flattened array of elevation floats. use dims to index
 *      Canopies returns a flattened array of ints representing foilage classes. use dims to index
 *      Maps returns the lat/long representation of the grid. For fake data, this a positive square with bottom left on the origin. It also has a hint for procesisng it.
 *      Hiker data is a projected trajectory from start to end based on the sim's current timestep
 * /elevations:
 *      GET /:simID - {data: [flattened 2d array of floats], dims: [RowsxCols]}
 * /canopies:
 *      GET /:simID - {data: [flattened 2d array of ints], dims: [RowsxCols]}
 * /maps:
 *      GET /:simID - {data: [4-length 1d array of [lat, long] coordinates], hint: "read clockwise to make a square region"}
 * /hiker:
 *      GET /:simID - {start: [2-element grid index (0-based)], current: [2-element grid index (0-based)], end: [2-element grid index (0-based)], timestep}
 *
 * ------------------------------------------------------------------------------------
 *
 * -- Some data updates in real time, such as the Probability map and drone position. We should consider
*/

const MAX_N = 1024;
const DEFAULT_MAX_TIMESTEP = 100;

// Error with an HTTP status attached, turned into a JSON response by the handler at the bottom
const httpError = (status, message) => Object.assign(new Error(message), { status });

const isInt = (v) => Number.isInteger(v);

// Looks up the sim or throws a 404
const requireSim = async (simID) => {
    const sim = await Store.getSim(simID);
    if (!sim) throw httpError(404, `Simulation ${simID} not found`);
    return sim;
};

export const app = express();
app.use(express.json({ limit: '1mb' }));

// Frontend (frontend/index.html) served at /
app.use(express.static(path.join(import.meta.dirname, '../../frontend')));

app.get('/ping', async (req, res) => {
    const response = await IPC.useClient('PING');

    if (response != 'PONG')
        console.log(`ERROR: Expected PONG response, but got ${response}`);

    return res.status(200).json({'msg': response });
});

// ---------------------------------- simulations ----------------------------------

app.post('/simulations', async (req, res) => {
    const type = req.query.type ?? 'fake';
    if (type === 'real') throw httpError(501, 'Real simulations are not implemented yet');
    if (type !== 'fake') throw httpError(400, `Unknown simulation type '${type}' (expected fake or real)`);

    const { N, offset = 1000, seed = null, maxTimestep = DEFAULT_MAX_TIMESTEP } = req.body ?? {};
    if (!isInt(N) || N < 1 || N > MAX_N) throw httpError(400, `N must be an integer from 1 to ${MAX_N}`);
    if (typeof offset !== 'number') throw httpError(400, 'offset must be a number');
    if (seed !== null && (!isInt(seed) || seed < 0)) throw httpError(400, 'seed must be a non-negative integer');
    if (!isInt(maxTimestep) || maxTimestep < 1) throw httpError(400, 'maxTimestep must be a positive integer');

    const env = await IPC.useClient('MAKE_FAKE_ENVIRONMENT', { N, offset, seed });

    const sim = await Store.createSim({
        simID: randomUUID(),
        type,
        params: { N, offset, seed: env.seed, maxTimestep },
        timestep: 0,
        elevation: env.elevation,
        canopy: env.canopy,
        perimeter: env.perimeter,
        hiker: env.hiker,
    });

    return res.status(201).json({
        simID: sim.simID,
        dims: sim.elevation.dims,
        seed: sim.params.seed,
        maxTimestep,
    });
});

app.get('/simulations/:simID/:timestep', async (req, res) => {
    const sim = await requireSim(req.params.simID);

    const timestep = Number(req.params.timestep);
    if (!isInt(timestep) || timestep < 0 || timestep > sim.params.maxTimestep)
        throw httpError(400, `timestep must be an integer from 0 to ${sim.params.maxTimestep}`);

    await Store.setTimestep(sim.simID, timestep);
    return res.sendStatus(204);
});

app.delete('/simulations/:simID', async (req, res) => {
    const deleted = await Store.deleteSim(req.params.simID);
    if (!deleted) throw httpError(404, `Simulation ${req.params.simID} not found`);
    return res.sendStatus(204);
});

// ---------------------------------- environment ----------------------------------

app.get('/elevations/:simID', async (req, res) => {
    const sim = await requireSim(req.params.simID);
    return res.status(200).json(sim.elevation);
});

app.get('/canopies/:simID', async (req, res) => {
    const sim = await requireSim(req.params.simID);
    return res.status(200).json(sim.canopy);
});

app.get('/maps/:simID', async (req, res) => {
    const sim = await requireSim(req.params.simID);
    return res.status(200).json({
        data: sim.perimeter,
        hint: 'read clockwise to make a square region',
    });
});

app.get('/hiker/:simID', async (req, res) => {
    const sim = await requireSim(req.params.simID);
    const { start, end } = sim.hiker;

    // Fake hiker walks a straight line from start (t=0) to end (t=maxTimestep)
    const progress = sim.timestep / sim.params.maxTimestep;
    const current = start.map((s, i) => Math.round(s + (end[i] - s) * progress));

    return res.status(200).json({ start, current, end, timestep: sim.timestep });
});

// ---------------------------------- errors ----------------------------------

// Express 5 forwards errors thrown in async handlers here
app.use((err, req, res, next) => {
    const status = err.status ?? err.statusCode ?? 500;
    const expected = err.status !== undefined || err.statusCode !== undefined;
    if (!expected) console.error(err);
    return res.status(status).json({ error: expected ? err.message : 'Internal server error' });
});
