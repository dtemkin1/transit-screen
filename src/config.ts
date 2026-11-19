import { isPaletteName, type PaletteChoice } from './lib/ui/palette';
import type { FeedConfig } from './lib/feeds/types';
import type { LatLon, PanelId } from './lib/types';

export interface Config {
  building: string; // building number, shown large in the header ("W41")
  name: string;     // building name beside it ("Metropolitan Warehouse"); may be empty
  palette: PaletteChoice; // frame color, or 'rotate' for a new SA+P one each day
  inset: number;  // margin for TV overscan, % of the screen's shorter side (0-10)
  location: LatLon; workerUrl: string;
  locate: boolean; // look `building` up on the MIT campus map for `location` (and `name`, when empty)
  feeds: FeedConfig[];             // board order within a panel follows this order
  pin: string[]; hide: string[];   // stop, route or alert ids; routes and alerts also as `${source}:${id}`
  walkSpeedMps: number; walkDetourFactor: number;
  /** Most important first: on a screen too short for every panel, the last ones are hidden. */
  priority: PanelId[];
}

const PANEL_IDS: readonly PanelId[] = ['subway', 'bus', 'shuttle', 'bikes'];

/** "shuttle,subway" puts those first, in that order; panels it leaves out follow in default order. */
export function parsePriority(raw: string, fallback: readonly PanelId[] = PANEL_IDS): PanelId[] {
  const named = raw.split(',').map((s) => s.trim()).filter((s): s is PanelId => (PANEL_IDS as readonly string[]).includes(s));
  return [...new Set([...named, ...fallback])];
}

/** An unset or empty VITE_WORKER_URL (e.g. an unset CI variable) falls back to local dev. */
export function pickWorkerUrl(raw: string | undefined): string {
  return raw || 'http://localhost:8787';
}

const passioRealtime = (agency: string) => ({
  tripUpdates: `https://passio3.com/${agency}/passioTransit/gtfs/realtime/tripUpdates.json`,
  serviceAlerts: `https://passio3.com/${agency}/passioTransit/gtfs/realtime/serviceAlerts.json`,
});

// Walk limits are how far riders will go for each: farther for the T than for a shuttle.
// A GTFS feed's static zip comes through the Worker, so a new one also needs an entry there.
export const FEEDS: FeedConfig[] = [
  // 7 min bus: brings in the 70 at Mass Ave @ Sidney St (6.7 min walk) beside the 1 and the 85.
  { kind: 'mbta', id: 'mbta', name: 'MBTA', walkMin: { subway: 15, bus: 7 } },
  {
    kind: 'gtfs', id: 'mit', name: 'MIT shuttles', mode: 'shuttle', walkMin: 5,
    realtime: passioRealtime('mit'), color: '#750014', named: true,
  },
  {
    kind: 'gtfs', id: 'ezride', name: 'EZRide', mode: 'bus', walkMin: 6,
    realtime: passioRealtime('charlesriver'), color: '#1F77B4',
    badge: { text: 'EZ', color: '#1F77B4', textColor: '#FFFFFF' },
    headsign: 'last-stop', // EZRide's trip_headsign names the service ("Evening Service")
  },
  // 8 min: the nearest docks from W41 are 3.7, 4.1, 5.9 and 7.5 min away on foot.
  {
    kind: 'gbfs', id: 'bluebikes', name: 'Bluebikes', mode: 'bikes', walkMin: 8, maxStations: 4,
    url: 'https://gbfs.bluebikes.com/gbfs/gbfs.json', unit: { one: 'bike', electric: 'e-bike' },
  },
];

export const defaultConfig: Config = {
  building: 'W41',
  name: 'Metropolitan Warehouse',
  palette: 'rotate',
  inset: 0,
  location: { lat: 42.35982, lon: -71.0961 },
  workerUrl: pickWorkerUrl(import.meta.env.VITE_WORKER_URL),
  locate: false,
  feeds: FEEDS,
  pin: [],
  hide: [],
  walkSpeedMps: 1.3,
  walkDetourFactor: 1.3,
  priority: [...PANEL_IDS],
};

export function resolveConfig(search: string, base: Config = defaultConfig): Config {
  const params = new URLSearchParams(search);
  const config: Config = { ...base };

  // Another building drops W41's name, location and SA+P colors.
  const building = params.get('building')?.trim();
  if (building && building !== 'W41') {
    config.building = building;
    config.name = '';
    config.palette = 'mit';
    config.locate = true;
  }
  const name = params.get('name');
  if (name) config.name = name;

  const palette = params.get('palette');
  if (palette && (palette === 'rotate' || isPaletteName(palette))) config.palette = palette;

  const priority = params.get('priority');
  if (priority) config.priority = parsePriority(priority, base.priority);

  const inset = Number(params.get('inset'));
  if (Number.isFinite(inset)) config.inset = Math.min(10, Math.max(0, inset));

  const latRaw = params.get('lat');
  const lonRaw = params.get('lon');
  if (latRaw !== null && lonRaw !== null && latRaw.trim() !== '' && lonRaw.trim() !== '') {
    const lat = Number(latRaw);
    const lon = Number(lonRaw);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      config.location = { lat, lon };
      config.locate = false;
    }
  }
  return config;
}
