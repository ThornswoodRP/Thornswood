# Workflows

Every GitHub workflow in `.github/workflows/`: what starts it, what it does
in a line, and what it writes outside its own run. Each file's header says the
why and the rest; this page is the list. Measured at main `82b5241e`
(issue #4184).

`tests/test-4184-workflows-page.ps1` holds this page to the folder: a
workflow with no row here, a row naming a file that is not there, or a row
whose "What starts it" leaves out an event the file's `on:` names, is red.
Adding, removing or retriggering a workflow means changing its row in the
same pull request.

"Writes" means what stays after the run outside its log: issues, labels and
comments, the board, Releases and tags, packages, Deployments, artifacts and
the Actions cache, the Security tab, Nexus, Discord. "Nothing" means a check
whose only result is its own status and log.

## On pull requests and the merge queue

| Workflow | What starts it | What it does | What it writes |
| --- | --- | --- | --- |
| [build-pr.yml](../.github/workflows/build-pr.yml) | `pull_request`, `merge_group`, `workflow_dispatch` | Build check (pull requests): the launcher's native publish and the gate harnesses a change can reach, in Windows and Linux shares. Generated from build.yml by `scripts/dev/Build-PrWorkflow.js`; its "Build check result" is required by main's ruleset. | Its gate reports as artifacts. |
| [pr-body.yml](../.github/workflows/pr-body.yml) | `pull_request` (opened, edited, pushed, reopened, ready), `merge_group`, `workflow_dispatch` | Release note: holds the body's "Release note:" line to the note rules (`tools/ReleaseNotes`). Required. | Nothing. |
| [test-tasks.yml](../.github/workflows/test-tasks.yml) | `pull_request` (opened, edited, pushed, reopened), `merge_group`, `workflow_dispatch` | Test tasks in the pull request: holds every "Test task for #N" block to the bot's post rules (`bot/pr_tasks.py`). Required. | Nothing. |
| [codeql.yml](../.github/workflows/codeql.yml) | `push` (main), `pull_request` (into main), `workflow_dispatch` | CodeQL reads the C#, JavaScript, Python and the workflows for security faults; on main, prunes the overlay databases a newer one replaced. | Code scanning alerts on the Security tab; deletes old CodeQL caches. |
| [pr-events.yml](../.github/workflows/pr-events.yml) | `pull_request` (opened, reopened, edited, closed) | Pull request changed: prints the pull request's number and the issues it named before an edit, for board.yml to read. No token. | Nothing. |
| [deploy-agent.yml](../.github/workflows/deploy-agent.yml) | `pull_request` (agent, Signature.cs, deploy/after, verbs paths), `push` (main, same paths), `workflow_dispatch` | Deploy agent: its tests on Linux and Windows; on main, builds, signs and publishes it. | On main, a Release `agent-v<version>` with the program and its signed manifest. |
| [release-notes.yml](../.github/workflows/release-notes.yml) | `pull_request` (note rules paths), `workflow_dispatch` | Release note rules: the C# rules and the PowerShell copy against the same fixture. | Nothing. |
| [load-test.yml](../.github/workflows/load-test.yml) | `workflow_dispatch`, `pull_request` (load test scripts) | Load test: a server on a hosted runner with more and more network bots, crowded and spread. | Artifacts `load-test-<shape>`. |
| [engine-pin-aside.yml](../.github/workflows/engine-pin-aside.yml) | `pull_request` (closed unmerged, moving `engine/skymp`) | Wakes engine-pin.yml when a pull request it stood aside for closes without merging. | Starts engine-pin.yml. |

## On main

| Workflow | What starts it | What it does | What it writes |
| --- | --- | --- | --- |
| [build.yml](../.github/workflows/build.yml) | `push` (main), `workflow_dispatch` | Build check: the same checks as build-pr.yml on main's tree, skipped when the merge's tree already passed (Tested-Tree.js). | Its gate reports as artifacts. |
| [merge-release.yml](../.github/workflows/merge-release.yml) | `push` (main, the shipped paths), `workflow_dispatch` | Merge release: builds, signs and publishes one Release of every part for the newest merge that changed what ships, and deploys it to Dev (and Site, Discord bot). | A Release `build-1.3.<n>` with attestations, a tag for main's package, main's launcher package on GitHub Packages, Deployments to Dev, Site and Discord bot. |
| [done-on-merge.yml](../.github/workflows/done-on-merge.yml) | `push` (main), `workflow_dispatch` | Done on merge: copies each merged "Test task for #N" onto issue N. | Issue comments. |
| [auto-merge.yml](../.github/workflows/auto-merge.yml) | `workflow_run` (Build check (pull requests)), `push` (main), `workflow_dispatch` | Puts every ready pull request on auto-merge, and back in the queue when it was let go for a reason not its own, with the pin robot's token. | Auto-merge on pull requests. |
| [collection-record.yml](../.github/workflows/collection-record.yml) | `push` (main, `records/collection.json`), `workflow_dispatch` | Collection record: drafts the collection revision the record names on Nexus, holds it to the record and publishes it. | A Nexus collection revision, the rebuild issue, an artifact of the record's files. |
| [gate-map.yml](../.github/workflows/gate-map.yml) | `schedule` (10:30 UTC), `workflow_dispatch`, `push` (main, the gate's own files), `pull_request` (the trace's scripts) | Gate map: traces the whole gate on Windows and runs it on Linux, and keeps which harnesses each file reaches and where each runs. | Artifact `gate-map` (on a pull request, `gate-map-trial`). |
| [engine-pin.yml](../.github/workflows/engine-pin.yml) | `workflow_dispatch`, `push` (main, `engine/skymp`) | Engine pin: moves `engine/skymp` to the fork's newest green head with every record, on the rolling pull request `engine-pin/next`. | Pushes `engine-pin/next`, opens or updates its pull request, starts engine.yml, test-tasks.yml and pr-body.yml. |

## On issues and the board

| Workflow | What starts it | What it does | What it writes |
| --- | --- | --- | --- |
| [board.yml](../.github/workflows/board.yml) | `issues` (opened, reopened, closed, labeled, unlabeled), `workflow_run` (Pull request changed), `workflow_dispatch` | Board from what GitHub knows: puts each card's Status, Order and the issue's type where the issue and its pull requests say (`scripts/ops/Sync-Board.js`). | The organization's board; issue types. |
| [area-label.yml](../.github/workflows/area-label.yml) | `issues` (opened), `workflow_dispatch` | Area label on new issues: one `area:` label from the title, or `area: triage`. | Labels (and makes `area: triage` once). |
| [duplicate-check.yml](../.github/workflows/duplicate-check.yml) | `issues` (opened) | Says on a new issue which open issues it may repeat (`scripts/ops/Find-Duplicate.js`). | An issue comment. |
| [box-step.yml](../.github/workflows/box-step.yml) | `issues` (opened, edited, closed), `schedule` (13:17 UTC), `workflow_dispatch` | Box step: an issue whose Done when is a step on the box closes only on that step's output (`scripts/ops/Box-Step.js`). | The `box step` label; reopens an issue with a comment. |
| [drop-claims.yml](../.github/workflows/drop-claims.yml) | `issues` (closed) | Takes every `claimed:` label off a closed issue. | Labels. |
| [expire-claims.yml](../.github/workflows/expire-claims.yml) | `schedule` (10:15 UTC), `workflow_dispatch` | Takes a claim off an issue with nothing on it for three days, saying why first. | Issue comments and labels. |
| [after-deploy.yml](../.github/workflows/after-deploy.yml) | `deployment_status` | After deploy: files each in-game check a deploy step lists, and says each failed step on its issue (`scripts/release/After-Deploy.js`). | Issues labelled `check: in game`, issue comments. |
| [collection-revision.yml](../.github/workflows/collection-revision.yml) | `schedule` (hourly at :20), `workflow_dispatch` | Holds Nexus's newest collection revision, the record and both feeds to one, and keeps the rebuild issue open while they part. | One issue, opened and closed. |

## On a schedule

| Workflow | What starts it | What it does | What it writes |
| --- | --- | --- | --- |
| [nightly.yml](../.github/workflows/nightly.yml) | `schedule` (09:00 UTC), `workflow_dispatch` | Nightly checks: secrets, parsing, writing rules, every harness in shares, the launcher's publish, stray pull requests and branches, issues not written plain. | The nightly issue, opened, added to and closed; its harness reports as artifacts. |
| [scorecard.yml](../.github/workflows/scorecard.yml) | `schedule` (Monday 10:00 UTC), `workflow_dispatch` | OpenSSF Scorecard's checks of how the repository is kept. | Code scanning alerts on the Security tab. |
| [watch-outside.yml](../.github/workflows/watch-outside.yml) | `schedule` (every five minutes), `workflow_dispatch` | Watch outside: thornswood.net and what is around it, from outside the box (`scripts/vps/Watch-Outside.ps1`). | Messages in #staff-updates; its state in the Actions cache. |

## Started by hand or by another workflow

| Workflow | What starts it | What it does | What it writes |
| --- | --- | --- | --- |
| [promote-main.yml](../.github/workflows/promote-main.yml) | `workflow_dispatch` (a build tag) | Promote to main: holds the tag to a Release dev ran, waits for Patrick's approval on the Main environment, then deploys it to Main. | A Deployment to Main; main's launcher on the Release `main-<build tag>`. |
| [engine.yml](../.github/workflows/engine.yml) | `workflow_dispatch` (a fork commit) | Engine build: takes the fork's attested build of a commit and hands back the records a pin takes, in its log. Started by engine-pin.yml. | Starts engine-pin.yml when it ends. |
| [git-ref.yml](../.github/workflows/git-ref.yml) | `workflow_dispatch` | Tag or branch: makes a release tag, or deletes a branch, a tag or a release draft, for a session whose git cannot write refs (`scripts/ops/Set-Ref.ps1`). | Tags and branches, release drafts; starts release-files.yml. |
| [release-files.yml](../.github/workflows/release-files.yml) | `push` (tags `release/main/*`, `release/dev/*`), `workflow_dispatch` | Release files: puts every file a release tag names on a Release of that tag, each held to its sha256. | A Release on the release tag. |
| [frida-sources.yml](../.github/workflows/frida-sources.yml) | `workflow_dispatch` | Frida sources: the source of what is in frida-gum.lib, on one permanent Release. | That Release. |
| [nexus-run.yml](../.github/workflows/nexus-run.yml) | `workflow_dispatch` (a line from `nexus-verbs.json`) | Nexus run: one Nexus script with the Nexus key, for a session that does not hold it; its output sealed to the session. | Whatever the script writes on Nexus; artifact `nexus-run-sealed`. |
| [harnesses.yml](../.github/workflows/harnesses.yml) | `workflow_dispatch` (harness names, or `gate`) | Run named harnesses on GitHub's Windows runner, the way the nightly does. | Nothing. |
| [board-read.yml](../.github/workflows/board-read.yml) | `workflow_dispatch` | Read the board: every card's Status and Order, handed back in the log (`scripts/ops/Read-Board.ps1`). | Nothing. |
| [clone-report.yml](../.github/workflows/clone-report.yml) | `workflow_dispatch` (a clone report) | Hands One's clone report back through the log (`scripts/dev/Report-Clone.ps1`). | Nothing. |
