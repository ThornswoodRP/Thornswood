<#
  test-publish-server-channel.ps1

  A dev Publish-Server packs the dev ports without leaving them in the local
  build, and a live one packs 7777 or nothing (#1114).

  WHY THIS EXISTS. A dev publish (-Channel dev) rewrote the build's own
  server-settings.json in place, to port 7787, voice 7789 and the name
  Thornswood Dev, with Set-Content -Encoding UTF8 (a byte order mark under
  Windows PowerShell), and never put it back. The next live publish without
  Deploy-Gamemode.ps1 in between packed those for the live server, and the run
  said only that the server did not come up.

  HOW. The real Publish-Server.ps1 and Export-ServerPayload.ps1 run in a child
  PowerShell against a scratch build, with ssh and scp stand-ins first on PATH
  (they write down what they were asked and say INSTALL OK, that the store
  holds the gamemode artifact, and SERVER RECORDED), and a listener on
  this machine standing in for the resources port the run probes afterwards,
  on a port from the system that it holds for the whole run (#1728):

    1. a dev publish: the zip starts the server on 7787, voice 7789, named
       Thornswood Dev, with no byte order mark, and the build's own settings
       are byte for byte what they were
    2. a live publish straight after: the zip starts it on 7777
    3. a build left on the dev ports by an older dev publish: the live publish
       refuses before anything is sent
    4. -SkipBuild with a dev zip on the live channel: refused, nothing sent
    5. Export-ServerPayload.ps1 by itself, the same way round
    6. a binary that is not the build the record names (#1214): refused
       before anything is sent, by a publish on either channel, by -SkipBuild
       with a zip made from it, and by Export-ServerPayload by itself; a good
       zip carries the record, for the installer to hold it again
    6b. every other server file the same way (#1214): a JavaScript half from
       another build beside the recorded binary, a -SkipBuild zip carrying
       one, a server file the record does not list, and a record that lists
       only the binary are each refused before anything is sent; a good zip
       carries every recorded file and nothing the build folder holds that
       is not part of a release
    7. a build whose npcSettings has a "default" key, which refuses every NPC
       (#1222): refused on either channel before anything is sent; a dev zip
       says thornswoodServer dev, and a live export of one that says dev is
       refused; ServerSettings.ps1 goes up beside the installer
    8. the gamemode and its stamp (#459): the payload carries the gamemode
       artifact's gamemode.js and a stamp made for the channel, the build's
       own folder gets no stamp, the artifact's record goes to the box's
       store once the install answers, and a -SkipBuild zip whose gamemode is
       not the artifact's is refused before anything is sent

  Run under whichever PowerShell runs this file, so running it under both
  checks both. Nothing here connects to the VPS.
#>
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$publish = Join-Path $repo 'scripts\release\Publish-Server.ps1'
$export = Join-Path $repo 'scripts\release\Export-ServerPayload.ps1'
Yes 'Publish-Server.ps1 and Export-ServerPayload.ps1 are there' ((Test-Path -LiteralPath $publish) -and (Test-Path -LiteralPath $export))
# The ports a person shipping gets, who passes neither -GamePort nor
# -ResourcesPort (#1728). The game port is also held below by the refusals of
# a zip packed for the other channel; the resources port is read here, because
# this run hands its own to every publish.
$pubSrc = [IO.File]::ReadAllText($publish)
Yes 'by default a payload is held to the channel''s game port, 7787 dev and 7777 live' (
    $pubSrc.Contains('$wantPort = if ($GamePort -gt 0) { $GamePort } elseif ($IsDev) { 7787 } else { 7777 }'))
Yes '  and the check after the install knocks on 3000 for 7777 and the game port plus one otherwise' (
    $pubSrc.Contains('$ResPort  = if ($ResourcesPort -gt 0) { $ResourcesPort } elseif ($GamePort -eq 7777) { 3000 } else { $GamePort + 1 }') -and
    $pubSrc.Contains('$GamePort = $wantPort'))

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-pubserver-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$dist = Join-Path $T 'dist'
$bin = Join-Path $T 'bin'
$zip = Join-Path $T 'out\thornswood-server.zip'
$log = Join-Path $T 'calls.log'
$utf8 = New-Object Text.UTF8Encoding($false)
$shell = (Get-Process -Id $PID).Path
$oldPath = $env:PATH; $oldCalls = $env:TS_PUB_CALLS
$listeners = @()

$record = Join-Path $T 'server-build.json'
function Write-Live {
    param([int]$Port = 7777, [string]$Name = 'Thornswood', [int]$Voice = 7778, [string]$Server = '', [switch]$NpcDefault)
    $esp = (Join-Path $T 'plugins\ours.esp').Replace('\', '/')
    $s = [ordered]@{
        name = $Name; port = $Port; thornswoodVoicePort = $Voice; maxPlayers = 100
        loadOrder = @($esp); startPoints = @(@{ worldOrCell = '0x3C'; pos = @(0, 0, 0); angleZ = 0 })
    }
    if ($Server) { $s.thornswoodServer = $Server }
    if ($NpcDefault) { $s.npcSettings = @{ default = @{ spawnInInterior = $true; spawnInExterior = $true } } }
    [IO.File]::WriteAllText((Join-Path $dist 'server-settings.json'), ($s | ConvertTo-Json -Depth 6), $utf8)
}
function Hash([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash }
# The binary in the build, the other server files the fork builds beside it
# (ServerBuild.ps1), and a record of the build as it is now.
function Write-Binary([string]$text) { [IO.File]::WriteAllText((Join-Path $dist 'scam_native.node'), $text, $utf8) }
function Write-ServerFile([string]$rel, [string]$text) {
    $p = Join-Path $dist ($rel -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
    [IO.File]::WriteAllText($p, $text, $utf8)
}
$serverRels = @('dist_back/skymp5-server.js', 'dist_back/skymp5-server.js.map', 'package.json', 'yarn.lock', 'launch_server.bat', 'data/scripts/ActiveMagicEffect.pex')
$forkCommit = 'abcdef0123456789abcdef0123456789abcdef01'
function Write-Record([string]$path = $record, [switch]$BinaryOnly) {
    $files = [ordered]@{}
    foreach ($rel in @('scam_native.node') + $serverRels) {
        $p = Join-Path $dist ($rel -replace '/', '\')
        $files[$rel] = [ordered]@{ sha256 = (Hash $p).ToLowerInvariant(); bytes = (Get-Item -LiteralPath $p).Length; commit = $forkCommit }
    }
    $rec = [ordered]@{ binary = 'scam_native.node'; sha256 = $files['scam_native.node'].sha256; bytes = $files['scam_native.node'].bytes; source = [ordered]@{ commit = $forkCommit } }
    if (-not $BinaryOnly) { $rec.files = $files }
    [IO.File]::WriteAllText($path, ($rec | ConvertTo-Json -Depth 5), $utf8)
    return $rec.sha256
}
# The entries in a zip, by their path with forward slashes.
function Zip-Entries([string]$path) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($path)
    try { return @($z.Entries | Where-Object { $_.Name } | ForEach-Object { $_.FullName.Replace('\', '/') }) } finally { $z.Dispose() }
}
# What the zip starts the server with, and whether its settings start with a BOM.
function Read-Zip([string]$path) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        $e = $z.GetEntry('server-settings.json')
        $ms = New-Object IO.MemoryStream
        $st = $e.Open(); try { $st.CopyTo($ms) } finally { $st.Dispose() }
        $b = $ms.ToArray()
        $bom = ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB -and $b[2] -eq 0xBF)
        $j = ($utf8.GetString($b) -replace '^\uFEFF', '') | ConvertFrom-Json
        $rec = ''
        $re = $z.GetEntry('server-build.json')
        if ($re) {
            $rr = New-Object IO.StreamReader($re.Open())
            try { $rec = [string]($rr.ReadToEnd() | ConvertFrom-Json).sha256 } finally { $rr.Dispose() }
        }
        $server = ''
        if ($j.PSObject.Properties['thornswoodServer']) { $server = [string]$j.thornswoodServer }
        return [pscustomobject]@{ Port = [string]$j.port; Voice = [string]$j.thornswoodVoicePort; Name = [string]$j.name; Bom = $bom; Rec = $rec; Server = $server }
    } finally { $z.Dispose() }
}
# The zip's gamemode.js hash and its stamp (#459).
function Read-Stamp([string]$path) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($path)
    try {
        $gm = ''; $stamp = $null
        foreach ($e in $z.Entries) {
            $n = $e.FullName.Replace('\', '/')
            if ($n -eq 'gamemode.js') {
                $st = $e.Open(); $h = [Security.Cryptography.SHA256]::Create()
                try { $gm = (-join ($h.ComputeHash($st) | ForEach-Object { $_.ToString('x2') })) } finally { $st.Dispose(); $h.Dispose() }
            } elseif ($n -eq 'thornswood-build.json') {
                $rr = New-Object IO.StreamReader($e.Open())
                try { $stamp = ($rr.ReadToEnd() -replace '^\uFEFF', '') | ConvertFrom-Json } finally { $rr.Dispose() }
            }
        }
        return [pscustomobject]@{ Gm = $gm; Stamp = $stamp }
    } finally { $z.Dispose() }
}
function Run([string]$script, [string[]]$more) {
    if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try {
        $out = (& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $script @more 2>&1 | Out-String)
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = $old }
    $calls = @(if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log | Where-Object { $_ } })
    # PowerShell 7 prints an error wrapped to the window, each piece on a line
    # of its own after a '|', so a message can break in the middle of the
    # words matched below. Joined back up.
    $out = $out -replace '\r?\n\s+\|\s+', ' '
    return [pscustomobject]@{ Code = $code; Out = $out; Calls = $calls }
}
function Publish([string[]]$more) {
    return Run $publish (@('-Dist', $dist, '-Zip', $zip, '-Record', $record, '-VpsHost', '127.0.0.1', '-VpsUser', 'test', '-NoPause', '-NoNews', '-NoPush', '-Wait', '1',
                           '-ResourcesPort', [string]$script:resPort) + @($more))
}
function Tail($r, [bool]$ok) { if (-not $ok) { Write-Host (($r.Out -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -Last 12) -join "`n") -ForegroundColor DarkGray } }
function Sent($r) { return @($r.Calls | Where-Object { $_ -match '^scp .*thornswood-server\.zip' }).Count }

try {
    foreach ($d in $dist, $bin, (Join-Path $T 'plugins'), (Split-Path -Parent $zip)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
    [IO.File]::WriteAllText((Join-Path $T 'plugins\ours.esp'), 'a plugin', $utf8)
    foreach ($rel in $serverRels) { Write-ServerFile $rel ('the recorded ' + $rel) }
    # What a build folder holds that is not part of a release (#1214).
    Write-ServerFile 'gamemode.js.progression-20260921' '// a gamemode backup'
    Write-ServerFile 'data/manifest.json' '{ "written": "by the server, while it ran here" }'
    Write-Binary 'the recorded binary'
    $recSum = Write-Record
    # The gamemode artifact a publish from this checkout builds (#459), with
    # its tables (#5191): the stand-in box says its store holds it, and what
    # it records.
    $art = & { Set-StrictMode -Off; . (Join-Path $repo 'scripts\deploy\Artifact.ps1'); New-ThornswoodArtifact -Component gamemode -RepoDir $repo -Paths 'game/gamemode.js', 'game/gamemode-tables' }
    $artGm = (Get-FileHash -LiteralPath (Join-Path $art.Folder 'game\gamemode.js') -Algorithm SHA256).Hash.ToLowerInvariant()
    $env:TS_PUB_HAS = $art.Sha256
    # PowerShell scripts rather than .cmd files: a .cmd runs through cmd.exe,
    # which splits an unquoted argument at an ampersand, and a temp folder can
    # have one in its path. The real ssh and scp are programs and take it whole.
    # Each answers as the box does when all is well: the installer's last line,
    # and the dev door script's (#1336, which a dev publish now stops without).
    # The server build artifact (#459, ServerArtifact.ps1) is a different
    # build in several runs below, so its store is a stand-in folder: scp puts
    # the artifact there, and the box answers for it with the hash of what
    # arrived, the way Send-ThornswoodArtifact asks after a send.
    $fake = @'
$in = @($input | ForEach-Object { [string]$_ })
[IO.File]::AppendAllText($env:TS_PUB_CALLS, ('NAME ' + ($args -join ' ') + [Environment]::NewLine))
$all = $args -join ' '
$text = $all
if ($all -match '-EncodedCommand (\S+)') { $text = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($Matches[1])) }
# A script over the command line's limit goes by scp to a copy of its own,
# which a short runner on the command line takes off the box and runs
# (Send-Script.ps1, #3059), so the stand-in keeps the copy and reads it there.
if ($text -match "^\`$ThornswoodRunFile = 'C:\\Windows\\Temp\\(thornswood-remote-[0-9a-f]{32}\.ps1)'") {
    $copy = Join-Path $env:TS_PUB_STORE $Matches[1]
    $text = [IO.File]::ReadAllText($copy)
    Remove-Item -LiteralPath $copy -Force
}
if ('NAME' -eq 'scp' -and $args.Count -ge 2 -and [string]$args[-1] -match '(?:Thornswood-Deploys/server/|C:/Windows/Temp/)((server-|thornswood-remote-).+)$') {
    Copy-Item -LiteralPath ([string]$args[-2]) -Destination (Join-Path $env:TS_PUB_STORE $Matches[1]) -Force
}
'INSTALL OK'
'DOOR CARRIED'
if ($text -match 'Thornswood-Deploys\\server\\(server-[^'']+\.zip)') {
    $f = Join-Path $env:TS_PUB_STORE $Matches[1]
    if (Test-Path -LiteralPath $f) { 'HAS ' + (Get-FileHash -LiteralPath $f -Algorithm SHA256).Hash.ToLowerInvariant() } else { 'HAS none' }
} else { 'HAS ' + $env:TS_PUB_HAS }
'SERVER RECORDED stand-in'
exit 0
'@
    foreach ($n in 'ssh', 'scp') {
        [IO.File]::WriteAllText((Join-Path $bin ($n + '.ps1')), $fake.Replace('NAME', $n))
    }
    $env:PATH = $bin + [IO.Path]::PathSeparator + $oldPath
    $env:TS_PUB_CALLS = $log
    $env:TS_PUB_STORE = Join-Path $T 'store-server'
    New-Item -ItemType Directory -Force -Path $env:TS_PUB_STORE | Out-Null
    # The resources port the run probes afterwards: one from the system, held
    # by this listener for the whole run and handed to every publish as
    # -ResourcesPort, so what answers is this listener and nothing else. Until
    # #1728 this bound dev's and live's own, 7788 and 3000, inside a catch that
    # carried on when either was held, which on the VPS the dev and live
    # servers do. The operating system answers a connect for a started
    # listener by itself.
    $res = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, 0)
    $res.Start()
    $listeners += $res
    $resPort = $res.LocalEndpoint.Port
    Yes ("a listener holds port {0} from the system for the resources check" -f $resPort) ($resPort -gt 0)

    # ---- 1. a dev publish ---------------------------------------------------------
    Write-Host ''; Write-Host 'a dev publish'
    Write-Live
    $settings = Join-Path $dist 'server-settings.json'
    $r = Publish @('-Channel', 'dev')
    $ok = $r.Code -eq 0 -and (Sent $r) -eq 1
    Yes ("a dev publish runs through and sends its zip (exit {0})" -f $r.Code) $ok; Tail $r $ok
    Yes ("  and the check after the install was answered on the port this run holds, {0}" -f $resPort) (
        $r.Out -match ('is up at 127\.0\.0\.1:7787, resources on ' + $resPort + '\b'))
    $z = Read-Zip $zip
    Yes ("  the zip starts the dev server: port {0}, voice {1}, name {2}" -f $z.Port, $z.Voice, $z.Name) ($z.Port -eq '7787' -and $z.Voice -eq '7789' -and $z.Name -eq 'Thornswood Dev')
    Yes '  its settings have no byte order mark' (-not $z.Bom)
    Yes ("  it says thornswoodServer {0}, for a first install into an empty dev root" -f $z.Server) ($z.Server -eq 'dev')
    Yes '  and it carries the build record, for the installer to hold the binary to (#1214)' ($z.Rec -eq $recSum)
    $ents = Zip-Entries $zip
    Yes '  and every recorded server file, the JavaScript half with the binary (#1214)' (@(@('scam_native.node') + $serverRels | Where-Object { $ents -notcontains $_ }).Count -eq 0)
    Yes '  and not what the build folder holds that is no part of a release' ($ents -notcontains 'gamemode.js.progression-20260921' -and $ents -notcontains 'data/manifest.json')
    Yes '  and ServerBuild.ps1 went up beside the installer, which holds them again with it' (@($r.Calls | Where-Object { $_ -match '^scp .*ServerBuild\.ps1 .*C:/ServerBuild\.ps1' }).Count -eq 1)
    Yes '  and ServerSettings.ps1 went up beside the installer (#1222)' (@($r.Calls | Where-Object { $_ -match '^scp .*ServerSettings\.ps1 .*C:/ServerSettings\.ps1' }).Count -eq 1)
    Yes '  and ServerReadyWait.ps1 went up beside the installer (#1938)' (@($r.Calls | Where-Object { $_ -match '^scp .*ServerReadyWait\.ps1 .*C:/ServerReadyWait\.ps1' }).Count -eq 1)
    $local = Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
    Yes ("  and the build's own settings are the live ones still (port {0}, name {1})" -f $local.port, $local.name) ([int]$local.port -eq 7777 -and $local.name -eq 'Thornswood' -and [int]$local.thornswoodVoicePort -eq 7778)
    # The gamemode and the number of seats are the build's, written the same on
    # any channel; the ports and the name are all that must not have moved.
    $ports = @('port', 'name', 'thornswoodVoicePort' | ForEach-Object { [string]$local.$_ })
    Yes '  byte for byte where a channel is concerned' (($ports -join '|') -eq '7777|Thornswood|7778')
    $b = [IO.File]::ReadAllBytes($settings)
    Yes '  and no byte order mark was written into it' (-not ($b.Length -ge 3 -and $b[0] -eq 0xEF -and $b[1] -eq 0xBB))
    $st = Read-Stamp $zip
    Yes '  and the zip carries the artifact''s gamemode.js, with a stamp naming it for dev (#459)' (
        $st.Gm -eq $artGm -and $null -ne $st.Stamp -and [string]$st.Stamp.gamemodeSha256 -eq $artGm -and [string]$st.Stamp.channel -eq 'dev')
    Yes '  and the build''s own folder was given no stamp' (-not (Test-Path -LiteralPath (Join-Path $dist 'thornswood-build.json')))
    Yes '  and once the install answered, the artifact''s record went to the box''s store' (
        @($r.Calls | Where-Object { $_ -match ('^scp .*C:/Thornswood-Deploys/gamemode/' + [regex]::Escape($art.Name.Replace('.zip', '.json'))) }).Count -eq 1)
    # The server build it installed, by name, read out of the zip it sent (#459).
    $srvSent = @(Get-ChildItem -LiteralPath $env:TS_PUB_STORE -Filter 'server-*.zip' -File)
    $srvNew = & { Set-StrictMode -Off; . (Join-Path $repo 'scripts\deploy\ServerArtifact.ps1'); New-ThornswoodServerBuildArtifact -From $zip -Record $record -OutDir (Join-Path $T 'server-check') }
    Yes '  and the server build it installed went to the store, the bytes the payload holds' (
        $srvSent.Count -eq 1 -and $srvSent[0].Name -eq $srvNew.Name -and
        (Get-FileHash -LiteralPath $srvSent[0].FullName -Algorithm SHA256).Hash.ToLowerInvariant() -eq $srvNew.Sha256)

    # ---- 2. the live publish straight after -----------------------------------------
    Write-Host ''; Write-Host 'a live publish after it'
    $r = Publish @('-Channel', 'main')
    $ok = $r.Code -eq 0 -and (Sent $r) -eq 1
    Yes ("a live publish after the dev one runs through (exit {0})" -f $r.Code) $ok; Tail $r $ok
    Yes ("  and its check was answered on the same held port, {0}, not 3000" -f $resPort) (
        $r.Out -match ('is up at 127\.0\.0\.1:7777, resources on ' + $resPort + '\b'))
    $z = Read-Zip $zip
    Yes ("  and packs port {0}, voice {1}, name {2}" -f $z.Port, $z.Voice, $z.Name) ($z.Port -eq '7777' -and $z.Voice -eq '7778' -and $z.Name -eq 'Thornswood')

    # ---- 3. a build an older dev publish left on the dev ports ------------------------
    Write-Host ''; Write-Host 'a build left on the dev ports'
    $devZip = Join-Path $T 'dev.zip'
    [void](Publish @('-Channel', 'dev')); Copy-Item -LiteralPath $zip -Destination $devZip -Force
    Write-Live -Port 7787 -Name 'Thornswood Dev' -Voice 7789
    $r = Publish @('-Channel', 'main')
    $ok = $r.Code -ne 0 -and (Sent $r) -eq 0 -and $r.Out -match 'not the live server''s' -and $r.Out -match 'port 7787'
    Yes ("a live publish refuses them, and sends nothing (exit {0})" -f $r.Code) $ok; Tail $r $ok
    Yes '  and says what to run' ($r.Out -match 'Deploy-Gamemode\.ps1')

    # ---- 4. -SkipBuild with the other channel's zip ------------------------------------
    Write-Host ''; Write-Host '-SkipBuild'
    Write-Live
    Copy-Item -LiteralPath $devZip -Destination $zip -Force
    $r = Publish @('-Channel', 'main', '-SkipBuild')
    $ok = $r.Code -ne 0 -and (Sent $r) -eq 0 -and $r.Out -match 'port 7787, and the main server is 7777'
    Yes ("a live publish of a dev zip is refused before it is sent (exit {0})" -f $r.Code) $ok; Tail $r $ok
    $r = Publish @('-Channel', 'dev', '-SkipBuild')
    $ok = $r.Code -eq 0 -and (Sent $r) -eq 1
    Yes ("  and the same zip goes to dev (exit {0})" -f $r.Code) $ok; Tail $r $ok

    # ---- 5. Export-ServerPayload.ps1 by itself -------------------------------------------
    Write-Host ''; Write-Host 'Export-ServerPayload.ps1'
    $ex = @('-Dist', $dist, '-Zip', $zip, '-OutDir', (Join-Path $T 'out\_payload'), '-Record', $record)
    $x = Run $export ($ex + @('-Channel', 'dev'))
    $z = Read-Zip $zip
    Yes ("-Channel dev packs 7787 into the payload only (exit {0})" -f $x.Code) ($x.Code -eq 0 -and $z.Port -eq '7787' -and [int](Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json).port -eq 7777)
    $x = Run $export $ex
    $z = Read-Zip $zip
    Yes ("no channel is live, and packs 7777 (exit {0})" -f $x.Code) ($x.Code -eq 0 -and $z.Port -eq '7777')
    Yes '  with the build record in it' ($z.Rec -eq $recSum)
    Write-Live -Port 7777 -Name 'Thornswood' -Voice 7789
    $x = Run $export $ex
    Yes ("a live export of the dev voice port is refused (exit {0})" -f $x.Code) ($x.Code -ne 0 -and $x.Out -match 'dev voice port 7789')
    Write-Live -Server 'dev'
    $x = Run $export $ex
    Yes ("a live export of settings that say thornswoodServer dev is refused (exit {0})" -f $x.Code) ($x.Code -ne 0 -and $x.Out -match 'thornswoodServer dev')

    # ---- 6. a binary that is not the recorded build (#1214) ---------------------------
    Write-Host ''; Write-Host 'a binary that is not the recorded build'
    Write-Live
    Write-Binary 'some other binary'
    foreach ($ch in 'dev', 'main') {
        $r = Publish @('-Channel', $ch)
        $ok = $r.Code -ne 0 -and (Sent $r) -eq 0 -and @($r.Calls | Where-Object { $_ -match '^(ssh|scp) ' }).Count -eq 0 -and $r.Out -match 'not the build'
        Yes ("a $ch publish of it is refused before anything is sent (exit {0})" -f $r.Code) $ok; Tail $r $ok
    }
    $x = Run $export $ex
    Yes ("Export-ServerPayload by itself refuses it too (exit {0})" -f $x.Code) ($x.Code -ne 0 -and $x.Out -match 'not the build' -and $x.Out -match 'Nothing was packed')
    # A zip made from it against a record that names it, sent with -SkipBuild
    # against the real record: refused from what is in the zip.
    $other = Join-Path $T 'other-record.json'
    [void](Write-Record $other)
    $x = Run $export @('-Dist', $dist, '-Zip', $zip, '-OutDir', (Join-Path $T 'out\_payload'), '-Record', $other, '-Channel', 'dev')
    Yes ("  (a zip made from it, against a record naming it, exit {0})" -f $x.Code) ($x.Code -eq 0)
    $r = Publish @('-Channel', 'dev', '-SkipBuild')
    $ok = $r.Code -ne 0 -and (Sent $r) -eq 0 -and $r.Out -match 'not the recorded build'
    Yes ("-SkipBuild with that zip is refused before it is sent (exit {0})" -f $r.Code) $ok; Tail $r $ok
    Write-Binary 'the recorded binary'
    $r = Publish @('-Channel', 'dev')
    $ok = $r.Code -eq 0 -and (Sent $r) -eq 1 -and $r.Out -match 'payload server files are the recorded build'
    Yes ("  and the recorded binary goes again (exit {0})" -f $r.Code) $ok; Tail $r $ok

    # ---- 6b. every other server file (#1214) ----------------------------------------
    Write-Host ''; Write-Host 'a JavaScript half that is not the recorded build'
    # The shape of 29 September: the recorded binary, and a JavaScript half
    # from another build beside it.
    Write-ServerFile 'dist_back/skymp5-server.js' '// a JavaScript half from 24 Sep'
    foreach ($ch in 'dev', 'main') {
        $r = Publish @('-Channel', $ch)
        $ok = $r.Code -ne 0 -and @($r.Calls | Where-Object { $_ -match '^(ssh|scp) ' }).Count -eq 0 -and $r.Out -match 'dist_back/skymp5-server\.js in .* is not the build'
        Yes ("a $ch publish of it is refused before anything is sent, naming the file (exit {0})" -f $r.Code) $ok; Tail $r $ok
    }
    $x = Run $export $ex
    Yes ("Export-ServerPayload by itself refuses it too (exit {0})" -f $x.Code) ($x.Code -ne 0 -and $x.Out -match 'skymp5-server\.js in .* is not the build' -and $x.Out -match 'Nothing was packed')
    # A zip made from it against a record naming it, sent with -SkipBuild
    # against the real record: refused from what is in the zip.
    [void](Write-Record $other)
    $x = Run $export @('-Dist', $dist, '-Zip', $zip, '-OutDir', (Join-Path $T 'out\_payload'), '-Record', $other, '-Channel', 'dev')
    Yes ("  (a zip made from it, against a record naming it, exit {0})" -f $x.Code) ($x.Code -eq 0)
    $r = Publish @('-Channel', 'dev', '-SkipBuild')
    $ok = $r.Code -ne 0 -and (Sent $r) -eq 0 -and $r.Out -match 'skymp5-server\.js in the payload is not the build' -and $r.Out -match 'not the recorded build'
    Yes ("-SkipBuild with that zip is refused before it is sent (exit {0})" -f $r.Code) $ok; Tail $r $ok
    Write-ServerFile 'dist_back/skymp5-server.js' 'the recorded dist_back/skymp5-server.js'

    Write-Host ''; Write-Host 'a server file the record does not list'
    Write-ServerFile 'dist_back/old-bundle.js' '// left by another build'
    $r = Publish @('-Channel', 'dev')
    $ok = $r.Code -ne 0 -and @($r.Calls | Where-Object { $_ -match '^(ssh|scp) ' }).Count -eq 0 -and $r.Out -match 'old-bundle\.js in .* does not list'
    Yes ("a publish with one is refused before anything is sent (exit {0})" -f $r.Code) $ok; Tail $r $ok
    Remove-Item -LiteralPath (Join-Path $dist 'dist_back\old-bundle.js') -Force

    Write-Host ''; Write-Host 'a record of the binary alone'
    $saved = [IO.File]::ReadAllText($record)
    [void](Write-Record $record -BinaryOnly)
    $r = Publish @('-Channel', 'dev')
    $ok = $r.Code -ne 0 -and @($r.Calls | Where-Object { $_ -match '^(ssh|scp) ' }).Count -eq 0 -and $r.Out -match 'lists no server files|files is missing, empty'
    Yes ("a publish held to a record that lists only the binary is refused (exit {0})" -f $r.Code) $ok; Tail $r $ok
    [IO.File]::WriteAllText($record, $saved, $utf8)
    $r = Publish @('-Channel', 'dev')
    $ok = $r.Code -eq 0 -and (Sent $r) -eq 1
    Yes ("  and the recorded build goes again (exit {0})" -f $r.Code) $ok; Tail $r $ok

    # ---- 7. an npcSettings "default" key (#1222) -----------------------------------------
    Write-Host ''; Write-Host 'an npcSettings default key'
    Write-Live -NpcDefault
    foreach ($ch in 'dev', 'main') {
        $r = Publish @('-Channel', $ch)
        $ok = $r.Code -ne 0 -and (Sent $r) -eq 0 -and $r.Out -match 'refuses every NPC'
        Yes ("a $ch publish of a build whose npcSettings has a default key is refused, nothing sent (exit {0})" -f $r.Code) $ok; Tail $r $ok
    }
    Write-Live

    # ---- 8. a gamemode that is not the artifact's (#459) ----------------------------------
    Write-Host ''; Write-Host 'a -SkipBuild zip whose gamemode is not the artifact''s'
    [IO.File]::WriteAllText((Join-Path $dist 'gamemode.js'), '// a gamemode from an older commit', $utf8)
    $x = Run $export @('-Dist', $dist, '-Zip', $zip, '-OutDir', (Join-Path $T 'out\_payload'), '-Record', $record, '-Channel', 'dev')
    $r = Publish @('-Channel', 'dev', '-SkipBuild')
    $ok = $x.Code -eq 0 -and $r.Code -ne 0 -and (Sent $r) -eq 0 -and $r.Out -match 'gamemode\.js is not game\\gamemode\.js at'
    Yes ("is refused before it is sent, since the box would say it runs another gamemode (exit {0})" -f $r.Code) $ok; Tail $r $ok
    $r = Publish @('-Channel', 'dev')
    $ok = $r.Code -eq 0 -and (Sent $r) -eq 1 -and (Read-Stamp $zip).Gm -eq $artGm
    Yes ("  and a publish that builds puts the artifact's gamemode back in and goes (exit {0})" -f $r.Code) $ok; Tail $r $ok
    $r = Publish @('-Channel', 'main', '-SkipBuild')
    $ok = $r.Code -ne 0 -and (Sent $r) -eq 0
    Yes ("  and that dev zip, its stamp for dev, does not go to live (exit {0})" -f $r.Code) $ok; Tail $r $ok
}
finally {
    foreach ($l in $listeners) { try { $l.Stop() } catch { } }
    $env:PATH = $oldPath; $env:TS_PUB_CALLS = $oldCalls; Remove-Item Env:\TS_PUB_HAS, Env:\TS_PUB_STORE -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
