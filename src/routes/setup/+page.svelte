<script lang="ts">
  import './setup.css';
  import { untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { parseList, readOptions, type BoardOptions } from '#lib/config/options.ts';
  import { boardSearch, resolveConfig } from '#lib/config/resolve.ts';
  import { PANELS } from '#lib/board/panels.ts';
  import { lookupBuilding, type Building } from '#lib/data/building.ts';
  import { fetchJson } from '#lib/data/worker-client.ts';
  import type { PaletteChoice } from '#lib/ui/palette.ts';
  import type { LatLon, PanelId } from '#lib/types.ts';
  import { findNearby, type NearbyItem } from '#lib/setup/nearby.ts';

  /** This page's address. The form writes it with shallow routing, which SvelteKit keeps in `page.shallow`. */
  const address = $derived(page.shallow?.url ?? page.url);
  /** The board URL's options, edited in place: a field at its `NO_OPTIONS` value says nothing. */
  let form: BoardOptions = $state(readOptions(untrack(() => address.search)));
  const cfg = $derived(resolveConfig(form));
  const search = $derived(boardSearch(form));
  const boardUrl = $derived(new URL(`${resolve('/')}${search}`, page.url.origin).href);

  /** How long the form waits after a change before adding a history entry, so typing a name makes one, not one per key. */
  const HISTORY_PAUSE_MS = 600;
  // The address follows the form, so a reload or a shared setup link keeps it, and Back undoes a change.
  $effect(() => {
    const next = search;
    if (next === untrack(() => address.search)) return;
    const timer = setTimeout(() => goto(`${address.pathname}${next}`, { shallow: true }), HISTORY_PAUSE_MS);
    return () => clearTimeout(timer);
  });
  // ...and the form follows the address when Back or Forward changes it.
  $effect(() => {
    const at = address.search;
    if (at !== untrack(() => search)) form = readOptions(at);
  });

  const PALETTE_LABELS: Record<PaletteChoice, string> = {
    rotate: 'SA+P colors, a new one each day',
    apricot: 'SA+P apricot',
    yellow: 'SA+P yellow',
    pink: 'SA+P pink',
    blue: 'SA+P blue',
    orange: 'SA+P orange',
    green: 'SA+P green',
    mit: 'MIT black and red',
  };
  const PALETTE_CHOICES = Object.keys(PALETTE_LABELS) as PaletteChoice[];
  /** What the board uses when no palette is chosen: SA+P's for W41, MIT's elsewhere. */
  const impliedPalette = $derived(resolveConfig({ building: form.building }).palette);
  const W41 = resolveConfig({});

  const titleOf = (id: PanelId) => PANELS.find((p) => p.id === id)?.title ?? id;
  function move(i: number, by: -1 | 1) {
    const next = [...form.priority];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    form.priority = next;
  }

  type Lookup =
    | { state: 'idle' | 'loading' | 'missing' | 'error' }
    | { state: 'found'; building: Building };
  let lookup = $state<Lookup>({ state: 'idle' });
  /** The building to look up: none when lat and lon are given, or for W41, whose location is built in. */
  const lookupNumber = $derived(cfg.locate ? cfg.building : '');
  $effect(() => {
    const number = lookupNumber;
    if (!number) {
      lookup = { state: 'idle' };
      return;
    }
    lookup = { state: 'loading' };
    let stale = false;
    // Waits for typing to stop before asking the Worker.
    const timer = setTimeout(async () => {
      try {
        const b = await lookupBuilding(W41, number, fetchJson);
        if (!stale) lookup = b ? { state: 'found', building: b } : { state: 'missing' };
      } catch {
        if (!stale) lookup = { state: 'error' };
      }
    }, 500);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  });

  /** Where walking is measured from, once known. */
  const site: LatLon | undefined = $derived(
    !cfg.locate ? cfg.location : lookup.state === 'found' ? { lat: lookup.building.lat, lon: lookup.building.lon } : undefined,
  );
  const siteKey = $derived(site ? `${site.lat},${site.lon}` : '');
  /** The building's own name and position, shown in the empty fields they'd fill. */
  const own = $derived(
    lookup.state === 'found'
      ? { name: lookup.building.name, lat: lookup.building.lat, lon: lookup.building.lon }
      : cfg.building === W41.building ? { name: W41.name, ...W41.location } : undefined,
  );
  const namePlaceholder = $derived(own?.name ?? '');

  type Nearby = { state: 'idle' | 'loading' | 'error' } | { state: 'done'; items: NearbyItem[]; failed: string[] };
  let nearby = $state<Nearby>({ state: 'idle' });
  let retries = $state(0);
  $effect(() => {
    const key = siteKey;
    void retries;
    if (!key) {
      nearby = { state: 'idle' };
      return;
    }
    const [lat, lon] = key.split(',').map(Number);
    nearby = { state: 'loading' };
    let stale = false;
    const timer = setTimeout(async () => {
      try {
        const found = await findNearby({ ...untrack(() => cfg), location: { lat, lon } });
        if (!stale) nearby = { state: 'done', ...found };
      } catch {
        if (!stale) nearby = { state: 'error' };
      }
    }, 800);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  });

  const listFormat = new Intl.ListFormat('en', { type: 'conjunction' });
  /** Feeds whose stops couldn't be read, by name. */
  const failed = $derived(nearby.state === 'done' ? nearby.failed : []);
  const feedName = (source: string) => cfg.feeds.find((f) => f.id === source)?.name ?? source;
  /** "MBTA stop 2168, 3 min walk": the id tells apart the two sides of a street, which share a name. Docks' ids are long and unneeded. */
  const describe = (item: NearbyItem) =>
    `${feedName(item.source)}${item.mode === 'bikes' ? '' : ` stop ${item.id}`}, ${item.walkMin} min walk`;
  const groups = $derived.by(() => {
    if (nearby.state !== 'done') return [];
    const items = nearby.items;
    return PANELS.map((p) => ({
      title: p.title,
      shown: items.filter((i) => i.mode === p.id && i.state === 'shown'),
      farther: items.filter((i) => i.mode === p.id && i.state === 'pinnable'),
    })).filter((g) => g.shown.length + g.farther.length > 0);
  });
  function setListed(list: 'pin' | 'hide', id: string, listed: boolean) {
    form[list] = listed ? [...new Set([...form[list], id])] : form[list].filter((x) => x !== id);
  }

  let urlField: HTMLInputElement | undefined = $state();
  let copyStatus = $state('');
  $effect(() => {
    void boardUrl;
    copyStatus = '';
  });
  async function copy() {
    try {
      await navigator.clipboard.writeText(boardUrl);
      copyStatus = 'Copied.';
    } catch {
      // No clipboard access (an insecure page, or a refused permission): select it for the keyboard.
      urlField?.select();
      copyStatus = 'Press Ctrl+C (⌘C on a Mac) to copy the selected URL.';
    }
  }

  let loadError = $state('');
  function load(text: string) {
    if (!text.trim()) return;
    try {
      form = readOptions(new URL(text.trim(), address.href).search);
      loadError = '';
    } catch {
      loadError = "That isn't a URL.";
    }
  }

  const SIZES = [
    { label: 'Landscape TV', w: 1920, h: 1080 },
    { label: 'Portrait TV', w: 1080, h: 1920 },
    { label: 'Short window', w: 1280, h: 420 },
  ];
  let sizeIndex = $state(0);
  const size = $derived(SIZES[sizeIndex]);
  let previewWidth = $state(0);
  let windowHeight = $state(800);
  /** The board renders at the screen's real size, scaled down to fit the column and most of the window's height. */
  const scale = $derived(previewWidth > 0 ? Math.min(1, previewWidth / size.w, (windowHeight * 0.7) / size.h) : 0);
  /** Lags the form, so typing doesn't reload the preview on every key. */
  let previewSrc = $state('');
  $effect(() => {
    const url = boardUrl;
    if (!untrack(() => previewSrc)) {
      previewSrc = url;
      return;
    }
    const timer = setTimeout(() => (previewSrc = url), 700);
    return () => clearTimeout(timer);
  });
</script>

<svelte:window bind:innerHeight={windowHeight} />

<div class="page">
  <header class="intro">
    <h1>Transit screen setup</h1>
    <p>Choose the settings, check the preview, then copy the URL and open it on the screen.</p>
  </header>

  <div class="layout">
    <form class="settings" onsubmit={(e) => e.preventDefault()}>
      <details class="load">
        <summary>Start from an existing board URL</summary>
        <label class="field">
          <span class="label">Board URL</span>
          <input type="url" placeholder="https://…/?building=32" onchange={(e) => load(e.currentTarget.value)} />
        </label>
        {#if loadError}<p class="hint error" role="alert">{loadError}</p>{/if}
      </details>

      <fieldset>
        <legend>Building</legend>
        <label class="field">
          <span class="label">Building number</span>
          <input bind:value={form.building} autocomplete="off" spellcheck="false" />
        </label>
        <p class="hint" aria-live="polite">
          {#if lookup.state === 'loading'}
            Looking up building {lookupNumber}…
          {:else if lookup.state === 'found'}
            {lookup.building.name || cfg.building}, at {lookup.building.lat.toFixed(5)}, {lookup.building.lon.toFixed(5)}.
          {:else if lookup.state === 'missing'}
            <span class="error">Building {lookupNumber} isn't on the MIT campus map. Check the number, or enter its latitude and longitude below.</span>
          {:else if lookup.state === 'error'}
            <span class="error">The building lookup didn't answer. The board will try again when it starts.</span>
          {:else if !cfg.locate && (form.lat || form.lon)}
            Walking is measured from the latitude and longitude below.
          {:else}
            {W41.name}, at its built-in location.
          {/if}
        </p>
        <label class="field">
          <span class="label">Name in the header</span>
          <input bind:value={form.name} placeholder={namePlaceholder} />
        </label>
        <p class="hint">Leave empty to use the building's own name, shown in gray.</p>
        <div class="pair">
          <label class="field">
            <span class="label">Latitude</span>
            <input bind:value={form.lat} inputmode="decimal" placeholder={own ? String(own.lat) : ''} />
          </label>
          <label class="field">
            <span class="label">Longitude</span>
            <input bind:value={form.lon} inputmode="decimal" placeholder={own ? String(own.lon) : ''} />
          </label>
        </div>
        <p class="hint">Optional, for a spot the campus map doesn't have. Both are needed.</p>
      </fieldset>

      <fieldset>
        <legend>Look</legend>
        <label class="field">
          <span class="label">Colors</span>
          <select bind:value={form.palette}>
            <option value="">Default for this building: {PALETTE_LABELS[impliedPalette]}</option>
            {#each PALETTE_CHOICES as choice (choice)}<option value={choice}>{PALETTE_LABELS[choice]}</option>{/each}
          </select>
        </label>
        <label class="field narrow">
          <span class="label">Edge margin, % of the screen</span>
          <input type="number" min="0" max="10" step="0.5" bind:value={form.inset} />
        </label>
        <p class="hint">For TVs that crop the picture's edges (overscan). 0 to 10.</p>
      </fieldset>

      <fieldset>
        <legend>Panel priority</legend>
        <p class="hint">On a screen too short for every panel, the ones at the bottom of this list are hidden first.</p>
        <ol class="priority">
          {#each form.priority as id, i (id)}
            <li>
              <span>{titleOf(id)}</span>
              <button type="button" class="small" onclick={() => move(i, -1)} disabled={i === 0} aria-label="Move {titleOf(id)} up">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3 2.5 9h11z" fill="currentColor" /></svg>
              </button>
              <button type="button" class="small" onclick={() => move(i, 1)} disabled={i === form.priority.length - 1} aria-label="Move {titleOf(id)} down">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13 2.5 7h11z" fill="currentColor" /></svg>
              </button>
            </li>
          {/each}
        </ol>
      </fieldset>

      <fieldset>
        <legend>Stops and docks</legend>
        {#if nearby.state === 'idle'}
          <p class="hint">Stops appear here once the building's location is known.</p>
        {:else if nearby.state === 'loading'}
          <p class="hint" aria-live="polite">Finding stops and walking times…</p>
        {:else if nearby.state === 'error'}
          <p class="hint error" role="alert">Couldn't load nearby stops.</p>
          <button type="button" onclick={() => retries++}>Try again</button>
        {:else}
          {#if failed.length > 0}
            <p class="hint error" role="alert">Couldn't load {listFormat.format(failed)} stops, so they're missing below.</p>
            <button type="button" onclick={() => retries++}>Try again</button>
          {/if}
          {#if groups.length === 0}
            <p class="hint">No {failed.length > 0 ? 'other ' : ''}stops within walking distance.</p>
          {:else}
            <p class="hint">Uncheck a stop to leave it off the board. Farther stops can be added.</p>
            {#each groups as group (group.title)}
              <h3>{group.title}</h3>
              <ul class="stops">
                {#each group.shown as item (`${item.source}:${item.id}`)}
                  <li>
                    <label>
                      <input type="checkbox" checked={!form.hide.includes(item.id)}
                        onchange={(e) => setListed('hide', item.id, !e.currentTarget.checked)} />
                      <span>{item.name}<span class="meta">{describe(item)}</span></span>
                    </label>
                  </li>
                {/each}
                {#each group.farther as item (`${item.source}:${item.id}`)}
                  <li class="farther">
                    <label>
                      <input type="checkbox" checked={form.pin.includes(item.id)}
                        onchange={(e) => setListed('pin', item.id, e.currentTarget.checked)} />
                      <span>{item.name}<span class="meta">{describe(item)}, past the {item.limitMin} min limit</span></span>
                    </label>
                  </li>
                {/each}
              </ul>
            {/each}
          {/if}
        {/if}
        <details>
          <summary>Edit ids by hand</summary>
          <label class="field">
            <span class="label">Hide (stops, routes or alerts)</span>
            <input value={form.hide.join(', ')} onchange={(e) => (form.hide = parseList(e.currentTarget.value))} spellcheck="false" />
          </label>
          <p class="hint">Comma-separated. Routes and alerts can also be given as source:id, for example mbta:70.</p>
          <label class="field">
            <span class="label">Pin (stops)</span>
            <input value={form.pin.join(', ')} onchange={(e) => (form.pin = parseList(e.currentTarget.value))} spellcheck="false" />
          </label>
        </details>
      </fieldset>
    </form>

    <section class="output" aria-labelledby="url-heading">
      <h2 id="url-heading">Board URL</h2>
      <div class="url-row">
        <label class="visually-hidden" for="board-url">Board URL</label>
        <input id="board-url" bind:this={urlField} readonly value={boardUrl} onfocus={(e) => e.currentTarget.select()} />
        <button type="button" class="primary" onclick={copy}>Copy URL</button>
      </div>
      <p class="hint" aria-live="polite">{copyStatus}</p>
      <a class="open" href={boardUrl} target="_blank" rel="noopener">Open the board in a new tab</a>

      <div class="preview-head">
        <h2>Preview</h2>
        <div class="sizes" role="group" aria-label="Preview size">
          {#each SIZES as s, i (s.label)}
            <button type="button" class="small" aria-pressed={sizeIndex === i} onclick={() => (sizeIndex = i)}>{s.label}</button>
          {/each}
        </div>
      </div>
      <div class="preview" bind:clientWidth={previewWidth}>
        {#if scale > 0 && previewSrc}
          <div class="frame" style:width="{size.w * scale}px" style:height="{size.h * scale}px">
            <!-- A new frame per URL: changing a frame's src would add a step to Back. -->
            {#key previewSrc}
              <iframe title="Board preview" src={previewSrc} width={size.w} height={size.h} style:transform="scale({scale})"></iframe>
            {/key}
          </div>
        {/if}
      </div>
      <p class="hint">{size.w} × {size.h}, shown at {Math.round(scale * 100)}%. It shows live data, and updates a moment after each change.</p>
    </section>
  </div>
</div>

<style>
  .page {
    max-width: 90rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 3rem;
  }
  .intro h1 {
    margin: 0;
    font-family: var(--font-display);
    font-weight: var(--display-medium);
    font-size: 2rem;
    letter-spacing: -0.01em;
  }
  .intro p {
    margin: 0.3rem 0 1.5rem;
    color: var(--muted);
  }
  /* One column on a phone; side by side once the preview has room beside the form. */
  .layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.5rem;
  }
  @media (min-width: 60rem) {
    .layout {
      grid-template-columns: minmax(20rem, 26rem) minmax(0, 1fr);
      align-items: start;
    }
    .output {
      position: sticky;
      top: 1rem;
    }
  }
  .settings {
    display: grid;
    gap: 1rem;
  }
  fieldset,
  .load,
  .output {
    /* A fieldset is as wide as its content by default; a long option would push the page sideways. */
    min-width: 0;
    margin: 0;
    padding: 1rem;
    border: 1px solid var(--rule);
    background: var(--surface);
  }
  legend {
    padding: 0 0.3rem;
    font-family: var(--font-display);
    font-weight: var(--display-medium);
    font-size: 1.15rem;
  }
  h2 {
    margin: 0 0 0.6rem;
    font-family: var(--font-display);
    font-weight: var(--display-medium);
    font-size: 1.15rem;
  }
  h3 {
    margin: 1rem 0 0.3rem;
    font-size: 1rem;
  }
  .field,
  .pair {
    display: grid;
    gap: 0.25rem;
    margin-top: 0.75rem;
  }
  legend + .field,
  .pair .field {
    margin-top: 0;
  }
  .narrow input {
    max-width: 8rem;
  }
  .label {
    font-weight: 700;
  }
  .pair {
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  input:not([type='checkbox']),
  select {
    width: 100%;
    min-width: 0;
    min-height: 2.75rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
  }
  input::placeholder {
    color: var(--muted);
  }
  .hint {
    margin: 0.3rem 0 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .error {
    color: var(--error);
  }
  summary {
    min-height: 2.75rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    font-weight: 700;
  }
  summary::before {
    content: '';
    flex: none;
    border-block: 0.32em solid transparent;
    border-inline-start: 0.5em solid currentColor;
    transition: transform 0.15s;
  }
  details[open] > summary::before {
    transform: rotate(90deg);
  }
  @media (prefers-reduced-motion: reduce) {
    summary::before {
      transition: none;
    }
  }
  details[open] > summary {
    margin-bottom: 0.3rem;
  }
  fieldset details {
    margin-top: 1rem;
    border-top: 1px solid var(--rule);
  }
  button {
    min-height: 2.75rem;
    padding: 0.4rem 1rem;
    border: 1px solid var(--border);
    border-radius: 2px;
    background: var(--surface);
    color: var(--text);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  button:hover:not(:disabled) {
    border-color: var(--text);
  }
  button:disabled {
    color: var(--muted);
    cursor: default;
  }
  button.small {
    min-width: 2.75rem;
    padding: 0.4rem 0.7rem;
  }
  button svg {
    display: block;
    width: 1rem;
    height: 1rem;
  }
  button[aria-pressed='true'] {
    background: var(--text);
    border-color: var(--text);
    color: var(--surface);
  }
  .primary {
    flex: none;
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }
  .primary:hover {
    background: #4d0025;
  }
  .priority {
    margin: 0.6rem 0 0;
    padding: 0;
    list-style: none;
    counter-reset: rank;
  }
  .priority li {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.25rem 0;
    border-top: 1px solid var(--rule);
    counter-increment: rank;
  }
  .priority li:first-child {
    border-top: 0;
  }
  .priority span {
    flex: 1;
  }
  .priority span::before {
    content: counter(rank) '. ';
    color: var(--muted);
  }
  .stops {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .stops label {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    min-height: 2.75rem;
    padding: 0.35rem 0;
    cursor: pointer;
  }
  .stops input {
    flex: none;
    width: 1.25rem;
    height: 1.25rem;
    margin: 0.1rem 0 0;
    accent-color: var(--accent);
  }
  .meta {
    display: block;
    color: var(--muted);
    font-size: 0.9rem;
  }
  /* Farther stops start a sub-list, so the two kinds of checkbox don't read as one. */
  .stops li.farther:not(.farther + .farther) {
    margin-top: 0.4rem;
    padding-top: 0.4rem;
    border-top: 1px dashed var(--rule);
  }
  .url-row {
    display: flex;
    gap: 0.5rem;
  }
  /* Monospace so stop ids in the URL keep 0 and O, 1 and l apart when someone reads or retypes it. */
  .url-row input {
    font-family: ui-monospace, Menlo, Consolas, monospace;
    font-size: 0.9rem;
  }
  /* On a phone the button goes under the URL, at full width. */
  @media (max-width: 30rem) {
    .url-row {
      flex-direction: column;
    }
  }
  /* Its own line, tall enough to tap. */
  .open {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    color: var(--accent);
  }
  .preview-head {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-top: 1.25rem;
  }
  .preview-head h2 {
    margin: 0;
  }
  .sizes {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .preview {
    margin-top: 0.75rem;
    display: flex;
    justify-content: center;
  }
  .frame {
    overflow: hidden;
    border: 1px solid var(--border);
  }
  iframe {
    display: block;
    border: 0;
    transform-origin: 0 0;
  }
</style>
