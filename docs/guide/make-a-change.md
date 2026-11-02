# Make a change

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

One issue, one branch, one pull request. Your commits sit on that branch. `main` on GitHub gains them when the pull request is merged. On your branch is the steps. The rules are the next group. A review and the build check hold you to them.

## On your branch

### Start from a current main

```powershell
git switch main
git pull
git switch -c yourname/short-name
```

`yourname` is your name in lowercase. `short-name` is the job, with hyphens. Example: `alex/fix-door-list`. `git switch -c` creates the branch and puts the folder on it. `git checkout -b yourname/short-name` creates it the same way. Later sections use `git checkout` for that move.

### Save the work in a commit

Save the file in the editor first (`Ctrl+S`). A save writes the file into whichever branch is current.

```powershell
git status
git diff
git add path\to\file
git commit -m "Fix the door list so a staff role still gets in."
```

`nothing to commit, working tree clean` means the folder matches this branch. A list of files means those edits become part of the branch when you commit them. That commit is on this PC until you push.

```powershell
git push -u origin HEAD
```

The first push sets the upstream. It puts this branch on GitHub under the same name. `main` on GitHub stays as it is.

### After a change to the content plugin

A change to a plugin in `game\content` (`Thornswood-Content.esp` and the two beside it) changes the tables the server reads out of the load order. Rebuild all of them before you commit, on the VPS box from any machine with box access (below), or on a PC with the game at `C:\Thornswood`:

```powershell
.\scripts\mods\Rebuild-ContentTables.ps1
```

It runs every builder in `scripts\mods\content-tables.json`, in order, and writes each plugin's new sha256 into `records\asset-provenance.json`. It ends with `All <n> builders ran.` and a list of every file that changed: commit those with the plugin, and write in the plugin's entry in `records\asset-provenance.json` what your change put in it. When a builder fails it prints `STOP.`, names the builder, and runs nothing after it.

One builder needs no game: commit first, then run it on the VPS box against the dev server's plugins, its load order and Skyrim's archives there, from any machine with box access (a cloud thread runs `pwsh scripts/vps/Setup-CloudSsh.ps1` first). What it writes under `game`, `records` and `docs\systems` comes back into your checkout:

```powershell
pwsh scripts/mods/Run-OnBox.ps1 scripts/mods/Build-LastPlugin.py --data '{data}'
pwsh scripts/mods/Run-OnBox.ps1 scripts/dev/Build-NpcPopulation.py --settings '{settings}' --strings-dir '{data}'
```

`{data}` is the run's copy of the plugins with this commit's own in their place, `{plugins}` the server's load order as a plugins.txt and `{settings}` as a server-settings.json. The whole rebuild runs the same way (`Run-OnBox.ps1 scripts/mods/Rebuild-ContentTables.ps1 -Data '{data}' -PluginsTxt '{plugins}'`), and writes the tables a game PC writes: every builder reads the load order `game\data\npc-population.json` records, and the crime table reads the script pack in `records\papyrus-scripts.json` (#3105).

From a cloud thread the deploy gate runs that whole rebuild with main's builders: `pwsh scripts/vps/Box-Run.ps1 -Line 'Rebuild-ContentTables -Pull <number> -Head <its full head commit>'` reads only the pull request's data files (the content plugin, `records\recipe-owners.json`, `game\data\last-plugin-policy.json` and `scripts\mods\content-salvaged.json`), never its code, so a change to a builder is merged on its own first. Add `-Stations` when the stations moved: it runs `Build-StationSites.py` and `Add-ContentRecords.py --masters` before the chain.

### Switch between branches

The folder shows one branch at a time. The files in Visual Studio Code are the branch named in the status bar. Every other local branch stays on this PC with its own commits.

```powershell
git branch
git status
```

A star marks the branch in the folder. `git branch -vv` also shows the GitHub branch each one tracks.

#### Commit, then switch

```powershell
git add path\to\file
git commit -m "Save the door list work on this branch."
git switch yourname/other-job
```

The door-list commit stays on the branch you left. Come back with `git switch yourname/short-name`. `git switch -` returns to the branch you were on before this one.

Start a second job from a current `main`. The first branch keeps the commits you already made:

```powershell
git switch main
git pull
git switch -c yourname/second-job
```

#### Set the edits aside

```powershell
git stash
git switch yourname/other-job
```

The folder is clean and shows the other branch. Return to the branch you stashed from and put the edits back:

```powershell
git switch yourname/short-name
git stash pop
```

`git stash list` shows what is still set aside. Pop on the branch you stashed from.

When the switch stops, those uncommitted edits touch a file that differs on the branch you asked for. You are still on the current branch, and the edits are still in the folder. Commit them, or stash them, then switch.

