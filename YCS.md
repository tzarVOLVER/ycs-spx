# YCS SPX: stage playback and public Google Sheets linking

This is a fork of [TuomoKu/SPX-GC](https://github.com/TuomoKu/SPX-GC), based on upstream commit `8bb7ec4e7b969fe7c777d2c2a9b03ed6de3f6981`. The upstream MIT license and notices are retained.

The initial implementation keeps SPX's normal rundown editor and HTML template lifecycle. An optional `ycs` module gives each stage its own program composition and independent preview. Multiple graphics can play together using named display slots. Commands target a stage and graphic ID, independent of controller focus.

## Development setup

### Single-computer Orlando rehearsal

From this checkout, run `node ycs/rehearsal.cjs` (or `npm run ycs:rehearsal`) and open **http://127.0.0.1:5661/rehearsal**. No Stream Deck or vMix installation is required. The separate loopback-only process uses the actual ticker templates from the sibling graphics checkout and the existing test lower third. It creates a fresh disposable show under `.local/rehearsals/run-*`; it never reads the development/production configuration, rundowns, real sheet URLs or saved mappings. It adds no routes to the normal SPX server. Port 5660 is explicitly rejected, and occupied ports are not taken over. Optional arguments are `--port 5662` and `--graphics ABSOLUTE_TICKER_FOLDER`.

All three 1920×1080 outputs are scaled into the rehearsal monitor, while their real output URLs remain full resolution. **Run playback checks** exercises stage-specific round values; simultaneous ticker/lower-third slots; manual preview/save versus Update; restoring linked mode; mapped Sheet-range and JSON-array lists with Published/Order/ID and text transforms; held lists during a source outage; output reloads; transport reconnects; and stage-only Stop. It checks the actual output frames as well as API state, including absence of bundled sample stories before the first Play. The three-stage data feeds are deterministic offline adapters; this does not contact Google or an external API, or measure their response latency.

After playback checks, **Test server restart** stops and replaces the rehearsal worker process on the same port while keeping the browser outputs open. The supervisor retains the disposable show's files; the outputs must reconnect and become stopped, with saved mappings/source values retained. Ordinary transport interruption holds graphics until the authoritative snapshot returns, and does not replay Play. Revision comparisons reset on a fresh WebSocket connection so a new server's revision zero can clear a retained composition. **Stop all test outputs** and per-stage controls operate only on the rehearsal show. Ctrl+C in the launcher terminal stops its worker. Closing the browser does not stop the rehearsal process. Each new launcher invocation creates another disposable show; the normal runtime launcher/process record is untouched.

These checks do not replace a later venue LAN, three-PC/vMix, browser performance or physical control-surface rehearsal. The lower third is a test graphic, not an approved broadcast design. Use the normal stage controller and production output URLs for the event.

Use a current Node.js LTS release. Keep the repositories side by side:

```text
GitHub/
  ycs-graphics/       templates and assets
  ycs-spx/           this controller fork
```

From this repository:

```powershell
npm ci
npm run ycs:demo
node server.js .local/ycs-dev.json
```

If the graphics repository is elsewhere, run `node ycs/setup-demo.cjs ABSOLUTE_PATH_TO_GRAPHICS_TICKER_FOLDER` instead of `npm run ycs:demo`. Setup never copies or edits the graphics repository: Express serves its ticker files from the configured `ycs.graphicsRoot`. Generated configuration and rundown data stay in ignored `.local/`. Rerunning setup preserves existing local data/configuration.

Windows convenience scripts are `ycs/start-dev.ps1` and `ycs/stop-dev.ps1`. Pass `-NodePath` if Node is not on PATH. The start script launches a hidden process and waits for a successful HTTP response.

The development server uses **127.0.0.1:5660**. It does not replace the installed SPX or the earlier linking pilot on ports 5656/5657.

| Stage | Controller | Transparent output | Preview |
|---|---|---|---|
| Stage 1 | `/gc/YCS-Stage-1/Show` | `/output/stage-1/program` | `/output/stage-1/preview` |
| Stage 2 | `/gc/YCS-Stage-2/Show` | `/output/stage-2/program` | `/output/stage-2/preview` |
| Stage 3 | `/gc/YCS-Stage-3/Show` | `/output/stage-3/program` | `/output/stage-3/preview` |

Open a controller URL with the base address `http://127.0.0.1:5660`. Select the ticker and press Play, then select the lower third and press Play. Both remain active. Other stages are independent, including their selected-item previews. The lower third is an intentionally simple test graphic, not a finished broadcast design.

Native Save changes the stage's saved fields. Typing previews pending values; Update commits them to an active program graphic. Updating a stopped graphic saves its data without putting it on air. STOP THIS STAGE clears only that stage. Configured stage playout/save requests bypass upstream's shared rundown cache. Legacy projects outside the configured stage list retain upstream behavior.

## Visual mapping workspace

The Mappings tab uses a three-panel layout: rundown graphics on the left, a real template monitor and field table in the middle, and browsable source values on the right. Project and rundown selectors use the configured SPX stage/project/rundown identities. Existing demo configuration has one SPX project per stage; the selectors do not invent production data or automatically register other SPX projects. Register additional outputs/rundowns under `ycs.stages` to include them. Connection definitions can optionally belong to one configured project; unscoped existing connections remain Shared. Project-specific connections are filtered in the browser and rejected by server mapping validation in another project.

Select a field and click a source value, or drag a source card onto its field row. **Browse cells** exposes the complete saved sheet range, including empty cells; any sheet layout works. **Use a table row** optionally exposes columns from a selected header/data row. **Auto-map by name** fills only currently unmapped fields with a unique exact normalized field-name/header/property match. It does not guess semantic aliases or overwrite existing links. JSON responses appear as expandable property groups; array indexes and escaped object keys are stored as generated [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901) references.

Each field row has Unmapped, Static value or a selected source binding, a transform, and the server-resolved preview value. Available transforms are None, Uppercase, Lowercase, Trim and Prefix text/media path. Numbers, checkboxes, text, textarea, choices, hex colours and image/file fields retain their native SPX string representations with type validation. Incompatible live values retain the existing on-air field value; mapping preview shows the manual fallback and reason. Hidden identity is protected. Object/array-to-collection mapping, schema transforms and media importing are not implemented; select a scalar JSON property or an individual array element property.

The monitor is an isolated classic-SPX iframe with its own update/play lifecycle. Mapping preview has no output subscription, renderer health report or playout command. Changes update that monitor without replaying its animation. **Save mapping** writes only the selected graphic's changed bindings with the loaded revision. **Revert** reloads that selected graphic. Unsaved drafts are retained separately when switching graphics, projects or rundowns within the page; background polling never advances their configuration revision. A successful save made by this page advances other drafts only when they share that exact prior revision, since the page knows precisely which source or graphic it changed; unrelated concurrent edits still conflict. They are not persisted across page reloads. The rundown's manual/linked modes and explicit Play/Update remain authoritative for program.

Reusable template defaults and row lookup remain under Advanced mapping options. A default belongs to the configured stage/rundown output and template; it does not change every production automatically.

## JSON API connections

Choose JSON API in Add connection, enter a public HTTPS JSON endpoint and refresh interval, optionally assign its project, then Test and Save. The server performs read-only GET requests, requires HTTP 200 with JSON content, follows no redirects and bounds responses to 1 MB with an eight-second timeout. Public DNS addresses are validated in the actual request lookup; loopback/private/link-local hosts and embedded credentials are rejected. LAN API support requires a separately designed explicit host configuration; this connector currently accepts public APIs only.

Optional Bearer authentication uses an environment-variable reference beginning `YCS_DATA_`, such as `YCS_DATA_TOURNAMENT_TOKEN`. Set the variable before starting the server; the saved document/browser receives the variable name, never the token. No credential is embedded in a template. OAuth flows, custom headers and token refresh are not included. A source is polled once for all its fields with the same backoff, pinned bindings and restart caching as Sheets. API test does not create a source or change program.

Additional routes: `POST /api/ycs/data/json/test` accepts `{settings:{url,refreshSeconds,tokenEnv?}}`; `/data/connections` accepts optional `type:'json-api'` and `project`. Field bindings also support `{static:'value',transform?}` or `{connection,selection:{kind:'json',pointer:'/event/name'},transform?}`. A transform is `{kind:'uppercase'|'lowercase'|'trim'}` or `{kind:'prefix',value:'media/guests/'}`. `POST /api/ycs/data/mappings/:stage/:graphic/preview` resolves unsaved edits into a graphic descriptor and field statuses without saving or modifying either stage composition.

## Data Manager and rundown workflow

Open **Data Manager** from any stage panel. It has two views:

- **Sources:** one connection per public Google Sheets range. Cards show health, last successful read, refresh interval and field references. Add/Edit opens a tested connection form with a read-only data preview. Local test values are tucked under a disclosure.
- **Mappings:** select a stage and graphic, then map any ordinary text field. Choose a connection and either a **fixed cell** or a **row key**. For example, use header row `1`, key column `Stage`, row key `STAGE 1`, and value column `Round`. Rearranging the stage rows does not change which stage is selected. Duplicate headers, duplicate keys, missing rows and empty/oversized values retain the last valid field value and show a warning.

Choose **This graphic** for a specific item or **Template default for this stage** to reuse a mapping in other copies of that template on the same stage. **Use template default** removes the graphic override. An explicit Unassigned override keeps that field manual-only even when a default exists. A default does not automatically enable linked mode: each rundown field still has its own chain button. Existing explicit mappings take precedence over new defaults.

Mapping edits save together with an expected document revision. Background polling never replaces an unsaved mapping form or silently advances its revision. If another operator saves first, reload the saved mappings and reapply your edits. A connection editor similarly rejects stale saves.

In the rundown, ordinary content fields have visible labels and a chain button. Hidden broadcast identity stays hidden. Ticker speed, timing, artwork and advanced JSON overrides are grouped under **Appearance & timing**. **Manage field mappings** opens Data Manager with this stage and graphic already selected.

1. Type a manual value or click a field's chain to use its assigned data. A linked field is read-only; clicking again restores its saved manual text.
2. Inspect **Preview**. Typing or toggling links does not change program.
3. **Save draft** persists field values and link modes without changing program. A pending badge identifies differences from an active graphic.
4. **Play** or **Update on air** commits the draft and its current field mappings. Later successful source reads update committed linked fields automatically, preserving the ticker iframe and crawl animation.

A mapping change does not rebind an active graphic until Update/Play. Its previous committed selector keeps receiving live data in the meantime. Renaming a connection or changing its interval is allowed while used. Changing its sheet, tab or range is blocked while saved/default/on-air references exist: create a new connection and remap the fields instead. Remove is disabled until saved/default references are unassigned and on-air linked graphics are stopped. No connection deletion writes to Google Sheets.

Native field types are supported, including the ticker's round, status, day/date, location and rounds-remaining text, and lower-third name/title. Checkboxes, numbers, image/file fields and choices can also be linked. Private Sheets, collection mapping and advanced transforms remain future extensions.

## Public Google Sheets runtime

The connector uses Google's documented [public spreadsheet query endpoint](https://developers.google.com/chart/interactive/docs/spreadsheets). Share the original sheet as **Anyone with the link → Viewer**; no Google sign-in, API key or service account is required. The server only reads it.

In Sources, add a connection name, the original `https://docs.google.com/spreadsheets/d/.../edit` sharing URL, an optional worksheet name/numeric gid and an A1 range. The URL's `gid` selects its tab when Worksheet is blank. Ranges are bounded to **200 rows × 32 columns**; the form previews the first ten rows/eight columns. Refresh intervals are **5–3600 seconds** under Refresh settings. Test before saving; editing the target invalidates the test. The save re-reads the range rather than trusting browser preview data.

The **Worksheet** dropdown loads actual tab names from the public sheet when the URL is entered or a connection is opened. The URL's gid selects the matching tab. Use the refresh button to reload the list. **Enter a tab name or gid…** provides a manual fallback if discovery is unavailable. Discovery reads bounded public HTML metadata, parses only tab-name/gid scalar descriptors, and never evaluates its scripts or follows embedded links. This is a compatibility parser for Google's public viewer, not the authenticated Sheets API; a Google markup change can make discovery unavailable while manual tab selection and normal data reads continue working.

The grid button next to **Data range** opens a read-only **Select data range** dialog. Drag from one cell to another (in either direction), or use Shift + arrow keys, to select a rectangle. **Use range** copies the A1 selection into the connection draft and invalidates its previous connection test; **Cancel** and Escape leave the form untouched. Test and Save still happen in the parent form. No picker action saves configuration, edits the sheet or sends playout commands.

The picker initially loads a bounded neighborhood containing the current selection, usually 100 rows × 26 columns. Sticky row/column headers, scrolling and drag-edge auto-scroll support larger selections. Edit **Preview window** or use row/column navigation buttons to browse farther; each window and saved selection is limited to 200 rows × 32 columns. Empty cells are selectable, allowing a range to include future rows. Existing in-use connection targets remain locked; create another connection to change the sheet, tab or range.

One background read refreshes the connection's dataset for all mapped fields and stages. At most four scheduled reads run together; concurrent refresh requests for a connection are coalesced. Requests time out after eight seconds and failed reads back off up to one hour. Google may cache responses, so last read is not the cell's modification time and the interval does not guarantee instantaneous updates. Cell values use formatted text and must be nonempty and at most 300 characters.

The server loads saved configuration and starts polling without a Data Manager or rundown browser open. `.local/ycs-data.json` (or `ycs.dataFile`) stores version 2 connections, local/legacy sources, stage/graphic mappings and stage/template defaults. Atomic saves advance `revision`; manual external edits must also advance it. Missing/invalid JSON retains the last valid configuration and blocks further saves until repaired.

Version 1 cell sources migrate automatically: identical connection settings are combined, original source IDs and cell selections are preserved, and an exact `.v1-backup.json` is written before migration. Existing mapped cells become direct field selections. Unused original cell aliases remain in the saved document for compatibility; select their connection and cell to reuse them from the new UI.

Last good datasets and resolved field values are cached atomically beside the data file as `.sheets-cache.json`. Cache identity includes the connection target and selection, preventing cross-cell reuse. A missing/damaged cache falls back to each field's saved manual text until a successful read. Program always starts stopped after a server restart. Runtime updates do not advance the configuration revision or store transient live values in the configuration document. These ignored local files, backups and real sheet URLs are never committed.

Publish-to-web `/d/e/...` URLs, restricted sheets and arbitrary HTTP/CSV endpoints are not accepted by the Sheets adapter. Public HTTPS JSON APIs use the separate connector described above. Requests go only to `https://docs.google.com`, without cookies or redirects. Callback payloads are parsed as JSON, never evaluated as JavaScript. No dependency was added.

Additional API routes use the same origin/auth rules as stage commands:

- `GET /api/ycs/data`: configuration, connection health, datasets, usages and resolved source values.
- `POST /api/ycs/data/sheets/worksheets`: `{url}` → public worksheet names and gids, without changing configuration.
- `POST /api/ycs/data/sheets/test`: `{settings:{url,worksheet,range,refreshSeconds}}` → read-only preview.
- `POST /api/ycs/data/connections`: `{id?,label,settings,revision}` → saved connection and snapshot.
- `POST /api/ycs/data/connections/:id/refresh`: immediate refresh.
- `POST /api/ycs/data/connections/:id/remove`: `{revision}` → remove an unused connection.
- `GET /api/ycs/data/mappings/:stage/:graphic`: field definitions and effective/default bindings.
- `POST /api/ycs/data/mappings/:stage/:graphic`: `{revision,edits:[{field,scope,binding}]}` → atomic mapping save. Scope is `override`, `default`, or `inherit`; binding is null, `{source:id}`, or `{connection:id,selection:{kind:'cell',cell:'B2'}}` / `{connection:id,selection:{kind:'row',headerRow:1,keyColumn:'Stage',keyValue:'STAGE 1',valueColumn:'Round'}}`.

The earlier `/data/source`, `/data/mapping`, `/data/sheets` and `/data/sheets/:id/refresh` endpoints remain available for existing integrations. New clients should use connection and mapping APIs rather than create one source per cell.

## Background runtime on Windows

After initial `npm ci` and demo/configuration setup, run from this checkout:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ycs/start-runtime.ps1
# Or select an existing show configuration:
powershell -NoProfile -ExecutionPolicy Bypass -File ycs/start-runtime.ps1 -Config .local/my-show.json
powershell -NoProfile -ExecutionPolicy Bypass -File ycs/stop-runtime.ps1
```

The launcher defaults to the existing `.local/ycs-dev.json`, launches Node hidden, loads saved connections/rundowns without regenerating demo content, and checks readiness. Starting the same recorded configuration again reuses its healthy process. A per-port startup mutex prevents duplicate launches; an unrelated occupied port is rejected. Stop verifies the recorded executable and process start time before stopping anything. Logs and process identity are saved under ignored `.local/runtime-logs/` and `.local/runtime-process.json`. `-NodePath` supports an absolute Node executable. Store configuration files inside this checkout because upstream SPX resolves their paths relative to server.js. Readiness requests use the saved API token when configured, without logging it. `general.launchBrowser` must be false.

This is a background process for the current Windows session, not an installed Windows service. An explicit launcher command can later be registered with Task Scheduler for login startup; no Windows login settings are changed by these scripts. Restart behavior, account credentials and LAN exposure should be validated on the actual host before venue use.

## Compact native editor

The configured stage rundowns use inline field labels with 29 px text controls and 7 px row spacing. The fields use the full editor width, with the original Save/Update and item tools moved intact to a compact footer. A thin bordered surface, consistent input borders, and locally bundled Lucide link/unlink and edit icons match the compact reference; icon attribution is in `ycs/public/editor-icons.LICENSE.txt`. Linked/manual mode updates the icon as well as its accessible state. Existing title/edit controls and checkboxes share a wrapping header; only source-linked checkboxes show their link toggle there. Source labels and manual/unassigned descriptions are available through the link/input hover titles and accessible descriptions instead of repeated helper lines. A failed linked source retains its visible warning and manual/last-good fallback message. Appearance/timing and manual story JSON remain collapsed disclosures. The original native input elements, names, handlers, values, manual/linked behavior and explicit Save/Preview/Play/Update paths are preserved. Smaller editors wrap the header and use narrower labels; touch pointers get larger controls. Save pending edits before refreshing a rundown to load the compact layout. No server restart is required for these static editor changes.

## Program, preview and renderer status

The stage panel identifies **PROGRAM** and the selected **PREVIEW** draft separately. Preview monitor / Program monitor switch only the embedded monitor. They do not take anything on air. Opening a rundown, reading an editor or switching stages never starts program playback. Selecting an item can play it inside preview.

Output pages acknowledge applied snapshots and report template errors. The panel distinguishes no connected renderer, a renderer loading the current state, ready renderers and reported errors. Heartbeats expire after 15 seconds; navigation closes the renderer report when possible. A ready renderer confirms that the browser applied the composition, **not** that vMix has put it on the broadcast. The native global Stop shortcut is scoped to the current configured stage.

## Display slots

Slot policies are defined in `ycs.slots` in the local configuration. The demonstration has `ticker` and `lower-third`. Each rundown item declares `ycsSlot`, and its stable `itemID` is the command target. Existing numeric layer metadata is retained for SPX editor compatibility, but the new output compositor uses named slots and configured stacking order.

- Different slots coexist. Each stage has its own complete set of slots.
- A new graphic in a slot replaces the previous graphic in that slot.
- Stop targets the named graphic; stopping an already replaced graphic cannot stop its replacement.
- Repeating Play on the same active graphic does not replay its IN animation.
- Updating a graphic reuses its iframe and applies its data without restarting other graphics.
- A stage preview overlays the selected draft on a copy of the active program composition. It does not change program or another stage's preview.

The first version supports classic SPX HTML templates exposing `update`, `play`, and `stop`. It does not add OGraf rendering support to these new stage endpoints. The stock OGraf path is preserved. Template-specific animation behavior and screen placement remain the template author's responsibility.

## Command API and Companion

See [Companion setup](ycs/COMPANION.md). The API can operate without any controller browser open. Both the native rundown and HTTP API call the same server-owned playback service. Per-stage commands are serialized, validated against that stage's saved rundown, and written atomically before program is changed.

Renderer subscriptions use the existing Socket.IO server's `/ycs-playback` namespace over WebSocket, scoped by stage and preview/program mode. Each controller subscribes to both modes on one socket; each output subscribes to its own mode. This avoids the browser's per-origin HTTP/1 connection limit when multiple stage controllers and previews are open. Authorization uses the shared SPX session, the configured API key, or loopback-only development access, with same-origin checks. Reconnecting receives the complete current snapshot; it does not replay historical commands. Active state is currently in memory. **Restarting the server starts outputs stopped**, even if a rundown contains previous on-air flags. Reloading/reconnecting a renderer while the same server remains running restores the current composition.

Save pending edits before reloading existing rundown/output pages after updating to the WebSocket version. Legacy EventSource subscriptions (`Accept: text/event-stream`) receive HTTP 204 to stop reconnecting and free their HTTP slots; the old page's unsaved fields are not altered. Raw requests without that Accept header can still read the legacy event endpoint. A reverse proxy used in a future deployment must support WebSocket upgrades.

The initial development configuration is loopback-only. Remote API requests require a configured `ycs.apiKey` (Bearer header) or an authenticated SPX operator session. LAN deployment, unattended renderer authentication, Windows service/login startup installation, and testing on the actual vMix machines need a separate validation pass before venue use.

## Verification and remaining work

Run `npm test` for stage isolation, concurrent slots, replacement, preview safety, saved-field commit behavior, command ordering, atomic failures, HTTP command handling, reconnection snapshots, data-link mode transitions, stale writes, invalid source recovery, renderer health and compositor iframe continuity. Sheets tests cover bounded public requests, JSON parsing, invalid/empty reads, polling/backoff, cache recovery, HTTP linking, coalescing and Data Manager draft safety. No browser automation dependency has been added; DOM tests use the existing jsdom dependency.

The browser smoke test covers two native controllers, a ticker and lower third together, independent Stage 2 playout, and the program renderer. Companion integration is tested through its intended HTTP requests; a physical Stream Deck is not required. The Companion application/emulator itself has not yet been configured in this fork's first milestone.

The data-link workflow supports native field types, basic transforms, reusable public Sheets/JSON API datasets, cell/row/property selections, project-scoped sources, defaults and connection editing/removal. Advanced authentication, production/output provisioning, operator-specific preview sessions and final deployment remain subsequent work. Companion's application/emulator is still not configured. No source credentials or user spreadsheet IDs are included in this repository.

Upstream changes are intentionally limited: registration of the optional module, shared session middleware for the stage WebSocket namespace, an optional listener host, stage attributes/script/preview URL in the existing controller view, test scripts, and local-file ignore rules. Keep changes to upstream files small so upstream fixes can be merged.


## Story playlists

The ticker templates in ycs-graphics declare a `Stories` textarea (`f14`) with additive `ycsCollection` metadata. The native SPX type remains textarea; `ycsCollection: {version: 1, fields: [{key, title, required?, aliases?}]}` describes the record fields to the mapper. Other templates can declare their own record keys rather than adopt category/topic/subtopic. JSON text is delivered through the normal SPX field; the ticker adapter validates it and converts it to `tickerItems`. This adds no OGraf compliance claim.

For an existing development install, stop the runtime, update ycs-graphics, run `node ycs/upgrade-ticker-fields.cjs .local/ycs-dev.json`, then start the runtime. The explicit upgrader adds only a missing Stories field to matching imported ticker definitions and project profiles, increments affected editor revisions and writes exact `.before-playlists.json` backups. It preserves existing fields, mappings, link modes and any tickerItems override in f1. It is idempotent. New imports already include the metadata. Reload a rundown after saving its pending edits to see the added field.

In Data Manager, select the ticker and choose **Map story list** on Stories. Pick a saved Sheets or JSON connection. For Sheets, choose a bounded range inside the saved connection range and its header row. For JSON, choose an array; paths into each record are generated by the property browser. Map the template's story fields to unique header names/properties, a fixed value, or Unused. Each source field can have a fallback for missing/blank values. Each story text field also has a Transform dropdown: None, Uppercase, Lowercase, Trim whitespace or Prefix text. The transform applies after reading its source/fixed/fallback value and before required-field, size and playlist validation. It affects the resolved preview and linked playout, not the sheet/API data or manual JSON fallback. Publication, ordering and Story ID selectors are not text-transformed. An optional Published/enabled selector accepts booleans and TRUE/FALSE, 1/0, yes/no, on/off; blank is excluded. Without it all records are enabled. An optional numeric Order selector sorts ascending with source order as a tie breaker. Without it source row/array order is retained. Optional Story IDs must be nonempty and unique among enabled stories. With no ID, the renderer uses content identity.

The preview lists source rows, included/excluded/invalid states, playback positions and validation errors; blank sheet rows are ignored. Names follow headers when columns move. Missing or duplicated mapped headers require explicit remapping, never a guessed column. Required story fields come from template metadata. Disabled rows need not have valid content/order/IDs. The complete playlist is rejected if any enabled row is invalid; the last valid playlist is held. An intentionally empty playlist (all unchecked) is valid and drains the crawler. Lists are bounded to 200 records / 64 KB, with up to 4000 characters per text property. Existing scalar linking retains its 300-character limit.

Google's query response infers column types and can drop a text header above boolean/numeric data. The connector therefore overlays isolated reads of the first range row and requested collection/lookup header rows, preserving their cell addresses. These reads share the connection poll and timeout, rather than polling once per linked field. Up to 16 distinct header rows are supported per connection. Keep each data column's types consistent; Google's query endpoint can still omit incompatible mixed-type data values.

**Use mapping** only updates the workspace draft. **Save mapping** saves the binding without changing the rundown or program. Enable Stories' link in the rundown and explicitly Play/Update to commit it; switching to manual restores its saved JSON fallback. Later valid source refreshes update the same template iframe. Visible/entering crawler nodes and their header timing are retained; only the unseen tail is replaced, continuing after the last retained Story ID when available. This avoids restarting the crawl or waiting through old prefetched repetitions. Saving a different mapping stays pending until an explicit Update.

Collection bindings use `{connection, selection: {kind: 'collection', format: 'sheet', range, headerRow, fields: {subtopic: {kind: 'column', name: 'Subtopic'}}, enabled?: {kind: 'column', name: 'Published'}, order?, id?, required: ['subtopic']}}`. JSON uses `format: 'json'`, `pointer` to the array and `{kind: 'property', pointer: '/message'}` selectors relative to each record. Fixed fields use `{kind: 'static', value: 'text'}`; source selectors may include `fallback`. Required keys are enforced by the template on preview/save and playout. Existing cell/row/scalar mappings remain compatible.
