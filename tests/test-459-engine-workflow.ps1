<#
  test-459-engine-workflow.ps1

      pwsh -NoProfile -File .\tests\test-459-engine-workflow.ps1

  The engine recorded in CI (#459): the shape of .github\workflows\engine.yml,
  and the part Build-Engine.ps1, Build-Server.ps1, EngineJobs.ps1 and
  Bootstrap-VPS.ps1 play in building the engine.

  WHY. Patrick decided on 15 Oct: the engine is built on GitHub's hosted
  runner first, and on the VPS runners when that is refused ("C, then B");
  since the flip it is GitHub's runner alone (#4983). Each piece of that is a
  line of YAML or a line of a script that a later edit could drop without
  anything else going red: the manual start, the image the fork's generator
  needs, the steps that make the records a pin pull request takes, the
  CI=true the fork's CMakeLists.txt reads, and the SKYRIM_DIR a runner does
  not have. Since Patrick's B of
  16 Oct, also the fork's own build taken first: the LF checkout, the look
  for it before anything compiles, every compile step skipped when it is in,
  and the records made from it naming the fork's run (section 3b;
  scripts\tests\test-459-fork-build.ps1 runs ForkEngineBuild.ps1 and -BuiltBy).
  Since Patrick's A on #3014 (22 Oct) the box compiles nothing, and since
  his A on #3399 (26 Oct) neither does GitHub's runner: a Ship machine takes
  the fork's own build, so with no fork build of the commit the job stops
  and say why (section 3c runs that step's own text), and the records come
  back in the job's log, not as an artifact of this repository, whose
  storage was used up (section 3d; tests\test-3399-engine-records.ps1 runs
  the hand-back).

  Read only, apart from a child pwsh that dot-sources EngineJobs.ps1 and
  Build-Engine.ps1 -Check against an empty folder, which changes nothing. Runs
  anywhere pwsh runs; nothing is built.
#>
[CmdletBinding()]
param([string]$WorkflowPath)
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$root = Split-Path -Parent $Here
if (-not $WorkflowPath) { $WorkflowPath = Join-Path $root '.github/workflows/engine.yml' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$wf = [IO.File]::ReadAllText($WorkflowPath).Replace("`r`n", "`n")
$lines = $wf -split "`n"
# The text with every comment line taken out, so a word in a comment is not
# read as a setting.
$code = (@($lines | Where-Object { $_ -notmatch '^\s*#' }) -join "`n")

# The text of one job: from "  <name>:" to the next line indented two spaces.
function Get-Job([string]$name) {
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -eq "  ${name}:") { $start = $i; break } }
    if ($start -lt 0) { return '' }
    $end = $lines.Count
    for ($j = $start + 1; $j -lt $lines.Count; $j++) { if ($lines[$j] -match '^  \S') { $end = $j; break } }
    return (($lines[$start..($end - 1)] | Where-Object { $_ -notmatch '^\s*#' }) -join "`n")
}
# One step's text, by the start of its name, up to the next step or job.
function Get-Step([string]$text, [string]$nameStart) {
    return [regex]::Match($text, ("(?ms)^      - name: " + [regex]::Escape($nameStart) + "[^\n]*\n(.*?)(?=^      - (name|uses):|^  \S|\z)")).Value
}

$head = $code.Substring(0, [Math]::Max(0, $code.IndexOf("`njobs:")))
$job = Get-Job 'engine'
$whichJob = Get-Job 'which'

