# YCS SPX: stage playback foundation

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

Renderer subscriptions are scoped by stage and preview/program mode. Reconnecting receives the complete current snapshot; it does not replay historical commands. Active state is currently in memory. **Restarting the server starts outputs stopped**, even if a rundown contains previous on-air flags. Reloading/reconnecting a renderer while the same server remains running restores the current composition.

The initial development configuration is loopback-only. Remote API requests require a configured `ycs.apiKey` (Bearer header) or an authenticated SPX operator session. LAN deployment, unattended renderer authentication, startup/service installation, and renderer acknowledgements need a separate validation pass before venue use.

## Verification and remaining work

Run `npm test` for stage isolation, concurrent slots, replacement, preview safety, saved-field commit behavior, command ordering, atomic failures, HTTP command handling, and reconnection snapshots.

The browser smoke test covers two native controllers, a ticker and lower third together, independent Stage 2 playout, and the program renderer. Companion integration is tested through its intended HTTP requests; a physical Stream Deck is not required. The Companion application/emulator itself has not yet been configured in this fork's first milestone.

The data-link pilot remains in `ycs-graphics/integrations/spx-data-link`. Migrating its chain buttons into the native stage editor, a general Data Manager, Google Sheets/API source adapters, and final production deployment are subsequent work. No source credentials are included in this repository.

Upstream changes are intentionally limited: registration of the optional module, an optional listener host, stage attributes/script/preview URL in the existing controller view, test scripts, and local-file ignore rules. Keep changes to upstream files small so upstream fixes can be merged.
