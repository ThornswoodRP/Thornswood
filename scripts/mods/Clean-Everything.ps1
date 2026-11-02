<#
  Clean-Everything.ps1

      .\scripts\mods\Clean-Everything.ps1              show what is there, delete nothing
      .\scripts\mods\Clean-Everything.ps1 -Delete      delete it, after you type DELETE

  Finds the old installers, build leftovers, temp files, stale backups and old
  GitHub release assets across this machine, the server and the source repository,
  adds up what they are costing, and prints it.

  It deletes NOTHING unless you pass -Delete, and even then it asks you to type
  the word out. What it deletes is exactly what it printed, nothing found later
  and nothing inferred.

  Never touched, whatever you pass:

    the Vortex downloads folder    those archives are every mod you have, and
                                   re-downloading them is 20 GB and an evening
    the newest backup              a cleanup that removes your only backup is
                                   not a cleanup
    anything under Game\Data       that is the build, not leftovers
    the repositories themselves    only their release assets are in scope

  Pick a part with -Installers, -Packs, -Stage, -Backups, -Temp, -Github or
  -ServerSaves. With none of them it looks at all of them except -ServerSaves,
  which is a wipe and has to be asked for by name.
#>
[CmdletBinding()]
param(
  [string]$Vps  = '',
  [string]$User = '',
  [string]$Root = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install),
  # Another repository whose release assets to look at. Thornswood-Releases
  # was the default until #907 deleted it.
  [string]$Repo = '',
  [string]$SourceRepo = 'ThornswoodRP/Thornswood',
  [string]$BackupDir,
  # Where releases stage, one <install root's name>\_dist each: Where.ps1 Dist.
  [string]$DistRoot,
  # How many of the newest to keep in each group that has a series.
  [int]$KeepBackups = 2,
  [int]$KeepReleases = 5,
  [switch]$Installers,
  [switch]$Packs,
  [switch]$Stage,
  [switch]$Backups,
  [switch]$Temp,
  [switch]$Github,
  # The server's character storage. This is a wipe, not a cleanup, so it is
  # never part of -All and has to be named.
  [switch]$ServerSaves,
  [switch]$Delete,
  [switch]$NoPause
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$ssh = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }
function Die($m) {
  Write-Host ''
  Write-Host "STOP. $m" -ForegroundColor Red
  if (-not $NoPause) { [void](Read-Host 'Enter to exit') }
  exit 1
}
function Remote($script) {
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}
function Mb($b) { return [math]::Round($b / 1MB, 1) }
function Gb($b) { return [math]::Round($b / 1GB, 2) }

# The repository's local\backups since 5 October, where Backup-Server.ps1
# puts its zips (Patrick: Thornswood work on One lives only in the
# repository and the vault).
if (-not $BackupDir) {
  $BackupDir = [string](& (Join-Path $Here '..\release\Where.ps1') Backups)
}
if (-not $DistRoot) {
  $DistRoot = [string](& (Join-Path $Here '..\release\Where.ps1') Dist)
}

$pickedAny = $Installers -or $Packs -or $Stage -or $Backups -or $Temp -or $Github -or $ServerSaves
if (-not $pickedAny) {
  $Installers = $true; $Packs = $true; $Stage = $true
  $Backups = $true; $Temp = $true; $Github = $true
}

Write-Host ''
Write-Host '  THORNSWOOD  -  what is lying around' -ForegroundColor White
if (-not $Delete) { Say '  Looking only. Nothing will be deleted.' 'DarkGray' }
else { Say '  -Delete is on. You will be asked to confirm before anything goes.' 'Yellow' }

# Every candidate lands here: Where (this machine / the server / github),
# What (a label), Path, Bytes. Deletion walks this and nothing else.
$found = @()
function Add-Found($where, $what, $path, $bytes) {
  $script:found += [pscustomobject]@{ Where = $where; What = $what; Path = $path; Bytes = [int64]$bytes }
}

function Folder-Bytes($path) {
  if (-not (Test-Path -LiteralPath $path)) { return 0 }
  $sum = 0
  foreach ($f in (Get-ChildItem -LiteralPath $path -Recurse -File -Force -EA SilentlyContinue)) { $sum += $f.Length }
  return $sum
}