# ---- 1. when it runs ----------------------------------------------------------
Yes 'it is the Engine build workflow' ($code -match '(?m)^name: Engine build$')
Yes 'a manual run names the fork commit, empty for the pin' ($head -match '(?ms)workflow_dispatch:.*?commit:.*?default: ''''')
Yes 'a manual run has no runner to choose: GitHub''s is the only one (#4983)' ($head -notmatch '(?m)^      runner:')
Yes 'it runs only when started by hand: no pull request, push or other trigger (#1306)' (
    @([regex]::Matches(($head -replace '(?s)^.*?\non:\n', '' -replace '(?s)\npermissions:.*$', ''), '(?m)^  (\w+):') | ForEach-Object { $_.Groups[1].Value }) -join ',' -eq 'workflow_dispatch')
$wake = Get-Job 'wake'
Yes 'the token reads the repository, and only the wake job writes, and only to start a workflow' ($head -match '(?m)^permissions:\n  contents: read$' -and
    ($code.Replace($wake, '')) -notmatch ':\s*write\b' -and $wake -match '(?m)^    permissions:\n      contents: read\n      actions: write$')
# One commit, one group, whether typed in or taken from the pin (#4321): the
# group is the build job's, named by the commit the which job worked out.
Yes 'the run as a whole has no concurrency group, which could only name the commit as typed (#4321)' ($head -notmatch '(?m)^concurrency:')
Yes 'the build job''s group is the fork commit the which job worked out, typed in or the pin (#4321)' ($job -match '(?m)^    needs: which$' -and
    $job -match '(?m)^    concurrency:\n      group: engine-\$\{\{ needs\.which\.outputs\.commit \}\}\n      cancel-in-progress: false$')
Yes '  and a build that has started is never cancelled by another' ($job -match '(?m)^      cancel-in-progress: false$')
$cq = [regex]::Match($wf, '(?ms)^    # One build of one fork commit at a time.*?(?=^    concurrency:)').Value
Yes '  its comment says a third run cancels the waiting second, as GitHub does (#4321)' ($cq -match 'a third cancels the waiting second' -and $cq -notmatch 'never cancelled by another: a second')

# ---- 2. where: GitHub's runner alone (#4983) -----------------------------------
Yes 'the job is GitHub''s windows-2022, the image with the generator the fork demands' ($job -match '(?m)^    runs-on: windows-2022$')
Yes '  three jobs, which commit, the record and the wake: no VPS fallback, no runner of the box, no BUILD_RUNNER switch' (
    (@([regex]::Matches(($code.Substring($code.IndexOf("`njobs:"))), '(?m)^  (\S+):') | ForEach-Object { $_.Groups[1].Value }) -join ',') -eq 'which,engine,wake' -and $code -notmatch '(?<!deny-)self-hosted|thornswood-vps|BUILD_RUNNER')
# The wake (plan part 8): engine-pin.yml hears the moment a run on main ends,
# by a workflow_dispatch, because GitHub starts no workflow_run for a run the
# workflow token started, which is how engine-pin.yml starts this one.
Yes 'the wake job follows the record however it ended, on main only' ($wake -match '(?m)^    needs: engine$' -and $wake -match "(?m)^    if: always\(\) && github\.ref == 'refs/heads/main'$")
Yes '  it starts engine-pin.yml on main and goes red when it cannot' ($wake -match 'gh workflow run engine-pin\.yml --repo \$env:GITHUB_REPOSITORY --ref main' -and $wake -match 'if \(\$LASTEXITCODE -ne 0\) \{[^}]*exit 1')
Yes '  it checks out nothing, runs on GitHub''s Linux runner and has a timeout' ($wake -notmatch 'uses:' -and $wake -match '(?m)^    runs-on: ubuntu-latest$' -and $wake -match '(?m)^    timeout-minutes: \d+$')
$tj = [regex]::Match($job, 'timeout-minutes: (\d+)')
Yes 'it has 30 minutes: it only takes the fork''s build (#3014, #3399)' ($tj.Success -and [int]$tj.Groups[1].Value -eq 30)

# ---- 3. what it runs, in order ------------------------------------------------
Yes 'the which job checks out the code without keeping a token and works out the commit on GitHub''s Linux runner with a timeout' (
    $whichJob -match 'uses: actions/checkout@' -and $whichJob -match 'persist-credentials: false' -and $whichJob.IndexOf('uses: actions/checkout@') -lt $whichJob.IndexOf('- name: Which fork commit') -and
    $whichJob -match '(?m)^    runs-on: ubuntu-latest$' -and $whichJob -match '(?m)^    timeout-minutes: \d+$' -and $whichJob -match '(?m)^      commit: \$\{\{ steps\.which\.outputs\.commit \}\}$')
Yes 'every step of the build that needs the commit takes the which job''s, and none works it out again' (
    $job -notmatch '- name: Which fork commit' -and $job -notmatch 'steps\.which\.' -and @([regex]::Matches($job, 'COMMIT: \$\{\{ needs\.which\.outputs\.commit \}\}')).Count -eq 3)
$order = @('uses: actions/checkout@', '- name: Fetch the fork at that commit', '- name: Look for the fork''s build',
           '- name: Record the fork''s server build', '- name: Record the client', '- name: Check the records name this commit', '- name: Hand the records back in the log')
$at = -1; $inOrder = $true
foreach ($o in $order) { $i = $job.IndexOf($o); if ($i -le $at) { $inOrder = $false; Write-Host "  out of order or missing: $o" }; $at = $i }
Yes 'the steps run in the order the header gives' $inOrder
Yes 'every action is pinned to a full commit with its tag beside it' (@([regex]::Matches($code, '(?m)^\s*(- )?uses: (\S+)') | Where-Object { $_.Groups[2].Value -notmatch '@[0-9a-f]{40}$' }).Count -eq 0 -and
                                                                    @([regex]::Matches($wf, '(?m)^\s*(- )?uses: \S+@[0-9a-f]{40}(?! # v)')).Count -eq 0)
$which = Get-Step $whichJob 'Which fork commit'
# Named in one place only: the env line that hands it to the script. Anywhere
# else it would be pasted into a script's text.
$named = @($code -split "`n" | Where-Object { $_ -match 'github\.event\.inputs\.commit' })
Yes 'the commit asked for reaches the script through env, never pasted into it' ($which -match 'INPUT_COMMIT: \$\{\{ github\.event\.inputs\.commit \}\}' -and
                                                                                $named.Count -eq 1 -and $named[0] -match '^\s+INPUT_COMMIT: ')
Yes 'with none asked, the commit is the one this branch pins' ($which -match 'git ls-tree HEAD engine/skymp')
$fetch = Get-Step $job 'Fetch the fork at that commit'
# Run 39149317535: the runner reused a fork git folder nightly.yml had fetched
# --depth 1, which follows main alone, and origin/thornswood/engine-changes
# was never made.
$fresh = $fetch.IndexOf("'modules\engine\skymp'"); $init = $fetch.IndexOf('submodule update --init engine/skymp')
Yes 'the run clones the fork itself, never reusing a git folder an earlier job left' ($fresh -gt 0 -and $init -gt $fresh -and $fetch -match 'Remove-Item -LiteralPath \$modules -Recurse -Force')
Yes 'the fork''s branch is fetched into the ref the One engine check reads' ($fetch -match [regex]::Escape("fetch origin '+refs/heads/thornswood/engine-changes:refs/remotes/origin/thornswood/engine-changes'"))
Yes 'only a commit on the fork''s thornswood/engine-changes is built (One engine)' ($fetch -match 'merge-base --is-ancestor \$env:COMMIT origin/thornswood/engine-changes')
Yes 'the fork''s upstream is fetched, for the records'' upstreamBase' ($fetch -match 'skyrim-multiplayer/skymp\.git' -and $fetch -match 'fetch upstream main')
Yes 'nothing is compiled: no vcpkg, no Actions cache, no Build-Engine, Build-Server or Write-ClientLicences step (#3014, #3399)' (
    $code -notmatch 'Build-Engine\.ps1' -and $code -notmatch 'Build-Server\.ps1' -and $code -notmatch 'VCPKG_BINARY_SOURCES' -and $code -notmatch 'actions/cache' -and $code -notmatch 'Write-ClientLicences')
Yes 'the client is recorded from the same fork' ((Get-Step $job 'Record the client') -match 'New-ClientBuildRecord\.ps1 -Dist engine\\skymp\\build\\dist\\client -Clone engine\\skymp')
$rcl = Get-Step $job 'Record the client'
Yes 'the libraries in the client and their texts are recorded after the client, from the same build (#3099)' (
    $rcl -match 'New-ClientLicenceRecord\.ps1 -Licences engine\\skymp\\build\\licences -Clone engine\\skymp' -and $rcl.IndexOf('New-ClientLicenceRecord') -gt $rcl.IndexOf('New-ClientBuildRecord'))
$check = Get-Step $job 'Check the records name this commit'
Yes 'both records are held to their shape and to the commit recorded' ($check -match 'Check-Records\.ps1' -and $check -match 'source\.commit' -and $check -match 'forkCommit')
$hand = Get-Step $job 'Hand the records back in the log'
Yes 'the server build is made as the store keeps it, and its name printed (ServerArtifact.ps1)' ($hand -match 'New-ThornswoodServerBuildArtifact -From engine\\skymp\\build\\dist\\server -Record records\\server-build\.json' -and $hand -match 'server build \{0\}')
Yes 'no step cleans up after a run: GitHub''s runner is thrown away, and the record job uses no always() (only the wake does, to say how it ended)' ($code -notmatch 'Free the box' -and $job -notmatch 'always\(\)')
Yes 'nothing is sent and nothing committed: no ssh, scp, push or Deploy' ($code -notmatch '\b(ssh|scp)\b' -and $code -notmatch 'git push' -and $code -notmatch 'Deploy-|Publish-')

# ---- 3b. the fork's own build first (Patrick's B, 16 Oct) -----------------------
Yes 'the fork is checked out LF, as committed, the way One and the fork''s own build check it out' (
    $fetch -match 'git -c core\.autocrlf=false submodule update --init engine/skymp' -and $fetch -match 'git -C engine/skymp config core\.autocrlf false' -and
    $fetch.IndexOf('config core.autocrlf false') -lt $fetch.IndexOf('checkout --force --detach'))
$look = Get-Step $job 'Look for the fork''s build of this commit'
Yes 'the fork''s build is looked for before anything is compiled, with ForkEngineBuild.ps1' ($look -match '(?m)^        id: fork$' -and $look -match '\. \.\\scripts\\release\\ForkEngineBuild\.ps1' -and $look -match 'Find-ForkEngineBuild \$env:COMMIT \$get')
Yes '  read with this run''s own token, handed through env; no secret anywhere in the file' ($look -match 'GH_TOKEN: \$\{\{ github\.token \}\}' -and $code -notmatch 'secrets\.')
Yes '  with none, one still running or one red, the run stops with its Why; nothing builds it in its place' ($look -match "if \(\`$f\.State -ne 'found'\) \{ Write-Host ""::error::\`$\(\`$f\.Why\)""; exit 1 \}" -and $look -notmatch 'found=false')
Yes '  the build is held to the commit, the run and GitHub''s digest before it goes in the fork''s build folder' ($look -match 'Expand-ForkEngineBuild -Zip \$zip -Commit \$env:COMMIT -RunId \$f\.Run\.id -Digest \(\[string\]\$f\.Artifact\.digest\) -Fork engine\\skymp')
# #5153: the fork's signed attestation of its fork-build.json, before anything is recorded.
Yes '  its fork-build.json is held to the fork''s attestation of it: that workflow, that commit, that branch, GitHub''s runner (#5153)' ($look -match 'gh attestation verify \$kept --repo \$forkRepo --signer-workflow "\$forkRepo/\.github/workflows/thornswood-pr-windows\.yml" --source-ref refs/heads/thornswood/engine-changes --source-digest \$env:COMMIT --deny-self-hosted-runners' -and $look.IndexOf('gh attestation verify') -gt $look.IndexOf('Expand-ForkEngineBuild'))
Yes '  under the fork''s name as GitHub gives it now, held to the fork''s id, so a move to another owner is followed (#5184)' ($look -match 'gh api "repos/\$ForkEngineRepo" --jq ''\[\.id, \.full_name\] \| @tsv''' -and $look -match '\$fork\[0\] -ne \[string\]\$ForkEngineRepoId' -and $look -notmatch 'FORK_REPO' -and $look.IndexOf('$forkRepo = $fork[1]') -lt $look.IndexOf('gh attestation verify'))
Yes '  and says which run built it to the steps after' ($look -match "\('run=' \+ \`$f\.Run\.html_url\)" -and $look -match "\('manifest=' \+ \`$kept\)")
$rf = Get-Step $job 'Record the fork''s server build'
Yes 'the fork''s server build is recorded after the server''s packages from its yarn.lock' ($rf -notmatch '(?m)^        if:' -and $rf -match 'yarn install --frozen-lockfile --non-interactive' -and
    $rf.IndexOf('yarn install') -lt $rf.IndexOf('New-ServerBuildRecord.ps1'))
