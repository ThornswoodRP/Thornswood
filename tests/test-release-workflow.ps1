<#
  test-release-workflow.ps1

      pwsh -NoProfile -File .\tests\test-release-workflow.ps1

  The shape of .github\workflows\release.yml after #2163, #4013 and #4823:
  where the release launcher is built, who may sign it, the one draft per tag
  (#2462), and the second machine that checks a signed draft. Since #4823 the
  launcher is compiled to native code by the .NET 10 SDK and is a folder:
  Thornswood.exe and the native libraries beside it, every one signed, listed
  in SHA256SUMS and put on the draft. The setup program the build also made
  went with the old installer (#4824).

  WHY. Patrick's decisions of 12 Oct on #2163: release.yml builds on GitHub's
  hosted Windows runner (then with #498's MSBuild, the .NET 10 SDK since
  #4823), and signs there through a federated Azure identity limited to v tags. The VPS
  stays the backup for every GitHub runner build, the same way build.yml has
  it. Each of those is one line of YAML that a later edit could drop without
  any other check going red, and the cost of losing one is a release built on
  the wrong machine, or an id-token handed to a run that is not a release.

  SWITCHED OVER (#3312, Patrick, 22 Oct 2026: "it needs to work like the VPS
  runners where VPS is the fallback and the GitHub runner is first", and
  "for signing it will use runner 3"). GitHub's hosted runner builds and
  signs first; the box takes a release up when the hosted job is refused or
  fails, and signs it on runner 3 alone, through the same OIDC identity, with
  no Azure CLI and no sign in kept on the box. A v<a.b.c.d> tag is a dev
  number release.yml hands Build-Launcher.ps1, held to the launcher's own
  number at the commit (LauncherVersion.ps1, #5179), and release-tag.yml
  makes the tag a cloud Ship cannot push.

  THE BOX JOB ENDED WITH THE FLIP (#4013, Patrick's A of 27 Oct 2026). A
  public repository has GitHub's runners free with no minute limit and no
  runner of the box registered to it (#3685), so release.yml has the hosted
  job alone, and the verify job a GitHub runner of its own. This checks that
  shape: no job on a self-hosted runner, no runner input, no BUILD_RUNNER.

  Read only. Parses the YAML text by indentation, no module needed, so it runs
  on the VPS, the hosted runner and anywhere pwsh runs.
#>
[CmdletBinding()]
param([string]$WorkflowPath)
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $WorkflowPath) { $WorkflowPath = Join-Path (Split-Path -Parent $Here) '.github/workflows/release.yml' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$wf = [IO.File]::ReadAllText($WorkflowPath).Replace("`r`n", "`n")
$lines = $wf -split "`n"

# The text of one job: from "  <name>:" to the next line indented two spaces.
function Get-Job([string]$name) {
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -eq "  ${name}:") { $start = $i; break } }
    if ($start -lt 0) { return '' }
    $end = $lines.Count
    for ($j = $start + 1; $j -lt $lines.Count; $j++) { if ($lines[$j] -match '^  \S') { $end = $j; break } }
    return (($lines[$start..($end - 1)]) -join "`n")
}
# One step's text, by the start of its name, up to the next step or job.
function Get-Step([string]$text, [string]$nameStart) {
    return [regex]::Match($text, ("(?ms)^      - name: " + [regex]::Escape($nameStart) + "[^\n]*\n(.*?)(?=^      - name:|^  \S|\z)")).Value
}
# The text before "jobs:", the workflow-level settings.
$top = $wf.Substring(0, [Math]::Max(0, $wf.IndexOf("`njobs:`n")))
$code = (($wf -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n")

# ---- triggers -----------------------------------------------------------------
Yes 'release.yml has no pull_request trigger (no PR run may reach the signing identity)' (-not ($top -match '(?m)^\s+pull_request(_target)?:'))
Yes 'a push runs it only for v* tags' ($top -match "(?m)^  push:\n    tags:\n      - 'v\*'\n" -and -not ($top -match '(?m)^    branches:'))
Yes 'the run is titled with the tag, for Sign-OnGitHub.ps1 to find main''s run for it (#3930)' ($top.Contains('run-name: Release launcher ${{ inputs.tag || github.ref_name }}'))

# ---- only a run of main's own workflow signs (#3930) ---------------------------
$main = "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'"
$hand = Get-Job 'handoff'
Yes 'a tag push has one job, "handoff", which hands the tag to main''s workflow' ($hand -ne '' -and $hand.Contains("if: `${{ github.event_name == 'push' }}"))
Yes '  it starts release.yml on main with the tag and the commit it named, by the repository token' ($hand.Contains("ref = 'main'; inputs = @{ tag = `$env:GITHUB_REF_NAME; expected_sha = `$env:GITHUB_SHA }") -and $hand.Contains('actions/workflows/release.yml/dispatches') -and $hand.Contains('GH_TOKEN: ${{ github.token }}'))
Yes '  with actions: write alone, no contents, no id-token, no environment, no checkout' ($hand -match '(?m)^    permissions:\n      actions: write\n    timeout' -and -not $hand.Contains('id-token') -and -not $hand.Contains('environment:') -and -not $hand.Contains('actions/checkout'))
Yes '  on GitHub''s runner, not the box (#4013)' ($hand -match '(?m)^    runs-on: ubuntu-latest$')
Yes 'no "refs/tags/v" gate is left on the environment or a sign step' (-not ($code -match "startsWith\(github\.ref, 'refs/tags/v'\)"))
Yes 'a manual run cannot ask for the box: there is no runner input (#4013)' (-not ($top -match '(?m)^      runner:') -and -not $top.Contains('options: [hosted, vps]'))
Yes 'workflow-level permissions are contents: write only, no id-token for every job' ($top -match "(?m)^permissions:\n  contents: write\n" -and -not (($top -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n").Contains('id-token'))
Yes 'one concurrency group per tag, however the run started (v1.1.96 got two drafts when it was per ref)' ($top.Contains('group: release-${{ github.event.inputs.tag || github.ref_name }}') -and $top.Contains('cancel-in-progress: false'))

# ---- GitHub's runner alone, no box job (#4013) ---------------------------------
$hosted = Get-Job 'launcher'
Yes 'the hosted job runs on every manual run, whatever BUILD_RUNNER says' ($hosted.Contains("if: `${{ github.event_name == 'workflow_dispatch' }}") -and -not $code.Contains('BUILD_RUNNER'))
Yes 'no job runs on a self-hosted runner, the box''s or any other' (-not ($code -match 'self-hosted|thornswood-vps|thornswood-sign|thornswood-build'))
Yes 'and there is no VPS job "launcher-vps"' ((Get-Job 'launcher-vps') -eq '' -and -not ($code -match '\*release\b|&release\b'))

# ---- the hosted job -----------------------------------------------------------
Yes 'there is a hosted job "launcher"' ($hosted -ne '')
Yes '  it runs on GitHub''s windows-latest, the image the build check proves every PR' ($hosted -match '(?m)^    runs-on: windows-latest$')
Yes '  it holds id-token: write and contents: write at job level' ($hosted -match '(?m)^    permissions:\n      contents: write\n      id-token: write$')
Yes '  the release environment only in a run of main''s own workflow (#3930)' ($hosted.Contains("environment: `${{ $main && 'release' || '' }}"))
Yes '  it hands the verify job the release id, the commit and whether it signed' ($hosted.Contains('release_id: ${{ steps.draft.outputs.release_id }}') -and $hosted.Contains('commit: ${{ steps.tag.outputs.commit }}') -and $hosted.Contains('signed: ${{ steps.draft.outputs.signed }}'))
Yes '  its steps are its own, no anchor another job shares' ($hosted -match '(?m)^    steps:$')

# ---- the steps ----------------------------------------------------------------
$fetch = Get-Step $wf 'Fetch the signing client'
$sign = Get-Step $wf 'Sign the launcher'
$clean = Get-Step $wf 'Take the signing setup off'
$gate = "if: `${{ $main }}"
Yes 'no azure/login: the box keeps no Azure sign in after the job (#3312)' (-not ($code -match 'azure/login'))
Yes 'the signing client is fetched only in a run of main''s own workflow, on either runner' ($fetch.Contains($gate))
Yes '  with the pin from Setup-ShipMachine.ps1, not a second copy' ($fetch.Contains("'Get-SigningClientPin'") -and -not ($fetch -match '[0-9a-f]{64}'))
Yes 'the sign step has the same gate and signs -Required' ($sign.Contains($gate) -and $sign.Contains('Sign-Artifact.ps1 -Path $programs -Required'))
Yes '  every program of the launcher, the exe and each .exe and .dll beside it (#4823)' ($sign.Contains("`$programs = @(Get-ChildItem -LiteralPath (Split-Path -Parent `$exe) -File | Where-Object { `$_.Extension -in '.exe', '.dll' }"))
Yes '  with the app and tenant ids from repository variables, no secret' ($sign.Contains('AZURE_CLIENT_ID: ${{ vars.AZURE_SIGNING_CLIENT_ID }}') -and $sign.Contains('AZURE_TENANT_ID: ${{ vars.AZURE_SIGNING_TENANT_ID }}') -and -not ($sign -match 'secrets\.|CLIENT_SECRET|client-secret'))
$signDoc = [IO.File]::ReadAllText((Join-Path (Split-Path -Parent $Here) 'docs/SIGNED-RELEASES.md')).Replace("`r`n", "`n")
Yes '  and SIGNED-RELEASES.md names those two variables, not three, and no subscription id is read (#3717)' ($signDoc.Contains('`AZURE_SIGNING_CLIENT_ID` and `AZURE_SIGNING_TENANT_ID`') -and -not ($signDoc -match 'three `AZURE_SIGNING_') -and -not ($code -match 'SUBSCRIPTION_ID'))
Yes '  asks GitHub for the OIDC token with the audience Azure trusts' ($sign.Contains("&audience=api://AzureADTokenExchange") -and $sign.Contains('ACTIONS_ID_TOKEN_REQUEST_TOKEN'))
Yes '  masks it and names it to the signing client as a workload identity file' ($sign.Contains("'::add-mask::' + `$answer.value") -and $sign.Contains('$env:AZURE_FEDERATED_TOKEN_FILE = $tokenFile'))
Yes '  and removes the file in a finally, whatever signtool did' ($sign -match '(?s)\} finally \{\s*Remove-Item -LiteralPath \$tokenFile')
Yes '  and reads every program''s signature back, Valid and timestamped' ($sign -match '(?s)foreach \(\$f in \$programs\) \{\s*\$sig = Get-AuthenticodeSignature -LiteralPath \$f' -and $sign.Contains("`$sig.Status -ne 'Valid'") -and $sign.Contains('TimeStamperCertificate'))
Yes 'no setup-stub.exe anywhere in the workflow: the old installer''s program went with it (#4824)' (-not ($code -match 'setup-stub'))
Yes 'the signing setup comes off the runner after every run, failed ones too' ($clean.Contains('if: ${{ always() }}') -and $clean.Contains('records\signing\signing.json') -and $clean.Contains('records\signing\client'))
Yes 'no step in release.yml reads a secret but the repository token' (-not (($wf -replace '\$\{\{ github\.token \}\}', '') -match 'secrets\.'))
$num = Get-Step $wf 'Hold the tag''s number to the launcher''s'
Yes 'the tag''s number is held to the launcher''s number at the commit, worked out by LauncherVersion.ps1' ($num.Contains('. .\scripts\release\LauncherVersion.ps1') -and $num.Contains('Get-LauncherVersion -RepoDir .'))
Yes '  a v<a.b.c> tag must be that number and no other' ($num.Contains('$parts.Count -eq 3 -and $want -ne $main'))
Yes '  and a v<a.b.c.d> tag must start with it' ($num.Contains('$parts.Count -eq 4 -and $base -ne $main'))
Yes '  and the number goes to the build as -Version, so git''s Updater.cs is never edited' ($wf.Contains('LAUNCHER_VERSION: ${{ steps.number.outputs.version }}') -and $wf.Contains('Build-Launcher.ps1 -Root $root -NoSign -NoPause -Version $env:LAUNCHER_VERSION'))
$build = Get-Step $wf 'Build the launcher into RUNNER_TEMP'
Yes 'the build is Build-Launcher''s native publish, with no -With and no MSBuild (#4823)' ($build.Contains('Build-Launcher.ps1 -Root $root -NoSign -NoPause') -and $build -notmatch '-With\b' -and $build -notmatch "'csc'" -and $code -notmatch 'MSBuild')
$iDotnet = $wf.IndexOf('- uses: actions/setup-dotnet@a98b56852c35b8e3190ac28c8c2271da59106c68 # v6.0.0')
Yes '  after the .NET 10 SDK is set up, at the build check''s pin' ($iDotnet -gt 0 -and $wf.Substring($iDotnet).StartsWith("- uses: actions/setup-dotnet@a98b56852c35b8e3190ac28c8c2271da59106c68 # v6.0.0`n        with:`n          dotnet-version: '10.0.x'"))
$iBuild = $wf.IndexOf('- name: Build the launcher into RUNNER_TEMP')
$iFetch = $wf.IndexOf('- name: Fetch the signing client')
$iNum = $wf.IndexOf("- name: Hold the tag's number to the launcher's")
$iClean = $wf.IndexOf('- name: Take the signing setup off')
$iSign = $wf.IndexOf('- name: Sign the launcher')
$iSums = $wf.IndexOf('- name: Collect the launcher''s programs')
$iDraft = $wf.IndexOf('- name: Draft a release')
Yes 'order: number, SDK, build, fetch the client, sign, SHA256SUMS, draft, clean up (sums name the signed bytes)' ($iNum -gt 0 -and $iNum -lt $iDotnet -and $iDotnet -lt $iBuild -and $iBuild -lt $iFetch -and $iFetch -lt $iSign -and $iSign -lt $iSums -and $iSums -lt $iDraft -and $iDraft -lt $iClean)

$collect = Get-Step $wf 'Collect the launcher''s programs'
Yes 'the collect step takes every .exe and .dll of the launcher folder, by name, and refuses one with no Thornswood.exe' ($collect.Contains("Where-Object { `$_.Extension -in '.exe', '.dll' -or `$_.Name -in 'app.ico', 'app-dev.ico' } | Sort-Object Name") -and $collect.Contains("`$_.Name -eq 'Thornswood.exe'"))
Yes '  and the two icons the exe embeds, refusing a folder without either, so Install-Launcher names the icon file after the exe''s art (#887)' ($collect.Contains("`$noIcon = @('app.ico', 'app-dev.ico' | Where-Object { `$programs.Name -notcontains `$_ })") -and $collect -match 'if \(\$noIcon\.Count\) \{[^}]*exit 1 \}')
Yes '  and writes a SHA256SUMS line for each of them' ($collect -match '(?s)foreach \(\$f in \$programs\) \{\s*\$hash = .*?\$lines \+= \("\$hash  " \+ \$f\.Name\)')

# ---- one draft per tag --------------------------------------------------------
$draft = Get-Step $wf 'Draft a release'
Yes 'the draft step has an id the outputs read' ($draft -match '(?m)^        id: draft$')
Yes 'it never looks a draft up by /releases/tags/ (that endpoint never returns a draft)' (-not ($code -match 'releases/tags/'))
Yes '  it reads the releases list page by page instead' ($draft.Contains('releases?per_page=100&page=$page') -and $draft.Contains('$_.tag_name -eq $tag'))
Yes '  and stops when the tag has more than one release, naming them' ($draft.Contains('if ($same.Count -gt 1)') -and $draft.Contains('gh api -X DELETE repos/$repo/releases/<id>'))
Yes '  and never replaces the files of a published release' ($draft.Contains('if (-not $release.draft)'))
Yes '  and rewrites an existing draft''s notes with the files it uploads (a signed rebuild kept saying UNSIGNED)' ($draft.Contains('-Method Patch -Uri "$api/releases/$($release.id)"') -and $draft.Contains('@{ body = $notes; tag_name = $tag; target_commitish = $env:RELEASE_COMMIT }'))
Yes '  naming the tag and commit in that edit, since an edit that does not name the tag drops it from a draft (v1.2.13, 31 Oct)' (@([regex]::Matches($draft, '-Method Patch')).Count -eq 1 -and $draft -match 'tag_name = \$tag; target_commitish = \$env:RELEASE_COMMIT \}')
Yes '  and the notes name the .NET 10 SDK''s native publish on GitHub''s runner' ($draft.Contains("'published natively on GitHub''s runner with the .NET 10 SDK (#4823)'") -and -not $draft.Contains('csc') -and -not $draft.Contains('VPS'))
Yes '  and it uploads every file the collect step left, not a fixed list' ($draft.Contains('$files = @(Get-ChildItem -LiteralPath $out -File') -and $draft.Contains('foreach ($asset in $files)'))
Yes '  and an unsigned draft says UNSIGNED' ($draft.Contains("else { `$how += ', UNSIGNED (not a run of main''s workflow, #3930)"))
Yes '  and writes release_id and signed for the verify job' ($draft.Contains('"release_id=" + $release.id') -and $draft.Contains('("signed=" +'))

# ---- the second machine -------------------------------------------------------
$ver = Get-Job 'verify'
Yes 'there is a "verify" job' ($ver -ne '')
Yes '  it runs after the build drafted a signed launcher' ($ver -match '(?m)^    needs: launcher$' -and $ver.Contains("if: `${{ !cancelled() && needs.launcher.result == 'success' && needs.launcher.outputs.signed == 'true' }}"))
Yes '  on a GitHub runner of its own, a fresh machine, never the one that signed' ($ver -match '(?m)^    runs-on: windows-latest$')
Yes '  without id-token or the release environment' (-not $ver.Contains('id-token') -and -not $ver.Contains('environment:'))
Yes '  it checks out the commit the draft was built from, by the job that built it' ($ver.Contains('ref: ${{ env.DRAFT_COMMIT }}') -and $ver.Contains('DRAFT_COMMIT: ${{ needs.launcher.outputs.commit }}'))
Yes '  downloads each file by its asset id' ($ver.Contains('releases/assets/$($a[0].id)') -and $ver.Contains("Accept = 'application/octet-stream'"))
Yes '  SHA256SUMS first, then every file it names, so the whole launcher is checked' ($ver -match "(?s)& \`$get 'SHA256SUMS'.*?foreach \(\`$n in \`$named\) \{ & \`$get \`$n \}")
Yes '  and runs Test-ReleaseFiles.ps1 -RequireSigned, failing on a refusal' ($ver.Contains('Test-ReleaseFiles.ps1 -Dir $dir -RequireSigned') -and $ver.Contains('if ($LASTEXITCODE -ne 0)'))
$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $WorkflowPath))
Yes '  and that script is in the repository' (Test-Path -LiteralPath (Join-Path $repoRoot 'scripts/release/Test-ReleaseFiles.ps1'))

# ---- no signing or check runner (#4033) ---------------------------------------
# No job asks for a runner's signing label since #4013, so the record that
# gave runner 3 it, and runner 3's firewall openings, went too. The check
# label went once the repository was public: the nightly's bot harnesses,
# its last user (#4914), run on GitHub's runner.
Yes "no records/sign-runners.json: no runner of the box signs a release" (-not (Test-Path -LiteralPath (Join-Path (Join-Path $repoRoot 'records') 'sign-runners.json')))
Yes 'no records/check-runners.json: no runner of the box checks a release or runs the bot harnesses' (-not (Test-Path -LiteralPath (Join-Path (Join-Path $repoRoot 'records') 'check-runners.json')))
Yes 'and no job here asks for the check label (#3956)' ($code -notmatch 'thornswood-check')

# ---- release-tag.yml makes the tag a cloud Ship cannot push (#3312) ------------
$tpath = Join-Path (Split-Path -Parent $WorkflowPath) 'release-tag.yml'
Yes 'release-tag.yml is there' (Test-Path -LiteralPath $tpath)
if (Test-Path -LiteralPath $tpath) {
    $t = [IO.File]::ReadAllText($tpath).Replace("`r`n", "`n")
    $tcode = (($t -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n")
    Yes '  workflow_dispatch only' ($tcode -match '(?m)^on:\n  workflow_dispatch:' -and -not ($tcode -match '(?m)^\s+(push|pull_request(_target)?|schedule):'))
    Yes '  from main only' ($tcode.Contains("if: `${{ github.ref == 'refs/heads/main' }}"))
    Yes '  with no id-token and no secret' (-not $tcode.Contains('id-token') -and -not (($tcode -replace '\$\{\{ github\.token \}\}', '') -match 'secrets\.'))
    Yes '  holds the tag to v<a.b.c> or v<a.b.c.d> and the commit to a full SHA' ($tcode.Contains("'^v\d+\.\d+\.\d+(\.\d+)?$'") -and $tcode.Contains("'^[0-9a-f]{40}$'"))
    Yes '  holds the commit to main through GitHub''s compare' ($tcode.Contains('compare/$commit...main') -and $tcode.Contains("-notin 'identical', 'ahead'"))
    Yes '  never moves a tag that is already on another commit' ($tcode.Contains('if ($sha -ne $commit)'))
    Yes '  and starts main''s release.yml for the tag, with the commit as expected_sha (#3930)' ($tcode.Contains('actions/workflows/release.yml/dispatches') -and $tcode.Contains("ref = 'main'; inputs = @{ tag = `$tag") -and -not $tcode.Contains('ref = $tag') -and $tcode.Contains('expected_sha = $commit'))
    Yes '  runs no repository code (no checkout)' (-not $tcode.Contains('actions/checkout'))
    Yes '  and has no runner input to pass on, since release.yml has none (#4013)' (-not ($tcode -match '(?m)^      runner:|INPUT_RUNNER|runner = '))
}

# ---- build.yml agrees ---------------------------------------------------------
$bpath = Join-Path (Split-Path -Parent $WorkflowPath) 'build.yml'
if (Test-Path -LiteralPath $bpath) {
    $b = [IO.File]::ReadAllText($bpath).Replace("`r`n", "`n")
    # Like release.yml, it runs on GitHub's runners alone since the flip (#4983).
    Yes 'build.yml has no BUILD_RUNNER switch and no runner of the box, as release.yml has none' (-not $b.Contains('BUILD_RUNNER') -and $b -notmatch '(?m)^\s+runs-on: \[self-hosted')
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
