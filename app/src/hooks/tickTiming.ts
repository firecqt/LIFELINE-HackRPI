/**
 * Wall-clock timing of the most recent simulation tick. The map renderer reads this every
 * animation frame to interpolate drone positions between discrete timesteps without React
 * re-renders.
 */
export const tickTiming = { last: 0, interval: 600 };
