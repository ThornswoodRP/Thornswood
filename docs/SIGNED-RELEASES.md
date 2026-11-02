# Signed releases and artifact provenance (issue #2163)

Status: DESIGN AND PILOT, switched over on 22 Oct 2026 (#3312), and the box
job ended with the flip to public (#4013, Patrick's A of 27 Oct 2026).
release.yml builds and signs the launcher on GitHub's hosted Windows runner.
From #3312 until the repository went public, when GitHub refused the job
(no minutes) or it failed, the VPS job built and signed it on runner 3. A
public repository has GitHub's runners free with no minute limit and no box
runner registered to it, so that job went rather than moving to the private
ops repository (section 7, "#4013"). A second GitHub runner checks the
signed draft, and for a release from the feed the engine fork checks the
launcher again on GitHub's runner before it signs the release (section 7,
"#3312"). Ship, the feed and every checksum check stay as they are. Since
#4824 the launcher is also the setup program, so there is no separate
installer to sign or publish. Patrick's answers are in
section 8, "Decisions", and none is pending. Section 9 sets doing nothing
beside the change (Patrick, 15 Oct, #2168 A).

This does not claim reproducible builds. The Framework 4 csc that built the
launcher until 15 Oct stamped a build time and a fresh MVID into every build.
Since #498 (#2550) every launcher is built by MSBuild. With
`-p:Deterministic=true` two rebuilds on One were byte-identical (#498), but
neither the project files nor release.yml set it, and nobody has measured
runner against local. Provenance here means "this signed file came from this commit,
this runner and these records", recorded and signed, not "anyone can rebuild
the same bytes".

## 1. Where things stand today (measured 11 Oct 2026)

| Layer | What it is | Where |
| --- | --- | --- |
| Authenticode signing | Azure Artifact Signing, account ThornswoodSigning, profile ThornswoodRelease, `signtool /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256` | `scripts\release\Sign-Artifact.ps1`, `records\signing\` |
| What is signed | Every program of the launcher's folder (`Thornswood.exe`, which is also the setup program since #4824, and the native libraries beside it) | `Build-Launcher.ps1`, `.github/workflows/release.yml` |
| Publish gate | Ship refuses an unsigned or wrongly signed file | `scripts\release\Assert-PublishSigned.ps1` |
| Launcher check | WinVerifyTrust, chain to Microsoft Identity Verification Root CA 2020 (`F40042E2...BFA2`), a "Microsoft ID Verified CS" issuer, a timestamp, the ThornswoodRelease durable identity `1.3.6.1.4.1.311.97.203948530.216998690.847558466.123546472`, Subject contains `ExpectedSigner` | `launcher\app\Signature.cs`, `Updater.cs` |
| Checksums | release.yml writes `SHA256SUMS` for every file of the launcher's folder onto a DRAFT release; Ship downloads and refuses on mismatch. The feed names every pack, the launcher and the client runtime by sha256 and serves them at `/feed[-dev]/assets/<sha256>`; the launcher refuses an empty or mismatched hash | `.github/workflows/release.yml`, `docs\FEED.md`, `Updater.cs` |
| Build records | `records\client-build.json` and `server-build.json` name every built file by hash and the fork commit; the feed's `release` object names id, channel, commit, branch, tag; `releases.txt` on the VPS keeps the history | `records\README.md`, `docs\FEED.md` |

What is NOT covered today, which is what this issue is about:

- Packs, the client runtime, `version.json` and the build records are zips
  and JSON. Authenticode cannot sign them. They are protected only by the
  sha256 the feed names, and the feed is protected only by https and by who
  can write `C:\Thornswood-Docs\feed` over ssh. Whoever can write the feed
  can change both a pack and its hash.
- Until the switch-over (section 7), the runner's exe is signed later on
  One, so the draft release holds unsigned bytes and a `SHA256SUMS` for
  them, and the published file has a different hash from the draft's.
  Decided (section 8): release.yml signs on GitHub's runner through a
  federated Azure identity, which ends this gap. A draft from the VPS job is
  still unsigned and says so in its notes.
- Nothing ties source commit, engine pin, runner, records and artifact hashes
  together in one signed statement.

## 2. Artifact types and how each is signed

| Artifact | Format | Signature | Algorithm | Verified by |
| --- | --- | --- | --- | --- |
| Launcher `Thornswood.exe` | PE | Authenticode, embedded (today) | RSA certificate from Artifact Signing, SHA256 file digest, RFC 3161 SHA256 timestamp | Ship gate; installed launcher before swap (`Signature.cs`) |
| The launcher's native libraries | PE | Authenticode, embedded (today) | same | Ship gate; Windows SmartScreen for the people installing, since the launcher is the setup program (#4824) |
| Client runtime, packs, optional packs, the baseline record (which names every file of the release by its sha256) | zip, JSON | Listed by sha256 in the signed release manifest (below), since phase B | SHA256 entries in a signed manifest | Launcher (phase C), Publish-Update's gate |
| Feed `version.json` | JSON | Not signed itself. It names the manifest (`signedManifest`), and every asset in it is checked against the manifest. Its own bytes are not listed: Set-Server, Set-Collection, Dev-News, Publish-Discord, Rollback-Feed and Repair-Manifest rewrite it after a Ship, so a signature over it would go stale at the next edit. What it says outside the asset hashes (server address, collection, news, minLauncher) is not covered; see "Not covered" below | none | |
| Build records `client-build.json`, `server-build.json` | JSON | Not yet. The manifest carries the commit and the fork commit; listing the records' hashes is for phase C | | |
| Release manifest `release.json` and its catalog (new, phase B) | JSON, and a Windows catalog (PKCS#7) whose one member is `release.json` | Authenticode on the catalog via the SAME Artifact Signing profile. Measured 18 Oct on One: ThornswoodRelease signed a `New-FileCatalog` catalog with a timestamp, Authenticode reads it Valid, and `Signature.cs` accepts it | as above | `Signature.cs` on the catalog, `Test-FileCatalog` for `release.json`, then each listed sha256 |

Why a catalog. It reuses the one signing identity the launcher already pins,
the one tool chain (`Sign-Artifact.ps1`) and the one custody arrangement. No
second key exists to lose, leak or rotate. A catalog is signed exactly like
an exe and checked by the same `Signature.cs`, and it carries a list of
hashes. A plain JSON manifest signed as a detached PKCS#7 by the same profile
is the fallback if catalogs prove awkward to build on the runner. A separate
key (minisign, Sigstore keyless) was the alternative; Patrick kept the
catalog (section 8, decision 1).

The manifest also carries the provenance: release id, channel, source
commit and branch, launcher version, the engine/skymp fork commit, when it
was made, and the sha256 of every asset. Not the machine's name: the
manifest is public on the site, and the signature already says who signed. The
records' own hashes are not in it yet (phase C). The pilot's
`records\signing\pilot-2163.json` is that shape for one test file.

Not covered, by design: what `version.json` says outside asset hashes. A
writer of the feed can still change the server address, the collection
address, the news and minLauncher. The manifest stops that writer from
handing out a pack, runtime, launcher or file the signer did not release;
it does not stop a feed that sends launchers to another server. Signing
those fields would mean every feed edit after a Ship signs again (the six
scripts above), which is phase C's question to settle.

## 3. Owners, custody, rotation, recovery, revocation

| Thing | Owner | Custody |
| --- | --- | --- |
| Signing account ThornswoodSigning and profile ThornswoodRelease | Patrick (makes accounts and gives the Certificate Profile Signer role, docs/guide/set-up-a-machine.md "Your own signing sign in", #1740) | In Azure. No private key leaves Microsoft's HSM; certificates last three days and are reissued |
| Release signing in release.yml (decided, section 8) | Patrick sets up the Azure side (the federated credential and the Signer role on ThornswoodRelease); the owner of the release.yml move does the workflow | A federated (OIDC) identity in Azure that trusts only release.yml on `v*` tags of this repository. No secret, password or key is stored in GitHub or on any machine; GitHub mints a short token per run. Pull request jobs never get it |
| Right to sign by hand | Each person who ships, with their own account holding Certificate Profile Signer on ThornswoodRelease | Their own `az login` on the machine they ship from, for local and fallback signing only once release.yml signs. Nothing is copied between machines; `signing.json` holds paths only |
| Durable identity pinned by launchers | Launcher lane | `Signature.Identities` in `launcher\app\Signature.cs` |
| `SHA256SUMS`, feed hashes, records | Release lane (Ship) | Git (records), GitHub draft releases, VPS feed store |

Rotation. Certificate rotation is automatic (three days) and needs nothing
because the launcher pins the root and the durable identity, not a
thumbprint. A NEW profile or new identity validation is a rotation that does
need work, already written in `records\signing\README.md`: add the new
durable identity to `Signature.Identities`, Ship that launcher signed with
the OLD profile, and only then sign with the new one. Rotating a person's
signing right is removing their role assignment.

Recovery. Lost machine: nothing to recover, sign in on another machine and
run `Setup-ShipMachine.ps1`. Compromised workflow or repository: Patrick
deletes the federated credential (or removes its role), which stops release
signing at once without touching anyone's own sign in. Lost or compromised Azure account of a signer:
Patrick removes the role and resets the account; no key is exposed because
none was held. Lost signing account or profile: a new profile means a new
durable identity, and installed launchers refuse it, so recovery is the
documented two-step identity add. That only works while the old profile can
still sign the bridging launcher. If the old profile is gone first, every
installed launcher must be updated by hand (new installer). This is the main
recovery risk and why "Decisions" covers a second identity (not for now).

Revocation. Microsoft can revoke a certificate; a timestamped signature made
before the revocation date stays valid, later ones fail WinVerifyTrust. To
withdraw one bad release without revoking: point the feed back at the last
good release (the feed store keeps `history\`), and once the manifest is
enforced, list the bad manifest's sha256 in a `revoked` array the launcher
refuses. Emergency stop of all signing: remove the signer role assignments,
the federated identity's included.

## 4. Verification points

1. Sign time (`Sign-Artifact.ps1`, in release.yml's hosted job): reads the
   signature back, must be Valid; a failure fails the job and no draft gets
   the file.
2. A second machine, straight after (release.yml's `verify` job): a VPS
   runner with no signing setup downloads the signed draft by asset id and
   runs `scripts\release\Test-ReleaseFiles.ps1 -RequireSigned`: each file
   against `SHA256SUMS`, the publish gate and `Signature.cs` on the
   launcher, and a one byte change refused by both. Red means do not ship
   that draft.
3. Publish (`Assert-PublishSigned.ps1`): Authenticode Valid, Subject has
   ExpectedSigner, `Signature.cs` passes. Unchanged.
4. Ship download of the runner's draft: `SHA256SUMS` first (kept), then the
   Authenticode check of the already signed exe, then in phase B the
   draft's manifest signature. Once release.yml signs, `SHA256SUMS` describes
   the signed files.
5. Launcher self update: sha256 from the feed, then `Signature.cs` (today).
6. Launcher pack and runtime download: sha256 from the feed (today), plus the
   manifest signature and listing (phase C).
7. Independent check by anyone, no sign in: `Test-SignPilot.ps1 -Verify` for
   the pilot's test exe, and `Test-ReleaseFiles.ps1 -Dir <folder>
   -RequireSigned` for a real draft's three files.

## 5. Migration and enforcement

Checksums are never removed. Every phase adds a check in front of or beside
the sha256 and keeps the sha256 check.

- Phase A, pilot (this change): a TEST exe signed and verified on One with
  the real profile, an offline harness, this document. No live change.
- Phase B, produce: Ship writes and signs the manifest and puts it on the
  site; its own gate verifies it. Launchers ignore it. Rollback: stop
  writing it (a revert of the block below).
  As built (#2163, 19 Oct): Publish-Update.ps1, on every run that uploads,
  after the release record and the news and before `version.json` is
  written. `Release-Manifest.ps1` lists every asset the feed names that
  carries code or names files (the launcher, the client runtime, each pack
  and optional pack, the baseline record) in `release.json`, and makes a
  catalog over it. `Sign-ReleaseCatalog.ps1` signs the catalog with
  `Sign-Artifact.ps1 -Required` and checks it with the publish gate and
  `Signature.cs`. `Get-ReleaseManifestRefusal` checks the catalog still holds
  `release.json` and that it lists every asset. Both files go to the site
  as assets by their sha256, and the feed names them as `signedManifest`
  (`url`, `sha256`, `catalogUrl`, `catalogSha256`). Any failure stops the
  publish before `version.json` moves. So every Ship now signs once more,
  dev included, and needs the signing setup and Azure to answer even when
  it ships no launcher. A run that uploads nothing drops `signedManifest`
  from the feed rather than name an older release's.
  Left for phase C: `Rollback-Feed.ps1` should name the manifest the release
  it goes back to had; `Scrub-Feed.ps1` rebuilds packs, so it must sign a
  manifest for them; and the records' hashes go into the manifest.
- Phase C, warn: a launcher that understands the manifest verifies it and
  reports a failure to the log and the site, but still installs on a good
  sha256. Measure for at least one main and several dev releases.
  As built (#2163, 19 Oct): `launcher\app\ReleaseManifest.cs` and
  `FeedManifest.cs`. On an update check that brings a different manifest or
  different assets, the launcher fetches release.json and the catalog like
  any asset, checks the catalog with `Signature.cs`, checks the catalog lists
  release.json's sha256 (wintrust's catalog reader), and checks release.json
  lists every asset the feed names. One line goes to launcher.log, which
  reaches the site with a session's logs: the release and "lists all N of
  the feed's assets, signed", or a line starting "WARNING: the release
  manifest", or "names no signed release manifest". Nothing is refused on it.
  What to read before phase D: those lines in the session logs the site
  keeps, for one main and several dev releases.
- Phase D, enforce: a new `minManifestLauncher` (or the next `minLauncher`)
  makes the launcher refuse a release with no manifest, a bad signature, or
  an asset not listed. From here an unsigned artifact is never silently
  accepted. Rollback: the feed can name the previous release (already
  signed), and enforcement is a launcher build, so rolling it back is
  shipping the previous launcher behaviour behind the same flag, not turning
  checks off in the feed.

## 6. Tags, drafts, replacement and failed signatures

- Tag movement. release.yml builds whatever the tag points at, and a tag can
  be moved and re-run (`workflow_dispatch`). Making the tag resolve to the
  intended commit is #2202 (Wyrd lane), not this design. What this design
  adds is only that the manifest records the commit sha the draft was built
  from, so whatever check #2202 settles on has a signed value to compare.
- Draft promotion. Today the draft's `SHA256SUMS` describes the UNSIGNED
  runner exe, and signing on One changes the bytes. With signing in
  release.yml (section 8) the runner builds and signs in one job, the draft
  carries the signed exe (the stub stays unsigned until Package signs the
  finished Setup, section 8) with a `SHA256SUMS` of the signed files,
  and the manifest is signed in the same job, so the draft's hashes and the
  published hashes are the same and "this runner built and signed Y from
  this commit" is one signed statement. Promoting a draft is a person's act
  and stays that way.
- Replacement. release.yml deletes and re-uploads same-named assets in a
  draft. After promotion an asset must never be replaced in place: a new
  build is a new release id. The feed serves by sha256, so a replaced file
  is a different URL and old manifests do not list it. release.yml keeps to
  that since #2163: it finds a tag's release in the releases list, uploads
  only into a draft, stops on a published one, and stops when a tag has
  more than one release. It used to look with `GET /releases/tags/<tag>`,
  which never returns a draft (measured 12 Oct: 404 for v1.2.4 while
  release 410844061 was its draft), so every run again for a tag made one
  more draft, and would have replaced the files of a published release.
  v1.1.96 has two drafts from the same second. Runs for one tag share one
  concurrency group, so a tag push and a manual run cannot race.
- Failed signature. Refuse, never warn, at every point that refuses today:
  Sign-Artifact exits 1 and Ship publishes nothing. In phase C the launcher
  logs and keeps the old version; in phase D it refuses to install and keeps
  the old version running. The pilot proves a one byte change inside the
  hashed region fails both the checksum and the signature
  (`tests\test-sign-pilot.ps1`, `Test-SignPilot.ps1 -Verify`).

## 7. The pilot

`scripts\release\Test-SignPilot.ps1 -Sign -Verify -Out <folder>` builds a
throwaway console exe, signs it through `Sign-Artifact.ps1 -Required` (the
release path), writes `SHA256SUMS` and `provenance.json`, and verifies with
the Ship gate and `Signature.cs`. Run on One, 11 Oct 2026, from commit
e975a14c: signed by the ThornswoodRelease profile, Microsoft RSA timestamp,
all eight checks passed. Record: `records\signing\pilot-2163.json`.
`-Verify` needs no sign in and no signing setup, so it can be run anywhere.

Found while piloting: flipping a byte in the middle of a small signed exe
can land in the signature blob, which Authenticode does not hash, and still
verify. A tamper test has to change bytes in the hashed region (the pilot
uses the DOS stub text). Anyone writing tamper tests later should know that.

Not yet done: signing and verifying away from One. With section 8 decision 2
that proof is a signed draft from release.yml, checked by its `verify` job
on a VPS runner, not a second hand-run machine.

### Where the release.yml move stands, 12 Oct 2026

In release.yml since #2163's pull request: the hosted job ("launcher":
windows-latest, MSBuild, the Azure sign in through the `release`
environment, `Sign-Artifact.ps1 -Required`, `SHA256SUMS` of the signed
bytes), the VPS job ("launcher-vps", the same steps by YAML anchor, MSBuild
since #2550, unsigned), the `verify` job, one draft per tag (section 6), and
`tests\test-release-workflow.ps1`, which says which side of the switch-over
the file is on.

The Azure side, read on 12 Oct with `az` and the GitHub API (no secret was
read): the app registration `thornswood-release-github` has one federated
credential, issuer `https://token.actions.githubusercontent.com`, audience
`api://AzureADTokenExchange`, subject
`repo:EvilPatrick06@187923600/Thornswood@1365246621:environment:release`.
That is the immutable id form, and the repository's OIDC setting has
`use_immutable_subject` on with that same prefix, so the subject a run on
the `release` environment presents is the one trusted. Its role is
Artifact Signing Certificate Profile Signer, given on the signing account
ThornswoodSigning rather than on the profile; the account has one profile,
ThornswoodRelease, so today that is the same thing. The `release`
environment allows tags `v*` only, and the two repository variables the
sign step reads, `AZURE_SIGNING_CLIENT_ID` and `AZURE_SIGNING_TENANT_ID`,
are set. No subscription id is needed: the workload identity sign in takes
only those two and the token file, and the unused
`AZURE_SIGNING_SUBSCRIPTION_ID` was taken off this repository (Patrick,
27 Oct, #3717). The fork's signing keeps its own copy for its azure/login.

What a run proved on 12 Oct: the default path, a `v*` tag push and a manual
run on the box, builds on the VPS as before; a manual run asking for
`runner: hosted` while GitHub refuses hosted jobs falls back to the VPS; and
each run for one tag uploads into its one draft. The pull request on #2163
names the runs.

The switch-over, the last step. It waits on three things, in this order:

1. GitHub's hosted runner has usage that month. Patrick is not raising the
   Actions budget (#2393, 15 Oct): hosted first, the VPS when hosted has none.
   `BUILD_RUNNER` still read `vps` on 16 Oct, so no workflow tries hosted
   unless a manual run asks for it. Measured again 18 Oct, 9:02 PM MT (run
   39192804622, pilot tag `v0.0.2163-pilot2` on main): GitHub still refused
   the hosted job on billing before any step ran.
2. A pilot: a tag that can never ship (`v0.0.2163-pilot<n>`) on a commit
   with this release.yml, then
   `gh workflow run release.yml --ref main -f tag=<tag>` (only a run of
   main's workflow signs, #3930; the runner input went with the box job,
   #4013).
   The pilot tag goes on a commit main has: `Resolve-ReleaseTag.ps1` refuses
   a tag whose commit is not on main, with or without `expected_sha`, and
   the run stops before it builds (#3890, Patrick, 27 Oct: a signed release
   is never built from a commit off main). Pushing the tag starts the usual
   VPS build: let it finish, never cancel it. Cancelling a VPS job during
   its checkout leaves git lock files in that runner's workspace and every
   later job there fails (#2751, 18 Oct). The hosted run then uploads into that one
   draft and writes its notes again for its own files.
   The hosted job's log says "building with MSBuild on a github-hosted
   runner", then the Azure sign in, then "signed by" the ThornswoodRelease
   certificate; `verify` passes; the draft's notes say signed. Then the
   pilot's draft and tag are deleted.
3. A launcher built by MSBuild has been started on dev (#498 step 2),
   because after the switch-over every main launcher is built that way.
   Measured 16 Oct: dev carries launcher 1.2.4.5, built by MSBuild in the
   dev release of 1:04 AM 16 Oct; #498 waits for somebody to start it once
   and say it opened cleanly.

Then one pull request: in release.yml the hosted job's `if` becomes
`${{ vars.BUILD_RUNNER != 'vps' && inputs.runner != 'vps' }}` and the
runner input's default becomes `hosted`; the two "until the switch-over"
checks in `tests\test-release-workflow.ps1` change to match. While
`BUILD_RUNNER` is `vps` (set 12 Oct for #2393) releases stay on the box even
after it, so taking `BUILD_RUNNER` off `vps` moves pull request builds and
releases together.

### #3312: hosted first, the box signs on runner 3, 22 Oct 2026

The switch-over above is in: the hosted job's `if` is
`${{ vars.BUILD_RUNNER != 'vps' && inputs.runner != 'vps' }}` and the runner
input defaults to `hosted`. What it adds, so that a Ship from the cloud can
carry a new launcher with no One in the chain:

- The VPS job has the `release` environment and `id-token: write` on a v
  tag, the way the hosted job does. The federated credential names the
  environment, not the runner, so the subject it presents is the one above.
  The sign step asks GitHub for the token itself and hands it to Microsoft's
  signing client as a workload identity file under RUNNER_TEMP for one
  signtool call (no `azure/login`, so no Azure CLI sign in stays in the
  runner account's profile). It runs on runner 3 only; runner 3 needs the
  label (`pwsh scripts/deploy/Set-BuildRunners.ps1`, #3107), the
  Windows SDK's signtool, and its outbound rules to let the signing hosts
  through (`Install-Runner.ps1 -NetworkOnly -Number 3`, from
  `records/sign-runners.json`; #3312).
- The `verify` job runs after whichever job signed, on a check runner
  (the `thornswood-check` label, `records/check-runners.json`, #3956),
  which is never the runner that signed. Light runner 4 carries that label
  and no build label, so no pull request build can hold up the check.
- A `v<a.b.c.d>` tag is a dev number: release.yml writes it into
  Updater.cs the way a dev Ship does. A `v<a.b.c>` tag must be the number
  Updater.cs already says.
- `release-tag.yml` makes the tag on main's commit and starts main's
  release.yml for it (#3930), since a cloud session can push no tag
  (measured on #3312).
- `Ship.ps1 -FromFeed` asks for it (`Invoke-ReleaseLauncherOnGitHub`, in
  Sign-OnGitHub.ps1), takes the draft held to its `SHA256SUMS` and to the
  launcher's own check (here on Windows, on the box anywhere else), and
  publishes; the engine fork's manifest job fetches the launcher the release
  names from the site and runs the launcher's own check on it, in a job with
  no Azure token, before it signs the release.

Measured on #3312 before choosing this: a cloud session may not create,
edit or delete a release, nor send a request body that is not JSON, so the
fork could not be handed the unsigned exe in a private draft (Patrick's
first choice, C).

### #3890 and #3930: only main's own workflow signs, 27 Oct 2026

Signing used to follow a `refs/tags/v` ref, and the `release`
environment's deployment rule allowed `v*` tags. A `v` tag push runs the
tagged commit's own copy of release.yml, and an expected SHA stood in for
the main check, so a tag pushed on a branch commit was built and signed
without the commit going through a pull request (#3890; two trial tags
were, in September and October). Patrick, 27 Oct, on his report page:
never (#3890, A), and only a run of main's own workflow signs (#3930,
option 1). So:

- `Resolve-ReleaseTag.ps1` checks the tag's commit is on main on every
  path; an expected SHA only narrows which commit.
- A job gets the `release` environment, and the sign steps run, only in a
  `workflow_dispatch` run on `refs/heads/main`: main's copy of release.yml
  and of the tag check, which only a pull request changes. The `release`
  environment's deployment rule names the branch `main` and nothing else
  (the ops repo's run note `ops/claude-queue/3930-sign-from-main.md`), so a copy on any
  other ref cannot reach the identity whatever it says. The federated
  credential's subject names the environment, not the ref (section 7), so
  Azure needs no change.
- A `v` tag push builds nothing itself: its one job (`handoff`, on a build
  runner) starts main's release.yml with the tag and the commit the tag
  named. Pushing a tag still starts a signed release, through main.
  `release-tag.yml` starts main's run (`--ref main`), and
  `Invoke-ReleaseLauncherOnGitHub` waits for the run on main titled
  `Release launcher <tag>`.

A run on any other ref builds unsigned on GitHub's runner and never
reaches runner 3. To build a tag by hand:
`gh workflow run release.yml --ref main -f tag=v<version>`.

### #4013: the box job ends with the flip, 27 Oct 2026

Once this repository is public no runner of the box is registered to it
(#3685, Patrick's A on the VPS runners card), and the jobs that need the box
moved to the private ops repository. The signing fallback did not: a job
there presents another subject, so Azure would need a second federated
credential, and it would need a stored token that writes this repository's
releases, where today no secret is stored for signing at all. A public
repository has GitHub's runners free with no minute limit, the only cause
the fallback ever covered. Patrick picked A on the report page
(q-4013-signing-fallback, 27 Oct): release.yml has the hosted job alone, no
`runner` input and no `BUILD_RUNNER` condition, and `verify` runs on a GitHub
runner of its own, a fresh machine that never signed. If GitHub's runner
cannot build a release, a Ship on One signs the unsigned launcher on
download (#921). A `v` tag push's `handoff` job, which starts main's run,
runs on GitHub's runner too, so the box takes no part in a release. #4033
took off what the job had left behind: runner 3's `thornswood-sign` label
(the box's admin service now takes off any label no record names),
`records/sign-runners.json`, the signing runner's job-started hook, the
signing hosts in runner 3's outbound rules, and Bootstrap-VPS.ps1's .NET
runtime for Microsoft's signing client, which nothing else on the box runs.
Once the repository was public it took the check runners'
`thornswood-check` and `records/check-runners.json` off too: their last user,
the nightly's bot harnesses (#4914), runs on GitHub's runner.

## 8. Decisions (Patrick)

Answered 11 Oct 2026 and settled 12 Oct 2026, 11:11 AM MT (Patrick's
decisions relayed by Smeagle; recorded on #2163). None is pending.

1. Key custody for non-PE artifacts: the default design, a Windows catalog
   signed by ThornswoodRelease (section 2). Decided 12 Oct; no separate key.
2. Where release signing happens: on GitHub's hosted Windows runner, in
   release.yml, through Azure Artifact Signing with a federated (OIDC)
   identity limited to release.yml on `v*` tags (the `release` environment).
   It replaces the earlier "VPS build machine" answer. The hosted job builds
   with MSBuild, so moving releases onto it is #498's MSBuild switch for the
   release build as well, one switchover, not two (section 7 says what it
   waits on). The VPS stays the backup for every
   GitHub runner build: release.yml's fallback job runs there the way
   build.yml's does (BUILD_RUNNER = vps, a manual run asking for the box, or
   the hosted job failing), with MSBuild like the hosted job (the VPS has the Build Tools since
   #498) and unsigned until the VPS has a signing path, and Ship signs that draft on
   download as before (#921). The draft from the hosted job carries the
   signed launcher and a `SHA256SUMS` of the signed files. setup-stub.exe
   stays unsigned on purpose: Package signs the finished Setup after the
   OneFile attach, and a pre-signed stub cannot be signed again. Pull request
   jobs never get the identity. The Azure side (the app registration, its
   federated credential for the `release` environment, and the Certificate
   Profile Signer role on ThornswoodRelease) is Patrick's, and he set it up
   on 12 Oct (read back in section 7).
3. Second durable identity: still not for now. The recovery risk in section
   3 stays accepted.
4. Signers holding Certificate Profile Signer on ThornswoodRelease: Patrick,
   Djinn and Four.
5. Main builds are always signed, and so is every dev launcher: an installed
   launcher refuses an unsigned one. (Until 16 Oct this line said dev builds
   stay unsigned to save signing quota; Patrick took it out that day.) Phase
   D runs only after Claude's signing pilot verifies on a clean
   machine (a signed draft from release.yml, checked away from One by its
   `verify` job, `Test-ReleaseFiles.ps1 -RequireSigned`), and its
   `minLauncher` is set to the first signed launcher.

## 9. Doing nothing, set beside the change

Decided by Patrick on 15 Oct 2026 (#2168, A): this doc sets what staying as
we are costs and risks beside the change's own cost, migration and rollback.
Read on 16 Oct 2026 from the repository, the GitHub API and the public feed
unless it names another date. Nothing was signed, built or published for it.

### 9.1 What checksums alone protect against, and what they do not

They catch:
- a download cut short or damaged on the way;
- a cache or mirror that serves some other file;
- an asset changed in the feed store while `version.json` stays as it was:
  the launcher asks for `/feed[-dev]/assets/<sha256>` and refuses a file
  whose hash is not that name;
- a draft file that changed after the runner wrote `SHA256SUMS`: Ship
  refuses it.

They do not catch anyone who can write the record the hash is read from:
- `version.json` names every pack and the client runtime by sha256, and
  whoever writes `version.json` writes those names too. That is every
  machine that Ships, and every Administrator ssh key on the VPS: five on
  11 Oct, usable from any address (the ops repo's DEPLOY-IDENTITIES.md section 1). On
  16 Oct main's feed named its client runtime (the SkyMP client files that
  load into the game on every tester's machine) by sha256 and nothing else.
- A draft carries `Thornswood.exe` and `SHA256SUMS` side by side, so whoever
  can replace one can replace the other. release.yml itself deletes and
  uploads a draft's files, and three accounts can push to the repository
  (the collaborators list: one admin, two write).

A checksum says the bytes are the ones the record names. It never says who
made the record. What Authenticode adds today covers the launcher and the
installer only. An installed launcher takes a new launcher only when it is
signed under ThornswoodRelease's durable identity (`Signature.cs`), and
nothing on the VPS can sign. So someone who can write the feed cannot swap
the launcher. Their cheapest way onto testers' machines is a pack or the
client runtime, which only phases C and D (section 5) close.

### 9.2 Today's signing on One against the hosted path

| | Today: the VPS builds, Ship signs on One | The hosted path: release.yml signs on GitHub's runner |
| --- | --- | --- |
| Where a main launcher is built | A VPS runner, with MSBuild since #2550 | A fresh GitHub virtual machine for each job, thrown away after it |
| What else runs on that machine | The same four runners build every pull request: `BUILD_RUNNER` is `vps` (set 12 Oct, still so on 16 Oct, when the two latest build checks skipped the hosted job and ran on `thornswood-vps-2` and `-3`). A job can leave files for the next one (the ops repo's RUNNER-ISOLATION.md, F4) | Nothing |
| Where it is signed | On the shipping machine, at Ship, after a checksum check of bytes that machine did not build | Inside the build job, before the draft exists |
| What the draft says | `SHA256SUMS` of the unsigned bytes. Measured: v1.2.4's draft lists `Thornswood.exe` as `8f8aefc7...`; main's feed serves 1.2.4 as `e079f4e4...`, Authenticode Valid. Nothing public ties the two. All 14 releases on GitHub, v0.0.0-ci-trial-20260926 to v1.2.4, are still drafts; none was published | `SHA256SUMS` of the signed bytes, the same hash the feed will name, checked by the `verify` job on a VPS runner |
| Who can cause a ThornswoodRelease signature | The three people with Certificate Profile Signer (Patrick, Djinn, Four), each through their own `az login` | Those three, plus anyone who can push a `v` tag or start release.yml on main, for a tag on a commit main has. Only a run of main's own workflow reaches the identity: the `release` environment allows the branch main alone, with no required reviewer, and main's release.yml refuses a tag whose commit is not on main (#3890, #3930) |
| Signing left on people's machines | Every dev launcher (Build-Launcher signs it during a dev Ship; dev 1.2.4.5 reads Authenticode Valid) and every installer (`Package-Thornswood.ps1` signs the finished Setup) | The same. Only the main launcher's signature moves |
| Packs, the client runtime, `version.json` | sha256 only | sha256 only. The signed manifest (phases B to D) is needed either way |

Section 8, decision 5, said dev builds stay unsigned, while the dev feed's
launcher, 1.2.4.5, was signed, as every dev launcher has to be. Patrick
answered on 16 Oct: the line comes out (#2163).

Who may start a signed run: Patrick, 16 Oct (#2163), "Anyone with repo
access not just me". So no tag rule limits `v` tags to him and the `release`
environment has no required reviewer; the accounts that can push start one,
as the row above says.

The hosted row's widening is not waiting on the switch-over. The federated
credential has existed since 12 Oct (section 7), so a manual run on a `v`
tag with `runner: hosted` can reach it today whenever GitHub starts a hosted
job.

### 9.3 Cost, migration and rollback of the change

Cost:
- GitHub hosted minutes. The repository is private, and GitHub's published
  rate counts a Windows minute on a private repository as two. Hosted jobs
  start only while the account has usage left that month; Patrick is not
  raising the budget (#2393, closed 15 Oct). There were 11 `v` tags from
  27 Sep to 12 Oct, one hosted run each. How long a hosted MSBuild release
  run takes is not measured: none has run (the one asked for on 12 Oct was
  refused on billing). The VPS release job took 10 to 20 seconds with csc
  (runs 38281424727, 38182115117, 37420542587).
- Signing. One signature for each tag run in release.yml. A main Ship then
  leaves the already signed launcher alone, so a main release signs the
  same number of times as today. Each pilot run is one more.
- Work. One pull request (the hosted job's `if`, the runner input's default
  and the two "until the switch-over" checks in
  `tests\test-release-workflow.ps1`), after the pilot.

Migration: the three conditions in section 7, in order. On 16 Oct: hosted
usage this month is not known (below); the pilot has not run; dev carries
the MSBuild launcher 1.2.4.5 and waits for someone to start it once.

Rollback: the published bytes are signed by the same profile either way,
so no installed launcher notices which path made them. To go back, revert
the switch-over. An unsigned draft is signed by Ship on download as it is
today (#921); that path stays in Ship.ps1. The box job and `BUILD_RUNNER`'s
`vps` went with the flip (#4013). To stop hosted signing
at once, Patrick deletes the federated credential or its role (section 3).

### 9.4 Doing nothing

Staying as we are costs nothing new: no hosted minutes, no pull request, no
pilot signature. What it keeps:
- the shipping machine signs a main launcher it did not build, trusting a
  checksum written beside it on the same draft, by a runner that also runs
  every pull request build;
- the draft's hash never matches the published file, so no public record
  names the launcher that shipped;
- the hosted signing identity anyway: it exists, and any account that can
  start release.yml on main can reach it for a tag on main (#3930). Doing nothing on the
  workflow does not remove that. Only a rule on who may start a signed run,
  or deleting the credential, does;
- the feed's reach onto testers' machines, which the hosted path does not
  change either.

### 9.5 What the comparison concludes

- The switch-over is cheap, and a variable takes it back. It ends the
  shipping machine signing bytes it did not build, and it gives a draft
  whose hashes are the published ones. Doing nothing is not safer: it keeps
  that gap and the new identity both.
- Before the pilot, limit who can start a signed run: a tag rule letting
  only the people who ship main create `v*` tags, or a required reviewer on
  the `release` environment. That is a repository setting, so it is
  Patrick's; the choice is written out on #2163.
- Neither path protects packs, the client runtime or the feed. Phase B, the
  signed manifest, is the step that does, and it is the larger risk.

### 9.6 Not measured from here

- Hosted minutes left this month and the account's rate for Windows: the
  GitHub CLI's token on One lacks the `user` scope that the billing read
  needs. Patrick, on GitHub's billing page.
- The Artifact Signing account's tier and this month's signature count:
  Patrick, in the Azure portal under ThornswoodSigning.
- How long a hosted MSBuild release run takes: the first hosted pilot.
- Whether the federated credential still reads as section 7 recorded on
  12 Oct: anyone with `az` access to the app registration, which is
  Patrick.
