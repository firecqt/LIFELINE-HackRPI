# AGENTS.md

## Project Description
Terrain-derived priors for Informed Drone Swarm Coordination in Hiker Search-and-Rescue (SAR). Using data such as elevation levels, canopy density, ISRID rings, and lost person behavioral psychology, we will compute a Bayesian prior distribution for where a lost hiker might be at a timestep t. Drones will then use this information inside of a gridworld value map to assign search regions and efficiently explore the space.

## Project Steps

### Project Step Tracker (To persist between sessions)
+ [x] Step 1
+ [x] Step 2
+ [x] Step 3
+ [ ] Step 4

### Step 1: Basic setup
We will use a node webserver with a python engine, communicating data via IPC. Express and ZeroMQ will be used to coordinate data. MongoDB will be used to hold simulation data.

### Step 2: Express server setup
Set up basic skeleton endpoints for accessing data. Read the documentation in server.js explaining general strategy.

### Step 3: Generating fake environment data
Once the MQ is hooked, write functions to generate elevation and foilage data. Elevation data should use perlin noise over an NxN grid about an offset variable (optional). The foilage data should use labels 1, 2, 3 to indicate no interference, low interference, and high interference (simulates foilage impact on camera). Finally also write a function that returns the perimeter of the area as 4 [x, y] coordinates boxing the grid. 

### Step 4: Set up MongoDB
Still working out how to do this.

### Step 5: One Simple Drone Agent
This is an agent that visits the hiker's LKP (start) then the hiker's found position (end) then returns to 0,0. It can be hard coded, and should follow the timestep rule. Each timestep it will move 1 position forward