# ------------------------------------------------------- this machine ---
# Where releases stage (#3004). Since 22 September Ship and Publish-Update
# stage in <Where.ps1 Dist>\<install root's name>\_dist, one per install root
# (and so did the old installer's Package-Thornswood until #4824, whose
# installers and stage may still be there), and One ships from more than one
# root (release-main and release-devbuild), so every _dist under Dist is
# looked at, not one root's. Until then this looked only in $Root\_dist, where
# they staged before, and missed the 5 GB installers a Ship left. $Root\_dist is still looked at
# while one is there, since what it holds is left over from before the move.
# Join-Path stops on a drive this machine does not have (C: off Windows), so
# the install folder is tested before anything is joined to it (#2989).
$dists = @()
if (Test-Path -LiteralPath $DistRoot) {
  foreach ($d in @(Get-ChildItem -LiteralPath $DistRoot -Directory | Sort-Object Name)) {
    $p = Join-Path $d.FullName '_dist'
    if (Test-Path -LiteralPath $p) { $dists += [pscustomobject]@{ Path = $p; Label = $d.Name + '\_dist'; Old = $false } }
  }
}
if (Test-Path -LiteralPath $Root) {
  $p = Join-Path $Root '_dist'
  if (Test-Path -LiteralPath $p) { $dists += [pscustomobject]@{ Path = $p; Label = $p; Old = $true } }
}
function Old-Note($d) { return $(if ($d.Old) { '   the old place, nothing stages here now' } else { '' }) }

if ($Installers) {
  Head 'Old installers on this machine'
  foreach ($d in $dists) {
    foreach ($n in 'Thornswood-Setup.zip', 'Thornswood-Setup.exe') {
      $p = Join-Path $d.Path $n
      if (Test-Path -LiteralPath $p) {
        $i = Get-Item -LiteralPath $p
        Add-Found 'this machine' 'old installer' $p $i.Length
        Say ("  {0,10:n1} GB  {1}\{2}   built {3}{4}" -f (Gb $i.Length), $d.Label, $n, $i.LastWriteTime.ToString('dd MMM HH:mm'), (Old-Note $d))
      }
    }
  }
  if (-not ($found | Where-Object { $_.What -eq 'old installer' })) { Say '  none' 'DarkGray' }
}

if ($Packs) {
  Head 'Old pack builds'
  # Each folder is its own series (Publish-Update prunes in the one it stages
  # in), so the newest two are kept in each. Not $packZips: PowerShell names are
  # not case sensitive, so that is the -Packs switch, and a list put in it
  # stopped the script on the first pack zip it found.
  $anyPacks = $false
  foreach ($d in $dists) {
    $packZips = @(Get-ChildItem -LiteralPath $d.Path -Filter 'pack-*.zip' -File | Sort-Object LastWriteTime -Descending)
    if ($packZips.Count -eq 0) { continue }
    $anyPacks = $true
    $keep = [Math]::Min(2, $packZips.Count)
    Say ("  {0}: {1} pack zip(s), keeping the newest {2}{3}" -f $d.Label, $packZips.Count, $keep, (Old-Note $d)) 'DarkGray'
    for ($i = $keep; $i -lt $packZips.Count; $i++) {
      Add-Found 'this machine' 'old pack' $packZips[$i].FullName $packZips[$i].Length
    }
    $sum = ($packZips | Select-Object -Skip $keep | Measure-Object -Property Length -Sum).Sum
    Say ("  {0,10:n1} MB  in {1} older pack(s)" -f (Mb $sum), ($packZips.Count - $keep))
  }
  if (-not $anyPacks) { Say '  none' 'DarkGray' }
}

if ($Stage) {
  Head 'Packaging leftovers'
  foreach ($d in $dists) {
    foreach ($n in 'stage', 'removed-plugins', 'unbound-locked', 'unbound-original', 'sfx', 'server') {
      $p = Join-Path $d.Path $n
      if (Test-Path -LiteralPath $p) {
        $b = Folder-Bytes $p
        Add-Found 'this machine' 'packaging leftover' $p $b
        Say ("  {0,10:n1} GB  {1}\{2}{3}" -f (Gb $b), $d.Label, $n, (Old-Note $d))
      }
    }
  }
  # The build tree's debug symbols. Enormous and rebuildable.
  $pdb = Join-Path (& (Join-Path $PSScriptRoot '..\release\Where.ps1') ServerDist) 'scam_native.pdb'
  if (Test-Path -LiteralPath $pdb) {
    $i = Get-Item -LiteralPath $pdb
    Add-Found 'this machine' 'debug symbols' $pdb $i.Length
    Say ("  {0,10:n1} MB  scam_native.pdb   debug symbols, rebuildable" -f (Mb $i.Length))
  }
}

