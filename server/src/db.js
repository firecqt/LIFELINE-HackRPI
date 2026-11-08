import { MongoClient } from 'mongodb';

/**
 * MongoDB connection (MongoDB Atlas).
 *
 * Connection details live in server/.env (gitignored), loaded by `import 'dotenv/config'` in index.js:
 *   MONGO_CONN - full connection URI (required)
 *   MONGO_DB   - database name (optional, defaults to "lifeline")
 *
 * One collection:
 *   simulations - { _id: simID (UUID string), params: {N, offset, seed, maxTimestep}, createdAt }
 *                 the hyperparameters needed to replay a simulation. Nothing else is stored:
 *                 the engine rebuilds the environment (elevation, canopy, perimeter) and, for fake
 *                 sims, the hiker deterministically from params.
 */

let client = null;
let db = null;

export const connect = async () => {
    if (db) return db;
    if (!process.env.MONGO_CONN) throw new Error('MONGO_CONN is not set. Add it to server/.env');

    client = new MongoClient(process.env.MONGO_CONN);
    await client.connect();
    db = client.db(process.env.MONGO_DB ?? 'lifeline');

    console.log(`Connected to MongoDB database "${db.databaseName}"`);
    return db;
};

export const close = async () => {
    if (client) await client.close();
    client = null;
    db = null;
};

const collection = (name) => {
    if (!db) throw new Error('Database not connected. Call connect() first');
    return db.collection(name);
};

export const simulations = () => collection('simulations');
