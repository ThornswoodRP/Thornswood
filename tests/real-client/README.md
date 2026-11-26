# The real game run

## What it is

A run of the real launcher and the real game on One, walked through a list of
steps by `game\plugins\thornswood-test.js` while
`scripts\dev\Run-RealClient.ps1` watches (#5197). It is for what only shows
in the real game: the choice page, the journal, the launcher's Play, the
menus, the load order. GitHub's runners have no graphics card or Skyrim, so
this is the in-game exception to keeping work off One.

Each `.json` here is one list. `dev-release.json` is the run after a dev
release: Play from the launcher, the scroll and the choice page, creation
when the character is new, the world, our journal, the inventory and the
game's menu, with a screenshot of each.

The run plays its own character: the slot named Adventurer, the name
creation gives it. It picks that slot by its name, never the slot the page
picks by itself, which is the last played: on 26 Nov a run that took the
page's pick joined as a person's own character. With no slot of that name the
run stops at the choice page and says so.

Creation comes only for a character the server has not got. The launcher
keeps one list of characters for both servers, so a character made on main
reads "not on this server" on dev, and playing it makes a new one there. The
race menu then opens in the hall. The run presses R, the menu's Done,
answers its question with Enter, accepts the name with Enter (the name box is
inside the race menu and says no menu of its own). For a character the server
has, the race menu never opens, and those steps are skipped. Then a character
still in the hall, new or made by an earlier run that stopped there, takes
the Starting Location on the K panel the way a person does (Whiterun, Review,
Confirm) and waits for the trip to the town. The panel's
`thornswoodSkills.isCreating()` says which: a character the server has
already placed answers `placed`, and the shot and the trip are skipped.

## On your machine

On a PC with an install whose Profile holds `dev-allowed.txt`, the launcher
and the game closed, and the PC signed in and not on the lock screen (the
game reads keys only while its window is in front, and behind the lock
screen no window is, so a locked PC stops the run before the launcher
starts), from the repository folder:

```
pwsh scripts\dev\Run-RealClient.ps1
```

It writes `temp\real-client\<run>\`: `summary.md`, `run.log`, the plugin's
`results.jsonl`, the launcher's log for the run, a `.png` for each
screenshot, and under `game\` the game's own logs that the run's game wrote
(`skyrim-platform.log` with the plugins' Trace lines, and the Thornswood
logs beside it), which the next game start writes over. `-Root` names another install (the default is
the install `scripts\release\Where.ps1 Install` finds, with the launcher the
setup put in `%LOCALAPPDATA%\Thornswood\current`), `-Steps` another list, and `-Publish` puts
the run on a draft Release of its own, `real-client-<run>`, and a line on the
newest Dev Deployment that links it. A build's own Release cannot take it,
because Releases here are immutable once published. A draft makes no tag and
only the team sees it, and the ten newest runs are kept. It ends 0 only when every step passed.

The game runs the build's own plugin. The launcher keeps its build's
`Data\Platform` files and puts them back before every Play, so a copy laid
in by hand never reaches the game (26 Nov: such a copy was put back, and the
run read the older plugin's miss as a failure of its steps). When the game's
plugin is not this checkout's, the run says so in `run.log` and its result,
with the build in place: run from that build's commit, whose steps are the
ones its plugin knows.

An install on the main channel is put on dev for the run, as the Server
card's switch does it: the launcher takes dev's package by itself when it
starts, and Play is pressed only once the launcher in place is dev's. When the
run ends the install goes back to the channel it was on, and the launcher
takes that channel's package at its next start. With automatic updates off
(Settings, Updates) the launcher never takes dev's package, and the run stops
at the Play wait and says so.

A Play the launcher could not start leaves it open with no game. The run
reads launcher.log from where it began, stops at the launcher's own "Failed
to start" line with its reason, and closes the launcher it started, instead of
waiting the whole `-Minutes` for a game that is not coming (26 Nov).

At the end the run closes the game, waits for the launcher's "Game closed
after" line, which it writes once it has put Windows' Skyrim folders back,
and then closes the launcher's window as a person does. A launcher ended by
force puts nothing back. If either folder still points at the build after
the run, the run fails and names it.

## After each dev release, by itself

On One, `pwsh scripts\dev\Watch-RealClient.ps1 -Install`, run once from
`C:\Thornswood-Repo` as the person signed in, makes a task that looks every
five minutes. It starts one run for the newest Dev Deployment that has
succeeded and has no "Real game run:" line yet, from that Deployment's own
commit, when no launcher or game is open, the PC is not on the lock screen
and nobody has used the keyboard or mouse for ten minutes. Each Deployment is
run once, pass or fail. The task runs the script from
`worktrees\real-client-watcher`, which `-Install` makes and each look moves
to origin/main first, so it never runs a stale copy from the shared clone.
Every look is a line in `temp\real-client\watch.log` of the clone;
`-Uninstall` takes the task and that worktree off. To run the newest
Deployment at once, without the ten idle minutes, run
`pwsh worktrees\real-client-watcher\scripts\dev\Watch-RealClient.ps1 -Now -Root C:\Thornswood`
from the clone and keep off the keyboard and mouse while it runs.

## How a step is written

One object per step, in order. Each takes `timeout` in milliseconds (30000
when not given) and may carry `why`, which nothing reads. The run stops at the
first step that fails, after a screenshot named `fail-<step>`.

| Step | Passes when |
|---|---|
| `{"do":"page","js":"<expression>"}` | the expression, run in the game's page every half second, gives true, a number other than 0 or a word. It may click things on the way, as a person would. |
| `{"do":"wait","for":"world"}` | the character stands in a cell with no loading screen or main menu up. |
| `{"do":"wait","for":"menu","menu":"InventoryMenu","open":true}` | the menu is open, or the game said it opened since the step before this one began (`"open":false`: closed). A loading screen can open and close between two of the plugin's ticks, which do not come while it is up. |
| `{"do":"page",...,"skip":2,"skipIf":"placed"}` | as a page step, but when the page answers exactly the `skipIf` word the next 2 steps, which deal with what is not there, are skipped. |
| `{"do":"wait",...,"skip":8}` | any wait with `skip` passes too when what it waits for does not come in its time, and the next 8 steps, which deal with it, are skipped. For what comes only sometimes, like creation. |
| `{"do":"wait","for":"message","match":["thornswood-front","journal:opened"]}` | the page sent a message starting with those words since the step before this one started. |
| `{"do":"key","code":36}` | Windows accepted a scan-code down, a 120 ms hold and a separate up, with game-window focus checks before and after (J is 36, I 23, Tab 15, Escape 1). A missing window, refused focus or incomplete input fails the step with its reason. |
| `{"do":"shot","name":"journal-open"}` | the runner saved a screenshot of the game window. |
| `{"do":"end"}` | always; the runner closes the game. |

`tests\test-5197-real-client.js` runs the plugin against a fake game and
checks every list here only uses these steps.

The runner replies with the request number, `ok` and `note` in
`thornswood-test-ack.txt`. Use the runner and plugin from the same checkout:
the old runner's numeric reply cannot pass a key step. Accepted input alone
does not prove the game or browser handled the key; follow it with a menu,
message or page check for the expected result. The focus checks and
Windows input are separate calls, so a focus change between those calls
cannot be ruled out by a successful acknowledgement. When the game window is
not in front, the note names the process and the title of the window that is
(26 Nov: Windows refused the focus at step 20 and nothing said what had it).

Keys stay down for 120 ms, a short human press below the repeat delay.
The pinned engine sends its browser listener changes in current keyboard
state, while native menus read buffered events. Sending down and up together
could open a native menu while the browser missed the entire pulse. The
runner always attempts key-up in `finally`, including after a failed press,
hold or focus check; a failed release fails the step too. It never retries
key-down. Native browser key capture and the resulting panel state remain
the acceptance checks for browser delivery.

`code` is a non-extended set-1 make code from 1 through 127. Extended/E1 keys
are unsupported and fail before any input is sent.

PowerShell 7 must be available to run the harness regression test, including
its fake Windows focus and input cases; missing PowerShell fails the test.
