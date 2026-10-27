# YCS SPX: stage playback and public Google Sheets linking

This is a fork of [TuomoKu/SPX-GC](https://github.com/TuomoKu/SPX-GC), based on upstream commit `8bb7ec4e7b969fe7c777d2c2a9b03ed6de3f6981`. The upstream MIT license and notices are retained.

The initial implementation keeps SPX's normal rundown editor and HTML template lifecycle. An optional `ycs` module gives each stage its own program composition and independent preview. Multiple graphics can play together using named display slots. Commands target a stage and graphic ID, independent of controller focus.

## Development setup

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

General text fields are supported, including the ticker's round, status, day/date, location and rounds-remaining text, and lower-third name/title. Checkboxes, numbers, artwork pickers and JSON fields remain manually controlled. Typed linking, transforms, private Sheets and general HTTP API adapters are future extensions.

## Public Google Sheets runtime

The connector uses Google's documented [public spreadsheet query endpoint](https://developers.google.com/chart/interactive/docs/spreadsheets). Share the original sheet as **Anyone with the link → Viewer**; no Google sign-in, API key or service account is required. The server only reads it.

In Sources, add a connection name, the original `https://docs.google.com/spreadsheets/d/.../edit` sharing URL, an optional worksheet name/numeric gid and an A1 range. The URL's `gid` selects its tab when Worksheet is blank. Ranges are bounded to **200 rows × 32 columns**; the form previews the first ten rows/eight columns. Refresh intervals are **5–3600 seconds** under Refresh settings. Test before saving; editing the target invalidates the test. The save re-reads the range rather than trusting browser preview data.

One background read refreshes the connection's dataset for all mapped fields and stages. At most four scheduled reads run together; concurrent refresh requests for a connection are coalesced. Requests time out after eight seconds and failed reads back off up to one hour. Google may cache responses, so last read is not the cell's modification time and the interval does not guarantee instantaneous updates. Cell values use formatted text and must be nonempty and at most 300 characters.

The server loads saved configuration and starts polling without a Data Manager or rundown browser open. `.local/ycs-data.json` (or `ycs.dataFile`) stores version 2 connections, local/legacy sources, stage/graphic mappings and stage/template defaults. Atomic saves advance `revision`; manual external edits must also advance it. Missing/invalid JSON retains the last valid configuration and blocks further saves until repaired.

Version 1 cell sources migrate automatically: identical connection settings are combined, original source IDs and cell selections are preserved, and an exact `.v1-backup.json` is written before migration. Existing mapped cells become direct field selections. Unused original cell aliases remain in the saved document for compatibility; select their connection and cell to reuse them from the new UI.

Last good datasets and resolved field values are cached atomically beside the data file as `.sheets-cache.json`. Cache identity includes the connection target and selection, preventing cross-cell reuse. A missing/damaged cache falls back to each field's saved manual text until a successful read. Program always starts stopped after a server restart. Runtime updates do not advance the configuration revision or store transient live values in the configuration document. These ignored local files, backups and real sheet URLs are never committed.

Publish-to-web `/d/e/...` URLs, restricted sheets and arbitrary HTTP/CSV endpoints are not accepted. Requests go only to `https://docs.google.com`, without cookies or redirects. Callback payloads are parsed as JSON, never evaluated as JavaScript. No dependency was added.

Additional API routes use the same origin/auth rules as stage commands:

- `GET /api/ycs/data`: configuration, connection health, datasets, usages and resolved source values.
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

The data-link workflow supports ordinary text fields, reusable public Sheets datasets, cell/row selections, defaults and connection editing/removal. Typed fields/transforms, private Google authentication, HTTP API adapters, operator-specific preview sessions and final production deployment remain subsequent work. Companion's application/emulator is still not configured. No source credentials or user spreadsheet IDs are included in this repository.

Upstream changes are intentionally limited: registration of the optional module, shared session middleware for the stage WebSocket namespace, an optional listener host, stage attributes/script/preview URL in the existing controller view, test scripts, and local-file ignore rules. Keep changes to upstream files small so upstream fixes can be merged.
