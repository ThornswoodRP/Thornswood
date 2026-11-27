<#
  test-4427-failed-publish.ps1

      pwsh -NoProfile -File tests\test-4427-failed-publish.ps1

  Issue #4427. Install-Thornswood.ps1, run to publish (its default), printed
  "Open the launcher and press Play." in green and exited 0 when Ship.ps1
  failed, so whatever ran it saw success. It also skipped its own launcher
  build and install when it was to publish, as Ship once built the launcher,
  and marked the launcher done before anything built it; Ship has sent no
  launcher since #4825, so a default run left the old launcher in place.

  A copy of Install-Thornswood.ps1 runs with -Only launcher in a scratch tree
  laid out like the real one (scripts\dev, scripts\release, scripts\vps), with
  stand-ins for Build-Launcher.ps1, Install-Launcher.ps1, Ship.ps1 and
  Close-Launcher.ps1 that write down what they were asked and exit with what
  this harness tells them:
    1. with Ship failing, the run prints the failure, not "press Play", and
       exits 1, after building and installing the launcher here;
    2. with Ship passing, it builds, installs, then publishes, says "press
       Play" and exits 0;
    3. with -NoShip it builds and installs, publishes nothing and exits 0;
    4. with no Ship.ps1 beside it, it says nothing was published and exits 0.

  Nothing leaves the machine and nothing is closed. Under ten seconds.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok, [string]$why = '') {
    if ($ok) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red; if ($why) { Write-Host ('      ' + ($why -replace "`n", "`n      ")) } }
}

$work = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'ts-4427-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$dev = [IO.Path]::Combine($work, 'scripts', 'dev')
$rel = [IO.Path]::Combine($work, 'scripts', 'release')
$vps = [IO.Path]::Combine($work, 'scripts', 'vps')
$root = [IO.Path]::Combine($work, 'root')
$calls = [IO.Path]::Combine($work, 'calls.log')
$saved = @{ TS_4427_CALLS = $env:TS_4427_CALLS; TS_4427_SHIP_EXIT = $env:TS_4427_SHIP_EXIT; THORNSWOOD_SCRATCH_ROOT = $env:THORNSWOOD_SCRATCH_ROOT }

$stubBuild = @'
param([string]$Root, [string]$OutDir, [switch]$NoPause)
Add-Content -LiteralPath $env:TS_4427_CALLS -Value 'build'
exit 0
'@
$stubInstall = @'
param([string]$Root, [string]$From, [switch]$NoPause)
Add-Content -LiteralPath $env:TS_4427_CALLS -Value 'install'
exit 0
'@
$stubShip = @'
param([Parameter(Position = 0)][string]$Notes, [string]$Root, [switch]$NoPause, [string]$Channel)
Add-Content -LiteralPath $env:TS_4427_CALLS -Value ('ship ' + $Channel)
exit ([int]$env:TS_4427_SHIP_EXIT)
'@
$stubClose = @'
function Test-GameRunning { param([string]$Root) return $false }
'@

function Invoke-Install([string[]]$more) {
    if (Test-Path -LiteralPath $calls) { Remove-Item -LiteralPath $calls -Force }
    $pwsh = (Get-Process -Id $PID).Path
    $args0 = @('-NoProfile', '-File', [IO.Path]::Combine($dev, 'Install-Thornswood.ps1'),
               '-Root', $root, '-Only', 'launcher', '-NoPause', '-Server', $root, '-Client', $root, '-ServerIp', '127.0.0.1') + $more
    $out = (& $pwsh @args0 2>&1 | Out-String)
    $code = $LASTEXITCODE
    $log = @(if (Test-Path -LiteralPath $calls) { Get-Content -LiteralPath $calls })
    return [pscustomobject]@{ Code = $code; Out = $out; Calls = ($log -join ',') }
}

