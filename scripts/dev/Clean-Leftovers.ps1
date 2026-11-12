<#
  Clean-Leftovers.ps1

  The other half of Audit-Leftovers.ps1. That one measures and never touches
  anything; this one removes what it found.

  Shows you the list and deletes nothing:

      .\Clean-Leftovers.ps1

  Actually removes it:

      .\Clean-Leftovers.ps1 -Go

  Why this is a script and not a list of paths in a chat window: the small ones
  are the whole point. A 13 GB zip gets noticed and dealt with once. Three .pex
  files at 800 bytes each, a 61 KB client log, a .bak next to a plugin, a
  versionlib nobody loads any more, all sitting in a Data folder that gets
  zipped into an installer four people download, are what actually accumulates,
  precisely because each one on its own never looks worth a command. Run this
  whenever, it is fast when there is nothing to do.

  Close the game first. Files the game has open will not delete, and the script
  will say so rather than pretending otherwise.
#>
[CmdletBinding()]
param(
    # Off by default. Nothing is removed until this is passed.
    [switch]$Go,
    [switch]$NoPause
)

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function MB($b) { '{0,9:n2} MB' -f ($b / 1MB) }

# The same folders the audit walks.
$roots = @(
    (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install)
    (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Engine)
    'C:\SkyrimRP'
    (Join-Path $env:USERPROFILE 'Downloads')
    (Join-Path $env:USERPROFILE 'AppData\Roaming\skyrim-rp-launcher')
    (Join-Path $env:USERPROFILE 'AppData\Roaming\com.bstar.skymp-launcher')
    (Join-Path $env:LOCALAPPDATA 'Temp\Skyrim Platform')
)

# Backups, previous copies and scratch.
$cruftRx = '(?i)(\.bak$|\.old$|\.tmp$|\.temp$|\.orig$|\.backup$|~$)'

<#
  Paths that match the pattern above and must survive anyway.

  The saves and ini folders are excluded outright rather than filtered. There
  is nothing in them worth this script's attention and a mistake there costs
  somebody their character.

  The Steam copy is not walked at all: that folder is where the vanilla game
  comes from and the installer fingerprints three files in it, and a .bak in
  a vanilla Data folder might be somebody's only copy of something.
#>
$keepRx = @(
    '(?i)\\My Games\\Skyrim Special Edition\\'
    '(?i)\\OneDrive\\'
    # The repo's own working tree. Its .orig and .bak files belong to vcpkg and
    # node_modules, which own their contents and repair them on their terms.
    # The fork was C:\Thornswood-Dev\skymp until 25 September and is the
    # engine\skymp submodule of this repository after it (scripts\release\Where.ps1).
    '(?i)\\(Thornswood-Dev|engine)\\skymp\\(vcpkg|.*node_modules)\\'
) -join '|'

Head 'Looking'

$hits = New-Object System.Collections.Generic.List[object]

foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) {
        Say ("  not here: $root") 'DarkGray'
        continue
    }
    Say "  $root" 'DarkGray'

    $files = @(Get-ChildItem -LiteralPath $root -Recurse -File -Force -EA SilentlyContinue)
    foreach ($f in $files) {
        if ($f.FullName -match $keepRx) { continue }

        if ($f.Name -match $cruftRx) {
            $hits.Add([pscustomobject]@{ Path = $f.FullName; Bytes = $f.Length; Kind = 'file'; Why = 'backup or temp' })
        }
    }
}

if ($hits.Count -eq 0) {
    Write-Host ''
    Say 'Nothing to clean. The pattern came back empty.' 'Green'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ------------------------------------------------------------------ show ----
$total = ($hits | Measure-Object -Property Bytes -Sum).Sum

Head ('Found {0} things, {1}' -f $hits.Count, (MB $total).Trim())
foreach ($h in ($hits | Sort-Object -Property Bytes -Descending)) {
    $tag = if ($h.Kind -eq 'folder') { 'DIR ' } else { '    ' }
    Say ('  {0} {1}  {2}' -f (MB $h.Bytes), $tag, $h.Path) 'DarkGray'
}

if (-not $Go) {
    Write-Host ''
    Say 'Nothing was removed. That was the list.' 'Yellow'
    Say 'To actually remove it:  .\Clean-Leftovers.ps1 -Go' 'Yellow'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 0
}

# ----------------------------------------------------------------- remove ----
Head 'Removing'

$gone = 0
$freed = 0
$stuck = @()

foreach ($h in $hits) {
    try {
        Remove-Item -LiteralPath $h.Path -Recurse -Force -ErrorAction Stop
        $gone++
        $freed += $h.Bytes
    } catch {
        $stuck += [pscustomobject]@{ Path = $h.Path; Error = $_.Exception.Message }
    }
}

Write-Host ''
Say ('Removed {0} of {1}, {2} back.' -f $gone, $hits.Count, (MB $freed).Trim()) 'Green'

if ($stuck.Count) {
    Write-Host ''
    Say ('{0} would not go. Almost always something still has them open:' -f $stuck.Count) 'Yellow'
    foreach ($s in $stuck) {
        Say ('  ' + $s.Path) 'DarkGray'
        Say ('      ' + $s.Error) 'DarkGray'
    }
    Say 'Close the game, the launcher and Vortex, then run it again.' 'Yellow'
}

Write-Host ''
Say ('If anything came out of ' + $roots[0] + '\Game\Data, ship a build so the') 'Gray'
Say 'installer stops carrying it:  .\Ship.ps1 -Package' 'Gray'
Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
