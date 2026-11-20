# Panel sizing by need

## Changed after building

The design below is the one approved. Trying it on the board changed four parts; the code in `src/lib/board/size.ts` is current.

- **Splitting.** Each panel starts at its need: its title plus that many rows. Spare room goes to the column's highest-priority panel that has something to show. In a short column, a panel one step higher in `priority` gives up 1/1.25 as much per pixel of its starting height. Splitting purely in proportion to weight left blank space in one panel while the next cut rows.
- **Layout.** `splitColumn` computes each panel's height in px. In this layout CSS flex wouldn't shrink a panel below its starting size (the panel inside each slot is `height: 100%`).
- **Subway count.** It comes from MBTA route patterns on the service date, one request per station, counting each route and destination ("Red" to "Braintree"). It no longer uses `/routes` by direction, so it no longer undercounts the Ashmont and Braintree branches. The Worker passes `/mbta/route_patterns` through.
- **Floor.** Each panel reports its least height (title plus first row, or its notes), and `splitColumn` keeps to it. CSS no longer sets it.

## Why

Fixed height shares waste room. The MIT shuttles may run only a few services while the buses beside them have more rows than fit. Or the subway has more service than its share can show while the bikes panel below it sits half empty.

## Goal

Within each column, give each panel the height its service needs, so a light panel gives room to a busy one.

## Non-goals

- Moving panels between columns.
- Changing column widths.
- Changing how `priority` hides panels on a short screen. It gains one job, weighting the split (below).

## Anti-goals

- Borders that move as departures come and go. The board is read from across a room, so a panel's place has to stay put through the day.
- A size taken from whatever runs at 4 am. The board reloads then, when almost nothing is running.

## Approaches

- **A. Split each column by need, counted once per day (chosen).** This fixes the buses-and-shuttles case fully, and the subway case whenever bikes has little to show.
- **B. A, plus moving bikes to the other column when its own is full.** Rejected: panels would change sides, and people learn where each panel sits.
- **C. Size by the rows showing right now.** Rejected: the borders would move all day, which is why the shares were fixed in the first place.

## Design

**Need is counted for the whole service day, not the hour.** A panel's need is how many rows it could show today. It is worked out when the board loads, and the 4 am reload counts the new day.

- **MBTA (subway, bus).** Discovery adds `/routes` requests, one per direction, filtered to the nearby platforms and today's service date (`filter[stop]`, `filter[date]`, `filter[direction_id]`). The Worker already proxies `/routes`, so it needs no change.
  - Bus need is the number of route directions found.
  - Subway need is route directions plus one header per station.
  - This undercounts a little where one direction splits by headsign (Red Line to Ashmont and Braintree), so the subway panel may get slightly less than it can fill.
- **GTFS feeds (shuttles).** Need is the number of directions that have a trip running today, using the existing `activeServiceIds`, at nearby stops.
- **Bikes.** Need is the number of docks shown, which is already fixed at load.
- **Failure.** If a feed's route count fails, that panel falls back to its current fixed share.

**Splitting a column.**

- Each panel's weight is its need × 1.25^(steps above the last panel in `priority`). With the default order, subway gets about 1.95× the room per row of need that bikes gets, and buses 1.25× the shuttles. That is close to today's lean toward subway.
- A column's height is split in proportion to weight, whether it is short of room or has some to spare. Spare room shows as space at the bottom of each list.
- Every panel keeps at least one row (a minimum height).
- A panel whose need is zero, or that is showing only "live data unavailable", keeps today's small empty share.
- On screens too short for one row each, today's hiding by `priority` still applies, unchanged.

**Code.**

- `PanelDef.share` gives way to a need computed in `src/lib/board/`, as a pure function with tests.
- `+page.svelte` sets each slot's flex-grow to that weight, with a flex basis of 0 and a minimum height of one row plus the title.

## Left to the builder

- How the new route counts are stored on `Discovered`.
- Test cases.
- README updates: "Panels" and the `priority` row, which now also weights panel heights.
