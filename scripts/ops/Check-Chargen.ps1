<#
  Check-Chargen.ps1

  Preflight for character creation. Everything it looks at is something that
  silently produces a broken first join rather than an error message, so it is
  worth thirty seconds before starting the server.

  It checks, in order:
    - the server's load order holds both plugins the flow needs
    - the plugin carries the ten town passages and the welcome book, each
      named and with a mesh
    - gamemode.js is the build that knows about all of it
    - the start point in server-settings.json is the creation room, computed
      from this load order rather than written down

      .\scripts\ops\Check-Chargen.ps1              the build on this machine
      .\scripts\ops\Check-Chargen.ps1 -From dev    the dev server's own settings
      .\scripts\ops\Check-Chargen.ps1 -From live   the live server's own settings

  ASK THE BOX, NOT ONLY THE BUILD. Until 23 September this read the built
  server on this machine and nothing else, and the file that went wrong was
  the one on the dev box: it keeps its own server-settings.json, which is
  the whole reason Deploy-DevGamemode exists, and its start point was left
  naming file index 58 after the load order under it moved. Skyrim Unbound
  is at 54 there, in a list of 57, so every new character died at login with
  'FromFormId failed due to invalid file index 58' and the client showed a
  box saying only that there were technical difficulties. This check would
  have found it in ten seconds and could not be pointed at the file.

  For a server, every check reads the server's own files (#2950): the plugin
  its load order names and the gamemode.js it runs, on the box, in the same
  call that reads its settings. Only the build reads -Data and -Dist.

  Read only, here and there. It changes nothing on either machine.
#>
param(
    [string]$Dist = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') ServerDist),
    [string]$Data = ((& (Join-Path $PSScriptRoot '..\release\Where.ps1') Install) + '\Game\Data'),
    # Whose settings to read: the build on this machine, or a server's own.
    [ValidateSet('build', 'live', 'dev')][string]$From = 'build',
    [string]$Vps  = '',
    [string]$User = ''
)


$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $Here '..\vps\Vps.ps1')
. (Join-Path $Here '..\deploy\ServerOrder.ps1')
if (-not $User) { $User = Get-ThornswoodVpsUser }
if (-not $Vps) { $Vps = Get-ThornswoodVpsAddress }
$fail = 0
function Ok  ($m) { Write-Host "  ok    $m" -ForegroundColor Green }
function Bad ($m) { Write-Host "  FAIL  $m" -ForegroundColor Red; $script:fail++ }
function Note($m) { Write-Host "        $m" -ForegroundColor DarkGray }

# What the plugin at $Path holds for the checks below, one line a record:
# 'BOOK <form id> <has a name> <has a mesh>'. It runs here for the build and
# on the box for a server, in Windows PowerShell there, so it only reads and
# only writes text.
#
# The four message boxes this also read, the trade menu and the town menu
# over two pages each, are out of the plugin (#2962): the choices are made in
# the K panel since 20 September, there is no trade to choose since 21
# September, and nothing showed or named the boxes. This asked for them as if
# creation needed them, which is what kept them.
function Read-ThornswoodChargenRecords([string]$Path) {
    $bytes = [IO.File]::ReadAllBytes($Path)
    # Walk the BOOK top group rather than the whole file: the records are
    # small, uncompressed, and all in one place.
    $i = 0
    while ($i + 24 -le $bytes.Length) {
        $tag = [Text.Encoding]::ASCII.GetString($bytes, $i, 4)
        if ($tag -eq 'GRUP') {
            $gs = [BitConverter]::ToUInt32($bytes, $i + 4)
            if ($gs -lt 24) { break }
            $label = [Text.Encoding]::ASCII.GetString($bytes, $i + 8, 4)
            if ($label -eq 'BOOK') {
                $j = $i + 24
                while ($j + 24 -le $i + $gs) {
                    $ds  = [BitConverter]::ToUInt32($bytes, $j + 4)
                    $fid = [BitConverter]::ToUInt32($bytes, $j + 12)
                    $body = [Text.Encoding]::GetEncoding(1252).GetString($bytes, $j + 24, $ds)
                    'BOOK {0:X8} {1} {2}' -f $fid, [int]$body.Contains('FULL'), [int]$body.Contains('MODL')
                    $j += 24 + $ds
                }
            }
            $i += $gs
            continue
        }
        $ds = [BitConverter]::ToUInt32($bytes, $i + 4)
        $i += 24 + $ds
    }
}

# Which of $Needles the gamemode at $Path mentions, one line each:
# 'HAS 1 <needle>' or 'HAS 0 <needle>'. Runs here or on the box, like the above.
function Find-ThornswoodGamemodeText([string]$Path, [string[]]$Needles) {
    $js = [IO.File]::ReadAllText($Path)
    foreach ($n in $Needles) { 'HAS ' + [int]$js.Contains($n) + ' ' + $n }
}

