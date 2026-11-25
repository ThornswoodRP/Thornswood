<#
  test-4201-door-root.ps1

      pwsh -NoProfile -File .\tests\test-4201-door-root.ps1

  Issue #4201. Given no -Root, scripts\ops\Set-Door.ps1 asked the box for
  every folder on C: holding server-settings.json and took the first. The
  restore rehearsal's C:\Thornswood-Rehearsal sorts before the live
  C:\Thornswood-Server, so while a rehearsal folder was there -Connect,
  -Enforce and the read acted on the rehearsal and said it worked, and
  -Connect handed the rehearsal the key that lets it push its roster to the
  live site.

  This lifts Set-Door.ps1 from "Finding the server" to where it says the
  root, and runs it with a stand-in Remote that answers the way the box's
  folder walk does (one ROOT line per folder, in name order):

    1. the rehearsal, dev and live folders there: the live one is taken;
    2. live alone: live;
    3. one server folder that is not live (a box set up another way): that one;
    4. two or more and none of them live: it stops, naming every one, and
       touches none;
    5. none: it stops, as before;
    6. -Root given: that root, and the box is not asked.

  Nothing here reaches a box: Remote is the stand-in.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$text = [IO.File]::ReadAllText((Join-Path $Repo ('scripts\ops\Set-Door.ps1'.Replace('\', [IO.Path]::DirectorySeparatorChar))))
$from = $text.IndexOf("Head 'Finding the server'")
$to = if ($from -ge 0) { $text.IndexOf('Say "  $root"', $from) } else { -1 }
Yes 'Set-Door.ps1 finds its server between "Finding the server" and saying the root' ($from -ge 0 -and $to -gt $from)
$block = $text.Substring($from, $to - $from) + 'Say "  $root"'

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4201-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Force -Path $T

# Runs the block in its own PowerShell, since it ends with exit on a stop.
function Find([string[]]$folders, [string]$root = '') {
    $answer = (@($folders | ForEach-Object { "'ROOT $_'" }) -join ', ')
    $asked = Join-Path $T ('asked-' + [Guid]::NewGuid().ToString('N'))
    $f = Join-Path $T ('find-' + [Guid]::NewGuid().ToString('N') + '.ps1')
    [IO.File]::WriteAllText($f, @"
`$ErrorActionPreference = 'Stop'
`$NoPause = `$true
`$Root = '$root'
function Say(`$m, `$c = 'Gray') { Write-Host `$m }
function Head(`$m) { Write-Host `$m }
function Die(`$m) { Write-Host ("STOP. " + `$m); exit 1 }
function Remote(`$script) { [IO.File]::WriteAllText('$asked', `$script); return @($answer) }
$block
Write-Host ('CHOSEN|' + `$root)
exit 0
"@)
    $said = @(& (Get-BoxPowerShell) -NoProfile -NonInteractive -File $f 2>&1 | ForEach-Object { "$_" })
    $chosen = @($said | Where-Object { $_ -like 'CHOSEN|*' } | ForEach-Object { $_.Substring(7) })
    return @{ Code = $LASTEXITCODE; Said = ($said -join ' / '); Root = $(if ($chosen) { $chosen[0] } else { '' }); Asked = (Test-Path -LiteralPath $asked) }
}

$live = 'C:\Thornswood-Server'
$dev = 'C:\Thornswood-Server-Dev'
$reh = 'C:\Thornswood-Rehearsal'

try {
    $r = Find @($reh, $live, $dev)
    Yes ('1. with the rehearsal, live and dev there, the live server is taken (' + $r.Root + ')') ($r.Code -eq 0 -and $r.Root -eq $live)
    if ($r.Root -ne $live) { Write-Host ('      it said: ' + $r.Said) }

    $r = Find @($live)
    Yes ('2. live alone is taken (' + $r.Root + ')') ($r.Code -eq 0 -and $r.Root -eq $live)

    $r = Find @('D:\Elsewhere-Server')
    Yes ('3. one server folder that is not live is taken (' + $r.Root + ')') ($r.Code -eq 0 -and $r.Root -eq 'D:\Elsewhere-Server')

    $r = Find @($reh, $dev)
    Yes ('4. two folders and neither live stops (exit ' + $r.Code + ')') ($r.Code -eq 1 -and -not $r.Root)
    Yes '   naming both, and saying to give -Root' ($r.Said -match [regex]::Escape($reh) -and $r.Said -match [regex]::Escape($dev) -and $r.Said -match '-Root')
    if ($r.Code -ne 1) { Write-Host ('      it said: ' + $r.Said) }

    $r = Find @()
    Yes ('5. no server folder stops (exit ' + $r.Code + ')') ($r.Code -eq 1 -and $r.Said -match 'No server-settings\.json')

    $r = Find @($reh, $live) $dev
    Yes ('6. -Root given is the root, and the box is not asked (' + $r.Root + ')') ($r.Code -eq 0 -and $r.Root -eq $dev -and -not $r.Asked)
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
