<#
  test-deploy-gamemode-warning.ps1

  Issue #520: a gamemode deploy that stops the server must warn who is on,
  or refuse without -Now. Deploy-DevGamemode got that in PR #214. The live
  stop is Deploy-Server.ps1 (Deploy-Gamemode.ps1 only builds locally and
  never talks to the VPS), so this harness checks both shapes:

    Deploy-Gamemode.ps1   no stop, no Remote, no Request-Restart; its header
                          points at Deploy-Server for the live warning
    Deploy-Server.ps1     OnlineNow / listen / Warn-LiveRoom / Request-Restart
                          / refuse without -Now when the warning cannot go out

  The Warn-LiveRoom block is driven with Remote, Request-Restart, the clock
  and exit replaced, so nothing reaches the VPS.

  Never connects to anything.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$gmPath     = Join-Path $repo 'scripts\deploy\Deploy-Gamemode.ps1'
$serverPath = Join-Path $repo 'scripts\deploy\Deploy-Server.ps1'
$askPath    = Join-Path $repo 'scripts\vps\Request-Restart.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$gm = Get-Content -LiteralPath $gmPath -Raw
$sv = Get-Content -LiteralPath $serverPath -Raw

# ---- Deploy-Gamemode is build-only (no live stop to warn before) ----------
Yes 'Deploy-Gamemode.ps1 says it does not talk to the VPS' (
    $gm -match 'does not talk to the VPS')
Yes 'Deploy-Gamemode.ps1 points at Deploy-Server for the live warning' (
    $gm -match 'Deploy-Server\.ps1' -and $gm -match 'issue #520')
Yes 'Deploy-Gamemode.ps1 has no Request-Restart call' (
    $gm -notmatch 'Request-Restart\.ps1')
Yes 'Deploy-Gamemode.ps1 has no Warn-LiveRoom / OnlineNow stop gate' (
    $gm -notmatch 'function OnlineNow' -and $gm -notmatch 'Warn-LiveRoom')

# ---- Deploy-Server carries the live warn / refuse path --------------------
$open  = '# ==== thornswood live deploy warning ===='
$close = '# ==== end thornswood live deploy warning ===='
$a = $sv.IndexOf($open)
$b = $sv.IndexOf($close)
Yes 'Deploy-Server.ps1 carries the live warning block between its markers' ($a -ge 0 -and $b -gt $a)
if (-not ($a -ge 0 -and $b -gt $a)) { Done }

$ast = [System.Management.Automation.Language.Parser]::ParseFile($serverPath, [ref]$null, [ref]$null)
$params = @{}
foreach ($p in $ast.ParamBlock.Parameters) { $params[$p.Name.VariablePath.UserPath] = $p }
function DefaultOf($name) {
    if (-not $params.ContainsKey($name) -or -not $params[$name].DefaultValue) { return $null }
    return $params[$name].DefaultValue.SafeGetValue()
}
function SetOf($p) {
    foreach ($at in $p.Attributes) {
        if ($at.TypeName.Name -eq 'ValidateSet') {
            return @($at.PositionalArguments | ForEach-Object { $_.SafeGetValue() })
        }
    }
    return @()
}

Yes '-Now is a switch on Deploy-Server' (
    $params.ContainsKey('Now') -and $params['Now'].StaticType -eq [System.Management.Automation.SwitchParameter])
Yes '-Minutes defaults to one minute' ((DefaultOf 'Minutes') -eq 1)
Yes '-Mode defaults to notice' ((DefaultOf 'Mode') -eq 'notice')
Yes '-Mode takes notice and restart' (
    $params.ContainsKey('Mode') -and ((@(SetOf $params['Mode']) | Sort-Object) -join ',') -eq 'notice,restart')
Yes '-Why is there for the restart wording' ($params.ContainsKey('Why'))
Yes 'Warn-LiveRoom is called before the stop' (
    $sv -match 'Warn-LiveRoom' -and
    ($sv.IndexOf('Warn-LiveRoom') -lt $sv.IndexOf("Stopping, swapping in and starting")))
Yes 'a missing Request-Restart refuses when people are online' (
    $sv -match 'Request-Restart\.ps1 is missing' -and
    $sv -match 'Put Request-Restart\.ps1 back')
Yes 'Request-Restart gets the data folder from Get-LiveOnline, not a hardcoded path' (
    $sv -match '-Data \$room\.Data' -and $sv -notmatch '-Data "\$Root/data"')
Yes 'Request-Restart.ps1 is still beside the vps scripts' (Test-Path -LiteralPath $askPath)