# What a gamemode.js that knows about the creation flow mentions.
$gmNeedles = @(
    @{ Text = "e80039:Thornswood-Content.esp"; What = 'the town passages' }
    @{ Text = "19bad4:Skyrim Unbound.esp";     What = 'the creation room' }
    @{ Text = "thornswoodChargen";             What = 'the creation state property' }
)

if ($From -eq 'build') {
    $settingsPath = Join-Path $Dist 'server-settings.json'
    if (-not (Test-Path -LiteralPath $settingsPath)) { throw "not found: $settingsPath" }
    $s = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    Write-Host ''
    Write-Host "reading the build at $settingsPath" -ForegroundColor DarkGray
    $espWhere = Join-Path $Data 'Thornswood-Content.esp'
    $espLines = $null
    if (Test-Path -LiteralPath $espWhere) { $espLines = @(Read-ThornswoodChargenRecords $espWhere) }
    $gmWhere = Join-Path $Dist 'gamemode.js'
    $gmLines = $null
    if (Test-Path -LiteralPath $gmWhere) { $gmLines = @(Find-ThornswoodGamemodeText $gmWhere ([string[]]@($gmNeedles | ForEach-Object { $_.Text }))) }
} else {
    # The files are read where they live and only text comes back. Nothing
    # is written on either machine.
    #
    # WHICH PLUGINS ARE LIGHT IS THE BOX'S TOO (#2947): each file the
    # settings' loadOrder names is read there by Test-ThornswoodPluginLight,
    # and whether the engine loads light plugins comes from the server's own
    # server-build.json. Until then both came from this machine (the game
    # folder in -Data and this checkout's record), so on a machine with no
    # game folder (a cloud one) this stopped on the first plugin it could
    # not find, and a game folder with another copy of a plugin answered for
    # a file the server does not load.
    #
    # AND SO ARE THE PLUGIN AND THE GAMEMODE (#2950). The records were read
    # from Thornswood-Content.esp in -Data and the gamemode from -Dist, the
    # files on this machine, which the server never runs: our plugin goes to
    # the box from the repo (game\content), not from a game folder, and its
    # gamemode.js from whichever deploy last ran. Both are read there now, in
    # this call: the plugin the load order names, and the gamemode by the
    # engine's own rule (skymp5-server/ts/settings.ts: the settings'
    # gamemodePath, else skymp5-gamemode\gamemode.js when that folder is
    # there, else gamemode.js, from the server's folder, where it runs). A
    # load order entry that is not a full path is under dataDir, as
    # ScampServer.cpp reads it.
    $root = if ($From -eq 'dev') { 'C:\Thornswood-Server-Dev' } else { 'C:\Thornswood-Server' }
    $settingsPath = "$root\server-settings.json"
    $lightDef = 'function Test-ThornswoodPluginLight {' + "`n" + (Get-Command Test-ThornswoodPluginLight).Definition + "`n}"
    $recordsDef = 'function Read-ThornswoodChargenRecords {' + "`n" + (Get-Command Read-ThornswoodChargenRecords).Definition + "`n}"
    $gmDef = 'function Find-ThornswoodGamemodeText {' + "`n" + (Get-Command Find-ThornswoodGamemodeText).Definition + "`n}"
    $needleList = (@($gmNeedles | ForEach-Object { "'" + $_.Text.Replace("'", "''") + "'" }) -join ', ')
    $remote = @"
`$ProgressPreference = 'SilentlyContinue'
$lightDef
$recordsDef
$gmDef
`$raw = Get-Content -LiteralPath '$settingsPath' -Raw
`$cfg = `$raw | ConvertFrom-Json
`$rp = '$root\server-build.json'
if (-not (Test-Path -LiteralPath `$rp)) { 'ENGINE none' }
else { try { `$r = Get-Content -LiteralPath `$rp -Raw | ConvertFrom-Json; 'ENGINE ' + [string](`$r.lightPlugins -eq `$true) } catch { 'ENGINE unreadable' } }
`$dataDir = [string]`$cfg.dataDir
if (-not [IO.Path]::IsPathRooted(`$dataDir)) { `$dataDir = Join-Path '$root' `$dataDir }
`$esp = `$null
foreach (`$o in @(`$cfg.loadOrder)) {
  `$f = [string]`$o
  if (-not [IO.Path]::IsPathRooted(`$f)) { `$f = Join-Path `$dataDir `$f }
  if ([IO.Path]::GetFileName(`$f) -eq 'Thornswood-Content.esp') { `$esp = `$f }
  try { 'LIGHT ' + [int](Test-ThornswoodPluginLight `$f) + ' ' + [IO.Path]::GetFileName(`$f) } catch { 'UNREAD ' + [IO.Path]::GetFileName(`$f) }
}
if (-not `$esp) { 'PLUGIN NONE' }
elseif (-not (Test-Path -LiteralPath `$esp)) { 'PLUGIN MISSING ' + `$esp }
else { 'PLUGIN AT ' + `$esp; Read-ThornswoodChargenRecords `$esp }
`$gm = 'gamemode.js'
if (`$cfg.gamemodePath) { `$gm = [string]`$cfg.gamemodePath }
elseif (Test-Path -LiteralPath '$root\skymp5-gamemode') { `$gm = 'skymp5-gamemode\gamemode.js' }
if (-not [IO.Path]::IsPathRooted(`$gm)) { `$gm = Join-Path '$root' `$gm }
if (-not (Test-Path -LiteralPath `$gm)) { 'GAMEMODE MISSING ' + `$gm }
else { 'GAMEMODE AT ' + `$gm; Find-ThornswoodGamemodeText `$gm @($needleList) }
'SETTINGS'
`$raw
"@
    $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remote))
    $text = Invoke-ThornswoodNative { & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes "$User@$Vps" "pwsh -NoProfile -EncodedCommand $enc" } 2>&1
    $lines = @($text | ForEach-Object { "$_" })
    $at = [Array]::IndexOf([string[]]$lines, 'SETTINGS')
    if ($at -lt 0) { throw "could not read $settingsPath from $Vps : $($lines -join "`n")" }
    $json = (@($lines | Select-Object -Skip ($at + 1)) -join "`n")
    if ($json.IndexOf('{') -lt 0) { throw "could not read $settingsPath from $Vps : $json" }
    $s = $json.Substring($json.IndexOf('{')) | ConvertFrom-Json
    $boxEngine = @($lines | Where-Object { $_ -like 'ENGINE *' } | Select-Object -First 1)
    $boxLight = @{}
    $boxUnread = @()
    $espWhere = "Thornswood-Content.esp, which the $From server's load order does not name"
    $espLines = $null
    $gmWhere = ''
    $gmLines = $null
    foreach ($l in @($lines | Select-Object -First $at | ForEach-Object { $_.Trim() })) {
        if ($l -match '^LIGHT ([01]) (.+)$') { $boxLight[$Matches[2].Trim().ToLowerInvariant()] = ($Matches[1] -eq '1') }
        elseif ($l -match '^UNREAD (.+)$') { $boxUnread += $Matches[1].Trim() }
        elseif ($l -match '^PLUGIN MISSING (.+)$') { $espWhere = "$($Matches[1]) on the $From server" }
        elseif ($l -match '^PLUGIN AT (.+)$') { $espWhere = "$($Matches[1]) on the $From server"; $espLines = @() }
        elseif ($l -match '^BOOK ' -and $null -ne $espLines) { $espLines += $l }
        elseif ($l -match '^GAMEMODE MISSING (.+)$') { $gmWhere = "$($Matches[1]) on the $From server" }
        elseif ($l -match '^GAMEMODE AT (.+)$') { $gmWhere = "$($Matches[1]) on the $From server"; $gmLines = @() }
        elseif ($l -match '^HAS ' -and $null -ne $gmLines) { $gmLines += $l }
    }
    Write-Host ''
    Write-Host "reading the $From server at $Vps, $settingsPath" -ForegroundColor DarkGray
    Write-Host '  and the plugins, plugin records and gamemode.js it loads, there' -ForegroundColor DarkGray
}
$order = @($s.loadOrder | ForEach-Object { @("$_".Trim() -split '[\\/]')[-1] })

