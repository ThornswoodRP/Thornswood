# Release to dev

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

Everything goes to the dev build first, including a small change. A dev release can run from any branch on any developer's machine. There is one dev feed and one dev server, and the last dev Ship wins, so a Dev says in #dev-coordination before taking the dev feed. The Lead Dev does not have to.

The machine that runs `Ship.ps1` still has to sign the build. [Setting up a machine](set-up-a-machine.md#setting-up-a-machine) and [Shipping from another machine](set-up-a-machine.md#shipping-from-another-machine) are how a PC gets there.

## The content plugin goes to the server first

The server gets the content plugin first, then the Ship. When `game\content\Thornswood-Content.esp` or `game\data\last-plugin.recipe` (the recipe Thornswood-Last.esp is made from, #2791) changed since the last dev release, put it on the dev server before you Ship. The Ship right after it carries the same change to the launcher and says it, so the deploy posts nothing (`-ShipFollows`) and the note goes to the Ship alone:

```powershell
.\scripts\deploy\Deploy-DevGamemode.ps1 -LoadOrder -ShipFollows
.\scripts\release\Ship.ps1 -Channel dev "The forge takes the new ores
- Iron and silver ore smelt at every forge."
```

Each post says only what is new on its channel (#3320, Patrick, 22 Oct). Ship and `Deploy-DevGamemode.ps1` refuse a note whose title or `- ` line the channel's News or its Discord channel has already had, and say where it was said. On 22 Oct a deploy and the Ship after it posted the same note twice, which is what `-ShipFollows` is for.

`-LoadOrder` keeps the dev server's own load order and sends every plugin it names that the server does not hold at the same bytes: the content plugin from your checkout, the others from the collection. `Thornswood-Last.esp` is never sent: it copies other authors' records, so the deploy makes it on the box from your checkout's recipe, into the stage beside what it sent, and the stage check holds it to the sha256 `game\data\last-plugin.json` names (#2791, `scripts\deploy\LastPluginOnBox.ps1`). It is always the last plugin in that order: when the dev server's order does not end with it, `-LoadOrder` puts it there and sends the order (#2486). It needs no server build, so it runs from the fresh checkout the deploy asks for. `-Dist <a built dist\server folder>` also writes that build's load order over the dev one.

When the engine pin moved as well, the server build goes first: `Deploy-DevGamemode.ps1` sends a gamemode only to a dev server that runs the build your commit records (#2076). `Publish-Server.ps1 -Channel dev -FromStore` keeps the running server's plugins, and when its `Thornswood-Last.esp` is not the one your recipe makes, it makes that one on the box the same way, from the plugins it sends and the server's own, and the installer takes it into the stage held to the same sha256. The deploy after it then finds the plugin already there.

Ship asks the dev server which of our plugins it holds, by size and sha256. When this release would send clients another one, Ship stops before it publishes, posts or tells the server anything, and names the command above. On 11 Oct a dev Ship sent a new content plugin while the dev server still had the old one, and for eight minutes every dev client that updated held a plugin the server did not (#2308).

## Say so, then write the note

The note is what people read. The first line is a title of three words or more, from the person's side. Then one line starting with `- ` for each thing they will notice. Ship refuses a title that is shorter, a note with no `- ` line, an issue number, a file name, a setting name, and the word the Words section bans.

The note is written in the pull request, not at release time (#5179). Its body has a `Release note:` line with the title on it and the `- ` lines directly under it, or `Release note: none` when nobody would notice the change in the game, the launcher, the site or Discord. The "Release note" check (`.github/workflows/pr-body.yml`) holds it to the rules above while the pull request is open, and runs again when the body is edited. Dependabot's pull requests say none by rule.

```text
Release note: The forge shows the price before you pay
- The forge window lists each metal a piece takes and how much.
```

At release time the note is joined from every pull request merged since the last dev release, in merge order, and printed ready for Ship:

```powershell
pwsh -NoProfile -File scripts/release/Collect-ReleaseNotes.ps1 -OutFile $env:TEMP\note.txt
.\scripts\release\Ship.ps1 -Channel dev (Get-Content $env:TEMP\note.txt -Raw)
```

It stops and names any merged pull request with no `Release note:` line, and says so when every change says none.

```powershell
.\scripts\release\Ship.ps1 -Channel dev "The Downgrade button shows its progress and says why it stopped
- A bar under the Downgrade button shows how far the downgrade has got.
- When the downgrade stops, the line under the button says why and what to do next."
```

That publishes the dev feed, the dev launcher News tab, and the dev updates channel in Discord. It leaves the live feed alone.

When the build matches what dev already has, Ship releases nothing and says so. It posts nothing to Discord, tells no server, and adds no news entry, because a note goes out with the release it describes. It still marks the dev notes again, below.

## Mark the dev notes again

The dev launcher's News tab marks a note DEV when the dev build has it and main does not. The marks follow main's feed. Every dev Ship works them out, a dev Ship with nothing new included, and every main Ship works them out for the dev feed as soon as main's feed is out. To do it on its own, with no release:

```powershell
.\scripts\release\Refresh-DevNews.ps1 -Check
.\scripts\release\Refresh-DevNews.ps1
```

`-Check` says which notes would lose or gain the mark and sends nothing. Without it, the dev feed's `version.json` is sent, and only when a mark or `mainVersion` moved. No pack, no launcher, no Discord post, no server notice. Run it from a clone that has main's release commit (`git fetch` first), because git proves which notes main has.

## Put the gamemode on the dev server

When the pull request changed `game\gamemode.js` or the dev server should run that release's gamemode:

```powershell
.\scripts\deploy\Deploy-DevGamemode.ps1
```

## Look before you post the news again

Ship already posts the note. These commands send nothing. They show what a second post would say.

```powershell
.\scripts\ops\Set-DevNews.ps1 -Check
.\scripts\ops\Publish-Discord.ps1 -Dev -DryRun
```

`Set-DevNews.ps1 -Check` says whether the dev Discord webhook is set, and which channel it points at. It prints no secret. Where the dev build is installed is [H. Dev Build](tools.md#h-dev-build).

## What any developer may do

Decided for the whole team: any developer may do every one of these, except the ones that change what is live. A main release, a hotfix and a live server or gamemode deploy go out only on Patrick's word, by whoever he names (Patrick, 30 Oct; How work moves). Confidence in the change, and a green `Build check result` check on the exact commit, are the gates for a merge. A dev release, a dev deploy, and a news post are the same people. Dev and Main each have one shared feed and one shared server, and the last Ship on a channel wins.

The machine that runs `Ship.ps1` still has to sign the build. `records\signing\signing.json` has to be present and enabled, and the launcher tip has to be signed by the certificate the launcher already trusts. `.\scripts\release\Setup-ShipMachine.ps1` is how a machine gets there. Shipping from another machine, in First Time Setup, says which Azure sign-in can sign.

| Job | Command | Where it shows up |
| --- | --- | --- |
| Dev release | `.\scripts\release\Ship.ps1 -Channel dev` plus the note | Dev feed, dev launcher News tab, dev updates channel in Discord |
| Main release | `.\scripts\release\Ship.ps1` plus the note | Live feed, launcher News tab, the site news page, Discord #news |
| Discord news | Ship posts it. To post the current feed again: `.\scripts\ops\Publish-Discord.ps1` or `.\scripts\ops\Publish-Discord.ps1 -Dev` | #news for main, the dev updates channel for dev |
| Game news | The same note. The launcher News tab reads the feed. The site writes its News page itself from the main feed and its news file (the site's copy or the Release's) within a minute of a new feed (#5187); nothing is run | Launcher News tab, and https://thornswood.net for main |
| Docs site | The merge's Release, put in by the box deploy agent: the app and the public pages. `.\scripts\deploy\Deploy-Docs.ps1` for the documents, the boards and the password | https://thornswood.net |
| Dev gamemode | `.\scripts\deploy\Deploy-DevGamemode.ps1` | Dev server only |
| Live gamemode | `.\scripts\deploy\Deploy-Server.ps1 -GamemodeOnly`, from any machine, needs no server build | Live server |
| Live server build, or the live settings Deploy-Gamemode writes | `.\scripts\deploy\Deploy-Gamemode.ps1`, then `.\scripts\deploy\Deploy-Server.ps1`, from a machine with the fork built | Live server |
| The server build your commit records, already in the store on the box, with the gamemode | `.\scripts\deploy\Deploy-Server.ps1 -FromStore` for live, `.\scripts\release\Publish-Server.ps1 -Channel dev -FromStore` for dev, from any machine | Live or dev server |

`Deploy-Server.ps1 -GamemodeOnly` sends the committed `game\gamemode.js`, its build stamp, and `game\content\Thornswood-Content.esp` when the live server's copy is not the same size and sha256. The live server keeps its own settings, and no setting may change. Before anything is sent it asks the live server which server build it runs, and refuses unless that is the build `records\server-build.json` names at your commit. A gamemode that needs a new server build, or a change to the live settings (the load order, the NPC, gear, reloot and damage settings, the join pass and the role lists), goes the full way, from a machine with the build. `-PutBack` puts back what either one replaced. Decided by Patrick on 5 Oct, #1089: any machine may put a gamemode live this way.

`-FromStore` (#459) puts the server build `records\server-build.json` names onto the server from the box's own store, where every publish and full deploy has kept the build it sent since #2467, so any machine can deploy a recorded engine. Before anything is sent the box says which build its store keeps for that record, and with none the run stops there; `-ServerBuild <zip>` sends one first, such as the one the engine build in CI made, held to the record on both sides. The server keeps its own settings, load order and start point, so it is the engine and the gamemode that move. An engine that reads light plugins another way than the running one is refused, because the order it keeps would then mean something else; that one goes the full way.

A dev release can run from any branch on any developer's machine. A main release runs from `main` after `git pull`, with a clean tree that matches GitHub. The note shape is in [Say so, then write the note](#say-so-then-write-the-note). The command for each file is in [After a pull request is merged](after-a-merge.md). The restart warning is in [How a release goes out](release-to-main.md#how-a-release-goes-out).

To post the current feed again:

```powershell
.\scripts\ops\Publish-Discord.ps1 -DryRun
.\scripts\ops\Publish-Discord.ps1 -Dev -DryRun
```

`-DryRun` sends nothing. A real post remembers what it already announced and refuses to repeat it. `-Force` is how a deleted post is made again.
