<#
  test-1319-pass-switch.ps1

  #1319. The gamemode now reads thornswoodRequirePass as on unless it is
  false (game\tests\test-1319-pass-switch.js). So a deploy never changes what a
  server does without being asked: a server whose settings hold neither true
  nor false is refused until -RequirePass says which.

    Deploy-Server.ps1     the carry on the box ($settingsCarryBlock in
                          ServerSettings.ps1) refuses, clears the stage and
                          leaves the server alone, unless this run's
                          -RequirePass says which (#1223: never the build)
    Deploy-DevGamemode    the first step on the box, before anything is sent,
                          refuses unless -RequirePass was given, and a
                          -RequirePass on or off always writes a real true or
                          false, even over "true" or "false" as text
    Deploy-Gamemode       writes no value into the build any more, and
                          says Deploy-Server -RequirePass is what sets it
                          (#1223)

  HOW. ServerSettings.ps1 is dot-sourced and its carry block run here against
  settings files in a temp folder; the two deploy scripts are read. Nothing
  connects to anything.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
if (-not $here) { $here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $here
$deploy = Join-Path (Join-Path $repo 'scripts') 'deploy'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

. (Join-Path $deploy 'ServerSettings.ps1')

# ---- the one question ------------------------------------------------------
function Doc([string]$json) { return ($json | ConvertFrom-Json) }
Yes 'true is a real answer' ((Get-ThornswoodPassSwitchProblem (Doc '{"thornswoodRequirePass":true}')) -eq '')
Yes 'false is a real answer' ((Get-ThornswoodPassSwitchProblem (Doc '{"thornswoodRequirePass":false}')) -eq '')
$missing = Get-ThornswoodPassSwitchProblem (Doc '{"port":7777}')
Yes 'absent is not, and the reason says missing and what to run' ($missing -match '^thornswoodRequirePass is missing' -and
    $missing -match 'Deploy-Server\.ps1 -RequirePass on, or off' -and $missing -match '#1319')
foreach ($j in @('{"thornswoodRequirePass":""}', '{"thornswoodRequirePass":"true"}', '{"thornswoodRequirePass":"false"}',
                 '{"thornswoodRequirePass":null}', '{"thornswoodRequirePass":1}', '{"thornswoodRequirePass":0}')) {
    $w = Get-ThornswoodPassSwitchProblem (Doc $j)
    Yes ("$j is not, and the reason says neither true nor false") ($w -match '^thornswoodRequirePass is neither true nor false')
}
Yes 'the reason names the key and never the value' ((Get-ThornswoodPassSwitchProblem (Doc '{"thornswoodRequirePass":"a-value-xyz"}')) -notmatch 'a-value-xyz')
Yes 'nothing at all is not a real answer either' ((Get-ThornswoodPassSwitchProblem $null) -match 'missing')

# ---- Deploy-Server's carry ---------------------------------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-1319-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
function Carry($running, $release, [string]$RequirePass = '') {
    $Root = Join-Path $tmp ([Guid]::NewGuid().ToString('N'))
    $Stage = '.stage-20261005-000000'
    # As Deploy-Server.ps1 hands them over (#1223): the keys the build may
    # change, and what this run asked for, which the swap may let move too.
    $Asked = New-ThornswoodAsked $RequirePass
    $ReleaseKeys = @($ThornswoodGamemodeKeys + @($Asked.Keys))
    # The line itself, run here the way the box runs it, sets $Asked.
    . ([scriptblock]::Create((Get-ThornswoodAskedLine $Asked)))
    New-Item -ItemType Directory -Path (Join-Path $Root $Stage) -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $Root 'server-settings.json'), ($running | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path (Join-Path $Root $Stage) 'server-settings.json'), ($release | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))
    $runBefore = [IO.File]::ReadAllText((Join-Path $Root 'server-settings.json'))
    $said = @(& ([scriptblock]::Create($settingsCarryBlock)) | ForEach-Object { "$_" })
    $staged = $null
    $sp = Join-Path (Join-Path $Root $Stage) 'server-settings.json'
    if (Test-Path -LiteralPath $sp) { $staged = [IO.File]::ReadAllText($sp) | ConvertFrom-Json }
    return [pscustomobject]@{
        Said = $said; Carried = [bool]@($said | Where-Object { $_ -match '^CARRIED [0-9a-f]{64}$' }).Count
        Refused = ($said -contains 'CARRY REFUSED'); Staged = $staged
        StageGone = -not (Test-Path -LiteralPath (Join-Path $Root $Stage))
        RunKept = ([IO.File]::ReadAllText((Join-Path $Root 'server-settings.json')) -eq $runBefore)
    }
}
$live = [ordered]@{ port = 7777; name = 'Thornswood'; thornswoodServer = 'main'; loadOrder = @('C:/s/Skyrim.esm') }
$build = [ordered]@{ port = 7777; name = 'Thornswood'; thornswoodServer = 'main'; loadOrder = @('C:/s/Skyrim.esm'); maxPlayers = 30 }
function With($o, [string]$k, $v) { $n = [ordered]@{}; foreach ($key in $o.Keys) { $n[$key] = $o[$key] }; $n[$k] = $v; return $n }

try {
    $r = Carry (With $live 'thornswoodRequirePass' $true) $build
    Yes 'live true, the build silent: carried, and live keeps true' ($r.Carried -and -not $r.Refused -and $r.Staged.thornswoodRequirePass -eq $true)
    $r = Carry (With $live 'thornswoodRequirePass' $false) $build
    Yes 'live false, the build silent: carried, and live keeps false' ($r.Carried -and $r.Staged.thornswoodRequirePass -is [bool] -and -not $r.Staged.thornswoodRequirePass)
    # A build's value is never taken (#1223): only this run's -RequirePass.
    $r = Carry $live (With $build 'thornswoodRequirePass' $true)
    Yes 'live missing, the build says true and this run says nothing: refused, the build is not the answer' ($r.Refused -and -not $r.Carried -and $r.RunKept)
    $r = Carry $live $build 'on'
    Yes 'live missing, -RequirePass on: carried as true' ($r.Carried -and $r.Staged.thornswoodRequirePass -eq $true)
    $r = Carry $live $build 'off'
    Yes 'live missing, -RequirePass off: carried as false' ($r.Carried -and $r.Staged.thornswoodRequirePass -is [bool] -and -not $r.Staged.thornswoodRequirePass)
    $r = Carry $live $build
    Yes 'live missing and nothing asked: CARRY REFUSED' ($r.Refused -and -not $r.Carried)
    Yes '  with the reason, naming the key and what to run' (($r.Said -join "`n") -match 'thornswoodRequirePass is missing' -and ($r.Said -join "`n") -match 'Deploy-Server\.ps1 -RequirePass on, or off')
    Yes '  and the stage is cleared and the running settings left as they were' ($r.StageGone -and $r.RunKept)
    $r = Carry (With $live 'thornswoodRequirePass' 'true') $build
    Yes 'live holding "true" as text and nothing asked: refused' ($r.Refused -and $r.StageGone -and $r.RunKept)
    $r = Carry (With $live 'thornswoodRequirePass' 'true') $build 'on'
    Yes 'live holding "true" as text, -RequirePass on: carried as a real true' ($r.Carried -and $r.Staged.thornswoodRequirePass -is [bool] -and $r.Staged.thornswoodRequirePass)
    $r = Carry (With $live 'thornswoodRequirePass' $true) (With $build 'thornswoodRequirePass' '')
    Yes 'a build holding an empty value over live true: carried, and live keeps true, never empty' ($r.Carried -and $r.Staged.thornswoodRequirePass -eq $true)

    # #2711: the two reads sat in a try with an empty catch, so the refusal
    # never said which file did not read, or why. Each is run here not reading.
    foreach ($which in 'running', 'sent') {
        $Root = Join-Path $tmp ([Guid]::NewGuid().ToString('N'))
        $Stage = '.stage-20261018-000000'
        $Asked = $null; $ReleaseKeys = @($ThornswoodGamemodeKeys)
        New-Item -ItemType Directory -Path (Join-Path $Root $Stage) -Force | Out-Null
        $good = ((With $live 'thornswoodRequirePass' $true) | ConvertTo-Json -Depth 10)
        [IO.File]::WriteAllText((Join-Path $Root 'server-settings.json'), $(if ($which -eq 'running') { '{"port":' } else { $good }))
        [IO.File]::WriteAllText((Join-Path (Join-Path $Root $Stage) 'server-settings.json'), $(if ($which -eq 'sent') { '{"port":' } else { ($build | ConvertTo-Json -Depth 10) }))
        $said = @(& ([scriptblock]::Create($settingsCarryBlock)) | ForEach-Object { "$_" })
        $named = $(if ($which -eq 'running') { 'the settings the server runs on: ' } else { 'the settings sent: ' })
        Yes ('settings ' + $which + ' that do not read: CARRY REFUSED, saying which and why, the stage cleared') (
            ($said -contains 'CARRY REFUSED') -and @($said | Where-Object { $_.Trim().StartsWith($named) -and $_.Trim().Length -gt $named.Length }).Count -eq 1 -and
            -not (Test-Path -LiteralPath (Join-Path $Root $Stage)))
    }
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- Deploy-DevGamemode -------------------------------------------------------
$dev = [IO.File]::ReadAllText((Join-Path $deploy 'Deploy-DevGamemode.ps1'))
$open = $dev.IndexOf('$made = @(Remote @"')
$close = $dev.IndexOf('"@ | ForEach-Object', $open)
Yes 'the first step on the box is where it was' ($open -gt 0 -and $close -gt $open)
$first = $dev.Substring($open, $close - $open)
$lineAt = $first.IndexOf("if (-not '`$RequirePass' -and -not (```$s.thornswoodRequirePass -is [bool])) { 'NO PASS SWITCH'; exit 8 }")
Yes 'it refuses a dev server with neither true nor false when -RequirePass was not given' ($lineAt -gt 0)
Yes '  before any old stage is cleared or anything is made' ($lineAt -gt 0 -and $lineAt -lt $first.IndexOf('Get-ChildItem -LiteralPath'))
Yes '  and this side stops, saying what to run, with nothing sent or stopped' (
    $dev -match "if \(\`$made -contains 'NO PASS SWITCH'\) \{\s*throw \('Refused: thornswoodRequirePass on the dev server is neither true nor false" -and
    $dev -match 'Run again with -RequirePass on or -RequirePass off\. Nothing was sent or stopped\.')
Yes '  and that check comes before the stage is taken as made' ($dev.IndexOf("`$made -contains 'NO PASS SWITCH'") -lt $dev.IndexOf("`$made -notcontains 'STAGE MADE'"))
Yes '-RequirePass on or off rewrites any value that is not a real true or false' (
    $dev.Contains("if ('`$RequirePass' -and (-not (```$s.thornswoodRequirePass -is [bool]) -or ```$s.thornswoodRequirePass -ne ```$needPass)) {"))

# The two tests as the box runs them, on each value.
function DevRefuses([string]$RequirePass, $value, [bool]$has) {
    $s = [pscustomobject]@{ port = 7787 }
    if ($has) { $s | Add-Member -NotePropertyName thornswoodRequirePass -NotePropertyValue $value }
    $v = $null
    if ($has) { $v = $s.thornswoodRequirePass }
    return (-not $RequirePass -and -not ($v -is [bool]))
}
function DevMoves([string]$RequirePass, $value) {
    $needPass = ($RequirePass -eq 'on')
    return [bool]($RequirePass -and (-not ($value -is [bool]) -or $value -ne $needPass))
}
Yes 'no switch, true on the box: goes ahead' (-not (DevRefuses '' $true $true))
Yes 'no switch, false on the box: goes ahead' (-not (DevRefuses '' $false $true))
Yes 'no switch, nothing on the box: refused' (DevRefuses '' $null $false)
Yes 'no switch, "true" as text on the box: refused' (DevRefuses '' 'true' $true)
Yes '-RequirePass on, nothing on the box: goes ahead' (-not (DevRefuses 'on' $null $false))
Yes '-RequirePass off over "false" as text: written, as a real false' (DevMoves 'off' 'false')
Yes '-RequirePass on over "true" as text: written, as a real true' (DevMoves 'on' 'true')
Yes '-RequirePass on over true: nothing to write' (-not (DevMoves 'on' $true))
Yes '-RequirePass off over false: nothing to write' (-not (DevMoves 'off' $false))

# ---- Deploy-Gamemode ------------------------------------------------------------
# Since #1223 the build carries no value at all: Deploy-Server -RequirePass
# sets live's on the box, so there is nothing here to read as on or off.
$gm = [IO.File]::ReadAllText((Join-Path $deploy 'Deploy-Gamemode.ps1'))
Yes 'Deploy-Gamemode writes no thornswoodRequirePass into the build' ($gm -notmatch 'NotePropertyName thornswoodRequirePass')
Yes '  and says Deploy-Server -RequirePass on or off is what changes it' ($gm -match 'Deploy-Server\.ps1 -RequirePass on\|off')
Yes '  and no longer calls anything but true watched only' ($gm -notmatch 'watched only, nobody refused')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
