# Release to main

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

A main release is for a security fix, for something that leaves the game untestable, or for work the team has agreed goes live. It goes out only on Patrick's word for that exact build, and whoever he names runs it from a machine that can sign (Patrick, 30 Oct). Nobody asks him whether main is ready. A release gets no #staff-updates line; the update channel, the app and site News tabs and GitHub say it. A main release runs from `main` after `git pull`, with a clean tree that matches GitHub.

## The version comes from the build

Nothing moves the version before a release (#5179). `launcher\app\Updater.cs` holds `0.0.0` in git, and every build works out the launcher's number from git: the time, in UTC, of the newest commit on main that changed anything the launcher is built from, written year.monthday.hourminute, so `2026.1101.1745` for 5:45 PM UTC on 1 Nov 2026. `scripts\release\LauncherVersion.ps1` has the rule. The same sources always give the same number, and a later change always a higher one. A dev build adds a fourth part. Until 1 Nov 2026 the number was a line in `Updater.cs` that `Bump-Version.ps1` moved in a pull request of its own before every main release with a launcher change; that script is gone.

The number needs the history, so a shallow checkout cannot build the launcher without `-Version`: fetch it with `git fetch --unshallow`, or give `actions/checkout` `fetch-depth: 0`.

## The content plugin goes to the live server first

When `game\content\Thornswood-Content.esp` or `game\data\last-plugin.recipe` changed since the last main release, the live server gets it before the Ship, from `main` after `git pull`:

```powershell
.\scripts\deploy\Deploy-Server.ps1 -GamemodeOnly
```

It sends the committed gamemode and the content plugin, and makes Thornswood-Last.esp on the box from the recipe, whenever the live server's copy is not the same size and sha256. The first time the live load order has to gain `Thornswood-Last.esp` as its last plugin, `-GamemodeOnly` refuses, because it changes no setting; that release goes the full way, `Deploy-Gamemode.ps1` then `Deploy-Server.ps1`. A main Ship asks the live server the same question and stops, with nothing published, posted or told to a server, while the answer is another plugin.

## Ship main

```powershell
git switch main
git pull
.\scripts\release\Ship.ps1 "what changed, in plain words"
```

Ship writes nothing to this repository. The note has the same shape as a dev note. This publish goes to the live feed, the launcher News tab, the site news page, and Discord #news. On the dev feed it changes only which notes are marked DEV, and `mainVersion`, so the dev News tab stops marking what main now has (see [Mark the dev notes again](release-to-dev.md#mark-the-dev-notes-again)).

## Deploy the live pieces the pull request touched

A gamemode change, from any machine:

```powershell
.\scripts\deploy\Deploy-Server.ps1 -GamemodeOnly
```

A new server build, or a change to the live settings, from a machine with the fork built:

```powershell
.\scripts\deploy\Deploy-Gamemode.ps1
.\scripts\deploy\Deploy-Server.ps1
```

The gamemode command, then the server command, is the live pair. `-GamemodeOnly` refuses, with nothing sent, when the live server runs another server build than the one your commit records; then the live pair is the way. What each one sends is in [What any developer may do](release-to-dev.md#what-any-developer-may-do). The full list, including the site, the bot, and voice, is [After a pull request is merged](after-a-merge.md).

Once the box deploy agent looks after main (`Install-DeployAgent -Main`, docs/DEPLOY-AGENT.md "Main"), the gamemode and the server build reach the live server another way: the Release dev ran is promoted, and goes out when Patrick approves it on GitHub, which is his word for that exact build (#5181):

```powershell
gh workflow run promote-main.yml --ref main -f tag=build-<yyyyMMdd>.<run>
```

## A hotfix

A hotfix is the one live release that does not come off `main`. The branch starts from the tag of the release that is live, carries only the fix, and is pushed. Ship runs from a checkout of that branch, and accepts a clean `hotfix/` branch that matches GitHub (#2436), with no `-AllowStaleCheckout`. The setup program is the launcher itself since #4824, so there is no separate installer to rebuild. The dev feed stays as it is. The fix also goes to `main` through its own pull request, or the next main release loses it. The long form is in [How a release goes out](#how-a-release-goes-out).

## How a release goes out

**Everything goes to the dev build first** (decided 23 Sep).
A main release is for a security fix, for something that leaves the game
untestable, or for work the team has agreed goes live. Any developer who
is confident may run it.

```
.\scripts\release\Ship.ps1 -Channel dev "what changed, in plain words"
```

That is the dev release: version 2026.1101.1745.1, .2, .3, pack ids ending `-dev`, the
dev feed and the dev baseline (`feed-dev` in the VPS store), the dev ports,
and the dev server told. It runs from
any branch on any developer's machine. There is no installer for it, and it
posts to the dev updates channel in Discord and the dev launcher's News tab,
never #news. There is one dev feed and the last dev Ship wins, so a Dev says in #dev-coordination before taking it. Main and Dev have independent feeds and baselines. A Main
Ship leaves Dev's release unchanged; advance Dev through its own Ship. What a
Main Ship does change on the dev feed is which notes are marked DEV and its
`mainVersion`, right after main's feed is out (`Refresh-DevNews.ps1`, which
sends the dev `version.json` alone and only when a mark moved). A Ship that
releases nothing, either channel, posts nothing and tells no server.

A main release, from your clone, on a machine that can sign:

```
cd C:\Users\<you>\Downloads\Thornswood-Repo
git checkout main
git pull
.\scripts\release\Ship.ps1 "what changed, in plain words"
```

Nothing moves the version first: Ship works the launcher's number out from
git, the time its sources last changed on main (The version comes from the
build, above, #5179).

Ship writes nothing to this repository. It refuses a main release with
anything uncommitted, with a file under `scripts` or another folder a release
is built from that git does not know, with
a `-Version` other than main's number for these sources, or with main here behind
or ahead of `origin/main`, so what ships is what is on GitHub. It builds the
launcher, checks that the game folder holds the recorded client build
(`Sync-Client.ps1 -Check`) and that the collection there can build the
behavior files and bodies every launcher makes before Play
(`scripts\mods\Build-Generated.ps1 -DryRun`; see One Skyrim of its own), then runs
`scripts\release\Publish-Update.ps1`, which
scans the game folder for loose files that are not Vortex's, not vanilla, not
runtime and not per machine, diffs them against this channel's baseline
(`published.json`, received from the VPS store at the start), zips the
difference as a pack, sends the pack, the launcher and the client runtime to
the site's `/feed[-dev]/assets/<sha256>` (since #897), rewrites `version.json`
and sends it and then the baseline back to the VPS store (since #907), which
is the moment the site serves the release.

The tip customers get is that `version.json`, and launchers poll the feed url in
it. So two things follow the tip, both run by
`scripts\release\Publish-PostShip.ps1`, which Ship calls for the remirror with
the channel it shipped, and then the release is announced as it always was:

1. **The host feed remirror**, the website lane's script, called as
   `& (Join-Path $Here '..\deploy\Remirror-Site-Feed.ps1') -Dev:$Dev`. It
   checks every asset the channel's feed names is on `https://thornswood.net/feed/`
   (or `/feed-dev/`) and finds `version.json` already there, because the
   publisher sent it. It has `-Check` for a dry run and `-Verify` to rehash
   what is up there, and optional `-FeedDir` and `-AssetDir` that nothing here
   passes: it works this machine's working copy out from the channel itself.
   That is the only feed a launcher polls since #907 (`docs\FEED.md`).
2. **The site news, the #news post and the server's countdown**, unchanged, the
   news main only as it always was. Those tell people to update, which is why
   the feed is mirrored before them.

VirusTotal is no longer part of publish (#802). Code signing covers trust
(#390). `Publish-VirusTotal.ps1` and `Add-VirusTotalComment.ps1` stay as
optional manual tools; Ship and the release workflow do not call them.

There is no third step for the launcher. A launcher updates itself from the feed
it polls, so the remirror is how a launcher update reaches anybody, and the
`Install-Launcher.ps1` that Ship runs in the middle of a release refreshes the
install on the shipping machine only (`C:\Thornswood` for main,
`C:\Thornswood-DevBuild` for dev).

The same block runs on a dev Ship, which is where it gets exercised: everything
goes to dev first, so the remirror is run several times a week rather than once
a fortnight. `Publish-PostShip.ps1` finds the remirror by name under `scripts\`
and calls it with the parameters it declares, so that lane does not have to
rename anything to fit, and a hook that is not on the branch yet is a line
saying which file it looked for rather than a failed release.

No switch turns either half off, asked for by the website and launcher lanes so
that every release exercises the block and the dev channel exercises it several
times a week. A `-DryRun` runs none of it, because a dry run publishes nothing to
follow.

Neither of them can fail a release. A script another lane has not landed is a
line naming it. A remirror that exits 1 has refused to publish a feed naming
bytes the site does not hold, which leaves the site one release behind rather
than pointing launchers at a 404, and the website lane asked for that to be a
line as well. So Ship names what did not happen on its last screen, with the
command for each, and still exits 0: a release that is on the feed, in #news and
on the server is out. Both halves ask before they act, so
`Publish-PostShip.ps1` can be run again by hand.

**A hotfix** is the one live release that does not come off main (decided by
Patrick on 24 Sep). A branch named `hotfix/...` starts from the commit the live
release was built from, carries only the fix, is pushed, and Ship runs from a
checkout of it. Every other check
above still applies, Ship refuses a hotfix branch that is not on GitHub, and
the dev feed is left alone. The fix also goes to main through its own pull
request, or the next main release loses it. Once live, the hotfix's commit
is tagged `live-<version>` and the branch deleted; the next hotfix starts
from that tag (`git checkout -b hotfix/<name> live-<version>`).

Everything else, and which one each change needs, is the list in [After a
pull request is merged](after-a-merge.md): `Deploy-Server.ps1` pushes a server
build, `Deploy-Server.ps1 -GamemodeOnly` the gamemode from any machine (`Deploy-DevGamemode.ps1` for dev), the box deploy agent the site and the bot from each merge's Release,
`Request-Restart.ps1` an announcement. `Rotate-ServerPassword.ps1` changes a
password nothing checks any more; the [secrets table](secrets.md) says why. Every
script closes the launcher and Skyrim itself when it needs to.
