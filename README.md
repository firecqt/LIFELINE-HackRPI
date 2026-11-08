# LIFELINE
### Contributors: Sam S, Jacob H

## What is LIFELINE?
Every day, hikers go missing. The probability of finding a missing hiker dramatically decreases after 24 hours, showing a need for an efficient search strategy. Current strategies are limited by equipment, finances, and manpower. To fix this, LIFELINE proposes a cost-effective unmanned search strategy invovling a coordinated drone swarm. By using a terrain-derived bayesian prior of the park, drones work together to optimally explore. Our rough estimates indicate an exponential speedup in search time, growing logarithmically with drone count, perimeter size, and the prevalence of sensor-interfering canopy coverage.

## Why is LIFELINE efficient?
LIFELINE makes extensive use of **Lost Person Behavior** research, which combines environmental features with human psychology to produce analytical models about movement. LIFELINE's movement model combines Koester rings with elevation change to produce a **Probability Density Function** over the region. Armed with this prior, drones have an information advantage that allows them to explore the world.

## Why is LIFELINE effective?
LIFELINE isn't just fast, but also considers real-world constraints, such as flight trajectory, search assignment, entropy reduction, and sensor occlusion. A comprehensive probability model is used, which embraces false negatives and Probability of Detection approaches to write a fault-first perspective.

## How to run me
1. go to `/server` and do npm install
2. go to `/engine` and make a virtual environment named `.venv`
3. activate the venv then install from requirements.txt
4. in that same terminal, run `python api.py`
5. in a different terminal, go to `/server`
6. run `npm run dev` in that terminal