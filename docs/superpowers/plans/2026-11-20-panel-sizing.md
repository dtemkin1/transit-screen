# Panel Sizing by Need Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Within each board column, size each panel by how many rows its service needs today, weighted by `priority`, with at least one row each.

**Architecture:**
- Each feed adapter gains a `service` poll that lists the rows it could show today (MBTA through `/routes` filtered by stop, date and direction; GTFS from its calendar). The poller keeps those lists in `state.service`.
- A pure module, `src/lib/board/size.ts`, turns them into a need and a weight per panel. The page sets each slot's `flex-grow` to the weight. Each panel's own minimum height (title plus one row) is the floor, and the browser's flex algorithm does the split.
- A column that overflows its floors hides its lowest-priority panel. This replaces the per-panel `fits` check.

**Tech Stack:** SvelteKit 3, Svelte 5 runes, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-20-panel-sizing-design.md`

## Global Constraints

- **Imports:** board code uses relative imports inside `src/lib`; routes use `#lib/...` with file extensions.
- **Weight:** need × 1.25^(steps above the last panel in `priority`).
- **Floor:** every shown panel keeps at least one row (subway: its station header plus one row; a panel showing only an "unavailable" note: half a row).
- **Empty panel:** one showing only "live data unavailable" weighs 1, with no priority factor.
- **Unknown need** (a feed's service count failed or hasn't arrived): the panel's old `share` × 3 rows, then the priority factor.
- **Steady borders:** need is counted for the whole service day (`serviceDate(nowMs)`), never from the rows showing now.
- **No Worker change:** the Worker already proxies MBTA `/routes`.
- **No commits.** The owner commits. Leave changes in the working tree.
- **Comments:** antislop comment rules apply. At most two lines, saying why, not what.

## Review Focus

1. **A feed that joins after the first discovery.** It must get its service count within 10 minutes, not tomorrow, so the `service` poll runs every 10 minutes. Covered in Task 4.
2. **Service arriving after first paint, which changes the weights.** The hidden list must start over so a panel hidden under the fallback weights comes back. Covered in Task 5, step 5, and the browser check.
3. **A column too short for its panels' floors.** It hides its own lowest-priority panel, never one in the other column, and never a column's only panel. Covered in Task 1 (`panelToHide`).
4. **Weekend and holiday service.** A weekday-only route counts zero rows on Saturday and on a `calendar_dates` holiday. Covered in Task 2 (GTFS) and Task 3 (MBTA date in the URL).
5. **Notes wrapping under a panel's title in a narrow column.** This raises the panel's floor, and overflow must be re-detected. Covered in Task 5 (the action watches child size changes) and the browser check.

---

### Task 1: Sizing math and column-based hiding

