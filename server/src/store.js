/**
 * Simulation storage.
 *
 * Temporary in-memory implementation; data is lost on restart.
 * Everything else talks to storage only through these async functions, so moving
 * to MongoDB (Docker volume) means reimplementing this file and nothing else.
 *
 * Sim shape:
 *  {
 *    simID, type, params: {N, offset, seed, maxTimestep}, timestep,
 *    elevation: {data, dims}, canopy: {data, dims}, perimeter: [[x, y] x4],
 *    hiker: {start: [row, col], end: [row, col]}
 *  }
 */

const sims = new Map();

export const createSim = async (sim) => {
    sims.set(sim.simID, sim);
    return sim;
};

export const getSim = async (simID) => sims.get(simID) ?? null;

export const setTimestep = async (simID, timestep) => {
    const sim = sims.get(simID);
    if (sim) sim.timestep = timestep;
    return sim ?? null;
};

export const deleteSim = async (simID) => sims.delete(simID);
