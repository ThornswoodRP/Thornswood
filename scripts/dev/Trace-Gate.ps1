<#
.SYNOPSIS
  The box's half of the gate trace (#3114): the trace's self-test on the
  box, and the trace task that traced main builds on the box's build
  runners.

.DESCRIPTION
  Run on the shipping machine, by somebody with the box's administrator key:

      .\scripts\dev\Trace-Gate.ps1 -SelfTest     # the trace's own check, a minute
      .\scripts\dev\Trace-Gate.ps1 -Install       # the trace task that traces every main build
      .\scripts\dev\Trace-Gate.ps1 -Status        # what the trace task is doing
      .\scripts\dev\Trace-Gate.ps1 -Uninstall     # the trace task taken off again
      .\scripts\dev\Trace-Gate.ps1 -Clean         # any session a run left stopped, the folder emptied

  WHY. A pull request should run only the gate harnesses its change can
  affect (scripts\dev\Affected-Harnesses.js), and which those are is
  measured on the machine the gate runs on, not guessed from a Linux run:
  a harness that asks which system it is on, or names a Windows path, can
  read other files on Windows. Patrick chose this on 22 Oct 2026 (option C on
  his page, q-3114-affected) after the Linux study in docs\AFFECTED-HARNESSES.md.

  THE WHOLE GATE, TRACED. Since #5119 every build runs on GitHub's hosted
  runner, so the gate is traced there: the public .github\workflows\
  gate-map.yml runs the whole gate under the same ETW session
  (scripts\dev\Trace-Gate-Here.ps1 around Trace-Gate-Box.ps1) every night
  and by hand, and keeps the map as an artifact:

      gh workflow run gate-map.yml --ref main

  This script no longer starts a traced gate on the box. Its old way,
  the private ops repository's trace-gate.yml on a box build runner, was
  taken out with it (#5270): it was never run
  there, it checked out any ref it was given on the box, and the box's
  runners keep only the jobs that need the box.

  The session and the trace are in C:\Thornswood-Trace on the box, which only
  administrators can read: a trace sees the name of every file anything on
  the box opens. -Clean stops any session a run left and empties it, but
  for the trace task's own folders.

  THE TRACE TASK (-Install). Patrick chose on 22 Oct 2026 (option A on
  q-3114-map-refresh) to trace every main build, and scripts\dev\
  Trace-Gate-Task.ps1 did, as SYSTEM, at the build's asking
  (scripts\dev\Run-Gate.ps1), while main's builds ran on the box's build
  runners. -Install sends it and Trace-Gate-Box.ps1 to
  C:\Thornswood-Trace\task, makes each build runner's trace and gate-map
  folders (the runners records\build-runners.json lists, so run it again
  when that list changes), and registers and starts the scheduled task
  Thornswood Gate Trace. Run again, it replaces the scripts and starts the
  task again; a trace it was taking is dropped. -Uninstall takes the task
  and those folders off, and then a build on a box runner runs untraced and
  pull requests there run the whole gate.

.PARAMETER SelfTest
  Only the self-test.

.PARAMETER Clean
  Stop any trace session and empty C:\Thornswood-Trace on the box.

.PARAMETER Install
  Install the trace task, or put this checkout's copy in its place.

.PARAMETER Status
  What the trace task is doing: its state, the map each build runner has
  and the end of its log.

.PARAMETER Uninstall
  Take the trace task and its folders off the box.

#>
[CmdletBinding()]
param(
    [switch]$SelfTest,
    [switch]$Clean,
    [switch]$Install,
    [switch]$Status,
    [switch]$Uninstall,
    [string]$Vps = '',
    [string]$User = ''
)

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent (Split-Path -Parent $Here)
. (Join-Path $RepoRoot 'scripts\vps\Send-Script.ps1')
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
if (-not $User) { $User = Get-ThornswoodVpsUser }
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10')
$BoxScript = Join-Path $Here 'Trace-Gate-Box.ps1'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) { Write-Host ''; Write-Host "STOP. $m" -ForegroundColor Red; exit 1 }

