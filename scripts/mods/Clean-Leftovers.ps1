<#
  Clean-Leftovers.ps1

  Removes the leftovers Thornswood's own tools leave on this machine, in the
  folders Thornswood owns, and lists, without touching, backup and temp files
  in the game's Data folder.

  Shows you the list and deletes nothing:

      .\Clean-Leftovers.ps1

  Actually removes Thornswood's own leftovers:

      .\Clean-Leftovers.ps1 -Go

  WHAT IT REMOVES, AND WHAT WRITES EACH ONE (#4808). Only a file a Thornswood
  tool writes, in a folder Thornswood owns, named here with what writes it:

    <install>\Launcher\Thornswood.exe.old
    <install>-DevBuild\Launcher\Thornswood.exe.old
        The launcher from before Velopack keeps its old exe under this name
        when its swap script puts an update in place, and launcher\move
        clears it when it starts. One is left when that never ran. The
        install is Where.ps1 Install, and -DevBuild beside it is where the
        main launcher's Settings page installs the dev build.

  Measured on main 12 November: no other Thornswood tool that runs on a
  person's machine leaves a file ending .bak, .old, .tmp, .temp, .orig,
  .backup or ~ behind. The gamemode, the bot, the site and the deploy agent
  write their .tmp and .bak files on the box. The launcher's Steam manifest
  .tmp is written whole and swapped in, in Steam's own folder. Enable-MCM.ps1,
  which kept SkyUI_SE.esp.bak in Data, is retired and refuses to run (#1179).

  WHAT IT ONLY LISTS. <install>\Game\Data and the dev build's: Vortex deploys
  the collection there, so a .bak in it may be a collection file Vortex put
  there, and deleting it would leave Vortex's deployment wrong. Each one is
  listed, so you can decide, and nothing there is ever removed.

  WHAT IT NEVER LOOKS AT. Until #4808 this walked the whole Downloads folder,
  the engine clone, C:\SkyrimRP, two other launchers' AppData folders and
  Skyrim Platform's temp folder too, and -Go deleted every file there with
  one of those endings: other programs' files, other clones, files Vortex
  deployed. None of those folders is Thornswood's, and nothing in them is a
  file Thornswood leaves, so none is read.

  Close the launcher first. A file something has open will not delete: the
  run names each one and exits 1.
#>
[CmdletBinding()]
param(
    # Off by default. Nothing is removed until this is passed.
    [switch]$Go,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Done([int]$code) {
    Write-Host ''
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit $code
}

$where = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'release') 'Where.ps1'
$installs = @((& $where Install), (& $where InstallDev))

# Thornswood's own leftovers, by name, in the folders Thornswood owns.
$own = @(foreach ($i in $installs) { Join-Path (Join-Path $i 'Launcher') 'Thornswood.exe.old' })

# Backups, previous copies and scratch: what is listed in Data.
$cruftRx = '(?i)(\.bak$|\.old$|\.tmp$|\.temp$|\.orig$|\.backup$|~$)'

Head 'Thornswood''s own leftovers'
$found = @($own | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
if ($found.Count) { foreach ($f in $found) { Say "  $f" } }
else { Say '  none' 'Green' }

Head 'Left alone in Game\Data, where Vortex deploys the collection'
$unread = @()
$listed = 0
foreach ($i in $installs) {
    $data = Join-Path (Join-Path $i 'Game') 'Data'
    if (-not (Test-Path -LiteralPath $data -PathType Container)) { continue }
    $readErrors = $null
    $files = @(Get-ChildItem -LiteralPath $data -Recurse -File -Force -ErrorAction SilentlyContinue -ErrorVariable readErrors |
        Where-Object { $_.Name -match $cruftRx })
    foreach ($e in @($readErrors)) { $unread += [pscustomobject]@{ Path = [string]$e.TargetObject; Error = $e.Exception.Message } }
    foreach ($f in $files) { Say ('  ' + $f.FullName) 'DarkGray'; $listed++ }
}
if (-not $listed -and -not $unread.Count) { Say '  none' 'Green' }
elseif ($listed) { Say '  These are not removed: one may be a collection file, and only Vortex or you can say.' 'Yellow' }

if ($unread.Count) {
    Head 'Could not be read, so the list above is not whole'
    foreach ($u in $unread) { Say ('  ' + $u.Path) 'Red'; Say ('      ' + $u.Error) 'DarkGray' }
}

if (-not $Go) {
    Write-Host ''
    if ($found.Count) { Say 'Nothing was removed. To remove Thornswood''s own leftovers:  .\Clean-Leftovers.ps1 -Go' 'Yellow' }
    if ($unread.Count) { Done 1 }
    Done 0
}

Head 'Removing'
$stuck = @()
foreach ($f in $found) {
    try {
        Remove-Item -LiteralPath $f -Force
        Say "  removed $f" 'Green'
    } catch {
        $stuck += [pscustomobject]@{ Path = $f; Error = $_.Exception.Message }
    }
}
if (-not $found.Count) { Say '  nothing to remove' 'Green' }

if ($stuck.Count) {
    Write-Host ''
    Say ('STOP. {0} of Thornswood''s own leftovers would not delete:' -f $stuck.Count) 'Red'
    foreach ($s in $stuck) { Say ('  ' + $s.Path) 'Red'; Say ('      ' + $s.Error) 'DarkGray' }
    Say '  Something has it open, most often the launcher. Close it, then run this again.' 'Yellow'
    Done 1
}
if ($unread.Count) { Done 1 }
Done 0
