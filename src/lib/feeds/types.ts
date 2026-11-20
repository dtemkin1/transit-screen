import type { Config } from '../../config';
import type { Alert, CancelledStop, Departure, Mode, RouteInfo, ServiceRow, Source, Station, Stop, Unit } from '../types';
import type { fetchBytes, fetchJson } from '../data/worker-client';

interface FeedBase {
  /** Keys state and route ids; the Worker serves a GTFS feed's zip under it. */
  id: Source;
  /** Agency name in panel notes and titles ("EZRide: data delayed"). */
  name: string;
}

export interface MbtaFeed extends FeedBase {
  kind: 'mbta';
  walkMin: { subway: number; bus: number };
}

export interface GtfsFeed extends FeedBase {
  kind: 'gtfs';
  mode: Mode;
  walkMin: number;
  /** GTFS-RT as JSON (Passio serves it). Without it the feed shows its schedule only. */
  realtime?: { tripUpdates: string; serviceAlerts?: string };
  /** For routes the feed publishes without one. */
  color: string;
  /** One badge for every route, for agencies that run everything under one banner. */
  badge?: { text: string; color: string; textColor: string };
  /** Rows lead with the route name ("Tech Shuttle to Kendall"). */
  named?: boolean;
  /** 'last-stop' when trip_headsign isn't a destination. */
  headsign?: 'trip' | 'last-stop';
}

export interface GbfsFeed extends FeedBase {
  kind: 'gbfs';
  mode: Mode;
  walkMin: number;
  maxStations: number;
  /** The gbfs.json autodiscovery URL. */
  url: string;
  unit: Unit;
}

export type FeedConfig = MbtaFeed | GtfsFeed | GbfsFeed;

export interface FeedIO {
  cfg: Config;
  fetchJson: typeof fetchJson;
  fetchBytes: typeof fetchBytes;
}

/** What a feed contributes to discovery, before the walk filter. */
export interface FeedCandidates<D = unknown> {
  /** The adapter's own static data, handed back to its polls. */
  data: D;
  stops?: Stop[];
  stations?: Station[];
  routes?: RouteInfo[];
  /** Stop ids each direction boards at, so a row's stop is chosen before any departure is known. */
  serving?: Map<string, Set<string>>;
}

/** The feed's share of the current discovery, as its polls see it. */
export interface FeedScope<D = unknown> {
  data: D;
  stops: Stop[];
  stations: Station[];
  /** Discovered plus learned from responses. */
  routes: RouteInfo[];
}

/** A poll's result; each field present replaces that feed's previous value. */
export interface FeedUpdate {
  live?: Departure[];
  scheduled?: Departure[];
  alerts?: Alert[];
  stations?: Station[];
  routes?: RouteInfo[];
  /** Rows the feed could show today, for sizing its panels. */
  service?: ServiceRow[];
  /** Trips the live feed says won't stop where scheduled. */
  cancelled?: CancelledStop[];
  /** Live data arrived. Its own timestamp (plus GBFS `ttl`) caps how fresh it counts as. */
  fresh?: { at?: unknown; validFor?: unknown };
}

export interface Poll<D = unknown> {
  name: string;
  everyMs: number;
  /** Returns undefined when there is nothing to ask for (no nearby stops). */
  run(scope: FeedScope<D>, io: FeedIO, nowMs: number): Promise<FeedUpdate | undefined> | FeedUpdate | undefined;
}

export interface Adapter<F extends FeedConfig = FeedConfig, D = unknown> {
  candidates(feed: F, io: FeedIO): Promise<FeedCandidates<D>>;
  polls(feed: F): Poll<D>[];
}
