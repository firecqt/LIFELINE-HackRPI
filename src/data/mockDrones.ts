import type { DroneSpec, DroneStatus, FleetDrone } from '../types/drone';
import { DRONE_COLORS } from '../lib/colors';
import { Rng } from '../lib/rng';
import { APP_NOW, HOUR } from './clock';

/** SIMULATED hardware catalog — fictional manufacturers and specifications. */
export const DRONE_MODELS: Record<string, DroneSpec> = {
  k2: {
    manufacturer: 'Kestrel Dynamics',
    model: 'K2 Thermal Scout',
    airframe: 'Quadcopter',
    flightTimeMin: 42,
    rangeKm: 12,
    cruiseSpeedMs: 14,
    maxWindMs: 12,
    camera: '48 MP 1/2" CMOS · 6× hybrid zoom',
    thermal: '640×512 radiometric LWIR · 30 Hz · NETD <40 mK',
    sensors: ['Laser rangefinder', 'RTK GNSS', 'ADS-B receiver', 'Obstacle avoidance (omni)'],
    weightKg: 1.9,
    costUsd: 18400,
    footprintM: 62,
    basePod: 0.9,
  },
  sr4: {
    manufacturer: 'Aethon Robotics',
    model: 'SR-4 Sentinel',
    airframe: 'Hexacopter',
    flightTimeMin: 55,
    rangeKm: 18,
    cruiseSpeedMs: 16,
    maxWindMs: 15,
    camera: '20 MP 1" CMOS · 30× optical zoom',
    thermal: '640×512 LWIR · 30 Hz · dual-gain',
    sensors: ['LiDAR altimeter', 'RTK GNSS', '120 dB loudspeaker', '1,800 lm spotlight', 'Cellular IMSI locator (sim)'],
    weightKg: 4.6,
    costUsd: 26900,
    footprintM: 66,
    basePod: 0.93,
  },
  talon: {
    manufacturer: 'Northwind UAS',
    model: 'Talon LR',
    airframe: 'VTOL fixed-wing',
    flightTimeMin: 110,
    rangeKm: 60,
    cruiseSpeedMs: 22,
    maxWindMs: 14,
    camera: '24 MP APS-C mapping camera',
    thermal: '640×512 LWIR · 9 Hz',
    sensors: ['RTK GNSS', 'Satellite datalink', 'ADS-B in/out'],
    weightKg: 7.8,
    costUsd: 48500,
    footprintM: 70,
    basePod: 0.86,
  },
  pathfinder: {
    manufacturer: 'Corvid Systems',
    model: 'Pathfinder Mini',
    airframe: 'Quadcopter',
    flightTimeMin: 34,
    rangeKm: 8,
    cruiseSpeedMs: 12,
    maxWindMs: 10,
    camera: '12 MP 1/2.3" CMOS',
    thermal: '320×256 LWIR · 9 Hz',
    sensors: ['GNSS', 'Downward ToF', 'Forward obstacle sensing'],
    weightKg: 0.9,
    costUsd: 7900,
    footprintM: 55,
    basePod: 0.82,
  },
};

const MODEL_ORDER: (keyof typeof DRONE_MODELS)[] = [
  'k2', 'sr4', 'k2', 'pathfinder', 'sr4', 'k2', 'talon', 'k2', 'sr4', 'pathfinder', 'k2', 'sr4',
  'talon', 'k2', 'sr4', 'pathfinder', 'k2', 'sr4', 'k2', 'talon',
];

const CALLSIGNS = [
  'Osprey', 'Kite', 'Harrier', 'Merlin', 'Falcon', 'Swift', 'Condor', 'Kestrel', 'Raven', 'Tern',
  'Heron', 'Shrike', 'Albatross', 'Petrel', 'Gannet', 'Plover', 'Warbler', 'Finch', 'Skua', 'Egret',
];

