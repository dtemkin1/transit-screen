import type { FeedConfig } from '../feeds/types';

const passioRealtime = (agency: string) => ({
  tripUpdates: `https://passio3.com/${agency}/passioTransit/gtfs/realtime/tripUpdates.json`,
  serviceAlerts: `https://passio3.com/${agency}/passioTransit/gtfs/realtime/serviceAlerts.json`,
});

/**
 * The agencies on the board. Walk limits are how far riders will go: farther for the T than for a
 * shuttle. A GTFS feed's static zip comes through the Worker, so a new one also needs an entry there.
 */
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
    // EZRide's trip_headsign names the service ("Evening Service"), not a destination.
    headsign: 'last-stop',
  },
  // 8 min: the nearest docks from W41 are 3.7, 4.1, 5.9 and 7.5 min away on foot.
  {
    kind: 'gbfs', id: 'bluebikes', name: 'Bluebikes', mode: 'bikes', walkMin: 8, maxStations: 4,
    url: 'https://gbfs.bluebikes.com/gbfs/gbfs.json', unit: { one: 'bike', electric: 'e-bike' },
  },
  {
    kind: "gtfs", id: "longwood", name: "Longwood shuttles", mode: "shuttle", walkMin: 5,
    realtime: passioRealtime("longwoodcollective"), color: "#fdc42f", named: true,
  },
];