try {
    foreach ($d in $dev, $rel, $vps, $root) { $null = New-Item -ItemType Directory -Force -Path $d }
    Copy-Item -LiteralPath ([IO.Path]::Combine($Repo, 'scripts', 'dev', 'Install-Thornswood.ps1')) -Destination $dev
    foreach ($f in 'Vps.ps1', 'vps.json') { Copy-Item -LiteralPath ([IO.Path]::Combine($Repo, 'scripts', 'vps', $f)) -Destination $vps }
    foreach ($f in 'Get-ScratchDir.ps1', 'Where.ps1') { Copy-Item -LiteralPath ([IO.Path]::Combine($Repo, 'scripts', 'release', $f)) -Destination $rel }
    Set-Content -LiteralPath ([IO.Path]::Combine($rel, 'Build-Launcher.ps1')) -Value $stubBuild -Encoding ASCII
    Set-Content -LiteralPath ([IO.Path]::Combine($rel, 'Install-Launcher.ps1')) -Value $stubInstall -Encoding ASCII
    Set-Content -LiteralPath ([IO.Path]::Combine($rel, 'Ship.ps1')) -Value $stubShip -Encoding ASCII
    Set-Content -LiteralPath ([IO.Path]::Combine($dev, 'Close-Launcher.ps1')) -Value $stubClose -Encoding ASCII
    $env:TS_4427_CALLS = $calls
    $env:THORNSWOOD_SCRATCH_ROOT = [IO.Path]::Combine($work, 'scratch')

    Write-Host '1. Ship fails:'
    $env:TS_4427_SHIP_EXIT = '1'
    $r = Invoke-Install @('-Notes', 'test')
    Yes "the run exits 1 ($($r.Code))" ($r.Code -eq 1) $r.Out
    Yes 'it says publishing did not finish' ($r.Out -match 'STOP\. Publishing to the dev build did not finish') $r.Out
    Yes 'and does not say press Play' ($r.Out -notmatch 'press Play') $r.Out
    Yes "it built and installed the launcher here before publishing to dev ($($r.Calls))" ($r.Calls -eq 'build,install,ship dev')
    Yes 'and no longer says the launcher is built as part of publishing' ($r.Out -notmatch 'built as part of publishing')

    Write-Host ''
    Write-Host '2. Ship passes:'
    $env:TS_4427_SHIP_EXIT = '0'
    $r = Invoke-Install @('-Notes', 'test')
    Yes "the run exits 0 ($($r.Code))" ($r.Code -eq 0) $r.Out
    Yes "it built, installed, then published to dev ($($r.Calls))" ($r.Calls -eq 'build,install,ship dev')
    Yes 'and says press Play and that it was published' ($r.Out -match 'press Play' -and $r.Out -match 'Published on the dev channel') $r.Out

    Write-Host ''
    Write-Host '3. -NoShip:'
    $env:TS_4427_SHIP_EXIT = '1'
    $r = Invoke-Install @('-NoShip')
    Yes "the run exits 0 ($($r.Code))" ($r.Code -eq 0) $r.Out
    Yes "it built and installed, and published nothing ($($r.Calls))" ($r.Calls -eq 'build,install')
    Yes 'and says press Play' ($r.Out -match 'press Play') $r.Out

    Write-Host ''
    Write-Host '4. no Ship.ps1 beside it:'
    Remove-Item -LiteralPath ([IO.Path]::Combine($rel, 'Ship.ps1')) -Force
    $r = Invoke-Install @('-Notes', 'test')
    Yes "the run exits 0 ($($r.Code))" ($r.Code -eq 0) $r.Out
    Yes "it built and installed ($($r.Calls))" ($r.Calls -eq 'build,install')
    Yes 'and says nothing was published' ($r.Out -match 'Ship\.ps1 is not here, so nothing was published') $r.Out
}
catch {
    Yes ('the harness ran to the end: ' + $_.Exception.Message) $false
}
finally {
    foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) }
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
exit ([int]($script:fail -gt 0))
