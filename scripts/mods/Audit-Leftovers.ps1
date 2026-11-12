<#
  Audit-Leftovers.ps1

  Measures. Deletes nothing, moves nothing, renames nothing.

  Two questions, in order of how much disk they are worth:

    1. How big is each folder, so the 13 GB ones can be told from the 13 MB
       ones before anybody starts deciding.
    2. What is a backup, a temp file or a previous copy of something.

  The full answer goes to a file, because a recursive listing of a 22 GB game
  build is not something anybody wants scrolling past. The console gets the
  summary.

      .\Audit-Leftovers.ps1

  Nothing here is destructive, so it is safe to run while the game is open and
  safe to run twice.
#>
#Requires -Version 7
[CmdletBinding()]
param(
    # In the repository's local folder, ignored by git, rather than inside the
    # install this audit walks (#3031).
    [string]$Report = (Join-Path (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Local) 'audit-report.txt'),
    [int]$MinMB = 1,
    [switch]$NoPause
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function GB($b) { '{0,8:n2} GB' -f ($b / 1GB) }
function MB($b) { '{0,8:n1} MB' -f ($b / 1MB) }

# Every folder this session can see. The Steam copy is in the list to be
# measured and named, never to be touched: it is where the vanilla files come
# from and the installer fingerprints three of them.
$roots = @(
    @{ Path = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install);                                            Note = 'the live build' }
    @{ Path = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Engine);                                             Note = 'the SkyMP source and build tree' }
    @{ Path = 'C:\SkyrimRP';                                                         Note = 'older attempt?' }
    @{ Path = (Join-Path $env:USERPROFILE 'Downloads');                                            Note = 'downloads and the repo' }
    @{ Path = (Join-Path $env:USERPROFILE 'AppData\Roaming\skyrim-rp-launcher');                   Note = 'an old launcher''s data' }
    @{ Path = (Join-Path $env:USERPROFILE 'AppData\Roaming\com.bstar.skymp-launcher');             Note = 'an old launcher''s data' }
    @{ Path = (Join-Path $env:USERPROFILE 'Documents\My Games\Skyrim Special Edition');            Note = 'saves and ini. CAREFUL' }
    @{ Path = (Join-Path $env:USERPROFILE 'OneDrive\Documents\My Games\Skyrim Special Edition');   Note = 'the OneDrive copy of the same' }
    @{ Path = (Join-Path $env:LOCALAPPDATA 'Temp\Skyrim Platform');                   Note = 'CEF caches and logs' }
    @{ Path = 'C:\Program Files (x86)\Steam\steamapps\common\Skyrim Special Edition'; Note = 'vanilla Steam copy. DO NOT TOUCH' }
)

# Backups, previous copies and scratch. Deliberately narrow: a pattern that
# matches too much turns an audit into a list nobody reads.
$cruftRx = '(?i)(\.bak$|\.old$|\.tmp$|\.temp$|~$|\.orig$|-prev\.|\.backup$|\.prefix\.backup$)'
$cruftDirRx = '(?i)(\\temp\\|\\tmp\\|\\_to_delete\\|\\leftovers?\\|\\fomod-leftovers\\|\\removed-plugins\\|\\old\\|\\backup\\)'

$lines = New-Object System.Collections.Generic.List[string]
function Out2($t) { Write-Host $t; $lines.Add($t) }
function File($t) { $lines.Add($t) }

$stamp = (Get-Date).ToString('u')
File "Thornswood leftover audit, $stamp"
File ('=' * 70)

Head 'Measuring'

$totals = @()
foreach ($r in $roots) {
    if (-not (Test-Path -LiteralPath $r.Path)) {
        Say ("  missing: {0}" -f $r.Path) 'DarkGray'
        continue
    }
    Say ("  {0}" -f $r.Path) 'DarkGray'
    $files = @(Get-ChildItem -LiteralPath $r.Path -Recurse -File -Force -ErrorAction SilentlyContinue)
    $bytes = ($files | Measure-Object -Property Length -Sum).Sum
    if (-not $bytes) { $bytes = 0 }
    $totals += [pscustomobject]@{
        Path = $r.Path; Note = $r.Note; Bytes = $bytes; Count = $files.Count; Files = $files
    }
}

# ---------------------------------------------------------------- sizes ----
Head 'Folder sizes, biggest first'
File ''
File 'FOLDER SIZES'
File ('-' * 70)
foreach ($t in ($totals | Sort-Object Bytes -Descending)) {
    $line = "{0}  {1,7:n0} files   {2}   {3}" -f (GB $t.Bytes), $t.Count, $t.Path, $t.Note
    Out2 ('  ' + $line)
}
$grand = ($totals | Measure-Object -Property Bytes -Sum).Sum
Out2 ('  ' + ('-' * 60))
Out2 ("  {0}  in total across every folder" -f (GB $grand))

# ------------------------------------------------ top level of each root ---
File ''
File 'WHAT IS INSIDE EACH ONE, top level, biggest first'
File ('-' * 70)
foreach ($t in ($totals | Sort-Object Bytes -Descending)) {
    File ''
    File ("{0}   [{1}]" -f $t.Path, $t.Note)
    $prefix = $t.Path.TrimEnd('\') + '\'
    $groups = $t.Files | Group-Object {
        $rel = $_.FullName.Substring([Math]::Min($prefix.Length, $_.FullName.Length))
        $i = $rel.IndexOf('\')
        if ($i -lt 0) { '(loose files)' } else { $rel.Substring(0, $i) }
    }
    foreach ($g in ($groups | Sort-Object { ($_.Group | Measure-Object Length -Sum).Sum } -Descending | Select-Object -First 15)) {
        $b = ($g.Group | Measure-Object Length -Sum).Sum
        File ("    {0}  {1,6:n0} files   {2}" -f (GB $b), $g.Count, $g.Name)
    }
}

# --------------------------------------------------- backups and scratch ---
Head ("Backups, previous copies and scratch, over {0} MB" -f $MinMB)
File ''
File ("BACKUPS, PREVIOUS COPIES AND SCRATCH (everything, no size floor)")
File ('-' * 70)

$cruft = @()
foreach ($t in $totals) {
    foreach ($f in $t.Files) {
        if ($f.Name -match $cruftRx -or $f.FullName -match $cruftDirRx) {
            $cruft += [pscustomobject]@{ Path = $f.FullName; Bytes = $f.Length }
        }
    }
}
$cBytes = ($cruft | Measure-Object -Property Bytes -Sum).Sum
if (-not $cBytes) { $cBytes = 0 }
Out2 ("  {0} in {1:n0} file(s)" -f (GB $cBytes), $cruft.Count)
foreach ($c in ($cruft | Sort-Object Bytes -Descending)) {
    File ("    {0}   {1}" -f (MB $c.Bytes), $c.Path)
}
foreach ($c in ($cruft | Sort-Object Bytes -Descending | Where-Object { $_.Bytes -ge ($MinMB * 1MB) } | Select-Object -First 20)) {
    Say ("    {0}   {1}" -f (MB $c.Bytes), $c.Path) 'DarkGray'
}

# ------------------------------------------------------------------ out ----
$dir = Split-Path -Parent $Report
if ($dir -and -not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Force -Path $dir }
[IO.File]::WriteAllLines($Report, $lines, (New-Object Text.UTF8Encoding($false)))

Head 'Done'
Say "  Nothing was deleted, moved or renamed." 'Green'
Say ("  Full report: {0}" -f $Report) 'Green'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
