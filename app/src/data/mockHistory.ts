import type { HistoricalMission } from '../types/mission';
import { Rng } from '../lib/rng';
import { APP_NOW, HOUR } from './clock';
import { parkById } from './mockParks';

interface Seed {
  id: string;
  name: string;
  age: number;
  parkId: string;
  daysAgo: number;
  durationMin: number;
  drones: number;
  outcome: HistoricalMission['outcome'];
  detectionMin: number | null;
  areaKm2: number;
  summary: string;
}

const SEEDS: Seed[] = [
  { id: 'H-0941', name: 'Rachel Kim', age: 29, parkId: 'yosemite', daysAgo: 3, durationMin: 54, drones: 6, outcome: 'Located — alive', detectionMin: 41, areaKm2: 11.2, summary: 'Hiker left trail in fading light; thermal signature located in a drainage 1.8 km below LKP. Ground team confirmed within 13 minutes.' },
  { id: 'H-0934', name: 'Marcus Webb', age: 58, parkId: 'glacier', daysAgo: 6, durationMin: 132, drones: 5, outcome: 'Located — injured', detectionMin: 118, areaKm2: 18.6, summary: 'Ankle injury off-route on talus. Detection delayed by low cloud; probability mass redistributed toward lee-side slopes after second sweep.' },
  { id: 'H-0927', name: 'Priya Nair', age: 41, parkId: 'yellowstone', daysAgo: 9, durationMin: 37, drones: 4, outcome: 'Self-rescued', detectionMin: null, areaKm2: 7.4, summary: 'Subject walked out to a trailhead while drones were clearing the northern sector. Mission stood down.' },
  { id: 'H-0919', name: 'Owen Gallagher', age: 12, parkId: 'rocky', daysAgo: 14, durationMin: 28, drones: 6, outcome: 'Located — alive', detectionMin: 22, areaKm2: 5.1, summary: 'Child separated from family near lake outlet. High-probability block searched first by auction winner D-02.' },
  { id: 'H-0911', name: 'Linda Okafor', age: 66, parkId: 'yosemite', daysAgo: 21, durationMin: 210, drones: 8, outcome: 'Located by ground team', detectionMin: 196, areaKm2: 26.8, summary: 'Dense canopy limited aerial POD. Drones narrowed probability to two corridors; ground team located subject in the second.' },
  { id: 'H-0902', name: 'Ben Torres', age: 33, parkId: 'glacier', daysAgo: 30, durationMin: 480, drones: 6, outcome: 'Suspended', detectionMin: null, areaKm2: 34.0, summary: 'Severe weather grounded fleet after 3.2 h. Search suspended with 61% cumulative POS; handed to ground teams.' },
  { id: 'H-0894', name: 'Hannah Moore', age: 24, parkId: 'yellowstone', daysAgo: 38, durationMin: 66, drones: 5, outcome: 'Located — alive', detectionMin: 59, areaKm2: 12.9, summary: 'Subject sheltering in timber near thermal area. Detection confidence 0.88 verified on second orbit.' },
  { id: 'H-0886', name: 'Victor Lang', age: 47, parkId: 'rocky', daysAgo: 45, durationMin: 95, drones: 7, outcome: 'Located — injured', detectionMin: 87, areaKm2: 15.3, summary: 'Fall above treeline. Strong wind reduced drone endurance; auction reweighted toward battery-efficient bids.' },
];

function build(s: Seed): HistoricalMission {
  const rng = new Rng(s.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const steps = Math.max(8, Math.round(s.durationMin / 5));
  const finalCov = s.outcome === 'Suspended' ? 0.94 : s.detectionMin ? Math.min(0.95, 0.35 + rng.range(0.1, 0.45)) : 0.52;
  const series: HistoricalMission['series'] = [];
  let unexplored = 1;
  let peak = rng.range(0.004, 0.009);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const coverage = finalCov * (1 - Math.pow(1 - t, 1.6));
    unexplored = Math.max(0.05, 1 - coverage * rng.range(0.85, 1.15) * 0.92);
    peak = peak * (1 + rng.range(-0.06, 0.12));
    series.push({
      minute: Math.round(t * s.durationMin),
      coverage: +coverage.toFixed(3),
      unexplored: +unexplored.toFixed(3),
      peak: +peak.toFixed(4),
      pos: +(1 - unexplored).toFixed(3),
    });
  }
  const droneDistances = Array.from({ length: s.drones }, (_, i) => ({
    id: `D-${String(i + 1).padStart(2, '0')}`,
    km: +(s.durationMin * rng.range(0.18, 0.42)).toFixed(1),
  }));
  const efficiency = series.map((p, i) => ({
    minute: p.minute,
    massPerKm: i === 0 ? 0 : +((p.pos / Math.max(1, p.minute * s.drones * 0.3)) * 100).toFixed(3),
  }));
  return {
    id: s.id,
    missingPerson: s.name,
    age: s.age,
    parkId: s.parkId,
    park: parkById(s.parkId).name,
    date: APP_NOW - s.daysAgo * 24 * HOUR,
    durationMin: s.durationMin,
    drones: s.drones,
    coverage: finalCov,
    outcome: s.outcome,
    detectionMin: s.detectionMin,
    areaKm2: s.areaKm2,
    summary: s.summary,
    series,
    droneDistances,
    efficiency,
  };
}

/** SIMULATED archive of completed missions. */
export const MOCK_HISTORY: HistoricalMission[] = SEEDS.map(build);
