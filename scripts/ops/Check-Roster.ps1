<#
  Check-Roster.ps1

  What is in each server's private folder, by name and size only.

  WHY THIS IS A SCRIPT AND NOT A LINE SOMEBODY TYPES. On 21 September this was
  handed over as a raw ssh with nested quotes:

      ssh Administrator@... "pwsh -NoProfile -Command \"Get-ChildItem ...\""

  and the far end answered

      \ : The term '\' is not recognized as the name of a cmdlet

  because the remote shell re-parses the line and the escaping does not
  survive. That trap is written down on the server build entry of the To Do
  List, with the answer: base64 the script and pass -EncodedCommand, which is
  what Deploy-Server.ps1 has always done. Hand-rolling the quoting a second
  time is how it gets got wrong a second time, so it lives here instead.

  WHAT private HOLDS, and why anybody cares:

    door.json          the door's own config. The door reads it to know where
                       to fetch the roster from. Without it the door never
                       fetches, so /tp refuses everybody including the owner.
    allowed.json       what the site last said about who may play, written by
                       the door. This is the roster.
    characters.json    the character register, written by the gamemode.

  NOTHING IN THEM IS READ OR PRINTED. Names, sizes and last write times only.
  door.json is a config file and its contents are not this script's business.

  Read only. Talks to the VPS.

  Usage:
      .\scripts\ops\Check-Roster.ps1
      .\scripts\ops\Check-Roster.ps1 -Root 'C:\Thornswood-Server-Dev'
#>
[CmdletBinding()]
param(
    [string]$Vps  = '',
    [string]$User = '',
    # Both by default, because the interesting answer is usually the
    # difference between them.
    [string[]]$Root = @('C:\Thornswood-Server', 'C:\Thornswood-Server-Dev')
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here '..\vps\Vps.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')

# The three the server actually uses. Anything else in there is listed too, so
# a file nobody expected is visible rather than hidden by the filter.
$wanted = @('door.json', 'allowed.json', 'characters.json')

foreach ($r in $Root) {
    Write-Host ''
    Write-Host $r -ForegroundColor White
    Write-Host ('-' * $r.Length) -ForegroundColor DarkGray

    # Single quoted here-string: nothing in it is expanded locally, so what is
    # sent is what is written. The root is the one substitution and it goes in
    # by Replace rather than by interpolation.
    $script = @'
$ProgressPreference = 'SilentlyContinue'
$p = '@@ROOT@@\private'
if (-not (Test-Path -LiteralPath $p)) {
    'NO PRIVATE FOLDER AT ALL'
} else {
    $f = @(Get-ChildItem -LiteralPath $p -File -Force -ErrorAction SilentlyContinue)
    if (-not $f.Count) {
        'the folder is there and it is empty'
    } else {
        foreach ($x in $f) {
            '{0}|{1}|{2}' -f $x.Name, $x.Length, $x.LastWriteTimeUtc.ToString('yyyy-MM-dd HH:mm')
        }
    }
}
'@
    $script = $script.Replace('@@ROOT@@', $r.TrimEnd('\'))
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))

    $out = Invoke-ThornswoodNative { & ssh @ssh "$User@$Vps" "pwsh -NoProfile -EncodedCommand $enc" } 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  could not ask the VPS: $out" -ForegroundColor Red
        continue
    }

    $seen = @{}
    foreach ($line in @($out)) {
        $t = [string]$line
        if (-not $t.Trim()) { continue }
        if ($t -notmatch '\|') { Write-Host "  $t" -ForegroundColor Yellow; continue }
        $bits = $t.Split('|')
        $seen[$bits[0]] = $true
        Write-Host ("  {0,-18} {1,9} bytes   last written {2}" -f $bits[0], $bits[1], $bits[2]) -ForegroundColor Green
    }

    foreach ($w in $wanted) {
        if (-not $seen.ContainsKey($w)) {
            $why = switch ($w) {
                'door.json'       { 'the door has no config, so it never fetches and /tp refuses everybody' }
                'allowed.json'    { 'the door has never written an allow list' }
                'characters.json' { 'the character register has never been written' }
            }
            Write-Host ("  {0,-18} MISSING   {1}" -f $w, $why) -ForegroundColor Red
        }
    }
}

Write-Host ''
