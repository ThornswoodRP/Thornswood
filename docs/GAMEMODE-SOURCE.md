# Splitting the gamemode's source

This page is the design for issue #2181: how `game\gamemode.js` can be written
as many source files and data files and still reach the server as the one file
the loader needs. Patrick chose option D on 12 Oct 2026 (on #2181), and the
plan he approved on 31 Oct (rev 64) writes the parts in TypeScript. Stages 1
and 3 are done (1 Nov 2026): the source is `game\gamemode\*.ts`, and
`game\gamemode.js` is built from it byte for byte. The tables went to files of
their own first (#5191), which is stage 2 by another road. "Where it stands"
below says what is left. How the file is laid out is [GAMEMODE.md](GAMEMODE.md).

Re-measured on 17 Oct 2026 at main a395d3ca, engine fork pin 0714e444. The
first measurements (12 Oct, main 55c22556, pin 1afaf2ef) are kept where they
still say something.

## What the file is today

- **Size.** 6,156,578 bytes and 69,961 lines on 17 Oct (6,073,192 and 64,664
  on 12 Oct).
- **Generated against written by hand.** On 12 Oct about 3.9 MB (64% of the
  bytes) were tables that scripts write and nobody edits; GAMEMODE.md
  "Generated tables" lists each one and its script. Most have a json in
  `game\data`. Two do not: `STAFF_SPELLS` and `BENCH_BY_BASE` / `BENCH_ACCESS`
  are written straight into the file by `Build-RecipeTable.ps1` and
  `Build-BenchTable.py`.
- **Sections.** The early part is split by dashed comment headers. After it,
  32 blocks sit between `// ==== thornswood X ====` and
  `// ==== end thornswood X ====`, plus seven `// NAME BEGIN` / `// NAME END`
  regions for the NPC and merchant code. A few hundred lines sit outside any
  well-formed marker (the books block, containers and take limit, and the seats
  block whose banner has three slashes).
- **One module already works this way.** `game\merchant-trading.js`,
  `merchant-settlement.js`, `quest-transactions.js` and `kill-contracts.js` are
  ordinary files that `scripts\dev\Build-MerchantGamemode.js` wraps, with their
  catalogues, into the `// MERCHANT TRADING BUNDLE BEGIN` region; `--check`
  fails when the region is not what the sources make.

Who edits it (12 Oct, 1,053 merged pull requests since 25 Sep): 188 changed
`gamemode.js`, from every lane; 37 of the 46 sections touched were touched from
more than one branch prefix; 0 of the 188 conflicted at merge time
(`git merge-tree` of each pull request's head against main just before it
merged). The measured cost is size and test coupling, not conflicts: 240 files
under `tests` read the file, 128 name a banner and 98 run code from it with
Node's `vm` module.

## What the server needs (the loader)

Read from the fork, `skymp5-server/ts/index.ts` at the pin 0714e444
(unchanged in these respects since 1afaf2ef):

1. **One file.** `gamemodePath` in `server-settings.json` names one file.
   `setupGamemode` resolves it to an absolute path.
2. **It runs from a temporary copy.** `requireTemp` reads the file as text,
   writes it to a new `mkdtemp` folder under a random name, `require`s that copy
   and deletes the folder straight after. So at run time `__filename` and
   `__dirname` name a folder that is already gone.
3. **No relative requires, and no files beside `__dirname`.** `require('./x')`
   and `path.join(__dirname, 'data', ...)` both look in that folder and fail.
   Node's own modules (`fs`, `path`, `crypto`) work.
4. **Nothing else of ours is reloaded.** An absolute `require` of another file
   stays in Node's module cache across a hot reload, so it keeps its old code.
5. **Only the one path is watched.** `chokidar.watch(absoluteGamemodePath)`
   reloads on a change to that file. A change to any other file, a data file
   included, reloads nothing.
6. **Reload only on change.** `requireUncached` compares the text with what it
   last loaded and reloads only when it differs, after `clear()` (`mp.clear()`).
7. **No source map for the gamemode.** source-map-support is installed for
   `skymp5-server.js` only. An error in the gamemode names a line in the
   temporary copy, which is the same line in the file that was loaded.

What our own scripts need today:

- `scripts\deploy\Artifact.ps1` (`New-ThornswoodArtifact`) builds every deploy
  zip from **committed git blobs at HEAD** and nothing else. It has no build
  step: a file that is not in the commit cannot be in the artifact.
- The artifact record lists every file with its sha256, and the server record
  (`thornswood-build.json`) already holds `gamemodeSha256`, checked by the
  restore and record scripts in the same file.
- `gamemode.js:gamemodeId` logs the git **sha1 blob id** of the bytes that
  loaded, and `scripts\vps\Check-LiveGamemode.ps1` compares that with the
  repository.
- The tests read `game\gamemode.js` from the checkout.

## Decision (Patrick, 12 Oct 2026): D

Generated tables move out of the code into data files the gamemode reads at
start; the hand-written code splits into small modules by system; a bundler
joins them into the **one file** the server loads when the **gamemode
artifact** is made (the versioned artifact every deploy already builds and
checks). Git holds **sources and data only**. The server's proof of what runs
is the **artifact hash**. Tests load the built artifact. In stages, each proven
to run the same gamemode.

Real modules loaded with `require` at run time are ruled out by points 2 to 5.
Option A (do nothing) is kept below as the defined fallback.

## The design

### Source tree

```
game\gamemode\
  order.json            the one list of parts, in load order
  00-header.js          the contract comment and 'use strict'
  10-helpers.js         small helpers, logging, gamemodeId, guard
  ...                   one file per dashed section of the early part
  50-<system>.js        one file per `// ==== thornswood X ====` block
  ...
game\data\*.json        every generated table, written only by its Build-* script
```

- **A boundary is an existing section.** The first split takes the banners as
  they are: each dashed section of the early part, each `thornswood X` block
  and each `NAME BEGIN` region becomes one file, named after its banner. No
  code moves between sections while it is being split; regrouping by system is
  later work, one system per pull request, after the split has proved itself.
- **The stray regions get banners first.** The books block, containers and take
  limit, and the three-slash seats banner are given well-formed banners in the
  file itself before anything is split, so every byte belongs to exactly one
  part.
- **One scope, kept.** The parts are joined as text, top to bottom, in
  `order.json` order, into one script with one top-level scope, exactly as the
  file runs today. The bundler wraps nothing and renames nothing. A part may
  use a name declared by an earlier part, as today. Blocks keep publishing their
  interfaces on `globalThis` (`g.__thornswood*`) and keep looking them up when
  called, not at load (GAMEMODE.md "How the blocks find each other"). A later
  stage may wrap a part in its own function once nothing outside it uses its
  top-level names; that is a code change and needs its own issue.
- **The bundler is the join.** `scripts\dev\Build-Gamemode.js` reads
  `order.json`, refuses a part that is missing, listed twice or not listed,
  and writes the parts with one `// @part <file>` line before each. That line
  is the only text it adds. It is not webpack or esbuild: those rewrite the
  code, and then the output no longer matches the sources line for line.

### Data at start

Patrick's D reads tables from data files at start. Point 3 means the gamemode
cannot find them through `__dirname`, and point 5 means changing one does not
reload anything. So:

- The artifact carries `game\data\*.json` beside the built file, laid out as in
  the repository.
- The built file finds them from the server's own settings: the folder of the
  `gamemodePath` the server was started with (read once from
  `server-settings.json` in the server's working folder), never `__dirname`.
  A table that cannot be read stops the load with a log line naming the file;
  there is no inlined fallback once a table has moved, so a missing file cannot
  silently run old data.
- A data change ships the same way as a code change: a new artifact, whose
  built file differs because the bundler writes the sha256 of each data file it
  was built with into a `DATA_FILES` const. So the file text changes, the
  watcher reloads, and the gamemode refuses a data file whose hash is not the
  one it was built with.
- `STAFF_SPELLS` and the bench tables get json of their own first (their
  scripts write the json, then stop writing the file).

### Generated output

- `Build-Gamemode.js` writes `out\gamemode\gamemode.js` (under the folder
  `scripts\release\Where.ps1 Out` names), never into `game\`.
- `Artifact.ps1` gains a gamemode build step: it builds from the commit's own
  blobs into a clean folder and adds the built `gamemode.js` and the data files
  to the zip. The record names the built file's sha256 and every source part
  and data file with theirs, so the artifact says exactly what it was built
  from. Same commit, same bytes, on any machine, as today.
- The server keeps loading one `gamemode.js` from its deploy folder.

## Equivalence

Every stage has to prove it runs the same gamemode as before. In order of
strength:

1. **Byte for byte (stages 1 to 3).** While `game\gamemode.js` is still
   committed, the bundle built from the parts must be the committed file
   exactly, minus only the `// @part` lines. `Build-Gamemode.js --check` does
   that in CI; Launcher builds fails on any difference, and a hand edit to the
   committed file is refused the same way. The git blob id the server logs then
   does not change, which proves no deploy is needed.
2. **Same values (tables out, stage 2).** A table moving from code to a data
   file cannot stay byte for byte. The check loads the old committed file and
   the new build in Node's `vm` with the same stub `mp` the harnesses use, and
   compares each moved table with `assert.deepStrictEqual`. The list of
   handlers registered on `mp`, the `globalThis.__thornswood*` keys and the
   property names declared must also be the same.
3. **Same behaviour.** Every gamemode harness passes against the build, and
   the dev server loads it and logs its start lines with no new error, before
   live.

A stage that cannot show one of these does not merge.

## Debugging

- No source map is read for the gamemode (point 7), so the built file keeps
  being readable code with the original line breaks. An error's line in the
  built file is found by searching backwards for the nearest `// @part` line.
- `Build-Gamemode.js --where <line>` prints the part and the line in it, read
  from the same join.
- Each part keeps its banner, so the citations GAMEMODE.md uses
  (`gamemode.js:name`) still find code by name.
- The artifact record lists every part's sha256, so the log line naming the
  built file is enough to rebuild exactly what ran.

## Stages (each one issue and one pull request)

Each stage leaves the server's file behaving the same. Stages 1 to 3 also leave
`game\gamemode.js` byte for byte as it was, so they need no deploy.

0. **Docs and scaffold (done).** This page; `Build-Gamemode.js --check`
   checking the merchant bundle (#2530).
1. **Banners and join.** Fix the stray banners; add `order.json` and a
   `Build-Gamemode.js` that cuts the committed file into parts on a scratch
   folder and joins them back, with `--check` proving the round trip. Nothing
   is moved in git yet.
2. **Tables out.** One table family per pull request: its `Build-*` script
   writes only the json; the gamemode reads it at start as above; equivalence
   by value (check 2).
3. **Parts into git.** The parts move into `game\gamemode\`; the committed
   `gamemode.js` becomes the build output, checked byte for byte (check 1).
4. **Tests on the build.** The harnesses read the built file (CI builds it once
   and caches it by the source hashes) instead of `game\gamemode.js`.
5. **Artifact build and proof on the artifact hash.** `Artifact.ps1` builds the
   file; `gamemodeId` logs the sha256 of the bytes that loaded, the one
   `thornswood-build.json` already records; `Check-LiveGamemode.ps1` compares
   that with the artifact record. Then git stops holding the joined file.

## Doing nothing, and stopping part way

- **Do nothing (option A).** Keep one committed file and today's tools. It is a
  supported state: the loader, the deploys, the blob id proof and every test
  already work with it. What it costs: the file keeps growing (2.7 times in 17
  days to 12 Oct) and GAMEMODE.md keeps falling behind. If D is dropped, the
  only follow-up is keeping GAMEMODE.md's map and size line current.
- **Stopping after any stage is safe.** After stage 1, 3 or 4 the committed file
  is still what the server runs. After a stage 2 pull request, that one table
  is read from its json and the rest stay inlined; both kinds work side by
  side.
- **Rollback.** Up to stage 4, reverting the pull request is the rollback and
  needs no special deploy. After stage 5, the joined file is no longer in git:
  rolling back means building the last good commit's artifact again, which the
  artifact record makes exact, and putting it back with the usual gamemode
  put-back. Before stage 5 merges, a run of that put-back from a built
  artifact is part of its proof.

## Where it stands (1 Nov 2026)

Stages 1 and 3 went in together, with the parts written as TypeScript, after
the tables left the file for `game\gamemode-tables` (#5191):

- **The cut.** The committed file was cut once at its banners: each dashed
  section of the early part, each `// ==== thornswood X ====` block and each
  `// NAME BEGIN` region starts a part, and a part runs to the next one, so
  every byte is in exactly one part (the lines after an end marker stay with
  the block above them). The parts are listed in `game\gamemode\order.json`.
  Joined as they were cut, they were the committed file byte for byte, and
  each one parsed as TypeScript and stripped to itself. The only change to
  the built file is the header comment that says it is built.
- **The build.** `scripts\dev\gamemode-source.js` strips each part with
  Node's `module.stripTypeScriptTypes` in strip mode (types become spaces, so
  each line keeps its number; no source map is needed) and joins them with
  nothing added. Node prints an ExperimentalWarning for it on 22 and 24; the
  strip itself is what Node runs `.ts` files with. `Build-Gamemode.js` writes
  `game\gamemode.js`, `--check` fails when the committed file is not what the
  parts build, and `--where <line>` names the part. The built file stays
  committed, so the deploys, the blob id proof and the tests are unchanged.
- **The builders.** A builder that still writes into the code (the bundles,
  the staff data, the NPC population data) edits the joined source (each part
  after a `// @part <file>` line) through `gamemode-source.js`, or
  `gamemode_source.py`, which calls `Build-Gamemode.js --read` and `--write`.
  Writing it back refuses a joined source that renames, drops, adds or breaks
  a part, writes only the parts that changed and builds the file. A builder
  given a plain file edits that file as before; `tests\gamemode-scratch.js`
  gives a harness a source folder of its own instead.
- **The record.** `tests\test-2181-gamemode-source.js` holds all of this.

Left, each its own issue: type checking the parts with `tsc` (#5346; no
types are written until it runs), the tables built and not committed
(#5191), stages 4 and 5 (#5348: tests on the build, the artifact builds the
file and git stops holding it), and regrouping parts by system once nothing
outside a part uses its names.