Yes '  by New-ServerBuildRecord.ps1 against the fork, naming the fork''s run' ($rf -match 'New-ServerBuildRecord\.ps1 -Dist engine\\skymp\\build\\dist\\server -Clone engine\\skymp -BuiltBy \$env:FORK_RUN' -and $rf -match 'FORK_RUN: \$\{\{ steps\.fork\.outputs\.run \}\}')
$rc = Get-Step $job 'Record the client'
Yes 'the client record names the fork''s run' ($rc -match 'FORK_RUN: \$\{\{ steps\.fork\.outputs\.run \}\}' -and $rc -match 'New-ClientBuildRecord\.ps1 -Dist engine\\skymp\\build\\dist\\client -Clone engine\\skymp -BuiltBy \$env:FORK_RUN')
Yes 'the log names the fork''s run the records were made from' ($hand -match 'FORK_BUILD: \$\{\{ steps\.fork\.outputs\.manifest \}\}' -and $hand -match 'recorded from the fork''s run')

# ---- 3c. no fork build: the job stops (#3014, 22 Oct; #3399, 26 Oct) ---------
# The box's runner accounts reach GitHub alone (#2161), and a compile needs
# certificate checks and download hosts outside it: run 39727871475 stopped at
# vcpkg's first download. And a Ship machine takes the fork's own build
# (#3399), so a build compiled on GitHub's runner would be bytes no Ship
# machine could take. So with no fork build the job stops, saying why. The
# step's own text runs here, with Find-ForkEngineBuild standing in for the
# lookup.
Yes 'the look step does not ask which kind of runner it is on' ($look -notmatch 'RUNNER_KIND')
$runText = [regex]::Match($look, '(?ms)^        run: \|\n(.*)').Groups[1].Value
$runText = (@($runText -split "`n" | ForEach-Object { if ($_.Length -ge 10) { $_.Substring(10) } else { $_.Trim() } }) -join "`n")
$stub = "function Find-ForkEngineBuild(`$c, `$g) { [pscustomobject]@{ State = 'none'; Why = 'the fork has no build of a push of ' + `$c + ', so there is no build of it to record. A pin names a head of thornswood/engine-changes.' } }"
Yes '  its text has the one dot-source the stand-in replaces' ($runText.Contains('. .\scripts\release\ForkEngineBuild.ps1'))
$lookFile = Join-Path ([IO.Path]::GetTempPath()) ('engine-look-' + [Guid]::NewGuid().ToString('N') + '.ps1')
[IO.File]::WriteAllText($lookFile, $runText.Replace('. .\scripts\release\ForkEngineBuild.ps1', $stub))
$pwshLook = (Get-Process -Id $PID).Path
function Invoke-Look([string]$kind) {
    $outFile = Join-Path ([IO.Path]::GetTempPath()) ('engine-look-out-' + [Guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($outFile, '')
    $saved = @{ COMMIT = $env:COMMIT; GITHUB_OUTPUT = $env:GITHUB_OUTPUT; RUNNER_ENVIRONMENT = $env:RUNNER_ENVIRONMENT; GH_TOKEN = $env:GH_TOKEN }
    try {
        $env:COMMIT = '7d5f038ee74df0ba184a19feb671b9dd691d87dd'; $env:GITHUB_OUTPUT = $outFile; $env:RUNNER_ENVIRONMENT = $kind; $env:GH_TOKEN = 'none'
        $said = @(& $pwshLook -NoProfile -File $lookFile 2>&1 | ForEach-Object { "$_" })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Said = ($said -join "`n"); Out = [IO.File]::ReadAllText($outFile) }
    } finally {
        foreach ($k in $saved.Keys) { if ($null -eq $saved[$k]) { Remove-Item "Env:$k" -ErrorAction SilentlyContinue } else { Set-Item "Env:$k" $saved[$k] } }
        Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue
    }
}
try {
    foreach ($kind in @('github-hosted')) {
        $r = Invoke-Look $kind
        Yes "  on $kind, with no fork build, it stops (exit 1), saying why" ($r.Code -eq 1 -and $r.Said -match '::error::the fork has no build of a push of 7d5f038e' -and $r.Said -match 'head of thornswood/engine-changes')
        Yes '    and hands the steps after it nothing' ($r.Out -notmatch '(?m)^(run|manifest)=')
    }
} finally { Remove-Item -LiteralPath $lookFile -Force -ErrorAction SilentlyContinue }

# ---- 3d. the records come back in the log (#3399) ----------------------------
Yes 'nothing is kept as an artifact: no upload step, no retention (#3399)' ($code -notmatch 'upload-artifact' -and $code -notmatch 'retention-days')
Yes 'the records go into the log with EngineRecords.ps1 and LogHandBack.ps1' ($hand -match '\. \.\\scripts\\release\\EngineRecords\.ps1' -and $hand -match '\$bundle = New-EngineRecordsBundle \.' -and
    $hand -match "Get-LogHandBackLines \('ENGINE' \+ '-RECORDS'\) \`$bundle" -and $hand -match 'Write-Host \$l')
Yes '  the mark is put together, so the step''s own text never holds it' (@([regex]::Matches($code, 'ENGINE-RECORDS')).Count -eq 0)
Yes '  after the records are checked' ($job.IndexOf('- name: Hand the records back in the log') -gt $job.IndexOf('- name: Check the records name this commit'))
Yes '  and the log says how to take them' ($hand -match 'Get-EngineRecords\.ps1 -Run')

# ---- 4. the scripts' part -----------------------------------------------------
# Read with LF line ends: a checkout with core.autocrlf has CR LF, and a
# pattern that ends a line with $ would not see the end of it.
function ReadLf([string]$rel) { return [IO.File]::ReadAllText((Join-Path $root $rel)).Replace("`r`n", "`n") }
$engine = ReadLf 'scripts/release/Build-Engine.ps1'
$server = ReadLf 'scripts/release/Build-Server.ps1'
$jobsLib = ReadLf 'scripts/release/EngineJobs.ps1'
Yes 'Build-Engine.ps1 takes -NoSkyrim' ($engine -match '\[switch\]\$NoSkyrim')
Yes '  and leaves SKYRIM_DIR out of the configure with it, and only with it' ($engine -match '\$skyrimArg = @\(if \(-not \$NoSkyrim\) \{ "-DSKYRIM_DIR=\$SkyrimDir" \}\)' -and $engine -match "'-DBUILD_SKYRIM_PLATFORM=ON' @skyrimArg @pwshArg")
Yes '  and asks for no SkyrimSE.exe with it' ($engine -match '(?m)^if \(\$NoSkyrim\) \{ Ok ')
Yes 'EngineJobs.ps1 has Clear-EngineCiSwitch' ($jobsLib -match 'function Clear-EngineCiSwitch')
$firstCmake = $engine.IndexOf('Run $cmake')
$clear = $engine.IndexOf('$ciSaid = Clear-EngineCiSwitch')
Yes 'Build-Engine.ps1 clears CI before it runs cmake' ($clear -gt 0 -and $firstCmake -gt $clear)
$clearS = $server.IndexOf('$ciSaid = Clear-EngineCiSwitch')
$cmakeS = $server.IndexOf('& $cmake $BuildDir')
Yes 'Build-Server.ps1 clears CI before it generates the build again over its cache' ($clearS -gt 0 -and $cmakeS -gt $clearS -and $server.IndexOf("EngineJobs.ps1") -lt $clearS)

# Clear-EngineCiSwitch itself, in a child pwsh so this run's environment is untouched.
$pwsh = (Get-Process -Id $PID).Path
$probe = @'
param([string]$Lib, [string]$Ci)
if ($Ci -eq '<unset>') { Remove-Item Env:CI -ErrorAction SilentlyContinue } else { $env:CI = $Ci }
. $Lib
$said = Clear-EngineCiSwitch
'SAID ' + [bool]$said
'CI ' + $(if (Test-Path Env:CI) { $env:CI } else { '<unset>' })
'@
$probeFile = Join-Path ([IO.Path]::GetTempPath()) ('engine-ci-probe-' + [Guid]::NewGuid().ToString('N') + '.ps1')
[IO.File]::WriteAllText($probeFile, $probe)
try {
    $jobsPath = Join-Path $root 'scripts/release/EngineJobs.ps1'
    $a = @(& $pwsh -NoProfile -File $probeFile -Lib $jobsPath -Ci 'true')
    Yes 'with CI=true, it says so and takes CI out' ($a -contains 'SAID True' -and $a -contains 'CI <unset>')
    $b = @(& $pwsh -NoProfile -File $probeFile -Lib $jobsPath -Ci '<unset>')
    Yes 'with no CI, it says nothing and changes nothing' ($b -contains 'SAID False' -and $b -contains 'CI <unset>')
    $c = @(& $pwsh -NoProfile -File $probeFile -Lib $jobsPath -Ci 'false')
    Yes 'with CI anything but true (which the fork does not read), it leaves it' ($c -contains 'SAID False' -and $c -contains 'CI false')
} finally { Remove-Item -LiteralPath $probeFile -Force -ErrorAction SilentlyContinue }

# Build-Engine.ps1 -Check -NoSkyrim against an empty folder, with CI=true: it
# says it cleared CI and asks for no game, whatever else this machine lacks.
$empty = Join-Path ([IO.Path]::GetTempPath()) ('engine-ci-fork-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $empty | Out-Null
$was = $env:CI
try {
    $env:CI = 'true'
    $said = @(& $pwsh -NoProfile -File (Join-Path $root 'scripts/release/Build-Engine.ps1') -Check -NoSkyrim -NoPause -Fork $empty -SkyrimDir (Join-Path $empty 'no-game') 2>&1 | ForEach-Object { "$_" })
    Yes 'Build-Engine.ps1 -Check with CI=true says it took CI out' (@($said | Where-Object { $_ -match 'CI=true was set' }).Count -eq 1)
    Yes '  and with -NoSkyrim asks for no SkyrimSE.exe' (@($said | Where-Object { $_ -match 'no game needed' }).Count -eq 1 -and @($said | Where-Object { $_ -match 'MISSING\s+SkyrimSE\.exe' }).Count -eq 0)
} finally {
    if ($null -eq $was) { Remove-Item Env:CI -ErrorAction SilentlyContinue } else { $env:CI = $was }
    Remove-Item -LiteralPath $empty -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- 5. the box's engine tools (Bootstrap-VPS.ps1) ---------------------------
$boot = ReadLf 'scripts/vps/Bootstrap-VPS.ps1'
Yes 'Bootstrap-VPS.ps1 takes -IncludeEngineTools' ($boot -match '\[switch\]\$IncludeEngineTools')
Yes '  which takes -IncludeBuildTools with it' ($boot -match '(?m)^if \(\$IncludeEngineTools\) \{ \$IncludeBuildTools = \$true \}')
Yes '  adds the C++ workload and Visual Studio''s CMake to the Build Tools install' ($boot -match "'Microsoft\.VisualStudio\.Workload\.VCTools', '--includeRecommended'" -and $boot -match "'Microsoft\.VisualStudio\.Component\.VC\.CMake\.Project'" -and $boot -match "@\('modify', '--installPath'")
Yes '  through Microsoft''s installer, held to its signature' ($boot -match 'Installer\\setup\.exe' -and $boot -match '(?s)Get-AuthenticodeSignature -LiteralPath \$setup.*?Microsoft Corporation')
Yes '  and a pinned classic yarn into Node''s own folder' ($boot -match "\[string\]\`$YarnVersion = '1\.22\.22'" -and $boot -match "install --global --prefix \`$et\.NodeDir \('yarn@' \+ \`$YarnVersion\)")
Yes '  and finds them where Build-Engine.ps1 looks' ($boot -match 'Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake\.exe' -and $engine -match 'Common7\\IDE\\CommonExtensions\\Microsoft\\CMake\\CMake\\bin\\cmake\.exe')

# ---- 6. the page -------------------------------------------------------------
$readme = ReadLf 'engine/README.md'
Yes 'engine\README.md has the engine built in CI, naming engine.yml' ($readme -match '(?m)^## The engine built in CI$' -and $readme -match 'engine\.yml')
Yes '  and the run that starts it and how a pin pull request takes its records' ($readme -match 'gh workflow run engine\.yml' -and $readme -match 'Get-EngineRecords\.ps1 -Run')
Yes '  and that the fork''s own build comes first, and what it is held to' ($readme -match 'thornswood-engine-<commit>' -and $readme -match 'ForkEngineBuild\.ps1' -and $readme -match '-BuiltBy')
Yes '  and that nothing is compiled in CI, so a pin names a commit the fork built (#3014, #3399)' ($readme -match '#3014' -and $readme -match '#3399' -and $readme -match 'a head of\s+`thornswood/engine-changes`')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