Write-Host ''
Write-Host 'load order' -ForegroundColor Cyan
# Full indices: an engine that loads light plugins lists them and gives them
# none (#1715). For the build on this machine, which engine is this
# checkout's record and which plugins are light is read from -Data, like the
# checks below; for a server, both are the box's own (above).
if ($From -eq 'build') {
    $lightTest = Get-ThornswoodLightTest ([string[]]@($order | ForEach-Object { Join-Path $Data $_ })) (Join-Path $Here '..\..\records\server-build.json')
} else {
    if ($boxEngine -notcontains 'ENGINE True' -and $boxEngine -notcontains 'ENGINE False') {
        throw ("the $From server's server-build.json said " + ($boxEngine -join ' ') + ', so it is not known whether its engine loads light plugins')
    }
    if ($boxUnread.Count) {
        throw ("the $From server cannot read whether " + ($boxUnread -join ', ') + ' is light, so no full index can be counted')
    }
    $lightTest = $null
    if ($boxEngine -contains 'ENGINE True') { $lightTest = { param($n) [bool]$boxLight[$n.ToLowerInvariant()] }.GetNewClosure() }
}
$idxContent = Get-ThornswoodFullIndex ([string[]]$order) $lightTest 'Thornswood-Content.esp'
$idxUnbound = Get-ThornswoodFullIndex ([string[]]$order) $lightTest 'Skyrim Unbound.esp'

