# Companion controls

Use Companion **5.1** with **Generic HTTP Requests 3.2.0**. No custom module or physical Stream Deck is needed; Interactive Buttons provides an emulator. The exports use Companion JSON version 12.

## Copy commands from a rundown item

Open an item in a configured stage rundown, then expand **Companion controls**. It shows the permanent **Item ID**, **Copy ID**, and **Copy Play / Stop / Toggle / Update URL** buttons. Use the copied URL in a Generic HTTP **POST** Press action, Content type **application/json**, Body **{}**. Leave Release empty. Copying sends no playback command and preserves unsaved field edits.

The copied URL includes the exact current stage and item ID. Nickname changes and reordering do not change the target. Deleting and re-adding an item creates a different ID: copy again or export fresh button pages. The native Caps Lock overlay's copy shortcuts also use the stage API on configured rundowns.

The full URL uses the server origin used to open the rundown. Open SPX through its LAN hostname/IP when preparing URLs for another computer; a localhost URL refers to that other computer itself. Generated profiles instead use relative action paths and one editable connection Base URL. The Generic HTTP module also supports a full URL that overrides its Base URL; see its [official guide](https://github.com/bitfocus/companion-module-generic-http/blob/master/companion/HELP.md).

If the browser blocks clipboard access, the panel exposes selectable text. This includes ordinary LAN HTTP pages. An item without a configured output slot shows a warning and its play-command copy buttons are disabled. It still exposes Copy ID. Importing a graphic alone does not assign its output slot yet.

## Download real button pages

In the stage panel, expand **Companion button pages**, then choose:

- **Download Play / Stop buttons**: explicit Play, Update and Stop for each actual saved item.
- **Download Toggle + Play / Stop buttons**: Toggle and Update, with explicit Play and Stop fallbacks.

Exports are read-only snapshots of the saved rundown. Button labels use saved nicknames, descriptions or template names. Every target is read from its actual saved ItemID; there are no assumed ticker/lower-third IDs or controls for missing demo items. Multiple copies of the same template are independent buttons. Each stage page has Stop Stage in its header and up to three graphic rows; additional items receive additional pages. CLI/all-stage exports also include overview pages.

Validation rejects missing/unknown output slots, duplicate/unsupported IDs, unsupported template paths and empty rundowns. Errors appear in SPX without navigating away or losing field drafts. Exporting never changes mappings, rundown content or program state.

In Companion, open **Import / Export**, select the downloaded file, then use the **Buttons** tab to select and import pages into empty destinations. Map to an existing Generic HTTP connection or create the imported connection. A full import/reset can replace other configuration; use it only for a disposable test installation. The file contains labels, connection origin and commands, with no field values, source data, API keys, triggers or surface settings.

The imported connection Base URL is the SPX origin used for download. Change it to the central server's LAN address for switch-PC imports. Prepare only the appropriate stage's pages for each operator; keep overview pages on the central operator computer. HTTP authorization is enforced by the existing API rules. If a private ycs.apiKey is configured, add an Authorization Bearer header to the actions locally; exports deliberately omit it. Do not share subsequent Companion exports containing private headers.

## CLI generation

From the SPX checkout:

    node ycs/companion/generate.cjs .local/ycs-dev.json
    node ycs/companion/generate.cjs .local/ycs-dev.json --base-url http://SPX-PC:5660 --name YCS-Orlando

The CLI reads the configured project/rundown files and validates all items before writing. It creates **dist/companion/YCS-Orlando.companionconfig**, its **-Toggle** variant, and individual page files. The default origin is localhost with the configured server port. Changing --base-url only changes exported connection settings; it does not change SPX network binding. Files remain ignored; code is tracked in Git.

CLI generation no longer invents rehearsal targets from the event configuration. To export the running isolated rehearsal's real IDs, download from:

    http://127.0.0.1:5661/api/ycs/companion/export
    http://127.0.0.1:5661/api/ycs/companion/export?style=toggle

## HTTP contract

POST with JSON body {} to:

    /api/ycs/stages/STAGE_ID/graphics/ITEM_ID/play
    /api/ycs/stages/STAGE_ID/graphics/ITEM_ID/stop
    /api/ycs/stages/STAGE_ID/graphics/ITEM_ID/toggle
    /api/ycs/stages/STAGE_ID/graphics/ITEM_ID/update
    /api/ycs/stages/STAGE_ID/clear

Play uses saved data/current mappings. Update applies saved changes to an active item; it cannot start a stopped graphic. Toggle resolves against actual program inside the stage queue, so an intervening rundown command is reflected by the next press. Each successful request flips once; duplicate requests flip twice. Use one Press action and no Release action. Manual/linked changes and rounds-remaining controls stay in the rundown.

A successful response is the server's composition, not proof that vMix has put it on broadcast. Non-2xx responses must be treated as failed commands. Colours identify action types, not continuous program/vMix tally. Nicknames are display labels; ItemIDs are the command targets.

Read-only export routes (existing operator/API authorization and origin checks apply):

    GET /api/ycs/companion/export?style=explicit|toggle
    GET /api/ycs/stages/STAGE_ID/companion?style=explicit|toggle

Add page=NUMBER to request a single-page export. Stage exports include only that stage; all-stage exports include overview pages. Neither export route executes commands or embeds credentials.

## Rehearsal

Start the separate rehearsal and import its exported buttons into a disposable Companion configuration. Use **Interactive Buttons** to test Play twice, Update on a stopped item, Toggle after a command from another controller, simultaneous graphics, individual Stop, and stage-only Stop. Verify other stages remain unchanged. Test missing targets and source outages. Actual venue LAN/vMix and physical surfaces still need validation; this does not add continuous tally.
