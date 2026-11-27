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
| `{"do":"face","what":"bed"}` | the character stands beside the nearest bed in its cell, turned to it and looking down at it, in first person, as somebody walks up to use one. The spots on the bed's four sides, 45 units clear of its bounds, are tried nearest first, and the first from which the crosshair lands on the bed is kept; the note names the side and every side that did not see it. A bed is what `thornswood-front.js` clears the owner of (its `isBedRef`). No bed in the cell, or none of its sides seeing it, fails the step. |
| `{"do":"wait","for":"cell","name":"Bannered Mare"}` | the character is in a cell whose name holds that; with `"in": false`, in one whose name does not. With `"skip"` it passes over the trip to a place the character is in already. |
| `{"do":"wait","for":"shut","menus":["InventoryMenu"]}` | none of those menus is open. |
| `{"do":"wait","for":"crosshair","what":"bed"}` | a bed is under the crosshair, so the game shows its prompt. |
| `{"do":"wait","for":"running","ms":10000}` | the game kept sending updates for that long with no gap of a second, so the world was not paused (a menu that should leave the world running, #6408). |
| `{"do":"wait","for":"time","ms":1500}` | that long has gone by. Only before a shot of something the game shows for a moment and gives no event for, like its message when a bed refuses. |
| `{"do":"end"}` | always; the runner closes the game. |

Any step may carry `"task": <issue>`, the test task it checks. A failing
step of a task takes its `fail-<step>` screenshot and ends that task only:
the run goes on at the next task's first step. Each task gets one results
line, `{"t":"task","task":"6408","ok":true}`, or with `ok` false the step
and why, and the run ends failed naming every failed task.
A key step with `"ifMenu": [names]` is pressed only while one of those
menus is open, and passes without a press otherwise. Every task but the
first starts with Escape that way, a `shut` wait for the same menus and a
page step that shuts our journal, so a task that failed with a menu up
leaves the next one where it should start. The dev release run's steps
after the world are tasks too (the journal, #1016; the inn bed, #6712; the
inventory, #7008; the game's menu, #5197), so one part failing no longer
stops the rest from running.
`tests\real-client\test-tasks.json` is the list of test tasks one character
checks alone; run it with `-Steps tests\real-client\test-tasks.json`.
A step with `"tidy": true` and no task puts back what the tasks made (the
journal tasks' scratch journals are thrown away), whether they passed or
not; it comes after every task, and if it fails the run ends there.
Its journal steps press the panel's buttons from a page step, as the click
would, and leave the run's own journals apart from the character's by the
ids it had before the first one.

Sitting down and getting up are results lines of their own,
`{"t":"furniture","enter":true,"bed":true,"ref":"..."}`, the character's
only, so a run says whether it lay down in a bed (#6712). The list goes to
the Bannered Mare with `/tp bannered`, sent once from a page step, which the
run's account may run because it is on the dev list.

`tests\test-5197-real-client.js` runs the plugin against a fake game and
checks every list here only uses these steps.

The two inventory key steps set `inventoryTrace` to record whether Skyrim
reported the scripted keyboard down and up. The result records menu state
and whether the game named the Inventory action. The Windows input receipt
and the following inventory open or close check are reported separately.

`camera-smoke.json` is a separate opt-in, local-only observation for the high
view report (#6593). It is never part of the normal release run. Use matching
runner/plugin bytes and an authorized test character. Run-RealClient selects
Dev; this list adds no Main route or environment switch. It reuses the normal
release run's entry steps and selects its existing named test character,
Adventurer. Keep hands off the controls: after the in-world screenshot it
requests one wheel detent forward and one backward, with a half-second pause
between completed attempts. Each request must match its unused opted-in plan
step. It never forces a camera or moves the actor.

An opted-in timed wait or wheel step enables `camera-trace` result lines only
while that step is active. Limits are thirty seconds from the first trace,
eight wheel observations/requests and sixty-four receipts per run. Ordinary runs do not
read camera state. `-Publish` is refused for any list with a camera trace:
coordinates and screenshots remain local, with no GitHub upload. Do not attach
these local results to a public issue. The existing dev permission and
whose-game checks are preserved.

The start sample includes actor XYZ, scale, cell/world, camera mode, browser
focus, camera/looking controls, known menus and the last native owner target
XYZ with its timestamp age and epoch. It copies no profile, name or inventory
contents from the native diagnostic. Missing APIs or target data are `null`.
`actorTargetZ` is reported only when the target location matches the actual
world/cell; an old target is not a current walking destination. Read its age.

A game mouse-wheel down records the preceding update sample, then the next
update and a sample at least 250ms later. `beforeSampleAgeMs` makes the timing
explicit: the first sample is not a synchronous pre-native-input measurement.
`sameOwnerEpoch` compares process-local diagnostic epochs/location; it is not
proof of persistent actor identity across client/controller recreation.
`actorDeltaXYZ` is reported only within the same world/cell. Multiple attempts
may overlap; their numbered receipts remain separate. A trace ending may
truncate a late wheel's settled receipt. No game button event means no claim
about whether a physical wheel was moved or swallowed before game input.

The explicit `{"do":"wheel","delta":120,"cameraTrace":true}` step (or
`delta:-120`) captures a before sample on update before asking Windows, then
records the next update after its acknowledgment and another at least 250ms
after the acknowledgment. These three `platform-request` receipts exist even
when no game wheel event arrives. The Windows helper sends one wheel-only
event after checking game focus, checks its insertion count and focus again,
and never retries. A rejected acknowledgment fails the step after the after
samples. An accepted acknowledgment passes delivery only; it does not prove
Skyrim read it or changed view. A focus race between checks and insertion
remains possible. Game wheel receipts and platform request receipts are
separate observations and may describe the same physical input.
`platformAckAt` is when the plugin consumed the runner's acknowledgment, not
the exact Windows insertion time. Sampling and runner polling add latency.

Stable actor XYZ while zoom changes the apparent height separates a view
problem from actual actor movement. Changed actor Z must be investigated as
movement. Camera mode alone cannot measure camera height: the pinned public
API offers a screen projection and camera-state enum, but no camera world
position getter, so camera XYZ/distance are explicitly unavailable. These
receipts do not prove a camera displacement or a correction. Pair them with
the local before/after screenshots and exact server/build/load route. A
separately authorized Main observation is still needed for a Main report.

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
