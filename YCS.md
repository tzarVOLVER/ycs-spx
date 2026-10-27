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

## Current round data-link test

The **Data Manager** link in the stage panel opens `/ycs/data-manager` in this server. It contains editable local sources, public Google Sheets sources and stage-specific mappings for the ticker's **Current round (`f5`)**. Multiple stages may map to the same source, or use separate sources. Private Sheets and general HTTP API adapters are not implemented yet.

1. Open a stage rundown and double-click the ticker to open its fields.
2. Enter a manual Current round value. Click its gray chain button to link it. The chain turns green, the field becomes read-only, and preview shows the mapped source value. Program is unchanged.
3. **Play** (or **Update** for an active ticker) commits the link to program. Later source changes update that field automatically without restarting the ticker or its crawler.
4. Open Data Manager, edit the stage's source text and click **Publish source**. A linked preview/program updates within roughly two seconds. Manual fields do not follow it.
5. Click the chain again to restore the saved manual text. This is a pending preview edit. If program was linked, it continues following its committed source until **Update** applies the manual override.
6. **Save** stores manual text and link mode without changing program. Reloading the rundown restores those saved settings. Unsaved edits are not restored after navigating away.

Field mappings belong to Data Manager. Remapping a field changes its editor binding; an active program keeps its previous source until the next Play/Update. Manual text, editor link mode and committed program bindings are separate. Each saved graphic has an edit revision: stale controller writes receive a conflict instead of overwriting newer edits. Reload the rundown to resolve a conflict. The Data Manager similarly rejects a stale document revision; its Reload button discards unsaved manager edits.

The server creates `.local/ycs-data.json` on first use (override with `ycs.dataFile`). This ignored JSON file is the source document, with version, revision, sources and mappings. The server checks it once per second, so it can also be edited locally. Keep the schema intact and increment `revision` when editing externally. Prefer replacing the complete file atomically. API writes validate nonempty source text up to 300 characters and use atomic replacement.

If the file becomes missing or invalid, existing links retain their last valid values and the chain/manager show a warning. Restoring valid JSON resumes updates. Last-good data is cached in memory; if the server starts with no valid source, the saved manual field supplies the fallback. Source failures do not disable manual playback. No template polls the source: the server resolves standard SPX field values and pushes composition snapshots. The previous standalone linking pilot and its port 8787 are not used by this fork.

## Public Google Sheets

The connector uses Google's documented [public spreadsheet query endpoint](https://developers.google.com/chart/interactive/docs/spreadsheets). A sheet shared as **Anyone with the link → Viewer** can be read without Google sign-in, an API key or a service account. The connector reads the sheet on the SPX server. It never changes the sheet's sharing settings or writes back to it.

1. In Data Manager, enter a **Source name** and the original `https://docs.google.com/spreadsheets/d/.../edit` sharing URL. A `gid` in the URL selects that tab automatically.
2. Optionally enter a worksheet name or numeric gid to choose another tab. Enter a bounded preview range, such as `A1:D4`, and an interval of **5–3600 seconds**.
3. Click **Test connection**. This reads a preview only, without saving a source or changing program. Select the nonempty cell to expose as this source's value, then click **Add source**. Changing connection settings invalidates the previous test/selection.
4. Assign the new source under **Field mappings**. In the stage rundown, click the Current round chain and inspect preview. **Save** persists the draft mode; **Play/Update** commits it to program.
5. Edit the source cell in Google Sheets. Committed linked fields follow successful reads automatically. The crawler keeps its iframe and continues moving. Pending manual overrides stay separate until Update.

Each Google Sheets source exposes one selected cell. To expose another cell, add another named source. Preview ranges are limited to 20 rows by 12 columns. Cell values use formatted text where available, including calculated sheet values, and must be nonempty and at most 300 characters. Empty/invalid values are treated as a failed read rather than clearing the graphic. No arbitrary JSON paths, transformations or automatic type conversion into other template field types are included in this milestone.

Saved source cards show the current value, selected cell, interval, connection status, last successful read and retry time after failure. **Refresh now** reads immediately. Google may cache results, so the interval is not a guarantee of frame-accurate or instantaneous updates. Last success is a successful read time, not the cell's modification time. Live values/status refresh without replacing unsaved local inputs or mappings.

Polling starts on the server even when no controller browser is open. At most four scheduled reads run together, repeated reads of the same source are coalesced, and failed reads use exponential backoff up to one hour. Requests have an eight-second timeout and a bounded response size. The rundown chain becomes amber for an unavailable/stale source, while retaining its last valid value. Recovery resumes the same link without Play or an animation restart.

Last valid values are atomically cached in ignored `.local/ycs-data.sheets-cache.json` (derived from `ycs.dataFile`). After a server restart, the saved value is available while the next read is pending; **program still starts stopped**. Cache entries are bound to the exact source configuration so a changed cell cannot reuse another cell's value. A missing or damaged cache falls back to the saved manual field until a valid read succeeds. Background refreshes do not advance the saved configuration revision or write runtime values into the configuration document.

Original public sharing URLs are supported. Publish-to-web `/d/e/...` URLs, private/restricted sheets and general HTTP/CSV sources are not supported. Outbound requests are constructed for `https://docs.google.com` only and do not follow redirects or send cookies. Google callback responses are parsed as JSON; remote scripts and cell contents are never evaluated. No new dependency is required.

Additional server routes (same origin/API access rules as stage commands):

- `POST /api/ycs/data/sheets/test`: `{settings:{url,worksheet,range,refreshSeconds}}` → preview cells.
- `POST /api/ycs/data/sheets`: `{label,settings:{url,worksheet,range,refreshSeconds,cell},revision}` → saved source ID and snapshot; the selected cell is re-read before saving.
- `POST /api/ycs/data/sheets/:id/refresh`: refresh a saved source and return status/last valid value.

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

The initial development configuration is loopback-only. Remote API requests require a configured `ycs.apiKey` (Bearer header) or an authenticated SPX operator session. LAN deployment, unattended renderer authentication, startup/service installation, and testing on the actual vMix machines need a separate validation pass before venue use.

## Verification and remaining work

Run `npm test` for stage isolation, concurrent slots, replacement, preview safety, saved-field commit behavior, command ordering, atomic failures, HTTP command handling, reconnection snapshots, data-link mode transitions, stale writes, invalid source recovery, renderer health and compositor iframe continuity. Sheets tests cover bounded public requests, JSON parsing, invalid/empty reads, polling/backoff, cache recovery, HTTP linking, coalescing and Data Manager draft safety. No browser automation dependency has been added; DOM tests use the existing jsdom dependency.

The browser smoke test covers two native controllers, a ticker and lower third together, independent Stage 2 playout, and the program renderer. Companion integration is tested through its intended HTTP requests; a physical Stream Deck is not required. The Companion application/emulator itself has not yet been configured in this fork's first milestone.

The native data-link test supports one text field, local JSON and public Google Sheets. General field/type selection, editing/removing saved sheet connections, private Google authentication, HTTP API adapters, operator-specific preview sessions and final production deployment remain subsequent work. Companion's application/emulator is still not configured. No source credentials or user spreadsheet IDs are included in this repository.

Upstream changes are intentionally limited: registration of the optional module, shared session middleware for the stage WebSocket namespace, an optional listener host, stage attributes/script/preview URL in the existing controller view, test scripts, and local-file ignore rules. Keep changes to upstream files small so upstream fixes can be merged.