# ---- drive Warn-LiveRoom with stand-ins -----------------------------------
$block = $sv.Substring($a, $b - $a)
$Root = 'C:/Thornswood-Server'
$Here = Join-Path $repo 'scripts\deploy'
$Vps = '127.0.0.1'
$User = 'nobody'
$Minutes = 1
$Mode = 'notice'
$Why = 'a gamemode update'
$Now = $false
$rootWin = 'C:\Thornswood-Server'
$stageName = '.stage-test'
$script:remoteLines = @()
$script:askLog = Join-Path ([IO.Path]::GetTempPath()) ('ts-ask-' + [Guid]::NewGuid().ToString('N') + '.txt')
$script:clearedStage = $false
$script:exitCode = $null

function Remote($text) {
    if ("$text" -match 'Remove-Item') { $script:clearedStage = $true; return @() }
    return @($script:remoteLines)
}

# Stand-in Request-Restart: same parameter names, writes what it was asked.
$askDir = Join-Path ([IO.Path]::GetTempPath()) ('ts-askdir-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $askDir -Force | Out-Null
$askStandIn = Join-Path $askDir 'Request-Restart.ps1'
@(
    'param([double]$Minutes,[string]$Mode,[string]$Why,[string]$Vps,[string]$User,[string]$Data,[switch]$RestartFollows)'
    '$log = Join-Path $PSScriptRoot ''asked.txt'''
    '@{ Minutes=$Minutes; Mode=$Mode; Why=$Why; Data=$Data; RestartFollows=[bool]$RestartFollows } | ConvertTo-Json | Set-Content -LiteralPath $log -Encoding UTF8'
    'if ($env:THORNSWOOD_ASK_EXIT) { exit [int]$env:THORNSWOOD_ASK_EXIT }'
    'exit 0'
) | Set-Content -LiteralPath $askStandIn -Encoding UTF8

# Point Join-Path $Here '..\vps\Request-Restart.ps1' at the stand-in by
# putting the stand-in where Warn-LiveRoom looks: $Here\..\vps\Request-Restart.ps1
# We override $Here to a temp deploy folder with a vps sibling.
$tempDeploy = Join-Path ([IO.Path]::GetTempPath()) ('ts-deploy-' + [Guid]::NewGuid().ToString('N'))
$tempVps = Join-Path $tempDeploy '..\vps' | Resolve-Path -ErrorAction SilentlyContinue
# Build: tempDeploy/scripts/deploy style
$tempHere = Join-Path $tempDeploy 'deploy'
$tempVpsDir = Join-Path $tempDeploy 'vps'
New-Item -ItemType Directory -Path $tempHere -Force | Out-Null
New-Item -ItemType Directory -Path $tempVpsDir -Force | Out-Null
Copy-Item -LiteralPath $askStandIn -Destination (Join-Path $tempVpsDir 'Request-Restart.ps1') -Force
$Here = $tempHere

function script:Exit-Test([int]$code) { $script:exitCode = $code; throw "EXIT:$code" }

# Replace exit in the block with a throw we can catch.
$blockDriven = $block -replace '(?m)^\s*exit 1\s*$', 'Exit-Test 1'
# And Start-Sleep / Get-Date for a fast countdown.
$script:fakeNow = [datetime]'2026-09-27T12:00:00'
$script:sleeps = 0
function Get-Date { return $script:fakeNow }
function Start-Sleep {
    param($Seconds, $Milliseconds)
    $add = 0
    if ($PSBoundParameters.ContainsKey('Seconds')) { $add = [double]$Seconds }
    elseif ($PSBoundParameters.ContainsKey('Milliseconds')) { $add = [double]$Milliseconds / 1000.0 }
    $script:fakeNow = $script:fakeNow.AddSeconds([Math]::Max(1, $add))
    $script:sleeps++
}

Invoke-Expression $blockDriven

# 1) nobody online, no -Now: still said (in Discord, by Request-Restart, #5784) and waited out
$script:remoteLines = @('DATA C:/Thornswood-Server/data', 'UP yes', 'ONLINE 0')
$script:exitCode = $null
$script:clearedStage = $false
$script:fakeNow = [datetime]'2026-11-11T12:00:00'
$script:sleeps = 0
$Now = $false
$out = @(& { Warn-LiveRoom } 6>&1 | ForEach-Object { "$_" })
Yes 'nobody online is still said, through Request-Restart, and waited out (#5784)' (
    ($out -join "`n") -match 'nobody is online; saying it in Discord' -and (Test-Path (Join-Path $tempVpsDir 'asked.txt')) -and
    $script:sleeps -gt 0 -and (($out -join "`n") -match 'notice given'))
Remove-Item (Join-Path $tempVpsDir 'asked.txt') -Force -ErrorAction SilentlyContinue

# 2) not listening
$script:remoteLines = @('DATA C:/Thornswood-Server/data', 'UP no', 'ONLINE 0')
$out = @(& { Warn-LiveRoom } 6>&1 | ForEach-Object { "$_" })
Yes 'not listening is treated as nobody on' (
    ($out -join "`n") -match 'not listening')

# 3) people online, warning goes out
Remove-Item (Join-Path $tempVpsDir 'asked.txt') -Force -ErrorAction SilentlyContinue
$script:remoteLines = @('DATA C:/elsewhere/data', 'UP yes', 'ONLINE 2')
$script:fakeNow = [datetime]'2026-09-27T12:00:00'
$script:sleeps = 0
$env:THORNSWOOD_ASK_EXIT = '0'
$out = @(& { Warn-LiveRoom } 6>&1 | ForEach-Object { "$_" })
$asked = $null
if (Test-Path (Join-Path $tempVpsDir 'asked.txt')) {
    $asked = Get-Content (Join-Path $tempVpsDir 'asked.txt') -Raw | ConvertFrom-Json
}
Yes 'people online are counted before the stop' (($out -join "`n") -match '2 online')
Yes 'Request-Restart was asked with RestartFollows' ($asked -and $asked.RestartFollows -eq $true)
Yes 'Request-Restart got the data folder from the box' ($asked -and $asked.Data -eq 'C:/elsewhere/data')
Yes 'notice mode waits out the countdown' ($script:sleeps -gt 0 -and (($out -join "`n") -match 'notice given'))

# 4) warning fails: refuse
Remove-Item (Join-Path $tempVpsDir 'asked.txt') -Force -ErrorAction SilentlyContinue
$script:remoteLines = @('DATA C:/Thornswood-Server/data', 'UP yes', 'ONLINE 3')
$script:clearedStage = $false
$script:exitCode = $null
$env:THORNSWOOD_ASK_EXIT = '1'
$threw = $false
try { $out = @(& { Warn-LiveRoom } 6>&1 | ForEach-Object { "$_" }) } catch { $threw = ("$_" -match 'EXIT:1'); $out = @() }
Yes 'a failed Request-Restart refuses the stop' ($threw -and $script:exitCode -eq 1)
Yes 'and clears the stage so the server is left as it was' ($script:clearedStage)

# 5) Request-Restart missing: refuse
Remove-Item (Join-Path $tempVpsDir 'Request-Restart.ps1') -Force
$script:remoteLines = @('DATA C:/Thornswood-Server/data', 'UP yes', 'ONLINE 1')
$script:clearedStage = $false
$script:exitCode = $null
$threw = $false
try { $null = @(& { Warn-LiveRoom } 6>&1) } catch { $threw = ("$_" -match 'EXIT:1') }
Yes 'a missing Request-Restart refuses when people are online' ($threw -and $script:exitCode -eq 1)
Yes 'and clears the stage when Request-Restart is missing' ($script:clearedStage)

# Put the stand-in back for -Now cases
Copy-Item -LiteralPath $askStandIn -Destination (Join-Path $tempVpsDir 'Request-Restart.ps1') -Force
Remove-Item Env:THORNSWOOD_ASK_EXIT -ErrorAction SilentlyContinue

# 6) -Now with people online: no ask, prints count
$Now = $true
$script:remoteLines = @('DATA C:/Thornswood-Server/data', 'UP yes', 'ONLINE 4')
Remove-Item (Join-Path $tempVpsDir 'asked.txt') -Force -ErrorAction SilentlyContinue
$out = @(& { Warn-LiveRoom } 6>&1 | ForEach-Object { "$_" })
Yes '-Now prints the count and does not warn' (
    (($out -join "`n") -match '-Now: 4 online') -and
    -not (Test-Path (Join-Path $tempVpsDir 'asked.txt')))

# 7) -Now with nobody
$script:remoteLines = @('DATA C:/Thornswood-Server/data', 'UP yes', 'ONLINE 0')
$out = @(& { Warn-LiveRoom } 6>&1 | ForEach-Object { "$_" })
Yes '-Now with nobody says so' (($out -join "`n") -match '-Now: nobody is online')

# cleanup
Remove-Item -LiteralPath $tempDeploy -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $askDir -Recurse -Force -ErrorAction SilentlyContinue

Done
