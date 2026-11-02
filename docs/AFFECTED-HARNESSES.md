# Affected harnesses on pull requests (#3114): design and measurements

**In use again since #5183 (1 Nov 2026), traced on GitHub's runner.** No
build runs on the box since #5119, so from 31 Oct no main build was traced
and every pull request ran the whole gate. Now `.github/workflows/gate-map.yml`
traces the whole gate every night on GitHub's hosted Windows runner (its job
runs as an administrator, so the same ETW session starts there, through
`scripts/dev/Trace-Gate-Here.ps1`) and keeps the map as a workflow artifact.
build.yml's job "Pick the gate harnesses" (`Run-Gate.ps1 -Pick`) fetches it
with `Gate-Map.ps1 -Fetch`, picks what a pull request's change can reach,
and splits that over the five shares by measured seconds; each share runs
its part (`Run-Gate.ps1 -Shard -Of`). `scripts/dev/Check-Change.ps1` makes
the same pick before a push. The trace runs on windows-2022: on Windows
Server 2025 node's stat calls left no event in the trace (gate-map.yml says
what was measured). What follows is how the map worked while the box built;
the map, the pick and why a map is enough are unchanged.

The study below was measured in a 4-core Linux container on 22 Oct 2026,
with a Linux tracer. On 22 Oct Patrick chose option C on his page
(q-3114-affected): trace the gate where it really runs, on the VPS, and
build the affected-only gate from that trace, with the whole gate still
running on main and nightly. The parts are:

- `scripts/dev/Trace-HarnessReads.js`, the Linux tracer the study used.
- `scripts/dev/Trace-Gate-Box.ps1`, the Windows tracer. It starts an ETW
  session, the gate runs under it, and it reads each harness's opens from
  the trace against `Nightly-Harnesses.ps1 -StartLog`. Since #5183
  `.github/workflows/gate-map.yml` runs it on GitHub's hosted runner through
  `scripts/dev/Trace-Gate-Here.ps1`; `scripts/dev/Trace-Gate.ps1` keeps only
  the box's half (its self-test and the trace task), and the ops
  repository's `trace-gate.yml`, which ran the gate traced on a box build
  runner, is gone (#5270). Its self-test passed
  on the box at 9:40 PM on 21 Oct (Patrick's time) with no events lost.
- `scripts/dev/Affected-Harnesses.js`, which builds the map from either
  tracer and picks the harnesses.
- `tests/test-3114-affected-harnesses.js` and `tests/test-3114-trace-gate.ps1`.

Section 10 is how it is wired, after Patrick chose option A on
q-3114-map-refresh at 7:49 AM on 22 Oct: every main build's gate is traced
on the box, and a pull request built there runs only what its change can
reach. Sections 1 to 9 are the Linux study as it was measured. A Windows
map drops the Linux-only rules in section 5 and keeps the git rule and the
rule for a harness that did not pass. It adds two more: a harness runs when
anything outside the harnesses opened the checkout while it ran, and when a
file changes in place in a folder it listed, because a Windows listing
gives every entry's size and times.

## The answer first

1. **It is provably safe only on Linux.** strace sees every path a harness
   touches. So if a pull request changes none of those paths, the Linux run
   cannot change. The gate runs on Windows, though, and nothing here can
   trace a Windows run. The step from Linux to Windows (premise P4) is
   backed by rules, not proved.
2. **Only a quarter of the gate gets a map.** Under those rules, 338 of the
   556 gate harnesses get a map, but they use only 25% of the harness
   processor time. The other 218 (75% of the time) run on every pull
   request. They skip on Linux, branch on the system, look for Windows
   paths or ask git about the tree.
3. **The saving is about 18%.** Over the last 40 merges, with a fresh map
   for every main commit, a pull request would have run 320 of 556
   harnesses on average. That is 82% of today's harness time (median 76%),
   so it saves about 18% on average and 24% at the median. Against the 765 s
   the gate took on 21 Oct, that is about 2.3 minutes. On its own, this does
   not bring a pull request build to 10 to 15 minutes.
4. **The big gain needs a trace on Windows.** If every harness except the 17
   that ask git had a map, the same merges would cost 43% on average (median
   30%). This is an estimate, since it uses their Linux reads.
   - Process Monitor is not available.
   - ETW (the Microsoft-Windows-Kernel-File provider, through logman or wpr) can do it. It needs an administrator.
   - The hosted windows-latest runner has an administrator. The VPS runner account does not.
   - The ETW route has not been measured yet (section 9).
5. **Recommendation: do not wire the Linux-only version yet.** First measure
   ETW on the hosted runner once.

## 1. What is proved, and on what premises

A harness's result can differ between two trees only through what its
system calls return. The tracer records, in every process and thread the
harness starts:

- every call that names a path: open, stat, access, readlink, execve, chdir, rename and the rest of strace's `%file` class;
- every folder listing (`getdents64`);
- failed lookups as well as successful ones.

Let M be the set of paths under the checkout that the harness touched, and L
the set of folders it listed.

Take a second tree in which no path in M was added, removed or changed, and
no folder in L gained or lost an entry. Run the harness there. Its first
call returns what it returned before, so it makes the same second call, and
so on by induction until it exits the same way.

Nothing in that argument needs the base commit; any two trees work. So the
map of an older commit is never wrong, only wider (section 3).

That proves the result for the run that was traced. The proof rests on five
premises:

| Premise | What holds it |
|---|---|
| P1. Every file access is a system call strace sees | `strace -f --seccomp-bpf` follows every process and thread. Every io_uring_setup is refused (`-e inject=io_uring_setup:error=ENOSYS`). Node 22 sets up rings here (measured: 3 per run) and falls back to plain calls when refused. A run that still gets a ring is marked untrusted. mmap and fstat need an open first, and the open is traced. |
| P2. Nothing else a pull request controls reaches the harness | The forcing list (section 4). It covers the gate's workflow, the scripts that list and run harnesses, and `.gitattributes`, which rewrites bytes on a Windows checkout without any blob changing. Environment, clock and network are not in a pull request's hands. |
| P3. The harness touches the same paths every time on the same tree | Measured, with one sample pair. Two traces of the 344 mapped harnesses on one tree touched identical paths. The only differences were names a run made up itself (Python's `.pyc` temp names, mkdtemp folders). The nightly fresh retrace is the check (section 3). |
| P4. The Linux run takes the same path as the Windows run | NOT PROVED. It is held only by the rules in section 5. A harness gets a map only if it passes on Linux, prints no SKIP or NOT RUN, looks for no path written the Windows way and asks git nothing about the tree. In addition, no code file it could have run may test which system it is on or use something only Windows has. A code file counts as runnable only if the harness started that file's program: a .js harness that greps a .ps1 and never starts pwsh runs none of it. The backstop is that main and the nightly run every harness on Windows. |
| P5. A folder's own metadata says nothing beyond that it exists | On NTFS, where the gate runs, a folder has no size and its times come from the checkout. So a stat of a folder tells a harness only that the folder is there. Without this premise, every node harness runs whenever a harness is added, because node stats `tests` to find its script. Section 6 measures both ways. `dirStat: 'listing'` in the prototype is the strict choice. |

## 2. The map: its format and where it lives

There is one JSON file per traced commit. It is 207 KB, or 23 KB gzipped:

```json
{
  "format": 1,
  "commit": "<the commit that was traced>",
  "tracer": "strace on Linux, scripts/dev/Trace-HarnessReads.js",
  "harnesses": {
    "test-1383-injury.js": {
      "seconds": 1.1,
      "reads": [".", "game/data/food.json", "game/gamemode.js", "game/plugins/thornswood-front.js",
                "package.json", "tests", "tests/package.json", "tests/test-1383-injury.js"],
      "lists": []
    },
    "test-2183-availability.ps1": { "always": "can run another way on Windows: tests/Windows.ps1:4 cmd.exe", "seconds": 14.9 }
  }
}
```

- `reads` is every path the harness opened, looked at, failed to find, wrote or ran, relative to the checkout.
- `lists` is the folders whose entries it read.
- `always` means the harness has no map it can be held to, and says why.

A mapped harness has a median of 9 paths and at most 143. The raw trace for
each harness, `<harness>.json`, keeps each path's kinds, the programs it
started and any path written the Windows way. Those raw traces are what
`build` reads.

**The map does not live in the repository.** A committed map would have to
change in every pull request that changes what a harness reads. That brings
back the shared-line conflicts #3009 removed. Checking it would also need a
Linux trace inside the pull request.

Instead, the map is an Actions artifact, `harness-reads-<commit>`. A Linux
job makes one on every push to main, and it is kept for 7 days. A pull
request build takes the newest map whose commit it can fetch, and measures
its change from that commit. Section 1 explains why any commit is sound.
With no map, the build runs the whole gate.

## 3. How the map is made and kept true

**Made.** `node scripts/dev/Trace-HarnessReads.js --out <dir>` traces each
harness:

- It runs each harness under strace in a fresh copy of a clean clone of HEAD, so what one writes is never what another reads.
- It starts each one the way Nightly-Harnesses.ps1 does, from the checkout's root.
- It sets GITHUB_ACTIONS, CI, RUNNER_TEMP and TEMP the way the build does.
- It runs the RUNS ALONE harnesses last, alone.

Then `node scripts/dev/Affected-Harnesses.js build <dir> map.json` sorts each
harness into mapped or always. The whole gate took 16.5 minutes of wall time
here, 5 harnesses at a time, for 2,954 harness-seconds under strace.

**Kept true on every merge.** On each push to main, a Linux job retraces
only these harnesses:

- the harnesses the merge's change hits under the old map;
- any harness that is new or changed.

Every other harness touches exactly what it touched before, by the argument
in section 1. So its old entry is still its true map, and the incremental
step is sound.

Over the 40 merges, that retrace covered 0 to 44 mapped harnesses, and about
205 when `game/gamemode.js` changed. An always harness is not retraced until
something it reads changes.

**Why a map per merge.** Main took 38 merges on 21 Oct, and an older map
loses most of the saving:

| Map age | Share of today's time | Whole gate runs |
|---|---|---|
| 5 merges old | 95% | 27 of 40 merges |
| 10 merges old | 99.7% | 39 of 40 merges |

A nightly map alone would give nothing.

**The check that fails when a harness reads a file its map lacks.** Each
night the Linux job traces the whole gate from scratch on main and compares
the result with the map it built merge by merge. Any path in the fresh trace
that the stored map lacks is a miss. The paths a run created itself are left
out of the comparison. On a miss, the job:

1. fails;
2. opens an issue naming the harness and the path;
3. replaces the stored map with the fresh one.

This catches reads that happen only on some runs (P3) and bugs in the
incremental step. It cannot see Windows. The Windows version would be an ETW
trace of the nightly's own run (section 9). Until one exists, P4 is held
only by the always rules and by main and the nightly running everything.

**Main and the tested-tree note.** Since #3182, main's build skips a tree
that a green pull request build already passed. If a partial pull request
build left that note, main would skip the full gate, and main would no longer
run everything. So a partial build must keep no note, or one that
Tested-Tree.js does not accept. Since #3399 the note is a `TESTED-TREE <tree>`
line in the build's log, not an artifact, and a build that did not run the
whole gate does not print it. Since #3874 only a build on GitHub's hosted
runner prints it. On the VPS a pull request runs the whole gate only when the
map could not serve it, and a main build skipped by the note is not traced,
so the note kept the map stale and every later pull request ran the whole
gate too. Without the note, main builds in full and is traced.

## 4. Forcing rules: a change to any of these runs the whole gate

| Path | Why |
|---|---|
| The gate's part of `.github/workflows/build.yml` and `build-pr.yml` | Their top-level permissions, env and defaults, and the two build jobs (less their name, needs and if) through the gate step hold the gate's steps, environment and checkout. Since #3874 the traced tree carries a hash of that part (`#gate-shape`, written by `Affected-Harnesses.js tree`), and only a change to it, or a tree with no hash to compare, forces the whole gate. A change elsewhere in those two files (the triggers, the concurrency, the tested jobs, the steps after the gate) makes them ordinary files, as is every other workflow: a harness that reads one has it in its map, as test-1306-pr-workflow.js does with build.yml. Adding or removing either file still forces it. |
| `scripts/dev/Run-Gate.ps1`, `Nightly-Harnesses.ps1`, `Gate-Harnesses.ps1`, `Affected-Harnesses.js`, `Trace-HarnessReads.js` | They list, choose, run and trace the harnesses. |
| `tests/gate-excluded.txt` | It is the gate list. |
| A code helper in `tests/` (`*.ps1`, `*.js`, `*.py`, `*.c` not named `test-*`) | Belt and braces: a helper is already in the map of every harness that reads it. The rule catches a helper that only Windows loads. Over the 40 merges it cost 1.2 points of time share and two whole gates (#3061 `fork-git.js`, #3053 `bot-python.js`). `tests/README.md` is not code. |
| `records/build-runners.json` | The gate step reads it for its share of the cores. |
| `.gitattributes` | It changes the bytes of every file a Windows checkout writes, without any blob changing. |
| `.gitmodules` | It sets the submodules a checkout has. |
| Any `git diff` status other than A, M or D (a type change, copy or unmerged path) | Symlinks and submodule swaps are not modeled. Renames are counted as a delete plus an add. |
| No map, or a change not measured from the map's own commit | There is nothing to select against. |

Additions, removals and renames do not force the whole gate. They are
handled exactly:

- **Added paths.** An added path hits every harness that looked for it and failed to find it. It also hits every harness that listed the folder gaining the entry. For a new folder, that is the folder holding its topmost new level.
- **Names** are compared without regard to case, the way Windows reads them.
- **Files in no map** can be ignored. A harness can find a file only by its name or by listing a folder, and both are in its map.
- **Whole-tree listings.** A harness that walks a tree has every folder it listed in `lists`, so any add or remove under that tree hits it.
- **git.** A harness that asks git always runs (section 5).

## 5. Who always runs, and why (measured, 556 gate harnesses)

| Count | Share of harness seconds | Reason |
|---|---|---|
| 338 | 25.5% | mapped |
| 98 | 23.3% | Prints SKIP or NOT RUN on Linux, so part of it was never traced. Mostly these are the Windows PowerShell 5.1 parts. |
| 36 | 26.4% | The harness itself tests the system (`$OnWindows`, `process.platform`, `$env:LOCALAPPDATA`, ...). |
| 46 | 19.6% | A code file it could have run tests the system: Deploy-Gamemode.ps1 (`$env:LOCALAPPDATA`), Artifact.ps1 (`OSVersion`), Build-Engine.ps1 (`cmd.exe`), Install-ThornswoodServer.ps1 (`PSVersionTable`), tests/Windows.ps1. |
| 17 | 4.4% | Asks git about the tree: `.git/index` through ls-files, or objects. The answer depends on every tracked path or on the commit's id, which differs on every pull request. test-1692-release-root.ps1 also fails on Linux. |
| 21 | 0.9% | Looks for a path written the Windows way, from any folder. Examples: `C:\Thornswood\Game\Data\Skyrim.esm`, `C:/Thornswood-Server/data/online.json` (the site harnesses), `C:\Thornswood-Server\server.log`. On the box such a path can be real. |

Two harnesses failed on Linux in the first full run and passed in the second:
test-2863-board-status.ps1 and test-2947-chargen-box-light.ps1.

The shares are Linux seconds under strace. On Windows the SKIP harnesses also
run the parts they skip here, so on Windows the always group's share is
probably above 75%.

## 6. Measured savings over the last 40 merges

The window is the 40 first-parent merges on origin/main, from e795957d
(21 Oct 11:49 UTC) to 77c4ca1f (22 Oct 02:37 UTC).

For each squash commit, its change against its first parent
(`git diff --name-status --no-renames`) went through `select`. The selection
used the map traced at 2135559d and the current gate list. That approximates
having a map for each merge's own base. Time share is the selected
harnesses' traced seconds over all 2,954 s.

| Configuration | Mean harnesses run | Mean time share | Median time share | Whole gate |
|---|---|---|---|---|
| **Recommended**: a map per merge, P5 (folder existence), helper forcing | 320 of 556 | **82.0%** | **75.6%** | 9 of 40 |
| Same, but strict folder metadata (no P5) | 396 | 87.0% | 95.2% | 9 |
| Same, but no helper forcing | 303 | 80.8% | 75.2% | 7 |
| Map 5 merges old | 499 | 95.0% | 100% | 27 |
| Map 10 merges old | 553 | 99.7% | 100% | 39 |
| Estimate: every harness mapped except the 17 git ones (what a Windows trace could give, using their Linux reads) | 194 | 42.9% | 29.6% | 9 |

What drives these numbers:

- **The always harnesses set the floor.** The 218 of them are 75% of the time on their own. 24 of the 40 merges ran only those, or nearly only those (218 to 232 harnesses).
- **`game/gamemode.js` reaches most game harnesses.** The four merges that touched it (#3096, #3095, #3088, #3040) ran 421 to 431 harnesses, because most game harnesses read that one large file.
- **The 9 whole gates:** build-pr.yml (five), `.gitattributes` (#3086), `gate-excluded.txt` (#3073), and the two test helpers.
- **Shared release helpers are read widely.** Each is read by 40 to 50 harnesses: Read-JsonFile.ps1, RecordShape.ps1, Vps.ps1, Ship-Rules.ps1, Where.ps1.

## 7. Risks

1. **P4 is not proved.** A harness with no explicit test of the system can
   still run differently on Windows. Causes include path separators, a
   case-insensitive file system, CRLF checkouts, `shell: true` going through
   cmd.exe, .NET APIs that differ, and variables set only on the box. The
   token list (`PLATFORM` in Affected-Harnesses.js) is a heuristic, and a
   miss there lets a Windows-only read slip past a pull request. Main and
   the nightly would catch it after the merge, not before. Only a Windows
   trace closes this.
2. **Reads that happen on some runs only (P3).** One pair of runs agreed
   exactly, but that is one sample. A harness that reads a file only on a
   race, retry or timeout path can lack it in its map. The nightly retrace
   catches this eventually, not at once.
3. **What earlier steps in the job leave behind.** The trace starts from a
   clean checkout, but in the build 12 steps run before the gate: the
   secrets scan, the parses, the writing rules, the engine and record
   checks, and three python harnesses. Whether those steps write into the
   checkout was not traced. Python does write `__pycache__`, and so do 10
   gate harnesses, into `scripts/dev`, `scripts/mods` and `bot`.
   - Python checks a `.pyc` against its source, and the source is in the map, so the `.pyc` files cannot change a result.
   - The real fix: the trace job runs the same steps first, under strace, and the map build fails on any write they make into the checkout.
   - `PYTHONDONTWRITEBYTECODE=1` for the gate would end the `.pyc` question.
4. **Harnesses side by side.** In the gate, harnesses share a checkout and a
   TEMP, so a harness can read what another one wrote, outside its own map.
   Apart from `.pyc` files, three harnesses write into the checkout and leave
   or make entries there:
   - test-say-staff.ps1 writes `bot/roots.pem` (untracked) and leaves it.
   - test-release-parity.ps1 writes `unfinished.txt` at the root.
   - test-merchant-runtime-evidence.js makes `.merchant-evidence-*` folders at the root.

   Ten mapped harnesses list `.`, `bot`, `scripts/dev` or `scripts/mods`:
   Python's import system lists the folders on its path. So in the gate they
   can see an entry another harness left. With these files that cannot
   change a result, because Python looks only for module names, but it is
   outside the proof. The three writes are faults of their own, and a
   harness should write under TEMP. The map build should fail on any harness
   write into the checkout.
5. **The machinery.** Wiring this in needs:
   - a Linux job on every push to main (strace from Ubuntu's apt; pwsh and node are on ubuntu-latest);
   - an artifact lookup in the pull request build (`actions: read`, as Tested-Tree.js has);
   - a fetch of the map's commit, since the checkout is depth 1 today;
   - the tested-tree change from section 3.

   Each one is a new place where a fault falls back to the whole gate. That
   fallback is safe, but it costs the saving.
6. **Paths strace cannot tie to the checkout.** A file reached through a
   path outside the checkout that points back into it (a symlink in TEMP,
   `/proc/self/cwd`) would be missed. None was seen.
7. **The tracer had bugs of its own while this was measured.** All are
   fixed, and the test covers each one:
   - io_uring was not refused.
   - `ok` was used before it was set.
   - When a child process's first calls came before its parent's clone returned, the child was given the wrong folder.
   - A Windows path was looked for only under the checkout.

   The parent and child ordering bug resolved git's relative opens against
   the wrong folder. The numbers above come from the corrected runs, and the
   first run is not used. A tracer is code, and its own test is what it
   leans on.

## 8. Wiring, as first sketched for the Linux map (superseded by section 10)

1. Add a workflow `harness-reads.yml` that runs on push to main, on
   ubuntu-latest. It fetches the previous map, retraces what the merge hits,
   builds the map and uploads `harness-reads-<sha>`. A nightly schedule in
   the same file does the fresh retrace and the comparison.
2. In build.yml's "Run the gate harnesses", on `pull_request` only:
   1. Find the newest map artifact.
   2. Fetch its commit.
   3. Run `node scripts/dev/Affected-Harnesses.js select map.json HEAD gate.txt`.
   4. Pass the list it prints to Nightly-Harnesses.ps1 `-Only`.
   5. Print why each harness runs, and the count skipped.

   If anything fails, run the whole gate.
3. Stop partial pull request builds from writing a note Tested-Tree.js
   accepts.
4. Regenerate build-pr.yml with Build-PrWorkflow.js.

## 9. What waits on a decision or a measurement

1. **Measure a Windows trace on the hosted runner.** Run the gate once on
   windows-latest under `logman` or `wpr` with Microsoft-Windows-Kernel-File,
   export the events with `tracerpt`, and compare them with the Linux maps.
   - This is what would turn P4 from a rule into a check, and it is what could take the gate toward 43%.
   - It costs hosted Windows minutes, and #2393 says that budget is not being raised.
   - Whether the VPS runner account could do it as a member of Performance Log Users, without being an administrator, is not known. That has to be tried on the box.
2. **Wire the Linux-only version now, or wait for item 1.** The
   recommendation is to wait. Linux-only saves about 2.3 minutes on an
   average pull request, and it adds a Linux job on every merge plus the new
   failure points in risk 5. Item 1 decides whether the bigger saving is real.

## 10. How it is wired (option A, 22 Oct 2026)

The gate trace on the box (run 39753666522, 3:12 AM on 22 Oct) mapped 548
of 570 gate harnesses. Replayed over the last 40 merges, a fresh map ran
32.7% of the gate's harness time; one 2 merges old 48%, 3 old 57%, 5 old
71%, 10 old 89%. So the map is refreshed on every merge to main:

1. **Main builds are traced.** build.yml's gate step is
   `scripts/dev/Run-Gate.ps1`. On a push to main on a box runner it asks the
   trace task, `scripts/dev/Trace-Gate-Task.ps1`, through the runner's own
   `<runner>\trace` folder, and runs the whole gate with
   `Nightly-Harnesses.ps1 -StartLog` while the task traces it. The task runs
   as SYSTEM, the only way to start the session without making the runner
   account an administrator. It takes one trace at a time and refuses any
   ask it cannot check: a run asked for before, a checkout outside that
   runner's `_work`, a link, a process that is not running. It drops a trace
   whose build was cancelled, ran past 45 minutes, or lost an event. A main
   build never waits on it: with no answer in a minute it runs untraced.
2. **The read is done at below normal priority** in a process of its own,
   about ten minutes of one core, the newest trace first. It keeps only
   paths inside the checkout and writes the traces and the commit's tree
   listing to every build runner's `<runner>\gate-map`. That folder is
   owned by Administrators and the runner accounts may only read it, so no
   job can change the map another pull request is held to. The trace itself
   stays in `C:\Thornswood-Trace` until it is read, then it is deleted.
3. **A pull request on a box runner runs what its change can reach.**
   `Affected-Harnesses.js pick` builds the map from the newest traces and
   measures the change from the traced tree's listing to the pull request's
   merge commit. Nothing is fetched. It prints why each chosen harness runs.
   A gate with no map of its own, on One's runners or GitHub's hosted
   runner, uses the map main's build handed on (item 7). It runs the whole
   gate when it has neither, when the map does not read, or when the change
   touches a forcing rule (section 4, now with `Run-Gate.ps1` and
   `Gate-Map.ps1`).
4. **Only a whole gate on GitHub's hosted runner keeps the note.**
   Run-Gate.ps1 writes `whole=true` only when every gate harness ran, and
   build.yml writes the `TESTED-TREE <tree>` note in its log (#3182, #3399)
   only then, and only on GitHub's hosted runner (#3874). So after any pull
   request built on the VPS, main builds in full, and that build is the one
   traced. On main a newer push waits for the build in progress instead of
   cancelling it (#3874), so a busy hour still ends in a traced build. Main
   and the nightly run the whole gate every time.
5. **Install.** `.\scripts\dev\Trace-Gate.ps1 -Install` from the shipping
   machine, by somebody with the box's administrator key, runs the self-test
   and installs the task for the runners `records/build-runners.json` lists.
   Run it again when that list changes. `-Status` shows the task, the map
   each runner has and the end of its log. `-Uninstall` takes it all off,
   and pull requests run the whole gate again.
6. **What it does not cover.** A main build on GitHub's hosted runner is not
   traced, so once hosted minutes are back (about 1 Nov) the map refreshes
   only when main builds on the box. A pull request built on the hosted
   runner picks from the last map a box build handed on (item 7), so the
   merges since count as part of its change.
7. **Off the box (#4009).** The map is only in the box's build runners'
   folders, so a pull request built on One's runners (#3860) or GitHub's
   ran the whole gate: #3861's own build on thornswood-pr-one took about 13
   minutes for it (run 40424800152). Main's push build on the box now runs
   `scripts/dev/Gate-Map.ps1 -Hand` after its gate: it builds the map from
   that runner's newest traces and prints it, gzipped, with the traced tree,
   into the job's log as numbered `GATE-MAP` lines with each part's sha256.
   About 23 KB and 75 KB gzipped. A log, because this repository's artifact
   storage is used up (#3399) and a log costs none. A gate with no map of
   its own runs `Gate-Map.ps1 -Fetch` with the job's token (`actions:
   read`), which reads the newest finished build.yml runs on a push to main
   of this repository, passes over any other run, and writes the first whole
   map it finds in the box's folder shape, the built map in place of the
   traces. `pick` takes either. Run-Gate.ps1 takes the token out of the
   environment before any harness starts. `tests/test-4009-gate-map.ps1`
   holds both halves.

`tests/test-3114-run-gate.ps1` runs Run-Gate.ps1 for real in a scratch
repository for each of those cases, and on Windows runs the task's check of
an ask against real folders, a junction among them.
