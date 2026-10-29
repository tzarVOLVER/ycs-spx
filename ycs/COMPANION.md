# Companion setup

Use the standard **Generic: HTTP Requests** connection in Companion. No custom SPX module, generated buttons or import files are needed. Each separate Companion installation needs this module/connection available and configured. A computer only displaying an SPX browser output needs neither Companion nor this module. Stream Decks connected to a central Companion installation, including through Satellite, use that installation's connections.

## Create a button

1. In Companion's Connections, add **Generic: HTTP Requests**. Install its module through Companion if it is not already available.
2. Open the item in the SPX rundown. In its **Companion** row, choose an action and click the copy icon.
3. Add a **POST** action to the Companion button's **Press** actions. Paste the copied URL, set Content Type to **application/json** and Body to **{}**. Leave Release empty.

The copied URL is complete, so Generic HTTP ignores its optional Base URL. Open SPX using the central computer's LAN hostname/IP before copying for another PC. A localhost address always refers to the machine running Companion. See the module's [official guide](https://github.com/bitfocus/companion-module-generic-http/blob/master/companion/HELP.md).

On the server, remote Companion requests require the existing `ycs.apiKey` setting and an `Authorization: Bearer YOUR_KEY` action header unless authenticated as an operator. The server must listen on the reachable LAN address. This UI change does not change binding, firewall or authorization settings. Do not put private tokens in URLs.

## Item API

Use POST with an empty JSON object:

    http://SPX-PC:5660/api/PROJECT/RUNDOWN/ITEM_ID/play
    http://SPX-PC:5660/api/PROJECT/RUNDOWN/ITEM_ID/stop
    http://SPX-PC:5660/api/PROJECT/RUNDOWN/ITEM_ID/toggle
    http://SPX-PC:5660/api/PROJECT/RUNDOWN/ITEM_ID/update
    http://SPX-PC:5660/api/PROJECT/RUNDOWN/ITEM_ID/select
    http://SPX-PC:5660/api/PROJECT/RUNDOWN/ITEM_ID/preview
    http://SPX-PC:5660/api/PROJECT/RUNDOWN/ITEM_ID/continue

- **Focus** uses `/select`; `/focus` is an alias. It focuses the matching row in currently open controllers for that configured rundown. It does not open a browser, navigate another rundown, play a graphic, change preview, save fields or overwrite unsaved edits. Reconnecting does not replay old focus commands.
- **Play** uses saved fields and current mappings. Repeated Play updates the active item without replaying its entrance.
- **Stop** removes that item from program.
- **Toggle** checks actual program inside the output queue and chooses Play or Stop. Use one Press action, with no Release action: duplicate requests toggle twice.
- **Update** applies saved changes to an active item; it does not start a stopped item.
- **Preview** previews saved data. It is separate from Focus and from a local editor's unsaved draft.
- **Continue** advances a running template with continuation steps; unsupported or inactive items return an error.

Project and rundown must match exactly one configured output in `ycs.stages`. Unknown/unconfigured pairs return 404; ambiguous pairs return 409. This address format does not automatically provision outputs for new projects. Native editor, data and renderer internals retain existing stage routes for compatibility. The public item API does not accept field edits.

Nickname changes and reordering do not change the item ID. Deleting and re-adding an item creates a different ID, so copy its new URL. The compact copy control never executes an action. Hover the icon to inspect its target; selectable text appears if clipboard access is blocked. An item without an output slot permits Focus copying but disables playback-action copying.

Successful HTTP responses describe server state, not vMix broadcast tally. Check failed/non-2xx commands in Companion's connection status/log. Test on the separate rehearsal first. Venue LAN/vMix and physical surfaces still need validation.
