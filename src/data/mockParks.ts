import type { Park } from '../types/mission';

/** SIMULATED: terrain profiles drive the procedural generator; they are not real DEM data. */
export const PARKS: Park[] = [
  {
    id: 'yosemite',
    name: 'Yosemite National Park',
    shortName: 'Yosemite',
    state: 'CA',
    center: { latitude: 37.8651, longitude: -119.5383 },
    areaKm2: 3027,
    profile: { base: 1250, relief: 1700, ridge: 0.38, exponent: 1.25, valley: true, domes: 3, lakeFraction: 0.012, treeline: 2650, snowline: 2850, moisture: 0.55, rivers: 2 },
    names: {
      peaks: ['Sentinel Dome', 'Cathedral Spire', 'Clouds Rest'],
      lake: 'Tenaya Basin Lake',
      trailhead: 'Glacier Point Trailhead',
      ranger: 'Bridalveil Ranger Station',
      overlook: 'Panorama Overlook',
      camp: 'Little Yosemite Camp',
      trails: ['Panorama Trail', 'Mist Ridge Trail', 'Cathedral Traverse'],
    },
  },
  {
    id: 'glacier',
    name: 'Glacier National Park',
    shortName: 'Glacier',
    state: 'MT',
    center: { latitude: 48.7596, longitude: -113.787 },
    areaKm2: 4101,
    profile: { base: 1050, relief: 1850, ridge: 0.62, exponent: 1.35, valley: false, domes: 0, lakeFraction: 0.07, treeline: 2050, snowline: 2400, moisture: 0.68, rivers: 2 },
    names: {
      peaks: ['Reynolds Horn', 'Garden Wall', 'Pollock Spire'],
      lake: 'Hidden Tarn',
      trailhead: 'Logan Pass Trailhead',
      ranger: 'St. Mary Ranger Station',
      overlook: 'Highline Overlook',
      camp: 'Granite Park Camp',
      trails: ['Highline Trail', 'Hidden Lake Trail', 'Siyeh Pass Route'],
    },
  },
  {
    id: 'yellowstone',
    name: 'Yellowstone National Park',
    shortName: 'Yellowstone',
    state: 'WY',
    center: { latitude: 44.428, longitude: -110.5885 },
    areaKm2: 8991,
    profile: { base: 2250, relief: 720, ridge: 0.18, exponent: 1.1, valley: false, domes: 2, lakeFraction: 0.09, treeline: 2900, snowline: 3050, moisture: 0.5, rivers: 3 },
    names: {
      peaks: ['Mount Washburn Spur', 'Dunraven Knob', 'Elephant Back'],
      lake: 'Shoshone Arm',
      trailhead: 'Lone Star Trailhead',
      ranger: 'Old Faithful Ranger Station',
      overlook: 'Firehole Overlook',
      camp: 'Shoshone Geyser Basin Camp',
      trails: ['Lone Star Geyser Trail', 'Mallard Lake Trail', 'Howard Eaton Trail'],
    },
  },
  {
    id: 'rocky',
    name: 'Rocky Mountain National Park',
    shortName: 'Rocky Mountain',
    state: 'CO',
    center: { latitude: 40.3428, longitude: -105.6836 },
    areaKm2: 1076,
    profile: { base: 2500, relief: 1450, ridge: 0.5, exponent: 1.3, valley: false, domes: 0, lakeFraction: 0.025, treeline: 3350, snowline: 3700, moisture: 0.5, rivers: 2 },
    names: {
      peaks: ['Longs Shoulder', 'Chiefs Head', 'Hallett Spire'],
      lake: 'Emerald Tarn',
      trailhead: 'Bear Lake Trailhead',
      ranger: 'Glacier Basin Ranger Station',
      overlook: 'Flattop Overlook',
      camp: 'Glacier Gorge Camp',
      trails: ['Flattop Mountain Trail', 'Glacier Gorge Trail', 'Odessa Lake Trail'],
    },
  },
];

export const parkById = (id: string) => PARKS.find((p) => p.id === id)!;
