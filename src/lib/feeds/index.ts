import type { Mode } from '../types';
import { gbfs } from './gbfs/adapter';
import { gtfs } from './gtfs/adapter';
import { mbta } from './mbta/adapter';
import type { Adapter, FeedConfig } from './types';

// A new kind of feed (a car-share API, say) is one adapter here plus its config type in ./types.
const ADAPTERS: { [K in FeedConfig['kind']]: Adapter<Extract<FeedConfig, { kind: K }>, any> } = { mbta, gtfs, gbfs };

export function adapterFor(feed: FeedConfig): Adapter {
  return ADAPTERS[feed.kind] as Adapter;
}

/** How far riders will walk to this feed's stops, per mode it serves. */
export function walkLimits(feed: FeedConfig): Partial<Record<Mode, number>> {
  return feed.kind === 'mbta' ? feed.walkMin : { [feed.mode]: feed.walkMin };
}