### Open the pull request

`gh pr create` uses the branch you have checked out. A one-line body uses ordinary double quotes. PowerShell treats `@" ` as the start of a here-string, and a here-string needs a line break immediately after `@"`. Characters on that same line raise `No characters are allowed after a here-string header`.

#### A one-line body

```powershell
gh pr create --title "Tools to 50" --body "Reduced tools from 100 to 50 on uses"
```

#### A body of several lines

```powershell
$body = @"
What changed.

How you tested it.

Closes #123
"@
gh pr create --title "Short title" --body $body
```

The title says what changed. The body says how you tested it. If the work finishes an issue and nobody would notice it in the game, put `Closes #123` in the body. A fix people would notice says `Refs #123` instead, with its test task under it as `Test task for #123: <title>`, because its issue is closed with that test task when a main Ship puts the fix on the main server, not when the pull request merges: the Ship closes it itself (`scripts\release\Close-ShippedIssues.ps1`, #3279) ([Everything we need to do goes on the board](the-board.md)). The pull request targets `main`.

Run the test that covers your change before you open the pull request.

```powershell
node tests\test-site-local.js
.\scripts\dev\Check-Words.ps1
```

Use the file in `tests\` whose name matches the area you touched. Pages, docs, and the launcher's window that a person will read go through `Check-Words.ps1`.

#### When the pull request will not open

**The push is not a fast-forward.** Your local branch is behind the same branch on GitHub. Bring the remote commits in, then create the pull request:

```powershell
git pull
gh pr create --title "Tools to 50" --body "Reduced tools from 100 to 50 on uses"
```

If `git pull` says there is no tracking information, name the remote and the branch. Use the name `git status` prints for yours.

```powershell
git pull origin yourname/short-name
git branch --set-upstream-to=origin/yourname/short-name
git pull
```

**You rewrote the branch on purpose** (`git commit --amend` or `git rebase`) and you mean to replace the remote copy of that same branch:

```powershell
git push --force
```

Force push replaces the remote branch. Use it on your own branch after you rewrote that branch. Never force push main: GitHub refuses it from write access, but not from the admin account while `enforce_admins` is off, so for the admin it is a team rule kept by hand. If `main` moved while you were working:

```powershell
git fetch origin
git rebase origin/main
git push
```

**The pull stopped on a conflict.** Git will not commit while a file is unmerged. Open the file it names, often `game\gamemode.js`. Find the markers `<<<<<<<`, `=======`, and `>>>>>>>`. Keep the code you want and delete the marker lines. Save the file.

```powershell
git add game\gamemode.js
git commit -m "Resolve merge conflict in gamemode.js"
```

If the stop was a rebase rather than a merge, the last step is `git rebase --continue` after the `git add`.

### Merge your own pull request

Wait until the check named `Build check result` is green on the commit you are merging. It passes only when `Tree checks`, `Launcher builds` and every `Gate harnesses (n of N)` and `Gate harnesses on Linux (n of N)` check passed, or was skipped because the pick said the change gave it nothing to check (on a pull request the gate's names end in ", what the change reaches" when they ran only that). Main also requires `Test tasks in the pull request`, which holds the test tasks in the body to the bot's rules; when it is red, fix the body, and the edit runs it again. It also requires `Release note`, which holds the body's `Release note:` line to its rules, on the pull request and again in the merge queue, because a published Release's notes can't be changed afterwards; when it is red, fix that line the same way. Pending means it is still running. A red check means the branch is not ready. Fix it on the same branch and push again.

```powershell
gh pr merge --auto --squash
gh pr checks --watch
git switch main
git pull
```

Auto-merge is on for the repository (#5182, Patrick's A on 31 Oct). Turn it on for your pull request as soon as it is open and you are confident in the change: the moment `Build check result` is green, GitHub puts it in the merge queue (#5296), and main's ruleset refuses a merge past red for everybody. The queue runs the build and the test task check again on its merge of your pull request onto the newest main, with the whole gate, and squash-merges it when they pass; main's own build then finds that run and builds nothing again. A pull request that fails there leaves the queue: fix it on the same branch and push, and auto-merge puts it back. `gh pr merge` cannot delete the branch while the queue is on, and does not need to: GitHub deletes it after the merge. On the website the button is **Enable auto-merge**. A merge gets no line in #staff-updates, and neither does the release that carries it. GitHub deletes the branch after a squash merge. Turn auto-merge on only for a pull request you understand. Leave one you do not.

What you run after the merge depends on what the pull request touched. A dev release is [Release to dev](release-to-dev.md). A main release is [Release to main](release-to-main.md).
