<#
  test-remote-length.ps1

  No script sends the VPS more than a command line can hold.

  WHY THIS EXISTS. sshd on Windows hands the command to cmd.exe, which stops
  at 8,191 characters. Base64 of UTF-16 is about 2.7 times the script, so a
  block of any size arrives CUT IN HALF and nothing anywhere says so: the far
  end sees a script that stops mid-line and complains about a brace or an
  unexpected token, naming a line above the one that was actually cut. On
  20 September a deploy failed that way with "Unexpected token '$?'" fifteen
  lines above the truncation.

  Deploy-Docs.ps1 solved it on 17 September and sixteen scripts were given the
  fix on 20 September, which is entry 115 on the To Do List. MEASURED AGAIN ON
  23 SEPTEMBER, two were still wrong and neither had ever worked:
  Install-Voice.ps1 sent 24,350 characters, which is the entire install of the
  voice service, and Check-Site.ps1 sent 17,802 because it carries a node
  script base64 inside its remote block.

  So it is checked here rather than remembered. A script that sends an encoded
  command and carries a here-string too long to fit must also carry the guard
  that sends it as a file instead.

  HOW IT DECIDES, and it is deliberately blunt: the longest here-string in the
  file, on the assumption that it is the one that goes up. That over-reports
  for a file whose big here-string is only ever scp'd, and the answer to a
  false red is to add the guard anyway, which costs one round trip on a script
  that was already sending one. Being wrong in the quiet direction is what
  this is here to stop.

  Read only. Never connects to anything.
#>
[CmdletBinding()]
param([string]$ToolsPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
# The scripts are in scripts\<area> since phase 8 of issue #440.
if (-not $ToolsPath) { $ToolsPath = Join-Path $Here 'scripts' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# What cmd.exe will carry, and what the guard has to be below.
$Limit = 8191

function OnTheWire([string]$script) {
    # Exactly what goes on the command line: the switches, then the script as
    # base64 of UTF-16, which is what -EncodedCommand takes. The box runs
    # pwsh since #5356, but a new box's first script (Remote.ps1 -NewBox)
    # still names powershell, the longer of the two, so that is the bound.
    $b = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    return ('powershell -NoProfile -EncodedCommand ').Length + $b.Length
}

$files = Get-ChildItem -Path $ToolsPath -Filter *.ps1 -File -Recurse |
         Where-Object { $_.Name -ne 'test-remote-length.ps1' } |
         Sort-Object Name

$sending = 0
$overs = @()

foreach ($f in $files) {
    $text = Get-Content -LiteralPath $f.FullName -Raw
    # Since #1070 most send through Send-Script.ps1 (Invoke-ThornswoodRemote),
    # which carries the guard for them.
    $helped = $text -match 'Invoke-ThornswoodRemote -Target'
    if ($text -notmatch 'EncodedCommand' -and -not $helped) { continue }
    $sending++

    # Every here-string body in the file, both quoting kinds.
    $longest = 0
    foreach ($m in [regex]::Matches($text, '@(["''])\r?\n(.*?)\r?\n\1@', 'Singleline')) {
        $len = $m.Groups[2].Value.Length
        if ($len -gt $longest) { $longest = $len }
    }
    if ($longest -eq 0) { continue }

    $wire = OnTheWire ('x' * $longest)
    if ($wire -le $Limit) { continue }

    # It is too long to go on a command line. It must send a file instead.
    $guarded = ($text -match '\$cmd\.Length -le') -or $helped
    if (-not $guarded) {
        $overs += ('{0}: {1} characters on the wire, limit {2}, and no file fallback' -f
                   $f.Name, $wire, $Limit)
    }
}

Yes "there are scripts that send the VPS an encoded command ($sending of them)" ($sending -gt 0)

Yes ("every one of them that is too long to fit sends a file instead" +
     $(if ($overs.Count) { "`n      " + ($overs -join "`n      ") } else { '' })) ($overs.Count -eq 0)

# ---- and the two that were found on 23 September, by name -------------------
#
# Named rather than left to the loop, because these are the ones somebody will
# look for, and because a rewrite that drops the guard from either of them is
# a rewrite that quietly stops the voice install and the site check working.
foreach ($name in @('Install-Voice.ps1', 'Check-Site.ps1')) {
    $p = @(Get-ChildItem -Path $ToolsPath -Filter $name -File -Recurse | Select-Object -First 1 -ExpandProperty FullName)[0]
    if (-not $p) { $p = Join-Path $ToolsPath $name }
    if (-not (Test-Path -LiteralPath $p)) { Yes "$name is there" $false; continue }
    $t = Get-Content -LiteralPath $p -Raw
    # Through Send-Script.ps1 since #1070, which sends a long script as a file
    # and removes it (tests\test-send-script.ps1), or with a guard of its own.
    $viaHelper = ($t -match 'Invoke-ThornswoodRemote -Target' -and $t -match "Send-Script\.ps1'\)")
    Yes "$name still sends a long script as a file" ($viaHelper -or $t -match '\$cmd\.Length -le')
    Yes "$name still cleans up what it sent" ($viaHelper -or $t -match 'Remove-Item -LiteralPath')
}

# ---- the guard has to be under the limit, not near it -----------------------
#
# 6000 characters of command line leaves room for the switches and for a path
# that is longer on somebody else's box. A guard set at the limit itself is a
# guard that fails on the first script that is a little longer than expected.
$guards = @()
foreach ($f in $files) {
    $text = Get-Content -LiteralPath $f.FullName -Raw
    # Send-Script.ps1's guard is its -Limit, 6000 unless a caller says less.
    foreach ($m in [regex]::Matches($text, '\$cmd\.Length -le (\d+)|\[int\]\$Limit = (\d+)')) {
        if ($m.Groups[2].Success) { $guards += [int]$m.Groups[2].Value; continue }
        $guards += [int]$m.Groups[1].Value
    }
}
Yes "the guards are all comfortably under $Limit" (
    ($guards.Count -gt 0) -and (($guards | Where-Object { $_ -ge 7000 }).Count -eq 0))

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
