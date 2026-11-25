# The in-game page and overlays

## What it is

What the game's browser shows: the page Skyrim Platform opens over the game
and the overlays drawn into it, plain JavaScript and HTML with nothing built.
`index.html` is the page. It is the front's own page, whose `build.js` comes
from `local\thornswood-front.zip`, plus `thornswood-bridge.js`, which supplies
what that page expects from a browser this one is not, and the character
choice at the main menu, `thornswood-select.js`, which draws itself before any
plugin runs. `thornswood-front.js` in `game\plugins` then fetches the
overlays into that one page:
- the chat (`thornswood-chat.js`, which holds the one socket to the voice service),
- the emote wheel (`thornswood-emotes.js`),
- voice (`thornswood-voice.js`),
- profession guides (generated as `thornswood-profession-guides.js`),
- the character panel and character creation behind K (`thornswood-skills.js`),
- the party menu behind P (`thornswood-party.js`),
- journals behind J (`thornswood-journal.js`),
- the notice board (`thornswood-board.js`),
- the trade panel (`thornswood-trade.js`),
- the guild trader and merchant panel (`thornswood-merchant.js`),
- the repair panel that a key in the inventory opens while a repair kit is carried (`thornswood-repair.js`),
- the wounds panel that a key in the inventory, or X on somebody hurt, opens (`thornswood-treat.js`),
- combat maneuvers (`thornswood-maneuvers.js`, #1386),
- carriage and ferry rides that E on a driver opens (`thornswood-ride.js`),
- the hold's drop box on a notice board (`thornswood-box.js`),
- trade ships and trade carts (`thornswood-ship.js`, #2700, #3158),
- food preservation for cooks (`thornswood-preserve.js`, #3163),
- the furniture panel that the lock key in the inventory opens inside a building you may arrange (`thornswood-furniture.js`),
- market stalls (`thornswood-stall.js`, #3160),
- the help panel on F7 and Help buttons on panels (`thornswood-help.js`),
- Settings where keys, the field of view, chat fade and needs bars are changed with the game running (`thornswood-settings.js`, #3126), and
- the "Are you still here?" window after 15 minutes idle (`thornswood-afk.js`).

`thornswood-theme.mp3` is the theme the main menu plays, and the launcher plays
it too while it is open.

The loading screen, `thornswood-loadscreen.js`, is in the page from its start
like the choice, because the plugins hear of a load only after it: the engine
tells the page itself when the game's Loading Menu opens and closes (the
`skyrimPlatform:loading` event) and draws the page while it is open. It plays
the menu's loop with one of Thornswood's hints over it, from
`Data\Platform\UI\thornswood-hints.js` in the game folder, which is not in
this folder: Go.ps1 writes it from `site\data\site\lines.md`, the one copy
of the hints (#3130, #3147).

## Dialogs when opening

The journal, board, party, character, trade, drop box, ride, wounds, repair,
furniture, maneuvers, help, merchant and ship panels call
`window.thornswoodDialog.open(dialog, title)` from the bridge after drawing a
closed panel into view. It names the dialog from its mounted title and focuses
the first visible, enabled control. If there are no controls, it focuses the
named dialog itself. The merchant and ship keep their existing modal
attributes.

Call it only when a panel changes from closed to open. Panels that replace a
focused control during a redraw use `thornswoodDialog.redraw(root, draw)` to
keep focus and the text selection on the matching control. If that control
disappears, focus goes to the dialog. The character section rows and
maneuvers use native buttons so Enter and Space activate the same actions as
clicking. Repeated keydown does not trigger another action. The away prompt
keeps its separate alert-dialog and focus-restoration behavior.

`game/tests/test-4601-panel-dialog-focus.js` renders the actual pages with the
bridge and checks their names, initial focus, reopening, owner updates and
native-button event boundaries. Chrome accessibility-tree and keyboard checks
also verify the native browser behavior before shipping.

## On your machine

From the repo folder, with the game closed:

```
.\scripts\release\Go.ps1 -SkipServer
```

unpacks the front from `local\thornswood-front.zip` into `Data\Platform\UI` in
the game folder Where.ps1 finds (or `-Game` to name another folder), copies
every `.js`, every `.mp3`, every `.webp` (the scroll pictures in front of the
character choice) and `index.html` from here over it so ours wins, copies the
site's banner from `site\public` (`banner.webm`, `banner.mp4` and `banner.jpg`
as `thornswood-menu.webm`, `thornswood-menu.mp4` and `thornswood-menu.jpg`) as
the menu's painting, and writes the loading screen's hints there from the
site's `lines.md`. It copies nothing else from this folder.

The front build, skymp5-front from the pinned fork commit, is built into
`local\thornswood-front.zip` by `scripts\release\Build-Front.ps1` and checked
against `records\front-build.json` (#2754). It is not in git. A missing front
zip, a zip that does not match the recorded build, a missing menu banner file
or a missing `index.html` fails the run and stops Ship. `-SkipServer` matters:
without it Go.ps1 also copies the voice service over the live one on the VPS
and restarts it.

The plugins' two rules apply here too: the launcher holds these files read
only while the game runs, and Keep puts its copy back at Play, so Go.ps1 makes
what it installs the kept copy and a file copied in by hand is undone. A new
overlay has to be called `thornswood-*.js`, like every other file of ours under
`Data\Platform`, and named in the `OVERLAYS` list at the top of
`thornswood-front.js`, or nothing loads it. Authored overlays are copied
directly. The content-table build runs `scripts\dev\Build-ProfessionGuides.js`
to generate the profession guides overlay. The `tests\test-*.js` harnesses read
several of these files and check them.

## Where it runs

In `Data\Platform\UI` in every person's game folder, drawn by the browser
Skyrim Platform runs over the game. The files reach people in a release pack
the same way as the plugins: Ship runs Go.ps1 into the shipping machine's game
folder, Publish-Update packs what changed (and puts this `index.html` back
first if another server's menu has replaced it), and each launcher unpacks the
pack, keeps a copy and holds the files read only while the game runs. Every
change goes to the dev build first, with
`.\scripts\release\Ship.ps1 -Channel dev "what changed"`.
