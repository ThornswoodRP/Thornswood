# How work moves: the rules and the long form

Part of the [Developer Guide](../../Developer-Guide.md), the index of every page and section.

## How work moves

The short form of the rules. The same decisions, with the dates they were made, are in [How work moves, the long form](#how-work-moves-the-long-form).

### Main, hotfixes, and merging

- main is what ships, and it ships only on Patrick's word for that exact
  build (Patrick, 30 Oct). Nobody else decides that a main release, a
  hotfix or a live server or gamemode deploy goes out: not a developer, a
  lane, a Claude or a Bot, and nobody asks him whether main is ready.
  Whoever he names runs it from a machine that can sign; once the Hermes
  Bots take over, that is Bramble. Until 30 Oct any developer could ship
  main. Ship.ps1 refuses
  a main release that is not on main, is behind or ahead of origin, has
  anything uncommitted, has a file under `scripts` or another folder a release is built from that git does not know, or
  asks for a new number with `-Version`. A main Ship writes nothing to the
  repository: the launcher's number comes from the build, the time its
  sources last changed on main (`scripts\release\LauncherVersion.ps1`, #5179),
  and Ship builds only what is already on GitHub, so every other machine can
  `git pull` exactly what shipped. Corrected 24 Sep: this bullet
  used to say a main Ship committed and pushed the source after the release,
  which stopped being true on 22 Sep (f917dd8).
- The one live release that does not come off main is a hotfix, decided by
  Patrick on 24 Sep for a tester who could not get in while a day of dev work
  sat on main: "the only thing that should be going to main now is the fix
  for him". A branch named `hotfix/...` starts from the commit the live
  release was built from, carries only the fix, is pushed, and Ship runs from
  a checkout of it; every other gate
  above still applies, and Ship refuses a hotfix branch that is not on
  GitHub. A hotfix leaves the dev feed alone. The fix also goes to main
  through its own pull request, or the next main release loses it. 1.1.93 was
  the first, built from 55ac6ef. A hotfix goes out on Patrick's word, the same as any live release, once
  the fix's Build check result is green. Once it is live, its commit is kept as a tag, `live-<version>`,
  and the branch is deleted, so no hotfix branch sits on GitHub: the next
  hotfix starts with `git checkout -b hotfix/<name> live-<version>` from the
  tag of the release that is live. None is kept today: `live-1.1.94` (25 Sep)
  shared no history with main and was deleted on 31 Oct (#4177).
- Nobody pushes to main any more, Patrick included. Everything goes through a
  pull request. This replaces the 18 Sep decision that his own work went
  straight to main. GitHub refuses a push to main from write access. It does
  not refuse one from the admin account: with `enforce_admins` off, GitHub
  holds an admin to none of main's rules, so for the admin this is a team rule
  kept by hand.
- What branch protection on main actually enforces, since 25 Sep:
  `enforce_admins` is **off**, there is no required check, required
  approving reviews is **0**, and the code owner review is **off**.
  Patrick, that day: "we don't need the required check/reviewer at all anymore for anyone as long as we give verbal agreement and the VPS check goes through". So the rule is ours, not a setting:
  anybody on the team merges their own pull request once `Build check result`
  (the build check, on the VPS) is green and they are confident in the
  change. A merge gets no line in #staff-updates (Patrick, 22 Oct: that
  channel is only for what staff must act on). Nobody waits for Patrick. What GitHub does hold write
  access to on main: a change comes through a pull request (with no approval
  needed), and a force push or deleting main is refused. None of that applies
  to the admin account while `enforce_admins` is off.
  Branch protection still enforces no build check, but main's ruleset does:
  on 25 Sep 35 pull requests were merged with their VPS build red and 18 with
  no build at all, and main went red with them, so since 31 Oct (#3683,
  `records/github-repo-settings.json`) the ruleset named main requires
  `Build check result` and has an empty bypass list. `Test tasks in the
  pull request` and `Release note` are required beside it, on the pull
  request and again in the merge queue: on 1 Nov the queue landed a pull
  request whose Release note check was red, and every merge release after it
  stopped at its notes. A ruleset holds the
  admin account too, whatever `enforce_admins` says, so GitHub refuses a
  merge past red for everybody. And since 31 Oct auto-merge is on (#5182,
  Patrick's A), and since 2 Nov nobody turns it on by hand:
  `.github/workflows/auto-merge.yml` (`scripts/ops/Auto-Merge.js`) puts
  every open pull request on it after each of its builds, and GitHub puts it
  in the merge queue the moment `Build check result` is green, so nobody
  waits to press merge (Patrick, 2 Nov: "every PR goes on auto-merge when it
  opens, dropped PRs go back in the queue"). A draft, a fork's, Djinn's and
  one that conflicts with main are left off. So is one labelled
  `outside work`, which carries the work of somebody outside the team: it
  merges only when Patrick says so for that person (8 Nov 2026), whoever
  opened the pull request that carries it. One the queue lets go goes back
  on after the next push to main when the queue was cleared, rolled back or
  timed out; let go for a failed check or a conflict, it is its owner's, and
  the owner's push with the fix puts it back on. The
  queue (#5296, the redesign's part 5) checks it once more on the newest
  main, with the whole gate, and squash-merges it. Opening it ready
  for review is the moment you say you are confident in the change. The last classic
  setting, "require branches to be up to date" with no check listed, was
  removed on 27 Sep at Patrick's word ("we use the VPS's build checker").
  What changed on 23 Sep, since 22 Sep: the review requirement was one
  approving review, which Patrick could not give himself and had to override
  with `--admin` on every one of his own pull requests, and it is now zero.
  The code owner review on `.github/CODEOWNERS` is off. And `enforce_admins`,
  which had to stay off while `Ship.ps1` pushed its own version commit
  straight to main, was turned on that day, since Ship writes nothing to the
  repository now: the launcher's number is worked out from git, never
  committed (#5179). It was off again by 25 Sep and is
  off today, which is why the admin account is not held to main's rules.
  Check which it is rather than assuming, because this paragraph was wrong
  for a day before anybody looked:
  `gh api repos/ThornswoodRP/Thornswood/branches/main/protection`
### Branch names

- Everybody's work goes on a branch named for whoever did it:
  `git checkout -b <name>/what-it-is` (your name, then a slash, and
  claude/ for a Claude's). Small commits, plain messages. Push the branch and
  open a pull request, standing on the branch, not on main:
  `git checkout <name>/what-it-is; git push -u origin <name>/what-it-is; gh pr create --fill`.
  It is merged into main from GitHub, never pushed over main.
  The branches opened before 17 Sep use a `gavin/` prefix; they are Djinn's
  and were left alone rather than renamed under open pull requests.
- One fix per commit, on a branch as much as anywhere: a commit that changes
  eight things cannot be reverted when one of them is wrong.
- `git pull` before starting anything. If a pull conflicts, resolve it on
  your branch (`git fetch`, `git rebase origin/main`), never on main. If a
  push is rejected, pull, do not force.
### Dev first, notes, and open branches

- Decided by Patrick on 23 Sep: **everything goes to the dev build first.**
  His words: "start puttin these on the dev build and not the main build
  launcher unless it's a security issue or can make the game untestable,
  everything else even small changes go to the dev build launcher for
  pretesting". Size is not a reason to skip it. A main Ship is for a
  security fix or for something that leaves the game untestable, and he
  says which.
- The dev channel (`.\scripts\release\Ship.ps1 -Channel dev "what changed"`) may be
  run from any branch, from any developer's machine, to try work on the dev server.
  There is one dev feed and the last dev Ship wins, so a Dev says in
  #dev-coordination before taking it; the Lead Dev does not have to. A release
  gets no #staff-updates line (Patrick, 22 Oct). A main Ship leaves the Dev feed and baseline unchanged, apart
  from which dev notes are marked DEV (see Mark the dev notes again).
- Every release note has a title and details, dev included. Patrick, 25 Sep,
  after two dev posts went out as "The scroll glows" and "Dev build: ...":
  they must have details and be as good as the ones before them. The notes
  are what people read in the launcher, on the site and in Discord, so write
  them from the side of the person playing: a title that says what changed
  for them, then one "- " line for each thing they will notice, saying what
  it does and what to do if anything. Ship refuses a title under three words
  or notes with no "- " line. Since 27 Sep it also refuses notes that say
  what only we would understand (scripts\release\Note-Rules.ps1): the word
  the Words section bans, an em dash, an issue or pull request number, "PR", a code file or
  a setting name (WEBVIEW2_LIKE_THIS), a name out of the code (PutInServerOrder,
  camelCase), our own words for how we work (demoting, worktree, squash, CI),
  and the same line twice. On 26 and 27 Sep all of those went out to the
  launcher, the site and Discord. And "The load order moved, so start a new
  character" is added by Publish-Update only when the plugins that are on, or
  their order, really changed; it used to follow any byte of plugins.txt and
  told testers to start over three times in two days. The shape:

  ```
  .\scripts\release\Ship.ps1 -Channel dev "The Downgrade button shows its progress and says why it stopped
  - A bar under the Downgrade button shows how far the downgrade has got: each of the three downloads with its size, then the copy into your game.
  - When the downgrade stops for any reason, the line under the button says why and what to do next.
  - If Windows will not open Steam's links, the launcher asks Steam directly, so Steam's console still opens."
  ```
- One fix per pull request. A branch that changes eight things is eight
  reviews nobody has time for; split it.
- No stray branches, worktrees or pull requests. Decided by Patrick on
  25 Sep, after a count found 70 branches on GitHub, two of them holding
  work that had never been merged and was nearly deleted with the rest:
  "we need to make sure in the docs that we don't leave a bunch of stray
  branches and PRs and fix+merge them everytime or delete if old".
  Widened by Patrick on 5 Oct to everything local as well as on GitHub, in
  the engine fork as well as here: "we need rules ... not to leave stale
  worktrees, branches, or PRs local or on GitHub it's messy work". That day
  a clean pass removed 48 fork branches, 4 branches here, about 30 GB of
  finished worktrees, a spare clone and old build copies in Downloads, and
  found the shared clone on an old branch with an unmerged engine checked out.
  - A branch is deleted once its pull request is merged. GitHub does that
    by itself in both repositories (the setting "Automatically delete head
    branches", on here since 25 Sep and on the fork since 5 Oct); delete it
    by hand if it was not. A pull request closed without merging gets its
    branch deleted the same minute.
  - The same moment, on the machine: `git worktree remove` the branch's
    folder and `git branch -D` the local branch (a squash merge leaves it
    looking unmerged to `-d`). Fork worktrees and fork branches too.
  - No scratch clones, copies of a build, or folders made for one task are
    left behind, and no process started for the work (a build, a load test)
    is left running after it.
  - Two folders, no copies (Patrick, 5 Oct; worktrees and scratch moved
    into the repository on 20 Oct, #2900). On a machine, Thornswood work
    lives in the repository folder: its ignored `local\` and `out\` for what
    is one machine's own, and its ignored `worktrees\<name>` and
    `temp\<task>` for worktrees and scratch, each removed when its work is
    done. On One that folder is `C:\Thornswood-Repo`. The other is the
    shared notes on One (`C:\Thornswood Vault`). The launcher's installs, the main one and
    `<Root>-DevBuild`, are the product and stay. No other top-level folders
    and no scratch files in Downloads. And no copies of what GitHub or the VPS
    already holds: logs, report bundles, builds and backups are read where
    they live and cited by where they are. His words: "I dont need a million
    backups and copies of things that are already on GitHub or the VPs thats
    the whole point of those".
  - Work goes into a pull request the day it is done, never left on a
    pushed branch without one. That is how the two above were lost track of.
  - A pull request held back on purpose (a freeze, a decision it waits on)
    carries the `held` label, with the reason in its body, and the label
    comes off the day it is let go (Patrick, 18 Oct, #1273). The nightly lists
    a held pull request and does not count it; any other pull request open
    more than two days turns the night red. A word in the title is not the
    mark: the nightly reads the label only.
  - At the start of a session, and before anything is shipped, look at what
    is open: `gh pr list --state open` and `git ls-remote --heads origin`.
    Everything there other than main, the current `hotfix/` branch and work
    somebody is doing today gets one of two things: fixed and merged, or,
    when it is old or no longer wanted, its pull request closed with a line
    saying why and its branch deleted. Somebody else's branch is theirs to
    decide on: ask them, and put it on the board if they cannot be asked.
    Check whether its work is already in main before deleting it; a
    squashed merge leaves the branch looking unmerged to git.
  - Before a session ends, the same look in both repositories, locally
    too: `git worktree list`, `git branch`, `gh pr list` and
    `git ls-remote --heads origin`, here and in `engine\skymp` (and
    `gh pr list -R ThornswoodRP/skymp`). Each of yours still there is open
    work with the reason it is open written on its issue, or it goes.
### Signing, the build check, and the six shared files

- Code signing is on since 27 Sep (issue #390, closed): the launcher and the
  setup program are signed through Azure Artifact Signing
  (`records\signing\README.md`). `ExpectedSigner` in `launcher\app\Updater.cs`
  is set, so every launcher from dev 1.1.101.17 on refuses an update that is
  not signed by that certificate. **Only a machine that signs may Ship, dev
  included.** `Ship.ps1` refuses (non-zero exit) when
  `records\signing\signing.json` is missing or disabled, or when the launcher
  is not Authenticode Valid under `ExpectedSigner`; the release workflow signs
  the launcher, which is also the setup program since #4824, on GitHub. A local
  `Build-Launcher` may still print "not signing" and leave an unsigned
  intermediate; that soft skip must not reach the site or the feed. The live main launcher,
  1.1.101, predates signing; the next main Ship is the first signed one.
- Every pull request gets the build check, `.github/workflows/build-pr.yml`,
  and every push to main gets the same steps from
  `.github/workflows/build.yml`. build-pr.yml is generated from build.yml:
  change build.yml, then run `node scripts/dev/Build-PrWorkflow.js`
  (`tests\test-1306-pr-workflow.js` fails while the two differ). It builds
  only; nothing is published. The job "Tree checks", on GitHub's Linux
  runner, scans for
  secrets, parses every PowerShell script and game script, checks the
  writing rules (see Words), the ownership page (`tests\test-ownership.js`,
  issue #752), the names that must stay out, that the engine is one commit and
  the high-risk records, runs the voice service's health harness, checks our
  plugins are clean, that the Python names only what exists (ruff, issue
  #1343), the count of silent catches (#5292) and that the launcher touches
  its window only from the UI thread (`scripts\dev\Check-UiThread.py`). The
  job "Launcher builds", on a Windows runner, publishes the native launcher
  the way every build does (`scripts\release\Build-Launcher.ps1`, red on a
  compile error or a trim or native code warning, issue #4823), checks the
  programs it made for secrets, and builds the ship root tool. The window is
  compiled markup, so a renamed control is a compile error there. A pull request that changes only files under
  `docs`, `site` or `bot` runs it on Linux instead, where it passes with
  one step that says why, because nothing it checks reads those folders
  (`scripts\dev\Launcher-Reach.ps1`, #5292). It is never skipped for that,
  so it has a result of its own on every pull request. Beside them, the job
  "gate" runs
  the gate harnesses (every `test-*.js` and `test-*.ps1` in `tests` or in a
  product's own `tests` folder, such as `launcher\tests`, that
  `tests\gate-excluded.txt` does not name, side by side through
  `scripts\dev\Nightly-Harnesses.ps1`, issues #3009 and #3114) in up to five
  shares on hosted Windows runners at once, `Gate harnesses (1 of 5)` to
  `(5 of 5)`, and the job "gate-linux" runs those that need nothing from
  Windows in up to four shares on Linux, `Gate harnesses on Linux (1 of 4)`
  and on (#5293), so a pull request's checks take under ten minutes. A
  harness goes to Linux only when the nightly trace ran it on both, it passed
  on both, and it skipped nothing on Linux that it ran on Windows; with no
  such record for the map's commit, every harness runs on Windows. First the
  job "Pick the
  gate harnesses" says what each share runs (#5183): on a pull request only
  the harnesses its change can reach, from the map main's nightly trace keeps
  (`.github\workflows\gate-map.yml`), and then the shares' names end in
  ", what the change reaches"; on main the whole gate. It splits them by the
  seconds each took when traced, so the shares end together, and its log
  says why each one runs. A change that reaches no harness on a platform
  starts no runner there. Main runs the whole gate after a pull request that
  ran less.
- The checks are **Tree checks**, **Launcher builds** and the shares of the
  **Gate harnesses** on Windows and on Linux, and on a pull request **Build
  check result** passes only when all of them did, or, for the gate's
  shares, were skipped because the pick said they had nothing to check
  (#3683, #5292, #5293).
  The repository is public since 30 Oct 2026, so hosted minutes are free, and
  nothing builds on the VPS any more: no fallback job and no `BUILD_RUNNER`
  switch (#4983). A push
  to main whose tree a green pull request build already passed stops green at
  "Already tested in its pull request" instead of building again (#3182).
  Red means the branch would stop Ship at the build step; fix that, and merge
  once it is green and you are confident in the change; a merge
  gets no line in #staff-updates. Nothing in GitHub's settings is required. Before you
  push, commit and run `pwsh scripts\dev\Check-Change.ps1`: it runs the
  harnesses your change can reach, picked from the same map the shares use,
  and with `-Body <file>` holds the pull request's test tasks to the bot's
  rules too (#5183). All
  ~410 of them (tests/, bot, and voice), and a look for stray pull requests
  and branches run every night on GitHub's runner (.github/workflows/nightly.yml,
  03:00 Mountain); a failure there opens an issue on the board, "Nightly
  checks failed", and whoever broke it fixes it next. The harnesses run in
  shares, a job each on a runner of its own with 45 minutes of its own
  (`scripts\dev\Nightly-Harnesses.ps1`, #2357); a share that runs out of
  time names the harnesses it did not get to, and the cure is another share. It
  ran on the VPS from 25 Sep, when GitHub's own runners were blocked on
  billing (issue #437), and runs on GitHub's runner since the repository went
  public (#4013, #4983).
- An edit to Shell.cs, Checks.cs, Keep.cs, Hold.cs, Updater.cs or
  Publish-Update.ps1 that blocks others' work gets a line in #dev-coordination first, from a Dev; every machine touches those.

## How work moves, the long form

Several people, several machines, one repo. The short rules are above;
this is the long form.

- **main is what ships, on Patrick's word.** It goes out only when Patrick
  says so for that exact build, run by whoever he names from a machine that
  can sign (Patrick, 30 Oct; until then any developer could). `Ship.ps1`
  refuses a main release that is not on the `main` branch, is behind or
  ahead of `origin/main`, has anything uncommitted, or has a file under
  `scripts` or another folder a release is built from that git does not know. It commits and pushes nothing, so what
  shipped is already on GitHub and every other machine can `git pull` exactly
  that.
- **Every change goes through a pull request, Patrick's included.** Nobody
  pushes to main from any machine. GitHub refuses it from write access; from
  the admin account it does not, so there it is our rule. `git checkout -b
  <name>/what-it-is` (your name, then a slash; a Claude uses `claude/`; older
  branches use `gavin/`), small
  commits with plain messages, `git push -u origin <branch>`, then
  `gh pr create --fill` standing on the branch. Nothing is force pushed.
- **What GitHub enforces on main, and what it does not.** Since 25 Sep:
  `enforce_admins` is off; there is no required check; required approving
  reviews is 0; the code owner review is off. For write access a change
  still has to come through a pull request, and a force push or deleting
  main is refused; with `enforce_admins` off, GitHub holds an admin to none
  of main's rules. The build check,
  `Build check result` in `.github/workflows/build-pr.yml`, runs on every pull
  request on GitHub's runners, and main's ruleset makes it a setting, not only
  a rule of ours:
  every pull request goes on auto-merge by itself (auto-merge.yml), and GitHub
  merges it once `Build check result` is green, which main's ruleset requires
  of everybody (#5182). Open it as a draft while it is not ready. Somebody else on the team reading a pull request first is a habit,
  not a setting. `.github/CODEOWNERS` asks the rest of the team for a review when
  a pull request touches one of the shared files, and blocks nothing while
  the code owner review is off. The settings change without a commit, so
  read them rather than this paragraph:
  `gh api repos/ThornswoodRP/Thornswood/branches/main/protection`
- **One fix per pull request.** A branch that changes eight things is eight
  reviews at once; split it.
- **`git pull` before anything.** A conflicting pull is resolved on your
  branch (`git fetch`, `git rebase origin/main`), never on main. A rejected
  push means pull first; never `--force`.
- **The dev channel is for trying.** `.\scripts\release\Ship.ps1 -Channel dev "..."`
  runs from any branch on any machine and puts that build on the dev
  server. There is one dev feed and the last dev Ship wins, so a Dev says in #dev-coordination before taking it. A main Ship preserves the Dev feed and baseline.
- **Settled design is a proposal first.** Where the game runs from (its own
  folder, see One Skyrim of its own), Keep and Hold for Data\Platform, the
  client built from the fork and recorded, the launcher build (Avalonia on
  .NET 10 with Native AOT and Velopack, #4823), one complete release at a time: changing any of these starts as a few lines in #staff-updates, agreed by the
  team before code. Editing `Shell.cs`, `Checks.cs`, `Keep.cs`, `Hold.cs`,
  `Updater.cs` or `Publish-Update.ps1` in a way that blocks others' work gets a
  line in #dev-coordination from a Dev; every machine touches them.
- **The publisher receives the feed and the baseline from the VPS** at the
  start and asks again before `version.json` is edited: a feed somebody changed
  meanwhile is received again and the release goes on top of it, and a
  baseline another Ship moved stops the release with nothing written. Each send
  replaces the file on the VPS only if it is still the one received
  (`scripts\release\Feed-Store.ps1`), so a refused send means NOT SHIPPED; run
  Ship again.
- **The baseline is per channel on the VPS store.** Every shipping machine
  receives the same published.json, so a Dev Ship from a second machine packs
  the same difference. Pending unfinished-send notes stay per machine under
  LOCALAPPDATA.
- **Keep puts its kept copies back at every Play**, on every machine. Go.ps1,
  which Ship runs to put the plugins and overlays in, makes what it installs
  the kept copy, the way a pack does, so a Ship is never undone by the next
  Play. An edit copied into the game folder by hand is. Since 25 September
  nothing writes `Profile\developer.flag`, which used to let the machine that
  ships keep newer game files instead.
- **What never leaves a machine** in a pack or an installer is one list,
  `scripts\release\Ship-Rules.ps1`, read by `Publish-Update.ps1`: runtime folders, one machine's own files,
  other servers' files, and the SkyMP client's saved sign in
  (`Data\Platform\PluginsNoLoad`). The installer of 16 Sep carried that
  sign in file before the list was shared; the launcher removes that exact
  copy from every install (Leaks.cs), matched by content so nobody's own
  sign in is touched. The dev records of 28 and 29 Sep handed out the
  machine that ships' mod menu settings, window layouts and notes; Leaks.cs
  takes those out of Thornswood's own folder the same way, only while each
  is still the bytes the record handed out, and never out of the Steam copy
  (#1252).