if ($Backups) {
  Head 'Old backups'
  # Backup-Server.ps1's copies: .zip.enc since #3582, the plain .zip before.
  $zips = @(Get-ChildItem -LiteralPath $BackupDir -Filter 'thornswood-backup-*' -File -EA SilentlyContinue |
            Where-Object { $_.Name -match '^thornswood-backup-\d{8}-\d{4}\.zip(\.enc)?$' } |
            Sort-Object LastWriteTime -Descending)
  if ($zips.Count -eq 0) { Say '  none' 'DarkGray' }
  else {
    $keep = [Math]::Min($KeepBackups, $zips.Count)
    Say ("  {0} backup(s), keeping the newest {1}" -f $zips.Count, $keep) 'DarkGray'
    foreach ($z in ($zips | Select-Object -First $keep)) {
      Say ("  {0,10:n1} MB  {1}   KEPT" -f (Mb $z.Length), $z.Name) 'Green'
    }
    foreach ($z in ($zips | Select-Object -Skip $keep)) {
      Add-Found 'this machine' 'old backup' $z.FullName $z.Length
      Say ("  {0,10:n1} MB  {1}" -f (Mb $z.Length), $z.Name)
    }
  }
}

if ($Temp) {
  Head 'Temp files on this machine'
  foreach ($dir in @($env:TEMP, 'C:\Windows\Temp')) {
    if (-not $dir -or -not (Test-Path -LiteralPath $dir)) { continue }
    foreach ($f in (Get-ChildItem -LiteralPath $dir -Filter 'thornswood*' -Force -EA SilentlyContinue)) {
      $b = if ($f.PSIsContainer) { Folder-Bytes $f.FullName } else { $f.Length }
      Add-Found 'this machine' 'temp' $f.FullName $b
      Say ("  {0,10:n1} MB  {1}" -f (Mb $b), $f.FullName)
    }
  }
  if (-not ($found | Where-Object { $_.What -eq 'temp' -and $_.Where -eq 'this machine' })) { Say '  none' 'DarkGray' }
}

