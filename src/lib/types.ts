/** Each mode is one board panel; a feed's stops and stations say which panel they appear in. */
export type Mode = 'subway' | 'bus' | 'shuttle' | 'bikes';
export type PanelId = Mode;
/** A feed id from `config.feeds` ("mbta", "mit", ...). */
export type Source = string;
export interface LatLon { lat: number; lon: number }

/** A row a feed could show today, listed to size its panel. */
export interface ServiceRow {
  mode: Mode;
  /** Feed's `directionKey`; for subway, the route and destination ("Red:Braintree"), as its rows are keyed */
  key: string;
  /** The route, so a hidden one (`?hide=`) isn't counted. */
  routeId: string;
  stopId: string;
}

export interface Stop {
  /** The MBTA parent station for subway; the stop itself otherwise. */
  id: string;
  source: Source; mode: Mode; name: string; lat: number; lon: number;
  /** Ids realtime data uses: MBTA child stops (platforms), or `[id]`. */
  platformIds: string[];
  walkSec: number;
  /** True when the walk time is a straight-line estimate (the walking service didn't answer). */
  walkEstimated: boolean;
}
export interface RouteInfo {
  id: string; source: Source; mode: Mode;
  shortName: string; longName: string;
  /** '#RRGGBB' */
  color: string;
  /** '#RRGGBB' */
  textColor: string;
  /** Fixed badge text, e.g. "EZ" for every EZRide route. */
  badge?: string;
  /** Riders know it by name: rows read "Tech Shuttle to Kendall". */
  named?: boolean;
}
export interface Departure {
  source: Source; mode: Mode; routeId: string;
  /** The feed's platform-level id; `Stop.platformIds` maps it to a stop. */
  stopId: string;
  /** MBTA: `${routeId}:${direction_id}`; GTFS: `${routeId}:${headsign}`, or the headsign alone for a feed with one badge. */
  directionKey: string;
  headsign: string;
  /** Epoch ms. */
  departureTime: number;
  /** Epoch ms. */
  arrivalTime?: number;
  live: boolean;
  /** MBTA prediction status text, shown verbatim. */
  status?: string;
  vehicleStoppedHere?: boolean;
  tripId?: string;
  /** Live only; one vehicle can be predicted on two trips back to back. */
  vehicleId?: string;
}
export interface Alert {
  id: string; source: Source; header: string; routeIds: string[]; stopIds: string[];
  /** Names no route: shown whenever the feed has a stop on the board. */
  agencyWide?: boolean;
  /** The feed's name, set by the board, so a strip of alerts from several agencies says whose each is. */
  agency?: string;
}
/** What a station's count is of: "bike" / "e-bike", or "car". */
export interface Unit { one: string; electric?: string }
/** A dock or lot with vehicles to pick up (Bluebikes, car share). The counts are undefined until status arrives. */
export interface Station {
  id: string; source: Source; mode: Mode; unit: Unit;
  name: string; lat: number; lon: number; walkSec: number;
  available?: number; electric?: number; docks?: number; open?: boolean;
}
export type PanelStatus = 'ok' | 'delayed' | 'schedule-fallback' | 'unavailable';
/** One departure you can still walk to in time. */
export interface TimeCell {
  label: string; live: boolean; departureTime: number;
  /** MBTA prediction status ("Stopped 5 stops away"), shown beside the countdown. */
  status?: string;
}
/** `stopName`, `walkMin` and `walkEstimated` are set on non-subway rows (the closest stop). */
export interface BoardRow {
  key: string; route: RouteInfo; headsign: string;
  stopName?: string; walkMin?: number; walkEstimated?: boolean;
  times: TimeCell[];
}
export interface BoardGroup { header?: { name: string; walkMin: number; walkEstimated: boolean }; rows: BoardRow[] }
export interface BoardPanel {
  id: PanelId; title: string; status: PanelStatus; groups: BoardGroup[];
  /** What isn't fully live, per agency ("EZRide: data delayed"). */
  notes: string[];
  /** Station panels list these instead of rows. */
  stations?: Station[];
}
