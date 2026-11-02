<#
  test-max-online.ps1

  One number for how many people a server holds at once, in one place
  (entry 281, issue #481).

  WHAT WAS WRONG. The engine's slot count is maxPlayers in
  server-settings.json. Entry 281 set it from MaxOnline in the launcher's
  config.json, a file the launcher rewrites from the feed and each machine
  keeps its own of, and past it RakNet refuses with nothing said and no way
  over it for staff. Patrick, 28 Sep: 25 at once for the alpha, raised later.

  WHAT THIS PROVES.
    1. MaxOnline.ps1 reads records\most-online.json, over every shape of it
       worth trying, and the real record says 25. It refuses a seat count
       the engine will not start with (above 1000).
    2. Set-MaxPlayers writes thornswoodMostOnline (the gamemode's number) and
       maxPlayers (the number plus the staff seats), and leaves both alone
       with no number.
    3. The feed (Publish-Update.ps1) reads the same record, and nothing reads
       a launcher's config.json for it any more.
    4. Deploy-Gamemode.ps1's settings section, lifted by text and run against
       a scratch build folder, writes both keys and keeps every other key.
    5. Deploy-DevGamemode.ps1's block that edits the dev settings on the VPS,
       lifted by text and run by Windows PowerShell against a scratch file,
       writes both keys, keeps the dev port and name, and treats an unknown
       number as nothing to change.
    6. Publish-Server.ps1's block, lifted by text and run against a scratch
       build, writes both keys into what it packs, before the zip is made.
    7. Each channel its own numbers (Patrick, 12 Oct: dev at most 5, in the
       game and in voice, "of 5 awake"; main stays 25 and 5, shown "of 30").
       Get-MostOnline -Channel dev reads the record's dev object, a record
       without one gives dev main's numbers and says so, and each channel is
       held to the engine's ceiling and to voice never under its own seats.
       Deploy-DevGamemode reads dev's, Publish-Server and Publish-Update the
       channel they are run for, and the feed's maxOnline is the seats.

  Nothing here reaches the VPS or reads a real config.json. Read only apart
  from files under its own temp folder.
#>
[CmdletBinding()]
param([string]$RepoDir)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $RepoDir) { $RepoDir = $Here }
# The counting function Deploy-DevGamemode sends up with the block (#2011).
# The sections lifted below call ConvertFrom-ThornswoodJson, which their script dot-sources.
. (Join-Path $RepoDir 'scripts\release\Read-JsonFile.ps1')
. (Join-Path $RepoDir 'scripts\deploy\ServerOrder.ps1')
$script:fullIndexDef = 'function Get-ThornswoodFullIndex {' + "`n" + (Get-Command Get-ThornswoodFullIndex).Definition + "`n}"

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-maxonline-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

function Done {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

# By name and by brace match, so a rename fails loudly rather than silently
# testing nothing.
function Get-BlockText([string]$text, [string]$start) {
    $at = $text.IndexOf($start)
    if ($at -lt 0) { return $null }
    $b = $text.IndexOf('{', $at)
    if ($b -lt 0) { return $null }
    $depth = 0
    for ($i = $b; $i -lt $text.Length; $i++) {
        $c = $text[$i]
        if ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') { $depth--; if ($depth -eq 0) { return $text.Substring($at, $i - $at + 1) } }
    }
    return $null
}

$utf8 = New-Object Text.UTF8Encoding($false)

# A record file holding the text given, or none when $json is null.
function New-Record([string]$name, $json, [bool]$bom) {
    $p = Join-Path $tmp ($name + '.json')
    if ($null -ne $json) { [IO.File]::WriteAllText($p, [string]$json, (New-Object Text.UTF8Encoding($bom))) }
    return $p
}

# ---- 1. the helper ----------------------------------------------------------
$helper = Join-Path $RepoDir 'scripts\deploy\MaxOnline.ps1'
Yes 'MaxOnline.ps1 is in scripts\deploy' (Test-Path -LiteralPath $helper)
if (-not (Test-Path -LiteralPath $helper)) { Done }
. $helper
# Deploy-Gamemode's settings section, lifted below, counts the start point's
# full index with ServerOrder.ps1 (#1715).
. (Join-Path $RepoDir 'scripts\deploy\ServerOrder.ps1')
Yes 'it gives Get-MostOnline and Set-MaxPlayers' (
    [bool](Get-Command Get-MostOnline -ErrorAction SilentlyContinue) -and
    [bool](Get-Command Set-MaxPlayers -ErrorAction SilentlyContinue))
Yes 'and no longer reads a launcher''s config.json' (
    -not (Get-Command Get-MaxOnline -ErrorAction SilentlyContinue) -and
    -not (Get-Command Find-LauncherRoot -ErrorAction SilentlyContinue))

# name, record text (null for no file), byte order mark, the number, the seats
$cases = @(
    @('plain',    '{"people":25,"staffSeats":10}',      $false, 25, 35),
    @('bom',      '{"people":40,"staffSeats":5}',       $true,  40, 45),
    @('quoted',   '{"people":"12","staffSeats":"3"}',   $false, 12, 15),
    @('nostaff',  '{"people":25}',                      $false, 25, 25),
    @('badstaff', '{"people":25,"staffSeats":-4}',      $false, 25, 25),
    @('nokey',    '{"staffSeats":10}',                  $false, 0,  0),
    @('zero',     '{"people":0,"staffSeats":10}',       $false, 0,  0),
    @('negative', '{"people":-3}',                      $false, 0,  0),
    @('words',    '{"people":"lots"}',                  $false, 0,  0),
    @('fraction', '{"people":2.5}',                     $false, 0,  0),
    @('broken',   '{"people": 25,,',                    $false, 0,  0),
    @('nofile',   $null,                                $false, 0,  0),
    @('ceiling',  '{"people":990,"staffSeats":10}',     $false, 990, 1000)
)
foreach ($c in $cases) {
    $path = New-Record $c[0] $c[1] $c[2]
    $got = $null
    try { $got = Get-MostOnline $path } catch { $got = $null }
    Yes ("{0}: reads {1}, engine seats {2}" -f $c[0], $c[3], $c[4]) ($null -ne $got -and $got.Value -eq $c[3] -and $got.Seats -eq $c[4])
    if ($null -ne $got) {
        Yes ("{0}: says which file" -f $c[0]) ($got.From -eq $path)
        if ($c[3] -eq 0) { Yes ("{0}: says why there is no number" -f $c[0]) ([string]$got.Why -ne '') }
    }
}

# Above the engine's ceiling is a stop, and the stop names the ceiling.
$over = New-Record 'over' '{"people":995,"staffSeats":10}' $false
$threw = $null
try { [void](Get-MostOnline $over) } catch { $threw = $_.Exception.Message }
Yes 'more than 1000 seats in all is refused rather than written' ($null -ne $threw)
Yes 'the refusal names the engine ceiling' ($null -ne $threw -and $threw.Contains('1000'))

# The real record, found the way every caller finds it: no path given.
$real = Get-MostOnline
Yes ("with no path it reads records\most-online.json (got {0})" -f $real.From) (
    [IO.Path]::GetFullPath($real.From) -eq [IO.Path]::GetFullPath((Join-Path $RepoDir 'records\most-online.json')))
Yes ("the record says 25 people at once (got {0})" -f $real.Value) ($real.Value -eq 25)
Yes ("and seats staff over it: engine seats {0}" -f $real.Seats) ($real.Seats -gt 25 -and $real.Seats -le 1000)
Yes ("main is 25 and 5, 30 seats, unchanged by dev's numbers (got {0} and {1})" -f $real.Value, $real.Staff) ($real.Value -eq 25 -and $real.Staff -eq 5 -and $real.Seats -eq 30 -and $real.Channel -eq 'main' -and -not $real.Note)
$realDev = Get-MostOnline -Channel dev
Yes ("dev reads its own: 5 people, no staff seats, 5 seats, voice 5 (got {0}, {1}, {2}, {3})" -f $realDev.Value, $realDev.Staff, $realDev.Seats, $realDev.Voice) (
    $realDev.Value -eq 5 -and $realDev.Staff -eq 0 -and $realDev.Seats -eq 5 -and $realDev.Voice -eq 5 -and $realDev.Channel -eq 'dev' -and -not $realDev.Note)

# ---- 7. each channel its own numbers ----------------------------------------
$both = New-Record 'both' '{"dev":{"people":5,"staffSeats":0,"voice":5},"people":25,"staffSeats":5,"voice":60}' $false
$m = Get-MostOnline $both
$d = Get-MostOnline $both -Channel dev
Yes 'with a dev object, main still reads the record''s own numbers' ($m.Value -eq 25 -and $m.Seats -eq 30 -and $m.Voice -eq 60)
Yes 'and dev reads its dev object' ($d.Value -eq 5 -and $d.Staff -eq 0 -and $d.Seats -eq 5 -and $d.Voice -eq 5 -and $d.From -eq $both)
$noDev = New-Record 'nodev' '{"people":25,"staffSeats":5,"voice":60}' $false
$d = Get-MostOnline $noDev -Channel dev
Yes 'with no dev object, dev takes main''s numbers, as before 12 Oct' ($d.Value -eq 25 -and $d.Seats -eq 30 -and $d.Voice -eq 60)
Yes 'and says so' ([string]$d.Note -match 'no dev numbers')
foreach ($bad in @(
        @('dev a number',   '{"dev":5,"people":25}',                  'its dev is not an object'),
        @('dev a list',     '{"dev":[5],"people":25}',                'its dev is not an object'),
        @('dev no people',  '{"dev":{"voice":5},"people":25}',        'its dev has no people'),
        @('dev people 0',   '{"dev":{"people":0},"people":25}',       'its dev people is not a whole number above zero'))) {
    $d = Get-MostOnline (New-Record ('bad-' + ($bad[0] -replace ' ', '-')) $bad[1] $false) -Channel dev
    Yes ("{0}: dev gives no number, and says why ({1})" -f $bad[0], $d.Why) ($d.Value -eq 0 -and $d.Seats -eq 0 -and $d.Why -match [regex]::Escape($bad[2]))
}
$threw = $null
try { [void](Get-MostOnline (New-Record 'dev-voice-low' '{"dev":{"people":5,"staffSeats":0,"voice":4},"people":25,"staffSeats":5,"voice":60}' $false) -Channel dev) } catch { $threw = $_.Exception.Message }
Yes 'dev voice under dev''s seats is refused, naming the dev numbers' ($null -ne $threw -and $threw -match 'its dev numbers' -and $threw -match 'fewer than the 5 seats')
$threw = $null
try { $m = Get-MostOnline (New-Record 'dev-voice-low-main' '{"dev":{"people":5,"staffSeats":0,"voice":4},"people":25,"staffSeats":5,"voice":60}' $false) } catch { $threw = $_.Exception.Message }
Yes 'and main reads on, its own numbers held to its own seats' ($null -eq $threw -and $m.Voice -eq 60)
$threw = $null
try { [void](Get-MostOnline (New-Record 'main-voice-low' '{"dev":{"people":5,"voice":5},"people":25,"staffSeats":5,"voice":29}' $false) -Channel dev) } catch { $threw = $_.Exception.Message }
Yes 'main''s voice under main''s seats does not stop dev, which has its own' ($null -eq $threw)
$threw = $null
try { [void](Get-MostOnline (New-Record 'dev-over' '{"dev":{"people":995,"staffSeats":10},"people":25}' $false) -Channel dev) } catch { $threw = $_.Exception.Message }
Yes 'dev over the engine''s 1000 is refused too' ($null -ne $threw -and $threw.Contains('1000'))
$threw = $null
try { [void](Get-MostOnline $both -Channel live) } catch { $threw = $_.Exception.Message }
Yes 'a channel that is neither main nor dev is refused' ($null -ne $threw)

# ---- 2. Set-MaxPlayers on its own -------------------------------------------
$g35 = [pscustomobject]@{ Value = 25; Staff = 10; Seats = 35; From = 'x'; Why = '' }
$g0 = [pscustomobject]@{ Value = 0; Staff = 0; Seats = 0; From = 'x'; Why = 'none' }
$s = [pscustomobject]@{ port = 7777; maxPlayers = 100; keep = 'yes' }
Set-MaxPlayers $s $g35 6>$null
Yes 'Set-MaxPlayers writes the number for the gamemode' ($s.thornswoodMostOnline -eq 25)
Yes 'and the engine seats, the number plus the staff seats' ($s.maxPlayers -eq 35)
Yes 'and keeps every other key' ($s.port -eq 7777 -and $s.keep -eq 'yes')
$s = [pscustomobject]@{ port = 7777; maxPlayers = 100 }
Set-MaxPlayers $s $g0 6>$null
Yes 'with no number it leaves maxPlayers as it was and adds nothing' ($s.maxPlayers -eq 100 -and
    $s.PSObject.Properties.Name -notcontains 'thornswoodMostOnline')
$s = [pscustomobject]@{ port = 7777 }
Set-MaxPlayers $s $g35 6>$null
Yes 'it adds both keys when the file had neither' ($s.maxPlayers -eq 35 -and $s.thornswoodMostOnline -eq 25)

# ---- 3. the feed reads the same record --------------------------------------
$pu = Get-Content -LiteralPath (Join-Path $RepoDir 'scripts\release\Publish-Update.ps1') -Raw
Yes 'Publish-Update.ps1 dot-sources MaxOnline.ps1 for the feed''s number' ($pu.Contains(". (Join-Path `$PSScriptRoot '..\deploy\MaxOnline.ps1')"))
Yes 'and announces the channel''s seats as maxOnline, the M of "N of M awake"' ($pu.Contains('$mo = (Get-MostOnline -Channel $Channel).Seats') -and
    $pu.Contains("if (`$mo -gt 0) { Set-Prop `$doc 'maxOnline' `$mo }"))
Yes 'which is 30 on main and 5 on dev' ((Get-MostOnline -Channel main).Seats -eq 30 -and (Get-MostOnline -Channel dev).Seats -eq 5)
Yes 'and no longer reads MaxOnline out of the launcher''s config.json' (-not $pu.Contains('$cfg.MaxOnline'))

# ---- 4. Deploy-Gamemode.ps1 --------------------------------------------------
$dg = Get-Content -LiteralPath (Join-Path $RepoDir 'scripts\deploy\Deploy-Gamemode.ps1') -Raw
$read = $dg.IndexOf('Get-MostOnline')
$copy = $dg.IndexOf('Copy-Item -LiteralPath $Gamemode')
Yes 'Deploy-Gamemode.ps1 dot-sources MaxOnline.ps1' ($dg.Contains("Join-Path `$Here 'MaxOnline.ps1'"))
Yes 'it reads the number before it writes anything into the build' ($read -ge 0 -and $copy -gt $read)
Yes 'and has no launcher root to read it from any more' (-not $dg.Contains('LauncherRoot'))

$from = $dg.IndexOf('# ---- rewrite server-settings.json')
$to = -1
if ($from -ge 0) { $to = $dg.IndexOf('[IO.File]::WriteAllText($settingsPath', $from) }
if ($to -ge 0) { $to = $dg.IndexOf("`n", $to) }
Yes 'the settings section is in Deploy-Gamemode.ps1' ($from -ge 0 -and $to -gt $from)
if ($from -ge 0 -and $to -gt $from) {
    $section = $dg.Substring($from, $to - $from)

    function Invoke-Section([string]$dist, $maxOnline) {
        $Dist = $dist
        $paths = @('C:/Data/Skyrim.esm', 'C:/Data/Skyrim Unbound.esp')
        $ServerName = 'Thornswood'; $Port = 7777; $VoicePort = 7778; $Npcs = 'all'
        $HitsOnPeople = 1.0; $HitsOnNpcs = 2.0; $Devs = @(); $Playtesters = @()
        . ([scriptblock]::Create($section)) 6>$null
    }
    function Seed-Built([string]$dist) {
        New-Item -ItemType Directory -Force -Path $dist | Out-Null
        [IO.File]::WriteAllText((Join-Path $dist 'server-settings.json'),
            '{"port":7777,"name":"Thornswood","maxPlayers":100,"keepMe":"yes","loadOrder":[]}', $utf8)
    }

    $dist = Join-Path $tmp 'dist'
    Seed-Built $dist
    $ok = $true
    try { Invoke-Section $dist $g35 } catch { $ok = $false; Write-Host ("      " + $_.Exception.Message) }
    Yes 'the lifted settings section runs against a scratch build' $ok
    $w = Get-Content -LiteralPath (Join-Path $dist 'server-settings.json') -Raw | ConvertFrom-Json
    Yes 'the built settings carry thornswoodMostOnline 25' ([int]$w.thornswoodMostOnline -eq 25)
    Yes 'and maxPlayers 35, ten over it for staff' ([int]$w.maxPlayers -eq 35)
    Yes 'a key nobody sets there survives' ($w.keepMe -eq 'yes')
    Yes 'the file has no byte order mark' ([IO.File]::ReadAllBytes((Join-Path $dist 'server-settings.json'))[0] -ne 0xEF)

    Seed-Built $dist
    $ok = $true
    try { Invoke-Section $dist $g0 } catch { $ok = $false; Write-Host ("      " + $_.Exception.Message) }
    $w = Get-Content -LiteralPath (Join-Path $dist 'server-settings.json') -Raw | ConvertFrom-Json
    Yes 'with no number the build keeps its 100' ($ok -and [int]$w.maxPlayers -eq 100)
}

# ---- 5. Deploy-DevGamemode.ps1 ----------------------------------------------
$dd = Get-Content -LiteralPath (Join-Path $RepoDir 'scripts\deploy\Deploy-DevGamemode.ps1') -Raw
$read = $dd.IndexOf('Get-MostOnline')
$stop = $dd.IndexOf("Write-Host 'Stopping the dev server...'")
Yes 'Deploy-DevGamemode.ps1 dot-sources MaxOnline.ps1' ($dd.Contains("Join-Path `$Here 'MaxOnline.ps1'"))
Yes 'and reads the dev numbers, never main''s' ($dd.Contains('$got = Get-MostOnline -Channel dev') -and -not ($dd -match 'Get-MostOnline\s*\r?\n'))
Yes 'it reads the number before the dev server is stopped' ($read -ge 0 -and $stop -gt $read)
Yes 'and has no launcher root to read it from any more' (-not $dd.Contains('LauncherRoot'))

$marker = $dd.IndexOf('`$p = Join-Path ''$rootWin'' ''server-settings.json''')
$open = -1; $close = -1
if ($marker -ge 0) {
    $open = $dd.LastIndexOf('Remote @"', $marker)
    $close = $dd.IndexOf("`n" + '"@', $marker)
}
Yes 'the block that edits the dev settings is in Deploy-DevGamemode.ps1' ($open -ge 0 -and $close -gt $marker)
if ($open -ge 0 -and $close -gt $marker) {
    $bodyAt = $dd.IndexOf("`n", $open) + 1
    $body = ($dd.Substring($bodyAt, $close - $bodyAt) -replace "`r`n", "`n").TrimEnd("`r", "`n")

    # Expanded the way the real script expands it, as the here-string it is,
    # with the values the script would put in.
    function Expand-Remote([string]$rootWin, $maxOnline, $seats) {
        $orderWire = ''
        $remotePlugins = 'C:/Thornswood-Server-Dev/plugins'
        $fullIndexDef = $script:fullIndexDef
        $lightDef = ''
        $devRecordLight = $false
        $VoicePort = 7789
        return & ([scriptblock]::Create('@"' + "`n" + $body + "`n" + '"@'))
    }

    # The far end is PowerShell 7 since #5356, so that is what runs it.
    . (Join-Path $PSScriptRoot 'Windows.ps1')
    $psExe = Get-BoxPowerShell

    function Invoke-Remote([string]$rootWin, $maxOnline, $seats) {
        $text = Expand-Remote $rootWin $maxOnline $seats
        $file = Join-Path $tmp ('remote-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.ps1')
        [IO.File]::WriteAllText($file, $text, (New-Object Text.UTF8Encoding($true)))
        # Continue, so a line on stderr is output to read rather than a stop
        # under Windows PowerShell.
        $ErrorActionPreference = 'Continue'
        return @(& $psExe -NoProfile -ExecutionPolicy Bypass -File $file 2>&1 | ForEach-Object { [string]$_ })
    }
    function Seed-Dev([string]$root, [bool]$withMax) {
        New-Item -ItemType Directory -Force -Path $root | Out-Null
        $max = ''
        if ($withMax) { $max = '"maxPlayers":100,' }
        [IO.File]::WriteAllText((Join-Path $root 'server-settings.json'),
            ('{"port":7787,"name":"Thornswood Dev",' + $max + '"thornswoodVoicePort":7789,' +
             '"equipmentSlotCheckEnabled":false,"equipmentSpellCheckEnabled":false,' +
             '"equipmentInventoryCheckEnabled":false,"equipItemAttemptEnabled":true,"dataDir":"data",' +
             '"npcAllowCrimeFaction":true,"npcAllowEssential":true,"thornswoodServer":"dev",' +
             '"loadOrder":["C:/Thornswood-Server-Dev/plugins/Skyrim.esm"]}'), $utf8)
    }
    function Read-Dev([string]$root) { Get-Content -LiteralPath (Join-Path $root 'server-settings.json') -Raw | ConvertFrom-Json }

    $dev = Join-Path $tmp 'dev-root'
    Seed-Dev $dev $true
    $out = Invoke-Remote $dev 25 35
    $w = Read-Dev $dev
    Yes 'the dev block sets thornswoodMostOnline to 25' ([int]$w.thornswoodMostOnline -eq 25)
    Yes 'and maxPlayers to 35' ([int]$w.maxPlayers -eq 35)
    Yes 'and says what moved' (($out -join "`n").Contains('to 25, engine seats from 100 to 35'))
    Yes 'the dev port and name are untouched' ([int]$w.port -eq 7787 -and $w.name -eq 'Thornswood Dev')
    Yes 'the read back names both' (($out -join "`n").Contains('most online 25, engine seats 35'))
    Yes 'the dev file has no byte order mark' ([IO.File]::ReadAllBytes((Join-Path $dev 'server-settings.json'))[0] -ne 0xEF)
    if ([int]$w.maxPlayers -ne 35) { foreach ($l in $out) { Write-Host ("      " + $l) } }

    $out = Invoke-Remote $dev 25 35
    Yes 'a second run finds nothing to change' ((($out -join "`n").Contains('already')) -and [int](Read-Dev $dev).maxPlayers -eq 35)

    $out = Invoke-Remote $dev 30 40
    Yes 'a new number moves both' ([int](Read-Dev $dev).thornswoodMostOnline -eq 30 -and [int](Read-Dev $dev).maxPlayers -eq 40)

    $out = Invoke-Remote $dev $realDev.Value $realDev.Seats
    Yes 'dev''s own numbers: 5, and engine seats 5 with none over it' ([int](Read-Dev $dev).thornswoodMostOnline -eq 5 -and [int](Read-Dev $dev).maxPlayers -eq 5)
    Yes 'and says so' (($out -join "`n").Contains('to 5, engine seats from 40 to 5'))

    Seed-Dev $dev $true
    $out = Invoke-Remote $dev 0 0
    Yes 'with no number the dev server keeps its 100' ([int](Read-Dev $dev).maxPlayers -eq 100)
    Yes 'and an unknown number is not a reason to rewrite' (($out -join "`n").Contains('already'))

    Seed-Dev $dev $false
    $out = Invoke-Remote $dev 25 35
    Yes 'a dev file with no maxPlayers gets both' ([int](Read-Dev $dev).maxPlayers -eq 35 -and [int](Read-Dev $dev).thornswoodMostOnline -eq 25)

    # The other harnesses that lift this block give it no seat count at all.
    Seed-Dev $dev $true
    $out = Invoke-Remote $dev 0 $null
    Yes 'with no seat count given at all the block still parses and runs' ([int](Read-Dev $dev).maxPlayers -eq 100 -and
        (($out -join "`n").Contains('already')))
}

# ---- 6. Publish-Server.ps1 ----------------------------------------------------
$pubs = Get-Content -LiteralPath (Join-Path $RepoDir 'scripts\release\Publish-Server.ps1') -Raw
$capAt = $pubs.IndexOf('$mostOnline = Get-MostOnline -Channel $Channel')
$ifAt = -1
if ($capAt -ge 0) { $ifAt = $pubs.LastIndexOf('if ($settingsPath -and (Test-Path -LiteralPath $settingsPath)) {', $capAt) }
$capBlock = $null
if ($ifAt -ge 0) { $capBlock = Get-BlockText $pubs.Substring($ifAt) 'if ($settingsPath -and (Test-Path -LiteralPath $settingsPath)) {' }
Yes 'Publish-Server.ps1 writes the number into the settings it packs' ($null -ne $capBlock -and $capBlock.Contains('Set-MaxPlayers $capJson $mostOnline'))
$zipAt = $pubs.IndexOf('-File $export -Dist $Dist -Zip $Zip')
Yes 'before the zip is made' ($capAt -ge 0 -and $zipAt -gt $capAt)
if ($null -ne $capBlock) {
    $pdist = Join-Path $tmp 'pub-dist'
    New-Item -ItemType Directory -Force -Path $pdist | Out-Null
    $settingsPath = Join-Path $pdist 'server-settings.json'
    $Channel = 'main'
    [IO.File]::WriteAllText($settingsPath, '{"port":7777,"name":"Thornswood","maxPlayers":100,"keepMe":"yes"}', $utf8)
    $ok = $true
    # The block dot-sources MaxOnline.ps1 from beside itself; here that is $helper.
    $sb = [scriptblock]::Create($capBlock.Replace("(Join-Path `$PSScriptRoot '..\deploy\MaxOnline.ps1')", "'" + $helper + "'"))
    try { . $sb 6>$null } catch { $ok = $false; Write-Host ("      " + $_.Exception.Message) }
    $w = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    Yes 'the lifted Publish-Server block runs against a scratch build' $ok
    Yes 'and packs thornswoodMostOnline 25 and maxPlayers over it' ([int]$w.thornswoodMostOnline -eq 25 -and [int]$w.maxPlayers -eq $real.Seats)
    Yes 'keeping every other key' ($w.keepMe -eq 'yes' -and [int]$w.port -eq 7777)
    Yes 'with no byte order mark' ([IO.File]::ReadAllBytes($settingsPath)[0] -ne 0xEF)
    [IO.File]::WriteAllText($settingsPath, ('{ "port":7777, "thornswoodMostOnline":25, "maxPlayers":' + $real.Seats + ' }'), $utf8)
    $before = [IO.File]::ReadAllText($settingsPath)
    . $sb 6>$null
    Yes 'and leaves the file untouched when nothing moved' ([IO.File]::ReadAllText($settingsPath) -eq $before)

    # -Channel dev packs dev's numbers.
    $Channel = 'dev'
    [IO.File]::WriteAllText($settingsPath, '{"port":7787,"name":"Thornswood Dev","thornswoodMostOnline":25,"maxPlayers":30}', $utf8)
    $ok = $true
    try { . $sb 6>$null } catch { $ok = $false; Write-Host ("      " + $_.Exception.Message) }
    $w = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
    Yes 'Publish-Server -Channel dev packs dev''s 5, engine seats 5' ($ok -and [int]$w.thornswoodMostOnline -eq 5 -and [int]$w.maxPlayers -eq 5 -and [int]$w.port -eq 7787)
}

Done