# The box script with what it is told set above it. A long one goes by scp
# (Send-Script.ps1).
function Invoke-Box([string]$mode, [hashtable]$vars = @{}) {
    $pre = "`$ProgressPreference = 'SilentlyContinue'`r`n`$TraceMode = '" + $mode + "'`r`n"
    foreach ($k in $vars.Keys) {
        $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$vars[$k]))
        $pre += '$' + $k + " = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + $b64 + "'))`r`n"
    }
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $out = @(Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Bypass -Script ($pre + [IO.File]::ReadAllText($BoxScript)) |
        ForEach-Object { [string]$_ })
    $rc = $LASTEXITCODE
    $ErrorActionPreference = $old
    return [pscustomobject]@{ Code = $rc; Lines = $out }
}
function Show($box) {
    foreach ($l in $box.Lines) {
        if ($l -eq 'BEGIN') { break }
        $c = 'Gray'
        if ($l -match '^PASS ') { $c = 'Green' } elseif ($l -match '^(FAIL|REFUSED)') { $c = 'Red' }
        Say "  $l" $c
    }
}

if (-not ($SelfTest -or $Clean -or $Install -or $Status -or $Uninstall)) {
    Die ('Say what to do: -SelfTest, -Install, -Status, -Uninstall or -Clean. The whole gate is traced on GitHub''s hosted runner now, by gate-map.yml in this repository: gh workflow run gate-map.yml --ref main')
}

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) { Die 'ssh is not on PATH.' }

if ($Clean) {
    Head 'Emptying the trace folder on the box'
    $b = Invoke-Box 'clean'; Show $b
    exit $b.Code
}

if ($Status) {
    Head 'The trace task on the box'
    $b = Invoke-Box 'status'; Show $b
    exit $b.Code
}

if ($Uninstall) {
    Head 'Taking the trace task off the box'
    $b = Invoke-Box 'uninstall'; Show $b
    exit $b.Code
}

if ($Install) {
    # The build runners, by records\build-runners.json, with the names
    # Install-Runner.ps1 gives the nth: the first has no number on its own.
    $numbers = @((Get-Content -LiteralPath (Join-Path $RepoRoot 'records\build-runners.json') -Raw | ConvertFrom-Json).runners)
    $runners = @($numbers | ForEach-Object {
        $n = [int]$_
        if ($n -le 1) { [ordered]@{ root = 'C:\Thornswood-Runner'; account = 'thornswood-runner' } }
        else { [ordered]@{ root = 'C:\Thornswood-Runner' + $n; account = 'thornswood-runner' + $n } }
    })
    if (-not $runners.Count) { Die 'records\build-runners.json lists no build runner.' }
    Head '1. The self-test on the box'
    $b = Invoke-Box 'selftest'
    Show $b
    if ($b.Code -ne 0) { Die ('the self-test did not pass (exit ' + $b.Code + '), so the task would trace nothing worth reading. Nothing was installed.') }
    Head ('2. The trace task, for runners ' + (@($numbers) -join ', '))
    $b = Invoke-Box 'install' @{
        TraceBoxText = [IO.File]::ReadAllText($BoxScript)
        TraceTaskText = [IO.File]::ReadAllText((Join-Path $Here 'Trace-Gate-Task.ps1'))
        TraceRunners = (ConvertTo-Json -InputObject @{ runners = @($runners) } -Compress -Depth 3)
    }
    Show $b
    if ($b.Code -ne 0) { Die ('the install did not finish (exit ' + $b.Code + '); the lines above say where it stopped.') }
    Say '  installed. The next main build built on a build runner is traced; its log says "Traced:", and -Status shows the map once it is read.' 'Green'
    exit 0
}

Head 'The self-test on the box'
$b = Invoke-Box 'selftest'
Show $b
if ($b.Code -ne 0) { Die ('the self-test did not pass (exit ' + $b.Code + '), so a trace on this box would prove nothing. The lines above say what was missing.') }
exit 0
