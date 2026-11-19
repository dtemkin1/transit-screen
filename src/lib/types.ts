/** Each mode is one board panel; a feed's stops and stations say which panel they appear in. */
export type Mode = 'subway' | 'bus' | 'shuttle' | 'bikes';
export type PanelId = Mode;
/** A feed id from `config.feeds` ("mbta", "mit", ...). */
export type Source = string;
export interface LatLon { lat: number; lon: number }

export interface Stop {
  id: string;              // display id (MBTA parent station id for subway; stop id otherwise)
  source: Source; mode: Mode; name: string; lat: number; lon: number;
  platformIds: string[];   // ids used to query/join realtime (MBTA child stops; [id] for others)
  walkSec: number; walkEstimated: boolean; // true when fallback estimate was used
}
export interface RouteInfo {
  id: string; source: Source; mode: Mode;
  shortName: string; longName: string; color: string; textColor: string; // '#RRGGBB'
  badge?: string;          // fixed badge text, e.g. "EZ" for every EZRide route
  named?: boolean;         // riders know it by name: rows read "Tech Shuttle to Kendall"
}
export interface Departure {
  source: Source; mode: Mode; routeId: string;
  stopId: string;          // platform-level id from the feed; mapped to Stop via platformIds
  directionKey: string;    // MBTA: `${routeId}:${direction_id}`; GTFS: `${routeId}:${headsign}`
  headsign: string;
  departureTime: number;   // epoch ms
  arrivalTime?: number;    // epoch ms
  live: boolean;
  status?: string;         // MBTA prediction status text, shown verbatim
  vehicleStoppedHere?: boolean;
  tripId?: string;
  vehicleId?: string;      // live only; one vehicle can be predicted on two trips back to back
}
export interface Alert {
  id: string; source: Source; header: string; routeIds: string[]; stopIds: string[];
  agencyWide?: boolean;    // names no route: shown whenever the feed has a stop on the board
}
/** What a station's count is of: "bike" / "e-bike", or "car". */
export interface Unit { one: string; electric?: string }
/** A dock or lot with vehicles to pick up (Bluebikes, car share). */
export interface Station {
  id: string; source: Source; mode: Mode; unit: Unit;
  name: string; lat: number; lon: number; walkSec: number;
  available?: number; electric?: number; docks?: number; open?: boolean; // undefined until status arrives
}
export type PanelStatus = 'ok' | 'delayed' | 'schedule-fallback' | 'unavailable';
export interface TimeCell {
  label: string; live: boolean; departureTime: number;  // only departures you can walk to in time
  status?: string;  // MBTA prediction status ("Stopped 5 stops away"), shown beside the countdown
}
export interface BoardRow {
  key: string; route: RouteInfo; headsign: string;
  stopName?: string; walkMin?: number; walkEstimated?: boolean; // set for non-subway rows (closest stop)
  times: TimeCell[];
}
export interface BoardGroup { header?: { name: string; walkMin: number; walkEstimated: boolean }; rows: BoardRow[] }
export interface BoardPanel {
  id: PanelId; title: string; status: PanelStatus; groups: BoardGroup[];
  notes: string[];        // what isn't fully live, per agency ("EZRide: data delayed")
  stations?: Station[];   // station panels list these instead of rows
}
