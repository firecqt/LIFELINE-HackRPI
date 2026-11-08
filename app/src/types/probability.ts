/**
 * Probability contract. The backend model may deliver `distribution` as number[][]
 * (see `probabilityService.toProbabilityMatrix / fromProbabilityMatrix` adapters);
 * internally the frontend keeps row-major Float32Arrays for rendering efficiency.
 */
export interface ProbabilitySnapshot {
  timestamp: number; // sim seconds since mission start
  minutes: number;
  width: number;
  height: number;
  distribution: Float32Array; // normalized, sums to 1
  highestProbabilityCell: { x: number; y: number; probability: number };
  searchedMass: number;
  coverage: number;
}

export interface ProbabilityStats {
  peak: { x: number; y: number; probability: number };
  searchedMass: number; // posterior mass inside already-searched cells
  unexploredMass: number;
  cumulativePos: number; // share of prior mass cleared by search (search confidence)
  mean: { x: number; y: number };
  ellipse: { rx: number; ry: number; angle: number };
  entropy: number;
}