if ($idxContent -lt 0) { Bad 'Thornswood-Content.esp is not in the server load order' }
else { Ok ("Thornswood-Content.esp at index {0} (0x{0:X2})" -f $idxContent) }

if ($idxUnbound -lt 0) {
    Bad 'Skyrim Unbound.esp is not in the server load order, so there is no creation room'
    Note 'creation still runs, wherever the start point happens to be'
} else {
    Ok ("Skyrim Unbound.esp at index {0} (0x{0:X2})" -f $idxUnbound)
}

Write-Host ''
Write-Host 'plugin records' -ForegroundColor Cyan
if ($null -eq $espLines) {
    Bad "not found: $espWhere"
} else {
    Note "read from $espWhere"
    $books = @{}
    foreach ($l in $espLines) {
        if ($l -match '^BOOK ([0-9A-F]{8}) ([01]) ([01])$') {
            $books[[Convert]::ToUInt32($Matches[1], 16)] = @{ HasName = ($Matches[2] -eq '1'); HasMesh = ($Matches[3] -eq '1') }
        }
    }

    # The sixteen trade writs and the fifteen skill manuals this used to ask
    # for were taken out of the plugin on 21 September, when rank came to be
    # earned by work (d1418f5, 5d1f3f0), and the novice alchemy book with
    # them; nothing in gamemode.js names any of them. The check went on
    # asking for them, which only a copy of the plugin older than that could
    # answer: it read a game folder's copy, never the server's (#2950).
    $passages = 0x05E80030..0x05E80039
    $welcome  = @(0x05E80000)

    function CheckSet($label, $ids) {
        $missing  = @($ids | Where-Object { -not $books.ContainsKey([uint32]$_) })
        $nameless = @($ids | Where-Object { $books.ContainsKey([uint32]$_) -and -not $books[[uint32]$_].HasName })
        $bodiless = @($ids | Where-Object { $books.ContainsKey([uint32]$_) -and -not $books[[uint32]$_].HasMesh })
        if ($missing)  { Bad ("{0}: {1} of {2} missing from the plugin" -f $label, $missing.Count, $ids.Count); return }
        if ($nameless) { Bad ("{0}: {1} have no name" -f $label, $nameless.Count); return }
        if ($bodiless) { Bad ("{0}: {1} have no mesh" -f $label, $bodiless.Count); return }
        Ok ("{0}: all {1} present, named and visible" -f $label, $ids.Count)
    }

    Ok ("{0} BOOK records in the plugin" -f $books.Count)
    CheckSet 'town passages'   $passages
    CheckSet 'welcome book'    $welcome
}

Write-Host ''
Write-Host 'gamemode' -ForegroundColor Cyan
if ($null -eq $gmLines) {
    Bad "not found: $gmWhere"
} else {
    Note "read from $gmWhere"
    foreach ($needle in $gmNeedles) {
        if ($gmLines -contains ('HAS 1 ' + $needle.Text)) { Ok ("gamemode.js knows {0}" -f $needle.What) }
        else { Bad ("gamemode.js does not mention {0} - it is the old build" -f $needle.What) }
    }
}

Write-Host ''
Write-Host 'start point' -ForegroundColor Cyan
$sp = @($s.startPoints)[0]
if (-not $sp) {
    Bad 'server-settings.json has no startPoints'
} elseif ($idxUnbound -ge 0) {
    $want = ($idxUnbound * 0x01000000) + 0x19BAD4
    $got  = [Convert]::ToUInt32(([string]$sp.worldOrCell -replace '^0[xX]', ''), 16)
    if ($got -eq $want) {
        Ok ("start point is the creation room (0x{0:X8})" -f $want)
    } else {
        Bad ("start point is 0x{0:X8}, the creation room is 0x{1:X8}" -f $got, $want)
        Note ("it names file index {0}; Skyrim Unbound.esp is at {1} in this load order" -f
              [int]($got -shr 24), $idxUnbound)
        Note 'a new character cannot spawn at all: the server throws FromFormId failed'
        Note 'and the client shows a box saying only that there are technical difficulties'
        if ($From -eq 'build') {
            Note 'run Deploy-Gamemode.ps1 again; it computes this from the load order'
        } else {
            Note 'run Deploy-DevGamemode.ps1; it recomputes this on the box every run'
        }
    }
} else {
    Note ("start point is {0}, which is the fallback" -f $sp.worldOrCell)
}

Write-Host ''
if ($fail) {
    Write-Host "$fail check(s) failed. Fix those before starting the server." -ForegroundColor Red
    exit 1
}
Write-Host 'everything checks out.' -ForegroundColor Green