const ASSIGN: Record<string, string> = {
  'D-01': 'M-001', 'D-02': 'M-001', 'D-03': 'M-001', 'D-04': 'M-001',
  'D-05': 'M-002', 'D-06': 'M-002',
  'D-07': 'M-003', 'D-08': 'M-003', 'D-09': 'M-003', 'D-10': 'M-003', 'D-11': 'M-003', 'D-12': 'M-003',
};

const PARK_NAMES = ['Yosemite', 'Glacier', 'Yellowstone', 'Rocky Mountain'];
const RESULTS = ['Subject located', 'Area cleared', 'Sector cleared', 'Subject located', 'Training sortie', 'Area cleared'];

function makeDrone(i: number): FleetDrone {
  const id = `D-${String(i + 1).padStart(2, '0')}`;
  const rng = new Rng(9000 + i * 17);
  const spec = DRONE_MODELS[MODEL_ORDER[i]];
  let baseStatus: DroneStatus = 'standby';
  if (ASSIGN[id]) baseStatus = i % 3 === 0 ? 'en_route' : 'searching';
  if (id === 'D-19') baseStatus = 'charging';
  if (id === 'D-20') baseStatus = 'maintenance';
  const flightHistory = Array.from({ length: 8 }, (_, k) => {
    const durationMin = Math.round(rng.range(0.45, 0.95) * spec.flightTimeMin);
    const distanceKm = +((durationMin * 60 * spec.cruiseSpeedMs * rng.range(0.45, 0.7)) / 1000).toFixed(1);
    return {
      date: APP_NOW - (k + 1) * rng.range(30, 90) * HOUR,
      missionId: `H-${String(940 - k * 7 - i).padStart(4, '0')}`,
      park: rng.pick(PARK_NAMES),
      durationMin,
      distanceKm,
      coverageKm2: +(distanceKm * ((spec.footprintM * 2) / 1000)).toFixed(2),
      result: rng.pick(RESULTS),
    };
  });
  const health = Math.round(rng.range(84, 99));
  const batteryHistory = Array.from({ length: 16 }, (_, k) => ({
    cycle: 180 + k * 6 + i * 3,
    capacity: +(100 - (100 - health) * (k / 15) - rng.range(0, 0.6)).toFixed(1),
    level: Math.round(rng.range(18, 100)),
  }));
  return {
    id,
    name: `${id} ${CALLSIGNS[i]}`,
    callsign: CALLSIGNS[i],
    color: DRONE_COLORS[i % DRONE_COLORS.length],
    spec,
    baseStatus,
    battery: baseStatus === 'charging' ? 46 : baseStatus === 'maintenance' ? 0 : Math.round(rng.range(78, 100)),
    batteryHealth: health,
    firmware: `v${rng.int(3, 4)}.${rng.int(0, 9)}.${rng.int(0, 20)}`,
    totalFlightHours: Math.round(rng.range(60, 420)),
    totalDistanceKm: Math.round(rng.range(900, 7200)),
    missionsFlown: rng.int(12, 96),
    lastMaintenance: APP_NOW - rng.range(3, 60) * 24 * HOUR,
    homeBase: rng.pick(['Bridalveil Ranger Station', 'St. Mary Ranger Station', 'Old Faithful Ranger Station', 'Glacier Basin Ranger Station']),
    assignedMissionId: ASSIGN[id] ?? null,
    flightHistory,
    batteryHistory,
    sensorPerformance: {
      detectionRate: +rng.range(0.78, 0.95).toFixed(2),
      falsePositiveRate: +rng.range(0.01, 0.06).toFixed(3),
      avgPod: +(spec.basePod * rng.range(0.7, 0.85)).toFixed(2),
      thermalUptime: +rng.range(0.96, 0.999).toFixed(3),
    },
  };
}

/** SIMULATED fleet of 20 drones. */
export const MOCK_FLEET: FleetDrone[] = Array.from({ length: 20 }, (_, i) => makeDrone(i));
