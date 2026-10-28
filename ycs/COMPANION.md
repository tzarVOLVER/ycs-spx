# Companion: explicit stage and graphic commands

Use Companion's **Generic HTTP Requests** connection. A custom module is not required. Its browser emulator can exercise these actions without a physical Stream Deck. The generated profiles target **Companion 5.1** (JSON export version 12) with **Generic HTTP 3.2.0**; older Companion import formats are not claimed compatible.

## Generate and import

From the SPX fork, run `npm run ycs:companion` or `node ycs/companion/generate.cjs .local/ycs-dev.json`. The generator reads only configured stage IDs/titles. It writes:

- `dist/companion/YCS-Rehearsal.companionconfig`: stage pages and overview, targeting the separate test server at `http://127.0.0.1:5661`.
- `dist/companion/YCS-Orlando.companionconfig`: the same controls targeting the normal server at `http://127.0.0.1:5660`.
- Matching `*-stage-1/2/3.companionconfig` individual page exports for switch-PC imports. The stage list comes from configuration; it is not limited to three by the generator.

In Companion, open **Import / Export**, choose a file, then use the **Buttons** tab to select pages and map the imported `ycs_rehearsal` or `ycs_orlando` HTTP connection. Import into empty destination pages so existing controls are retained. A full import can replace existing pages/connections; use that only for a new disposable Companion configuration. The profiles contain no triggers, surface settings, source URLs, saved field values or credentials. Generated files remain ignored; the generator is tracked in Git.

The leftmost button labels the stage and has no action. The seven following buttons are Ticker Play / Update / Stop, Lower Third Play / Update / Stop, and Stop Stage. Every action uses an explicit stage ID and stable graphic item ID with an empty JSON body. There are no toggles or controller-focus dependencies. Update applies the saved draft/current mapped values; it does not take a stopped graphic on air. Pending text that has not been saved in the rundown is not available to Companion. Use the rundown for field changes, manual/linked modes and the rounds-remaining checkbox.

Green/blue/red identify the command type; they are **not active-state tally**. Companion's connection/button status icons indicate request errors. A successful request means the SPX server accepted it, not that vMix has placed the input on the final broadcast. Continuous program-state feedback is a separate next step; these profiles do not keep a latched success indicator that could be mistaken for live tally.

## Browser emulator rehearsal

1. Start the separate rehearsal with `npm run ycs:rehearsal`; open its three-output monitor.
2. Import the rehearsal profile into a separate Companion test configuration. Confirm its connection base URL is port **5661** before pressing buttons.
3. Open Companion's **Interactive Buttons** emulator, choose the overview page, then Play each stage's ticker and lower third. Verify the monitor shows different rounds on three outputs using the same ticker template URL.
4. Stop one ticker and confirm its lower third and the other stages continue. Press Play twice and confirm it remains playing. Stop a graphic, then press Update: it must remain stopped.
5. Save a manual round draft in that rehearsal rundown or through the test API, press Update, and verify only that stage changes. Stop Stage must clear only its row's output. A bad/unavailable endpoint must produce a connection error; restore its base URL before continuing.

The development checkout's portable test uses an official, signature-verified Companion 5.1.1 runtime with separate configuration under the graphics repository's ignored `.local/companion-config`, and a loopback admin URL on port **8888**. It is separate from SPX and is not a Windows service or login-startup installation. A normal Companion installation can import the same generated profiles.

## HTTP contract

For the local development server, use base URL `http://127.0.0.1:5660`. Configure an HTTP POST action with Content-Type `application/json` and body `{}`.

| Button | POST URI |
|---|---|
| Stage 1 ticker: Play | `/api/ycs/stages/stage-1/graphics/ticker/play` |
| Stage 1 ticker: Update saved values | `/api/ycs/stages/stage-1/graphics/ticker/update` |
| Stage 1 ticker: Stop | `/api/ycs/stages/stage-1/graphics/ticker/stop` |
| Stage 1 lower third: Play | `/api/ycs/stages/stage-1/graphics/lower-third/play` |
| Stage 1 lower third: Stop | `/api/ycs/stages/stage-1/graphics/lower-third/stop` |
| Stage 2 ticker: Play | `/api/ycs/stages/stage-2/graphics/ticker/play` |
| Stop Stage 1 graphics | `/api/ycs/stages/stage-1/clear` |

Change `stage-1` to `stage-2`/`stage-3` for the other stages. Always use explicit Play and Stop actions. The graphic ID comes from its stable rundown `itemID`, not its position or browser selection. Use the rundown to edit values and visibility controls.

A successful request returns a JSON program snapshot. Failures return a non-2xx status and `error`; do not display a successful action solely because a request was sent. Snapshot state represents the server's active composition, not proof that vMix has placed the input on the final broadcast. Renderer/vMix confirmation is not implemented yet.

Useful GET endpoints:

- `/api/ycs/stages` — stage controllers.
- `/api/ycs/stages/stage-1/graphics` — available graphic IDs and slots.
- `/api/ycs/stages/stage-1/program/state` — active program composition.
- `/api/ycs/stages/stage-1/preview/state` — independent pending preview composition.

For a future LAN deployment, set the imported connection's Base URL to the SPX server's LAN address after configuring its bind address. Configure a private `ycs.apiKey` and add `{"Authorization":"Bearer YOUR_TOKEN"}` to each action's Header JSON locally. The generator deliberately includes no token. Header values can be present in exports even when “Include secrets” is off, so remove credentials before sharing an export. Import only the matching stage's page on each switch PC; keep the overview on the central control computer. The current demo binds to loopback, so it is intentionally accessible only on the development computer. LAN/vMix and physical surface validation remain outstanding.

Documentation: [Companion](https://companion.free/), [import/export](https://companion.free/user-guide/v5.1/config/import-export/) and [Generic HTTP module](https://github.com/bitfocus/companion-module-generic-http/blob/master/companion/HELP.md). The generator's schema was checked against an actual exported page from 5.1.1 as well as its official export models; no Companion source was copied into this project.
