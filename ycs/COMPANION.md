# Companion: explicit stage and graphic commands

Use Companion's **Generic HTTP Requests** connection for the first integration. A custom module is not required for Play/Stop. Its browser emulator can exercise these actions without a physical Stream Deck.

For the local development server, use base URL `http://127.0.0.1:5660`. Configure an HTTP POST action with Content-Type `application/json` and body `{}`.

| Button | POST URI |
|---|---|
| Stage 1 ticker: Play | `/api/ycs/stages/stage-1/graphics/ticker/play` |
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

For a future LAN deployment, use the server's LAN address after configuring its bind address. Configure a private `ycs.apiKey` and pass `Authorization: Bearer YOUR_TOKEN` in Companion's headers. Do not commit or include the token in exported public profiles. The current demo binds to loopback, so it is intentionally accessible only on the development computer.

Documentation: [Companion emulator](https://companion.free/user-guide/v4.1/sidebar/emulator/) and [Generic HTTP module](https://github.com/bitfocus/companion-module-generic-http/blob/master/companion/HELP.md).
