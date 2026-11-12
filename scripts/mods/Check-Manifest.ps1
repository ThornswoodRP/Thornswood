<#
  Check-Manifest.ps1

  Says what load order the game server is actually handing out, and how it
  compares to the one you play with.

      .\scripts\mods\Check-Manifest.ps1
      .\scripts\mods\Check-Manifest.ps1 -Full     print both lists in full
      .\scripts\mods\Check-Manifest.ps1 -Dev      the dev server against the dev build

  -Dev exists because until 22 September this could not be pointed at the dev
  server at all. It finds the root by listing C:\ on the VPS and taking the
  first folder that holds a server-settings.json, which is C:\Thornswood-Server,
  and it compared against C:\Thornswood, the main build. So the one question
  worth asking about the dev server, whether its load order is still the one
  people are playing, had no way to be asked. On that day the answer was no: 60
  plugins against the game's 57, parting company at position 7, and four things
  for the launcher's scan to find before Play would come back.

  Why it matters: SkyMP's client compares the server's manifest against your
  plugin list position by position. One plugin out of place and the person is
  turned away with a load order error that says nothing useful. Before building
  a Nexus collection, the list in here is the thing that has to be matched, and
  a stale copy on a client is not evidence of anything.

  Exit 0 when the server's list and yours match position by position. Exit 1
  when they do not, when a copy of the manifest cannot be read, when there is
  no plugins.txt to compare, or when the server, the dev server or its
  manifest cannot be found (#4760).
#>
[CmdletBinding()]
param(
  [string]$Vps  = '',
  [string]$User = '',
  [string]$Client = '',
  [switch]$Dev,
  [switch]$Full,
  [switch]$NoPause
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\vps\Send-Script.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
# The dev server is a second install beside the live one, and the dev build is
# a second launcher beside the main one. Asking about one against the other is
# what made this worth a switch rather than two paths typed by hand.
if (-not $Client) { $Client = [string](& (Join-Path $Here '..\release\Where.ps1') $(if ($Dev) { 'InstallDev' } else { 'Install' })) }

$ssh = @('-o','BatchMode=yes','-o','StrictHostKeyChecking=yes')

# The one rule for what the game loads and in what order, shared with the
# launcher's LoadOrder.cs and with Publish-Update.ps1. This script used to
# build its own list and got it wrong in the one way that matters: it compared
# the server's 60 full plugins against every enabled line in plugins.txt,
# light ones included, so on 17 September it reported the two lists parting
# company at slot 6, server Water for ENB.esm against Expressive Facegen
# Morphs.esl, two lines after saying you had every plugin the server wants. It
# then advised redeploying a server that was already correct, which is worse
# than having no check at all. The server drops light plugins on purpose:
# Game.getModCount gives them no index, so they hold no place in the order.
. (Join-Path $PSScriptRoot 'LoadOrder.ps1')

function Say($m, $c = 'Gray') { Write-Host $m -ForegroundColor $c }
function Head($m) { Write-Host ''; Write-Host $m -ForegroundColor Cyan; Write-Host ('-' * $m.Length) -ForegroundColor DarkGray }

function Remote($script) {
  # Send-Script.ps1 (issue #1070): a long script goes by scp and its run takes
  # it off the box before it runs, and the far side's exit code comes back.
  return Invoke-ThornswoodRemote -Target "$User@$Vps" -SshArgs $ssh -Script $script
}

Write-Host ''
Write-Host '  THORNSWOOD  -  what load order the server wants' -ForegroundColor White

# The server root has moved before, so find it rather than assume it.
Head 'Finding the server'
$found = Remote @"
`$ErrorActionPreference = 'Continue'
`$roots = @()
foreach (`$d in (Get-ChildItem 'C:\' -Directory -EA SilentlyContinue)) {
  if (Test-Path -LiteralPath (Join-Path `$d.FullName 'server-settings.json')) { `$roots += `$d.FullName }
}
if (-not `$roots) {
  # Second pass: one level deeper, for a server inside a folder of its own.
  foreach (`$d in (Get-ChildItem 'C:\' -Directory -EA SilentlyContinue)) {
    foreach (`$s in (Get-ChildItem -LiteralPath `$d.FullName -Directory -EA SilentlyContinue)) {
      if (Test-Path -LiteralPath (Join-Path `$s.FullName 'server-settings.json')) { `$roots += `$s.FullName }
    }
  }
}
if (-not `$roots) { 'NO SERVER FOUND'; exit }
foreach (`$r in `$roots) { 'ROOT ' + `$r }
"@
$found | ForEach-Object { Say "  $_" }
if ("$found" -match 'NO SERVER FOUND') {
  Write-Host ''
  Say '  No server-settings.json anywhere on C:. Is the game server on this box?' 'Red'
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 1
}
# Every root the box has, in the order it listed them. Taking the first was
# right when there was one; with the dev instance beside it, the first is the
# live server and the dev one was unreachable from here.
$roots = @(@($found) | Where-Object { $_ -match '^ROOT ' } | ForEach-Object { ("$_" -replace '^ROOT ', '').Trim() })
$devRoots  = @($roots | Where-Object { $_ -match '(?i)-dev$' })
$liveRoots = @($roots | Where-Object { $_ -notmatch '(?i)-dev$' })

if ($Dev) {
  if (-not $devRoots.Count) {
    Write-Host ''
    Say '  No dev server on the box: nothing on C:\ ends in -Dev and holds a server-settings.json.' 'Red'
    Say '  vps-dev-instance.ps1 is what makes it, and it runs on the VPS.' 'DarkGray'
    if (-not $NoPause) { [void](Read-Host 'Enter to close') }
    exit 1
  }
  $root = $devRoots[0]
} else {
  $root = if ($liveRoots.Count) { $liveRoots[0] } else { $roots[0] }
}
Say ("  reading {0} ({1}), against the build at {2}" -f $root, $(if ($Dev) { 'dev' } else { 'live' }), $Client) 'DarkGray'

Head "Reading the manifests under $root"
$out = Remote @"
`$ErrorActionPreference = 'Continue'
`$root = '$($root.Replace("'", "''"))'
`$dataDir = 'data'
try {
  `$cfg = Get-Content -LiteralPath (Join-Path `$root 'server-settings.json') -Raw | ConvertFrom-Json
  if (`$cfg.dataDir) { `$dataDir = [string]`$cfg.dataDir }
} catch { }
`$data = Join-Path `$root `$dataDir
'dataDir  ' + `$data

# The same manifest is written twice, once where it is generated and once
# where the client asks for it. Reading both and concatenating made the server
# look like it wanted 122 plugins when it wants 61.
`$seen = `$false
foreach (`$f in (Get-ChildItem -LiteralPath `$data -Recurse -Filter 'manifest.json' -File -EA SilentlyContinue)) {
  try {
    `$m = Get-Content -LiteralPath `$f.FullName -Raw | ConvertFrom-Json
    `$n = @(`$m.loadOrder).Count
    `$k = @(`$m.mods).Count
    'FILE ' + `$f.FullName
    '  loadOrder ' + `$n + '   mods ' + `$k + '   written ' + `$f.LastWriteTime
    if (-not `$seen) { foreach (`$p in `$m.loadOrder) { 'LO ' + `$p }; `$seen = `$true }
    else { '  same list as above, not counted twice' }
  } catch { 'FILE ' + `$f.FullName + '  UNREADABLE: ' + `$_.Exception.Message }
}
"@

$lines = @($out | ForEach-Object { "$_" })
$serverOrder = @()
# Each finding below adds one, and any at all is exit 1 at the end (#4760).
$bad = 0
foreach ($l in $lines) {
  if ($l -match '^\s*LO (.+)$') { $serverOrder += $Matches[1].Trim() }
  else {
    Say "  $l"
    if ($l -match '  UNREADABLE: ') { $bad++ }
  }
}

if ($serverOrder.Count -eq 0) {
  Write-Host ''
  Say '  The server has not written a manifest. It writes one at startup, so it' 'Yellow'
  Say '  either has not been started since the last deploy, or it failed early.' 'Yellow'
  if (-not $NoPause) { [void](Read-Host 'Enter to close') }
  exit 1
}

# ------------------------------------------------------- the comparison ---
$plug = Join-Path $Client 'Profile\LocalAppData\plugins.txt'
Head 'Against the load order you play with'
if (-not (Test-Path -LiteralPath $plug)) {
  Say "  No plugins.txt at $plug" 'Yellow'
  $bad++
} else {
  $enabled = @()
  foreach ($l in (Get-Content -LiteralPath $plug)) {
    $n = Get-LoadOrderEnabledName $l
    if ($n) { $enabled += $n }
  }

  # The game's own order: the five masters, then every plugin Skyrim.ccc
  # names that is in Data in that file's order, then the enabled lines. Light
  # plugins are skipped throughout, because the server gives them no index.
  # The Skyrim.ccc half is not decoration: on 19 September two Creation Club
  # masters the list never mentions put every plugin after Dragonborn.esm two
  # places off, and any check that reads plugins.txt alone passes that.
  $gameDir = Join-Path $Client 'Game'
  $data    = Join-Path $gameDir 'Data'
  $ccc     = @()
  $cccFile = Join-Path $gameDir 'Skyrim.ccc'
  if (Test-Path -LiteralPath $cccFile) {
    foreach ($raw in (Get-Content -LiteralPath $cccFile)) {
      $t = "$raw".Trim()
      if ($t.Length -and -not $t.StartsWith('#')) { $ccc += $t }
    }
  }
  $isLightOrMissing = { param($n) $f = Join-Path $data $n; (-not (Test-Path -LiteralPath $f)) -or (Test-LoadOrderLight $f) }
  $exists           = { param($n) Test-Path -LiteralPath (Join-Path $data $n) }
  # Assigned, not wrapped in @(): the function hands back one array and @()
  # around it would nest that array inside another.
  $mineFull = Get-LoadOrderGame $enabled $isLightOrMissing $ccc $exists
  $dropped  = ($enabled.Count + 5) - $mineFull.Count

  Say ("  server wants  {0} plugins" -f $serverOrder.Count)
  Say ("  you have      {0} that take a place in the order (five Bethesda masters included)" -f $mineFull.Count)
  Say ("  {0} enabled lines carry no index and are left out of both lists, because they are light" -f $dropped) 'DarkGray'
  Write-Host ''

  $extra   = @($mineFull | Where-Object { $serverOrder -notcontains $_ })
  $missing = @($serverOrder | Where-Object { $mineFull -notcontains $_ })

  if ($missing.Count) {
    Say ("  {0} the server wants that you DO NOT have:" -f $missing.Count) 'Red'
    $missing | ForEach-Object { Say "    $_" 'Red' }
  } else {
    Say '  you have every plugin the server wants' 'Green'
  }
  Write-Host ''
  if ($extra.Count) {
    Say ("  {0} you have that the server does NOT list:" -f $extra.Count) 'Yellow'
    $extra | ForEach-Object { Say "    $_" 'DarkGray' }
    Write-Host ''
    Say '  Each of these takes a place in your order that it does not take in' 'DarkGray'
    Say '  the server''s, so everything after it sits one place off. The first' 'DarkGray'
    Say '  mismatched position below says where that starts.' 'DarkGray'
  } else {
    Say '  you have nothing the server does not list' 'Green'
  }

  Write-Host ''
  $firstBad = Get-LoadOrderFirstMismatch $mineFull $serverOrder
  if ($missing.Count -or $extra.Count -or $firstBad -ge 0) { $bad++ }
  if ($firstBad -lt 0) {
    Say '  POSITION BY POSITION: identical.' 'Green'
  } elseif ($firstBad -ge $serverOrder.Count -or $firstBad -ge $mineFull.Count) {
    Say ("  POSITION BY POSITION: the first {0} match, then one list runs out." -f $firstBad) 'Yellow'
    Say '  The shorter list is missing plugins the other has. They are named above.' 'Yellow'
  } else {
    Say ("  POSITION BY POSITION: they part company at slot {0}." -f ($firstBad + 1)) 'Red'
    Say ("    server: " + $serverOrder[$firstBad]) 'Red'
    Say ("    you:    " + $mineFull[$firstBad]) 'Red'
    Write-Host ''
    # Not advice to redeploy. Until 17 September this ended by telling you to
    # regenerate a server manifest that was correct, on the strength of a
    # comparison that was wrong. The server's order is the one to keep: the
    # world database keys every changed form on the position in that list, so
    # moving the server re-keys every saved chest, door and body after it.
    if ($Dev) {
      # The opposite answer, and it has to be said here or the habit from the
      # live half does the damage. The dev world is made empty on purpose
      # (vps-dev-instance.ps1: characters and the world are not copied), so
      # there are no saved forms to re-key and nothing to protect by keeping a
      # stale order. The dev server is the thing that falls behind, because
      # until 22 September nothing could move a load order onto it. Pressing
      # Fix here would write the dev server's old list into the dev build's
      # plugins.txt, naming plugins that are no longer installed at all.
      Say '  The DEV server follows the build, not the other way round. Its world' 'Yellow'
      Say '  is empty by design, so there is nothing to re-key and nothing to keep.' 'Yellow'
      Say ''
      Say '  Do NOT press Fix in the dev launcher. It would write this old list' 'Red'
      Say '  into the dev build and name plugins that are not installed any more.' 'Red'
      Say ''
      Say '  Bring the dev server up to the build instead (Patrick runs it):' 'Yellow'
      Say '    .\scripts\deploy\Deploy-DevGamemode.ps1 -LoadOrder' 'Yellow'
    } else {
      Say '  This machine follows the server, not the other way round. Press Fix' 'Yellow'
      Say '  in the launcher: it puts the server''s order into this build''s plugin' 'Yellow'
      Say '  list and downloads nothing.' 'Yellow'
      Say '  Do not redeploy the server to make this match. The world keys every' 'Yellow'
      Say '  saved form on its position in that list, so moving it re-keys them.' 'Yellow'
    }
  }
}

if ($Full) {
  Head 'The server list in full'
  $i = 0
  foreach ($p in $serverOrder) { $i++; Say ('  {0,3}  {1}' -f $i, $p) }
}

Write-Host ''
if (-not $NoPause) { [void](Read-Host 'Enter to close') }
# What it found is the exit code (#4760). Until then a list that parted
# company with the server's was printed in red and the run still exited 0.
if ($bad) { exit 1 }
exit 0