# ------------------------------------------------------------ the server ---
if ($Installers -or $Temp) {
  Head 'On the server'
  $lines = Remote @"
`$ErrorActionPreference = 'Continue'
foreach (`$d in @('C:\Thornswood-Docs\public\downloads', 'C:\Windows\Temp')) {
  if (-not (Test-Path `$d)) { continue }
  foreach (`$f in (Get-ChildItem `$d -Force -EA SilentlyContinue)) {
    if (`$f.PSIsContainer) { continue }
    if (`$f.Name -notmatch '(?i)(thornswood|setup|pack-|\.zip`$|\.exe`$)') { continue }
    'FILE|' + `$f.FullName + '|' + `$f.Length + '|' + `$f.LastWriteTime.ToString('yyyy-MM-dd')
  }
}
foreach (`$d in (Get-ChildItem 'C:\' -Directory -EA SilentlyContinue)) {
  `$lg = Join-Path `$d.FullName 'server.log'
  if (Test-Path `$lg) { `$i = Get-Item `$lg; 'FILE|' + `$i.FullName + '|' + `$i.Length + '|' + `$i.LastWriteTime.ToString('yyyy-MM-dd') }
}
"@
  $any = $false
  foreach ($l in $lines) {
    $bits = "$l" -split '\|'
    if ($bits.Count -lt 4 -or $bits[0] -ne 'FILE') { continue }
    $any = $true
    Add-Found 'the server' 'server leftover' $bits[1] ([int64]$bits[2])
    Say ("  {0,10:n1} MB  {1}   {2}" -f (Mb ([int64]$bits[2])), $bits[1], $bits[3])
  }
  if (-not $any) { Say '  nothing worth removing' 'DarkGray' }
}

# ----------------------------------------------------------------- github ---
if ($Github) {
  Head 'GitHub release assets'
  $gh = Get-Command gh -EA SilentlyContinue
  if (-not $gh) {
    Say '  gh is not installed, so the repositories were not looked at.' 'Yellow'
    Say '  winget install --id GitHub.cli' 'DarkGray'
  }
  else {
    foreach ($r in @(@($Repo, $SourceRepo) | Where-Object { $_ })) {
      Say "  $r" 'White'
      $json = & gh api "repos/$r/releases?per_page=100" 2>$null
      if ($LASTEXITCODE -ne 0 -or -not $json) { Say '    could not read it, skipping' 'Yellow'; continue }
      $rels = $json | ConvertFrom-Json
      $rels = @($rels | Sort-Object { [datetime]$_.created_at } -Descending)
      if ($rels.Count -eq 0) { Say '    no releases' 'DarkGray'; continue }
      $keep = [Math]::Min($KeepReleases, $rels.Count)
      Say ("    {0} release(s), keeping the newest {1}" -f $rels.Count, $keep) 'DarkGray'
      foreach ($rel in ($rels | Select-Object -Skip $keep)) {
        $b = 0
        foreach ($a in @($rel.assets)) { $b += [int64]$a.size }
        if ($b -eq 0) { continue }
        Add-Found 'github' "release $r" ("$r#" + $rel.tag_name) $b
        Say ("    {0,10:n1} MB  {1}   {2}" -f (Mb $b), $rel.tag_name, ([datetime]$rel.created_at).ToString('dd MMM'))
      }
    }
  }
}

# ------------------------------------------------------------ the totals ---
Head 'Altogether'
if ($found.Count -eq 0) {
  Say '  Nothing to clean up.' 'Green'
  Write-Host ''
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}
foreach ($g in ($found | Group-Object Where | Sort-Object Name)) {
  $b = ($g.Group | Measure-Object -Property Bytes -Sum).Sum
  Say ("  {0,10:n2} GB  {1}   ({2} item(s))" -f (Gb $b), $g.Name, $g.Count)
}
$total = ($found | Measure-Object -Property Bytes -Sum).Sum
Say ("  {0,10:n2} GB  in total" -f (Gb $total)) 'Green'

if ($ServerSaves) {
  Head 'The server wipe, separately'
  Say '  Asked for with -ServerSaves. This is every character anybody has made.' 'Yellow'
  $lines = Remote @"
`$ErrorActionPreference = 'Continue'
foreach (`$d in (Get-ChildItem 'C:\' -Directory -EA SilentlyContinue)) {
  foreach (`$n in @('world', 'private\characters.json', 'data\online.json')) {
    `$p = Join-Path `$d.FullName `$n
    if (Test-Path `$p) {
      `$b = 0
      if ((Get-Item `$p).PSIsContainer) {
        foreach (`$f in (Get-ChildItem `$p -Recurse -File -EA SilentlyContinue)) { `$b += `$f.Length }
      } else { `$b = (Get-Item `$p).Length }
      'SAVE|' + `$p + '|' + `$b
    }
  }
}
"@
  foreach ($l in $lines) {
    $bits = "$l" -split '\|'
    if ($bits.Count -lt 3 -or $bits[0] -ne 'SAVE') { continue }
    Say ("  {0,10:n1} MB  {1}" -f (Mb ([int64]$bits[2])), $bits[1]) 'Yellow'
  }
  Write-Host ''
  Say '  Not deleted by this script. Take a backup first, then wipe it from the' 'Yellow'
  Say '  server with the machine stopped, or characters come back from memory.' 'Yellow'
}

# ---------------------------------------------------------------- delete ---
if (-not $Delete) {
  Write-Host ''
  Say '  Nothing was deleted. Run it again with -Delete to remove exactly the' 'DarkGray'
  Say '  items above, and nothing else.' 'DarkGray'
  Write-Host ''
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 0
}

Write-Host ''
Say ("  About to delete {0} item(s), {1:n2} GB." -f $found.Count, (Gb $total)) 'Red'
$typed = Read-Host '  Type DELETE to go ahead'
if ($typed -cne 'DELETE') { Die 'Not deleted.' }

Head 'Deleting'
$goneBytes = 0; $goneCount = 0; $failed = 0
foreach ($f in $found) {
  try {
    if ($f.Where -eq 'this machine') {
      if (Test-Path -LiteralPath $f.Path) {
        Remove-Item -LiteralPath $f.Path -Recurse -Force -ErrorAction Stop
      }
    }
    elseif ($f.Where -eq 'the server') {
      [void](Remote "Remove-Item -LiteralPath '$($f.Path)' -Recurse -Force -EA SilentlyContinue")
    }
    else {
      $bits = $f.Path -split '#'
      & gh release delete $bits[1] --repo $bits[0] --yes --cleanup-tag 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "gh release delete exited with $LASTEXITCODE" }
    }
    $goneBytes += $f.Bytes; $goneCount++
    Say ("  gone   {0}" -f $f.Path) 'Green'
  }
  catch {
    $failed++
    Say ("  FAILED {0}" -f $f.Path) 'Red'
    Say ("         " + $_.Exception.Message) 'DarkGray'
  }
}

Head 'Done'
Say ("  {0} item(s) removed, {1:n2} GB back" -f $goneCount, (Gb $goneBytes)) 'Green'
if ($failed) { Say ("  {0} could not be removed, listed above" -f $failed) 'Yellow' }

Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
