export type Mode = 'subway' | 'bus' | 'ezride' | 'shuttle' | 'bikes';
export type Source = 'mbta' | 'mit' | 'ezride' | 'bluebikes';
export type PanelId = 'subway' | 'bus' | 'shuttle' | 'bikes'; // bus panel holds mode bus + ezride
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
}
export interface Departure {
  source: Source; mode: Mode; routeId: string;
  stopId: string;          // platform-level id from the feed; mapped to Stop via platformIds
  directionKey: string;    // MBTA: `${routeId}:${direction_id}`; Passio: `${routeId}:${headsign}`
  headsign: string;
  departureTime: number;   // epoch ms
  arrivalTime?: number;    // epoch ms
  live: boolean;
  status?: string;         // MBTA prediction status text, shown verbatim
  vehicleStoppedHere?: boolean;
  tripId?: string;
  vehicleId?: string;      // live only; one vehicle can be predicted on two trips back to back
}
export interface Alert { id: string; source: Source; header: string; routeIds: string[]; stopIds: string[] }
export interface BikeStation {
  id: string; name: string; lat: number; lon: number; walkSec: number;
  bikes?: number; ebikes?: number; docks?: number; renting?: boolean;
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
  notes: string[];  // what isn't fully live, per agency ("EZRide: data delayed")
}
