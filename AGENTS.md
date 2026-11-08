# AGENTS.md

## Project Description
Terrain-derived priors for Informed Drone Swarm Coordination in Hiker Search-and-Rescue (SAR). Using data such as elevation levels, canopy density, ISRID rings, and lost person behavioral psychology, we will compute a Bayesian prior distribution for where a lost hiker might be at a timestep t. Drones will then use this information inside of a gridworld value map to assign search regions and efficiently explore the space.

## Project Steps

### Project Step Tracker (To persist between sessions)
+ [x] Step 1
+ [x] Step 2
+ [x] Step 3
+ [x] Step 4
+ [x] Step 5
+ [x] Step 6
+ [ ] Step 7

### Step 1: Basic setup
We will use a node webserver with a python engine, communicating data via IPC. Express and ZeroMQ will be used to coordinate data. MongoDB will be used to hold simulation data.

### Step 2: Express server setup
Set up basic skeleton endpoints for accessing data. Read the documentation in server.js explaining general strategy.

### Step 3: Generating fake environment data
Once the MQ is hooked, write functions to generate elevation and foilage data. Elevation data should use perlin noise over an NxN grid about an offset variable (optional). The foilage data should use labels 1, 2, 3 to indicate no interference, low interference, and high interference (simulates foilage impact on camera). Finally also write a function that returns the perimeter of the area as 4 [x, y] coordinates boxing the grid. 

### Step 4: Set up MongoDB
The role of MongoDB is to track simulations, using a single Simulations collection. MongoDB is hosted on Atlas; the connection URI is read from `process.env.MONGO_CONN` (set in server/.env). The Simulations collection tracks only the hyperparameters necessary to replay a simulation (N, offset, seed, maxTimestep). Nothing else is stored: a simulation bootstraps itself from its hyperparameters, so the engine regenerates the environment (Canopy, Elevation, and Perimeter) and, for fake data, the hiker's start and end positions deterministically from them.

### Step 5: Set up a WebSocket stream
All REST endpoints use /api as a prefix. The API is intentionally minimal and supports a single client at a time (demo scope, no multi-stream): POST /api/sim creates a simulation and returns its static data (params, environment, hiker start/end); POST /api/sim/stream sends a "start simulation" message via IPC (replacing any running sim) and DELETE /api/sim/stream stops it. Frames are published by the engine over ZeroMQ PUB/SUB and relayed to the single WebSocket client on /ws/sim/stream.

### Step 6: Create a (fake) simulation class
A simulation takes some hyperparameters and bootstraps itself. It constructs the environment state like elevations and canopy. It initializes the hiker agent and drone agent(s). It has a step function that updates agents sequentially. Eventually it should support sending a simulation frame that can be put onto a websocket stream.  

### Step 7: Give the hiker agent a simple random walk
Use a mixture of current momentum and downhill descent (bound it simply) to randomly walk towards the found location. Add pauses to simulate it following a standard ISRID Koenser ring.

### Step 8: Implement a PDF based on the Koenser rings
This should be a matrix where a cell is a float. It should be passable to agents.