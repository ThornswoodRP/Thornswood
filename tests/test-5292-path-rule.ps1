<#
  test-5292-path-rule.ps1

      pwsh -NoProfile -File .\tests\test-5292-path-rule.ps1

  Issue #5292: a pull request that changes only docs, the site or the bot
  starts no Windows job. The checks of the tree that need no Windows run in
  build.yml's job "Tree checks" on Linux for every change; the pick says
  whether the job "Launcher builds" has anything to check
  (scripts\dev\Launcher-Reach.ps1), and when it has not, that job still runs,
  on Linux, and passes with one step that says why, so it is never skipped
  for the path rule (Magpie's finding of 1 Nov 2026); and "Build check
  result" needs that job to pass, and counts the gate as passed when it was
  skipped only when the pick said so.
  This checks that:

    1. Launcher-Reach.ps1, run for real against commits in a scratch
       repository, says launcher=false for a change only under docs, site
       and bot, and launcher=true, naming the file, for one that touches
       anything else (the launcher, a file at the root, a folder whose name
       only starts like docs); true on main and a run by hand, with no base,
       and with a base git cannot find, each saying why;
    2. "Build check result"'s own script, run with bash for each result and
       output it can be given, passes only when the pick, the tree checks
       and the launcher build passed and the gate, its Windows shares and
       since #5293 its Linux shares, each passed or were skipped because
       the pick said they had nothing to do; a skipped launcher build never
       passes;
    3. read from this repository: the launcher job's steps are exactly the
       one that says why there is nothing to build, which alone runs when
       the pick said launcher=false, on Linux, then the launcher window, the
       ship root tool, the MSBuild launcher and the note, which run only
       otherwise, on Windows (the 5.1 comparison of the writing check went
       with #5356), and
       none of what they build or read names docs, site or bot; the writing
       check's harness runs in Tree checks too; Tree checks is on Linux,
       always runs, and has no step that needs Windows.

  Writes only its scratch folder, in the system's temp folder, and deletes it.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function GitOk { $o = @(& git @args 2>&1); if ($LASTEXITCODE -ne 0) { throw ('git ' + ($args -join ' ') + ': ' + ($o -join ' ')) }; $o }
function Read-Text([string]$rel) { [IO.File]::ReadAllText((Join-Path $repo $rel)).Replace("`r`n", "`n") }

# The job in a workflow, from its key to the next job's key.
function Get-Job([string]$text, [string]$key) {
    $m = [regex]::Match($text, "(?ms)^  ${key}:\n.*?(?=^  [a-z][\w-]*:\n|\z)")
    if ($m.Success) { $m.Value } else { '' }
}
function Get-StepNames([string]$job) { @([regex]::Matches($job, '(?m)^      - name: (.*)$') | ForEach-Object { $_.Groups[1].Value.Trim() }) }

# ---- 3. read from this repository -------------------------------------------
$build = Read-Text '.github/workflows/build.yml'
$pr = Read-Text '.github/workflows/build-pr.yml'
$launcher = Get-Job $build 'launcher'
$checks = Get-Job $build 'checks'
$pick = Get-Job $build 'pick'
$want = @('Say why there is nothing to build', 'Check the launcher window', 'Build the ship root tool', 'Check the MSBuild launcher against its sources',
    'Write down the tree these checks passed on')
$have = Get-StepNames $launcher
Yes ('the job "Launcher builds" has exactly the step that says why there is nothing to build, the steps that need Windows, and the note (' + ($have -join '; ') + ')') (($have -join '|') -eq ($want -join '|'))
Yes '  and always runs, never skipped for the path rule' ($launcher -match "(?m)^    if: \$\{\{ !cancelled\(\) && needs\.tested\.outputs\.run == '' \}\}$" -and $launcher -notmatch 'outputs\.launcher != ''false'' \}\}')
Yes '  on Linux when the pick says the change cannot reach it, and on Windows otherwise, a failed or silent pick included' ($launcher -match "(?m)^    runs-on: \$\{\{ needs\.pick\.outputs\.launcher == 'false' && 'ubuntu-24\.04-arm' \|\| 'windows-latest' \}\}$" -and $launcher -match "(?m)^      REACHES: \$\{\{ needs\.pick\.outputs\.launcher \}\}$")
$steps = @([regex]::Split(($launcher -replace '(?s)^.*?\n    steps:\n', ''), '\n(?=      - )') | Where-Object { $_ -match '^      - ' })
$why = $steps[0]
Yes '  where the first step alone runs, says why, and runs nothing' ($why -match "^      - name: Say why there is nothing to build\n        if: env\.REACHES == 'false'\n" -and $why -notmatch '(?m)^\s+(uses|shell):|pwsh|powershell|\.ps1 |node ')
$unguarded = @($steps | Select-Object -Skip 1 | Where-Object { $_ -notmatch "\n        if: env\.REACHES != 'false'(\n| && \()" })
Yes ('  and every other step runs only when the pick did not say so (' + $steps.Count + ' steps)') ($steps.Count -ge 7 -and $unguarded.Count -eq 0)
# What those steps build and read. Each named here is what one of them runs
# or compiles; none may name a folder the path rule skips.
$reads = @('scripts/dev/Check-Controls.ps1', 'scripts/release/ShipRoot/ShipRoot.csproj', 'launcher/tests/test-498-msbuild.ps1', 'launcher/tests/test-app-manifest.ps1',
    'scripts/release/Build-Launcher.ps1', 'scripts/release/LauncherVersion.ps1', 'scripts/release/Find-MSBuild.ps1',
    'launcher/app/Thornswood.csproj', 'installer/setup/Setup.csproj')
foreach ($f in $reads) {
    $t = Read-Text $f
    $named = [regex]::Matches($t, '(?i)(?<![\w.-])(docs|site|bot)[\\/]') | ForEach-Object { $_.Value }
    Yes ("  $f names no folder under docs, site or bot" + $(if ($named) { ' (' + (@($named) -join ', ') + ')' } else { '' })) (-not $named)
}
$runs = @([regex]::Matches($launcher, '(?m)^\s*(?:&\s*)?(?:pwsh|powershell)[^\n]*-File\s+(\S+)') | ForEach-Object { $_.Groups[1].Value.Replace('\', '/') })
$runs += @([regex]::Matches($launcher, '(?m)(scripts\\release\\ShipRoot\\ShipRoot\.csproj)') | ForEach-Object { $_.Groups[1].Value.Replace('\', '/') })
$unlisted = @($runs | Where-Object { $_ -notin $reads })
Yes ('  and every script or project the job runs is one of those (' + ($runs -join ', ') + ')') ($runs.Count -ge 4 -and -not $unlisted.Count)
Yes 'the writing check''s harness runs in Tree checks for every change too' ($checks -match "foreach \(\`$n in 'test-check-words\.ps1', 'test-note-rules\.ps1', 'test-ship-check-words\.ps1'\)")
Yes 'Tree checks is on Linux and always runs, once "tested" found no green pull request build' ($checks -match '(?m)^    runs-on: ubuntu-latest$' -and $checks -match "(?m)^    needs: tested\n    if: \$\{\{ !cancelled\(\) && needs\.tested\.outputs\.run == '' \}\}$")
$code = ($checks -split "`n" | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
Yes '  and none of its steps needs Windows: no Windows PowerShell, no MSBuild, no backslash path handed to node' ($code -notmatch 'shell: powershell|Find-MSBuild|\bmsbuild\b|node\s+\S*\\|Scripts\\python\.exe')
Yes 'the pick runs Launcher-Reach.ps1 with the base, and hands on launcher=' ($pick -match '(?m)^      launcher: \$\{\{ steps\.reach\.outputs\.launcher \}\}$' -and $pick -match '(?m)^          ./scripts/dev/Launcher-Reach\.ps1 -Base \$env:BASE$' -and $pick -match '(?m)^          BASE: \$\{\{ github\.event\.pull_request\.base\.sha \}\}$')
$prResult = Get-Job $pr 'result'
Yes 'Build check result needs the pick, the tree checks, the launcher build and the gate on both platforms' ($prResult -match '(?m)^    needs: \[pick, checks, launcher, gate, gate-linux\]$')

# ---- 2. Build check result's script, run --------------------------------------
$script = ''
$m = [regex]::Match($prResult, '(?ms)^        run: \|\n(.*)\z')
if ($m.Success) { $script = (($m.Groups[1].Value -split "`n") | ForEach-Object { $_ -replace '^          ', '' }) -join "`n" }
$bash = Get-Command bash -ErrorAction SilentlyContinue
if (-not $script) { Yes 'Build check result has a script to run' $false }
elseif (-not $bash) { Write-Host 'SKIP  Build check result''s script: no bash here, which GitHub''s ubuntu-latest runs it with' }
else {
    $scratch0 = Join-Path ([IO.Path]::GetTempPath()) ('path-rule-result-' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $scratch0
    try {
        $file = Join-Path $scratch0 'result.sh'
        [IO.File]::WriteAllText($file, $script + "`n")
        $cases = @(
            @('everything passed', 'success', 'success', 'success', 'success', 'true', '[1,2]', 'success', '[1]', 0),
            @('the launcher build passed on Linux because the pick said the change cannot reach it', 'success', 'success', 'success', 'success', 'false', '[1]', 'success', '[1]', 0),
            @('the launcher build skipped, though the pick said the change cannot reach it (a skip is not a pass)', 'success', 'success', 'skipped', 'success', 'false', '[1]', 'success', '[1]', 1),
            @('the gate skipped because the pick gave it no share', 'success', 'success', 'success', 'skipped', 'true', '[]', 'success', '[1]', 0),
            @('a change to a doc no harness reads: the launcher build passed on Linux and the gate skipped', 'success', 'success', 'success', 'skipped', 'false', '[]', 'success', '[1]', 0),
            @('the launcher build skipped though the pick said it reaches it', 'success', 'success', 'skipped', 'success', 'true', '[1]', 'success', '[1]', 1),
            @('the launcher build skipped and the pick said nothing', 'success', 'success', 'skipped', 'success', '', '[1]', 'success', '[1]', 1),
            @('the launcher build skipped beside a failed pick', 'failure', 'success', 'skipped', 'skipped', 'false', '[]', 'success', '[1]', 1),
            @('the gate skipped though the pick gave it shares', 'success', 'success', 'success', 'skipped', 'true', '[1,2]', 'success', '[1]', 1),
            @('the tree checks failed', 'success', 'failure', 'success', 'success', 'true', '[1]', 'success', '[1]', 1),
            @('the tree checks skipped', 'success', 'skipped', 'success', 'success', 'true', '[1]', 'success', '[1]', 1),
            @('the launcher build failed', 'success', 'success', 'failure', 'success', 'true', '[1]', 'success', '[1]', 1),
            @('the launcher build was cancelled', 'success', 'success', 'cancelled', 'success', 'true', '[1]', 'success', '[1]', 1),
            @('a share of the gate failed', 'success', 'success', 'success', 'failure', 'true', '[1]', 'success', '[1]', 1),
            @('the Linux shares skipped because the pick gave them none (#5293)', 'success', 'success', 'success', 'success', 'true', '[1]', 'skipped', '[]', 0),
            @('every gate skipped, a change to a doc no harness reads', 'success', 'success', 'success', 'skipped', 'false', '[]', 'skipped', '[]', 0),
            @('the Linux shares skipped though the pick gave them some', 'success', 'success', 'success', 'success', 'true', '[1]', 'skipped', '[1,2]', 1),
            @('the Linux shares skipped and the pick said nothing', 'success', 'success', 'success', 'success', 'true', '[1]', 'skipped', '', 1),
            @('a Linux share failed', 'success', 'success', 'success', 'success', 'true', '[1]', 'failure', '[1]', 1),
            @('a Linux share was cancelled', 'success', 'success', 'success', 'success', 'true', '[1]', 'cancelled', '[1]', 1))
        foreach ($c in $cases) {
            $env:PICK = $c[1]; $env:CHECKS = $c[2]; $env:BUILD = $c[3]; $env:GATE = $c[4]; $env:REACHES_LAUNCHER = $c[5]; $env:SHARES = $c[6]; $env:GATE_LINUX = $c[7]; $env:LINUX_SHARES = $c[8]
            $null = & bash $file 2>&1
            $rc = $LASTEXITCODE
            Yes ("Build check result: {0}: {1}" -f $c[0], $(if ($c[9] -eq 0) { 'passes' } else { 'fails' })) ($rc -eq $c[9])
        }
    } finally {
        foreach ($n in 'PICK', 'CHECKS', 'BUILD', 'GATE', 'REACHES_LAUNCHER', 'SHARES', 'GATE_LINUX', 'LINUX_SHARES') { Remove-Item -LiteralPath "Env:$n" -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $scratch0 -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# ---- 1. Launcher-Reach.ps1, run ------------------------------------------------
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('path-rule-test-' + [Guid]::NewGuid().ToString('N'))
$keep = @{}
foreach ($n in 'GITHUB_EVENT_NAME', 'GITHUB_OUTPUT') { $keep[$n] = [Environment]::GetEnvironmentVariable($n) }
$here = Get-Location
try {
    $sr = Join-Path $scratch 'repo'
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $sr 'scripts/dev'), (Join-Path $sr 'docs'), (Join-Path $sr 'site'), (Join-Path $sr 'bot'), (Join-Path $sr 'launcher'), (Join-Path $sr 'docsx')
    Copy-Item -LiteralPath (Join-Path $repo 'scripts/dev/Launcher-Reach.ps1') -Destination (Join-Path $sr 'scripts/dev')
    foreach ($f in 'docs/a.md', 'site/b.html', 'bot/c.py', 'launcher/d.cs', 'docsx/e.md', 'README.md') { Set-Content -LiteralPath (Join-Path $sr $f) -Value $f }
    $null = GitOk init -q $sr
    $null = GitOk -C $sr config user.name 'Path rule test'
    $null = GitOk -C $sr config user.email 'path-rule-test@example.invalid'
    $null = GitOk -C $sr config core.autocrlf false
    $null = GitOk -C $sr add -A
    $null = GitOk -C $sr commit -q -m base
    $base = ((GitOk -C $sr rev-parse HEAD) -join '').Trim()
    Set-Location -LiteralPath $sr
    $out = Join-Path $scratch 'output.txt'

    function Reach([string[]]$files, [string]$event = 'pull_request', [string]$baseArg = $base) {
        $null = GitOk -C $sr reset -q --hard $base
        foreach ($f in $files) { Add-Content -LiteralPath (Join-Path $sr $f) -Value 'changed' }
        if ($files.Count) { $null = GitOk -C $sr commit -q -am ('change ' + ($files -join ' ')) }
        Remove-Item -LiteralPath $out -ErrorAction SilentlyContinue
        $env:GITHUB_OUTPUT = $out; $env:GITHUB_EVENT_NAME = $event
        $said = @(& pwsh -NoProfile -File (Join-Path $sr 'scripts/dev/Launcher-Reach.ps1') -Base $baseArg 2>&1 | ForEach-Object { "$_" })
        $rc = $LASTEXITCODE
        $o = $(if (Test-Path -LiteralPath $out) { [IO.File]::ReadAllText($out) } else { '' })
        $v = $(if ($o -match '(?m)^launcher=(\w+)\s*$') { $Matches[1] } else { '' })
        [pscustomobject]@{ Code = $rc; Value = $v; Text = ($said -join "`n") }
    }

    $r = Reach @('docs/a.md')
    Yes ("1. a change only under docs: launcher=false ($($r.Value)), saying why") ($r.Code -eq 0 -and $r.Value -eq 'false' -and $r.Text -match 'skipped, all 1 file')
    $r = Reach @('docs/a.md', 'site/b.html', 'bot/c.py')
    Yes "   only under docs, site and bot: launcher=false ($($r.Value))" ($r.Value -eq 'false' -and $r.Text -match 'all 3 file')
    $r = Reach @('docs/a.md', 'launcher/d.cs')
    Yes "   docs and the launcher: launcher=true ($($r.Value)), naming the launcher file" ($r.Value -eq 'true' -and $r.Text -match 'launcher/d\.cs' -and $r.Text -notmatch 'docs/a\.md,')
    $r = Reach @('README.md')
    Yes "   a file at the root: launcher=true ($($r.Value))" ($r.Value -eq 'true' -and $r.Text -match 'README\.md')
    $r = Reach @('docsx/e.md')
    Yes "   a folder whose name only starts like docs: launcher=true ($($r.Value))" ($r.Value -eq 'true' -and $r.Text -match 'docsx/e\.md')
    $r = Reach @('docs/a.md') 'push'
    Yes "   on main (a push) it always builds: launcher=true ($($r.Value)), saying why" ($r.Value -eq 'true' -and $r.Text -match 'push run, not a pull request')
    $r = Reach @('docs/a.md') 'workflow_dispatch'
    Yes "   and on a run by hand ($($r.Value))" ($r.Value -eq 'true' -and $r.Text -match 'workflow_dispatch run')
    $r = Reach @('docs/a.md') 'pull_request' ''
    Yes "   with no base: launcher=true ($($r.Value)), saying why" ($r.Value -eq 'true' -and $r.Text -match 'no base commit was given')
    $r = Reach @('docs/a.md') 'pull_request' ('0123456789abcdef' * 2 + '01234567')
    Yes "   with a base git cannot find: launcher=true ($($r.Value)), saying why" ($r.Code -eq 0 -and $r.Value -eq 'true' -and $r.Text -match 'could not fetch the base')
    $r = Reach @() 'pull_request'
    Yes "   with nothing changed: launcher=true ($($r.Value)), saying why" ($r.Value -eq 'true' -and $r.Text -match 'lists no file changed')
} finally {
    Set-Location -LiteralPath $here
    foreach ($n in $keep.Keys) { [Environment]::SetEnvironmentVariable($n, $keep[$n]) }
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