**Files:**
- Modify: `src/lib/types.ts`: add `ServiceRow`.
- Create: `src/lib/board/size.ts`, `src/lib/board/size.test.ts`
- Modify: `src/lib/board/panels.ts:22-32` (`panelToHide`), `src/lib/board/panels.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  ```ts
  /** A row a feed could show today, listed once a day to size its panel. `key` is the feed's directionKey. */
  export interface ServiceRow { mode: Mode; key: string; stopId: string }
  ```
- Produces, in `size.ts`:
  - `export const ROW_EM = 2.5; export const HEADER_EM = 1.45;`. These move here from `Panel.svelte`.
  - `export function panelNeed(def: PanelDef, discovered: Pick<Discovered, 'stops' | 'stations'>, service: Partial<Record<Source, ServiceRow[]>>): number | undefined`
  - `export function panelWeight(def: PanelDef, need: number | undefined, priority: readonly PanelId[], empty = false): number`
- Produces, in `panels.ts`: `export function panelToHide(columns: readonly (readonly PanelId[])[], overflowing: ReadonlySet<number>, priority: readonly PanelId[]): PanelId | undefined`. Its argument is the column indexes that overflow. `PanelDef.share` stays, used only for the fallback.

**`panelNeed` rules:**
- **`'stations'`:** the count of `discovered.stations` with `mode === def.id`.
- **Other panels:** the sources are the distinct `source` of `discovered.stops` with `mode === def.id`. If any of those sources has no entry in `service`, return `undefined`. No sources means `0`.
- **`'closest-stop'`:** the count of distinct `${source}:${key}` among those sources' rows with that mode.
- **`'by-station'`:** distinct `${source}:${stopId}|${key}` plus `HEADER_EM / ROW_EM` per distinct `${source}:${stopId}`.

**`panelWeight`:**
- `empty` gives `1`.
- Otherwise `(need === undefined ? def.share * 3 : Math.max(need, 1)) * 1.25 ** (priority.length - 1 - rank)`, where `rank = priority.indexOf(def.id)`. A missing panel ranks last.

- [ ] **Step 1: Write the failing tests** in `size.test.ts`. Use `PANELS` defs and default priority `['subway','bus','shuttle','bikes']`.
  - `panelWeight`:
    - subway need 1 → `1.953125`;
    - bikes need 1 → `1`;
    - bus need 12 → `18.75`;
    - shuttle need 3 → `3.75`;
    - need 0 → same as need 1;
    - subway need `undefined` → `17.578125`;
    - `empty` → `1`;
    - priority `['shuttle','subway','bus','bikes']`, shuttle need 3 → `5.859375`.
  - `panelNeed`, with stops `{source:'mbta', mode:'subway', id:'place-knncl'}`, `{source:'mbta', mode:'bus'}` and `{source:'ezride', mode:'bus'}`:
    - subway, rows `Red:0` and `Red:1` at `place-knncl` → `2.58`;
    - adding `Red:0` at `place-cntsq` → `3 + 2 * 0.58` (use `toBeCloseTo`);
    - bus, MBTA rows `1:0` (stopId `''`), `1:1`, `1:0` again, plus ezride `Kendall` → `3`;
    - bus with no `ezride` entry in `service` → `undefined`;
    - shuttle with no shuttle stops → `0`;
    - bikes with 3 bikes stations → `3`.
- [ ] **Step 2: Rewrite `panels.test.ts`** for the new `panelToHide`:
  - no overflowing column → `undefined`;
  - `[['subway','bikes'],['bus','shuttle']]` with column 0 overflowing → `'bikes'`;
  - column 1 overflowing with priority `['shuttle','subway','bus','bikes']` → `'bus'`;
  - a lone-panel column overflowing (`[['subway'],['bus','shuttle']]`, `{0}`) → `undefined`;
  - both columns overflowing, default priority → `'bikes'`;
  - a panel missing from the priority ranks last: `[['subway','bikes']]`, `{0}`, priority `['bikes']` → `'subway'`.
- [ ] **Step 3: Run** `npx vitest run src/lib/board/size.test.ts src/lib/board/panels.test.ts`. Expected: FAIL (module missing, wrong signature).
- [ ] **Step 4: Implement** `ServiceRow`, `size.ts` and the new `panelToHide`.
  - `panelToHide`: candidates are the panels in overflowing columns that have 2 or more panels. Return the one ranked last in `[...priority, ...missing]`.
  - Update the `PanelDef.share` doc to "Rows assumed per unit when a panel's need is unknown."
- [ ] **Step 5: Run** the same command. Expected: PASS. (`npm run check` fails until Task 5 updates the callers.)

### Task 2: GTFS service rows

**Files:**
- Modify: `src/lib/feeds/gtfs/static.ts`, `src/lib/feeds/gtfs/static.test.ts`, `src/lib/feeds/gtfs/adapter.ts`, `src/lib/feeds/gtfs/adapter.test.ts`
- Modify: `src/lib/feeds/types.ts`: `FeedUpdate` gains `service?: ServiceRow[]`.

**Interfaces:**
- Produces: `export function todaysService(s: GtfsStatic, stopIds: ReadonlySet<string>, sd: string): string[]`. It returns the sorted, distinct direction keys of trips active on `sd` (`activeServiceIds`) that board at one of `stopIds`. A trip's last stop is drop-off only, so it doesn't count, the same as `serving()`.
- Produces: the GTFS adapter's polls gain `{ name: 'service', everyMs: 10 * MIN, run }`. It returns `{ service: todaysService(...).map((key) => ({ mode: feed.mode, key, stopId: '' })) }` for `serviceDate(nowMs)`, or `undefined` when the scope has no stops.

- [ ] **Step 1: Write the failing tests** in `static.test.ts` under `describe('todaysService')`, using the existing fixture `s`:
  - `todaysService(s, new Set(['A']), '20261117')` → `['r1:Stop B', 'r1:Stop D']`;
  - with `'20261121'` (Saturday) → `[]`;
  - with `'20261126'` (removed in `calendar_dates`) → `[]`;
  - `todaysService(s, new Set(['B']), '20261117')` → `['r1:Stop D']` (t2 only drops off at B).
- [ ] **Step 2: Write the failing test** in `adapter.test.ts`: `'lists today\'s directions at nearby stops for sizing'`.
  - Find the poll named `'service'`; check `everyMs === 600_000`.
  - Run it on a scope with stop `A` at a Tuesday `nowMs`. Expect `service` to equal both keys with `mode: 'shuttle', stopId: ''`.
- [ ] **Step 3: Run** `npx vitest run src/lib/feeds/gtfs`. Expected: FAIL.
- [ ] **Step 4: Implement** `todaysService`, the `service` poll and `FeedUpdate.service`. The poll appears whether or not the feed has a realtime URL.
- [ ] **Step 5: Run** `npx vitest run src/lib/feeds/gtfs`. Expected: PASS. Update the existing test that lists poll names, if it asserts the full list.

### Task 3: MBTA service rows

**Files:**
- Modify: `src/lib/feeds/mbta/api.ts`, `src/lib/feeds/mbta/api.test.ts`, `src/lib/feeds/mbta/adapter.ts`

**Interfaces:**
- Produces:
  - `export function routesUrl(cfg: Config, platformIds: string[], sd: string, directionId: 0 | 1, mode: 'subway' | 'bus'): string`, with query:
    - `filter[stop]`: ids joined with `,`;
    - `filter[date]`: `YYYY-MM-DD`;
    - `filter[direction_id]`;
    - `filter[type]`: `0,1` or `3`;
    - `fields[route]`: `type`.
  - Factor the `YYYY-MM-DD` formatting out of `schedulesUrl` into a private `isoDate(sd)` and use it in both.
  - `export function parseServiceRoutes(json: unknown): { id: string; mode: Mode }[]`. It skips `SILVER_LINE_IDS` and types other than 0, 1 and 3, using the existing `routeModeOf`.
- Produces: the MBTA adapter gains `{ name: 'service', everyMs: 10 * MIN, run }`, with `sd = serviceDate(nowMs)`:
  - **Bus:** for each direction 0 and 1, and each `chunk` of all bus platform ids, one request. Rows are `{ mode: 'bus', key: \`${id}:${dir}\`, stopId: '' }`.
  - **Subway:** for each subway stop (station) and direction, one request with that station's `platformIds`. Rows are `{ mode: 'subway', key: \`${id}:${dir}\`, stopId: station.id }`.
  - It returns `undefined` when the scope has no stops. Any failed request throws, which leaves the previous value (or the fallback).

- [ ] **Step 1: Write the failing tests** in `api.test.ts`:
  - **The URL.** `routesUrl(cfg, ['70071','70072'], '20261121', 1, 'subway')` contains `filter[stop]=70071,70072`, `filter[date]=2026-11-21`, `filter[direction_id]=1` and `filter[type]=0,1`.
  - **Parsing.** `parseServiceRoutes` on `{ data: [{id:'Red',type:'route',attributes:{type:1}}, {id:'1',type:'route',attributes:{type:3}}, {id:'742',type:'route',attributes:{type:3}}, {id:'CR-Fitchburg',type:'route',attributes:{type:2}}] }` → `[{id:'Red',mode:'subway'},{id:'1',mode:'bus'}]`.
- [ ] **Step 2: Write the failing adapter test** (in `api.test.ts` beside the other MBTA tests, or a new `adapter.test.ts`):
  - **Setup.** Stub `fetchJson` to return Red for subway URLs and route `1` for bus URLs. The scope has one subway station `place-knncl` with platforms `['70071','70072']` and one bus stop.
  - **Result.** Expect rows `Red:0` and `Red:1` at `place-knncl`, and `1:0` and `1:1` with `stopId: ''`.
  - **Request count.** 4 calls.
- [ ] **Step 3: Run** `npx vitest run src/lib/feeds/mbta`. Expected: FAIL.
- [ ] **Step 4: Implement** `isoDate`, `routesUrl`, `parseServiceRoutes` and the poll.
- [ ] **Step 5: Run** `npx vitest run src/lib/feeds/mbta`. Expected: PASS. Then `curl -s "https://api-v3.mbta.com/routes?filter%5Bstop%5D=place-knncl&filter%5Bdate%5D=<today ISO>&filter%5Bdirection_id%5D=0&filter%5Btype%5D=0,1&fields%5Broute%5D=type"` should list `Red`.

### Task 4: Poller keeps service rows

**Files:**
- Modify: `src/lib/data/poller.svelte.ts`, `src/lib/data/poller.test.ts`, `src/lib/data/demo.svelte.ts`

**Interfaces:**
- Produces: `PollerState.service: Partial<Record<Source, ServiceRow[]>>`, with the doc "Rows each feed could show today; a missing feed hasn't reported (sizing falls back)." It starts as `{}`. In `apply`, `if (u.service) state.service[feed.id] = u.service;`. The demo state sets `service: {}`.

- [ ] **Step 1: Write the failing test** in `poller.test.ts`, following the file's existing fake-adapter pattern: a poll returning `{ service: [{ mode: 'bus', key: '1:0', stopId: '' }] }` ends up in `state.service[feedId]`.
- [ ] **Step 2: Run** `npx vitest run src/lib/data/poller.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it again. Expected: PASS.

### Task 5: Board layout, floors and overflow hiding

**Files:**
- Create: `src/lib/ui/overflow.ts`. A Svelte action: `export function overflow(node: HTMLElement, report: (over: boolean) => void): { update(fn): void; destroy(): void }`.
- Modify: `src/lib/ui/Panel.svelte`, `src/routes/+page.svelte`, `README.md`

**Interfaces:**
- Consumes: `panelNeed`, `panelWeight`, `ROW_EM`, `HEADER_EM` (Task 1), `panelToHide` (Task 1), `state.service` (Task 4).
- **`overflow` action.** It reports `node.scrollHeight > node.clientHeight + 1`:
  - on a `ResizeObserver` callback for the node and each child element;
  - on a `MutationObserver` `childList` change, which also re-observes children.

- [ ] **Step 1: Panel.svelte.**
  - Import `ROW_EM` and `HEADER_EM` from `../board/size`; remove the local constants.
  - Remove the `fits` prop and its effect.
  - Keep `needed` and set `style:--need="{needed * ROW_EM}em"` on `.panel`.
  - Change `.panel` from flex to `display: grid; grid-template-rows: auto minmax(var(--need), 1fr); row-gap: 0.3em;`. The grid's minimum is then the floor, and it follows a wrapped title.
  - Body measuring and `trimPanel` are unchanged.
- [ ] **Step 2: +page.svelte, columns.** Each entry becomes `{ panel, weight }`, where:
  ```ts
  weight = panelWeight(def, data.discovered && panelNeed(def, data.discovered, data.service), cfg.priority, empty)
  ```
  - Remove `EMPTY_SHARE`.
  - The slot gets `style:flex-grow={weight}`.
  - Slot CSS: `flex-basis: 0;`, with `min-height: 0` removed, so the panel's grid minimum is the floor.
  - `.column` gains `overflow: hidden`.
- [ ] **Step 3: +page.svelte, hiding.**
  - Replace `fits` with `let overflowing = $state(new Set<number>())`.
  - Add `use:overflow={(over) => { … }}` to each `.column`, setting or deleting its index. Reassign a new `Set` so state updates.
  - The hide effect calls `panelToHide(columns.map((c) => c.map((x) => x.panel.id)), overflowing, cfg.priority)`. When it hides one, it also sets `overflowing = new Set()`, so the observers report again for the new layout.
- [ ] **Step 4: Update the comments** on `hidden` and `reset` to say "a column too short for its panels' floors".
- [ ] **Step 5: Reset when the weights change.** Add `const weightKey = $derived(columns.flat().map((x) => \`${x.panel.id}:${x.weight}\`).join())` to the reset effect's dependencies, so service arriving after load starts the hiding over. `reset` also clears `overflowing`.
- [ ] **Step 6: README.**
  - The `priority` row: "Which panels matter most, most important first (`subway`, `bus`, `shuttle`, `bikes`). Higher panels get more of their column's height, and on a screen too short for all of them the lowest go first. Panels left out follow in the default order: Red Line, buses, shuttles, Bluebikes."
  - In the panels list, replace the fixed-share sentence: "Each column's height is split by how many rows each panel's service could show today (counted at load, so borders stay put), weighted by `priority`, with at least one row each."
- [ ] **Step 7: Run** `npm run check && npm test`. Expected: 0 errors, all tests pass.
- [ ] **Step 8: Check in the browser.** Run `npm run worker:dev` and `npm run dev`, then open `/?building=W41`.
  - In a 1920×1080 window, the shuttles panel is no taller than its rows plus title when buses fill their panel.
  - In a 1280×500 window, the lowest-priority panel in the column that ran short is hidden, and the bottom line names it.
  - Back to 1920×1080, it returns.
  - `?priority=shuttle` gives shuttles more height.
  - Stop the dev servers afterwards.
