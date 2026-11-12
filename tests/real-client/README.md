# The real game run

## What it is

A run of the real launcher and the real game on One, walked through a list of
steps by `game\plugins\thornswood-test.js` while
`scripts\dev\Run-RealClient.ps1` watches (#5197). It is for what only shows
in the real game: the choice page, the journal, the launcher's Play, the
menus, the load order. GitHub's runners have no graphics card or Skyrim, so
this is the in-game exception to keeping work off One.

Each `.json` here is one list. `dev-release.json` is the run after a dev
release: Play from the launcher, the scroll and the choice page, the world,
our journal, the inventory and the game's menu, with a screenshot of each.

## On your machine

On a PC with a dev install whose Profile holds `dev-allowed.txt`, the launcher
and the game closed, from the repository folder:

```
pwsh scripts\dev\Run-RealClient.ps1
```

It writes `temp\real-client\<run>\`: `summary.md`, `run.log`, the plugin's
`results.jsonl`, the launcher's log for the run and a `.png` for each
screenshot. `-Root` names another install (the default is
the dev install, as `scripts\release\Where.ps1 InstallDev` finds it), `-Steps` another list, `-InstallPlugin` copies
this repository's plugin into a build released before it, and `-Publish` puts
the run on the GitHub Release of the newest Dev Deployment and a line on that
Deployment. It ends 0 only when every step passed.

## How a step is written

One object per step, in order. Each takes `timeout` in milliseconds (30000
when not given) and may carry `why`, which nothing reads. The run stops at the
first step that fails, after a screenshot named `fail-<step>`.

| Step | Passes when |
|---|---|
| `{"do":"page","js":"<expression>"}` | the expression, run in the game's page every half second, gives true, a number other than 0 or a word. It may click things on the way, as a person would. |
| `{"do":"wait","for":"world"}` | the character stands in a cell with no loading screen or main menu up. |
| `{"do":"wait","for":"menu","menu":"InventoryMenu","open":true}` | the game says that menu opened (`"open":false`: closed). |
| `{"do":"wait","for":"message","match":["thornswood-front","journal:opened"]}` | the page sent a message starting with those words since the step before this one started. |
| `{"do":"key","code":36}` | the runner pressed that key in the game window, as a DirectInput scan code (J is 36, I 23, Tab 15, Escape 1). |
| `{"do":"shot","name":"journal-open"}` | the runner saved a screenshot of the game window. |
| `{"do":"end"}` | always; the runner closes the game. |

`tests\test-5197-real-client.js` runs the plugin against a fake game and
checks every list here only uses these steps.
