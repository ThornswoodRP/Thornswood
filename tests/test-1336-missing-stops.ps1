<#
  test-1336-missing-stops.ps1

      pwsh -NoProfile -File .\tests\test-1336-missing-stops.ps1

  #1336. What the server publish chain expects and does not find stops it,
  or is said, never skipped without a word.

  1. ServerSettings.ps1. A release key the release does not carry at all
     (the voice port, the NPC switch) is left as the running server has it,
     and the lines a deploy prints now name it. Before, they named only the
     keys that moved, so a deploy whose build had no join pass switch read
     the same as one that set it. The carry Deploy-Server sends to the box
     says the same. Since #1223 the join pass and the role lists are no
     release's at all: they are carried as the server has them and not
     called absent.
  2. The dev door's keys (Publish-Server.ps1's roster script, lifted out and
     run the way the box runs it). The live key and join pass key reach dev
     with DOOR CARRIED. A live root with no private folder, no door.json, one
     that does not read, or one without the address, the key or the join pass
     key leaves the dev door exactly as it was and ends DOOR NOT CARRIED, and
     Publish-Server stops on that with exit 1. No key is printed either way.
  3. Export-ServerPayload.ps1, run on a scratch build. A build with no
     gamemode.js is refused before anything is packed (the server would
     otherwise start with no gamemode: skymp5-server logs the missing file
     and runs on). So is a build with no gamemode tables (#5191), which
     the gamemode cannot load without. A load order naming a plugin this machine does not have
     is refused, where it used to be left out and the shorter order shipped.
     A build with both packs, with the whole order. A build with no stamp
     packs and says it has none.
  4. Install-ThornswoodServer.ps1 refuses a stage with no gamemode.js or no
     gamemode tables (#5191), and a put-back with a settings file missing
     says so. Read from the source:
     the installer runs only on Windows, under test-install-server.ps1.

  Nothing leaves this machine. Scratch files go under the temp folder.
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
$utf8 = New-Object Text.UTF8Encoding($false)
$shell = (Get-Process -Id $PID).Path
function Put([string]$file, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $text, $utf8)
}
function Text([string]$file) { if (Test-Path -LiteralPath $file) { return [IO.File]::ReadAllText($file) } return $null }

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-1336-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null
try {
    # ---- 1. ServerSettings.ps1 -------------------------------------------------
    Write-Host 'ServerSettings.ps1'
    . (Join-Path $repo 'scripts\deploy\ServerSettings.ps1')
    $running = [pscustomobject][ordered]@{ port = 7777; loadOrder = @('a.esm'); thornswoodVoicePort = 7778; npcEnabled = $true
                                           thornswoodRequirePass = $true; thornswoodDevs = @(1) }
    $release = [pscustomobject][ordered]@{ port = 7787; loadOrder = @('a.esm', 'b.esp') }
    $m = Join-ThornswoodServerSettings $running $release $ThornswoodGamemodeKeys
    # Read without strict mode tripping, so a copy from before #1336 fails here rather than stops.
    $absent = @(if ($m.PSObject.Properties['Absent']) { $m.Absent })
    Yes 'a release key the release does not carry is left as the running server has it' (
        $m.Settings.thornswoodVoicePort -eq 7778 -and $m.Settings.npcEnabled -eq $true)
    Yes '  and is named as not in the release' ($absent -contains 'thornswoodVoicePort' -and $absent -contains 'npcEnabled')
    $line = @($m.Said | Where-Object { $_ -like 'not in the release*' })
    Yes '  in a line the deploy prints' ($line.Count -eq 1 -and $line[0] -match 'thornswoodVoicePort' -and $line[0] -match 'npcEnabled')
    Yes '  which names keys and no value' ($line.Count -eq 1 -and $line[0] -notmatch 'True|7778')
    Yes 'the join pass and the role lists are no release key (#1223): carried as the server has them, not called absent' (
        $m.Settings.thornswoodRequirePass -eq $true -and @($m.Settings.thornswoodDevs) -contains 1 -and
        $absent -notcontains 'thornswoodRequirePass' -and $absent -notcontains 'thornswoodDevs')
    Yes 'a key it does carry moves, and is not called absent' ($m.Changed -contains 'loadOrder' -and $absent -notcontains 'loadOrder')
    Yes 'a release key outside the list is still kept and said' ($m.Kept -contains 'port' -and $m.Settings.port -eq 7777)
    $full = [pscustomobject][ordered]@{ loadOrder = @('a.esm'); startPoints = @(); thornswoodMostOnline = 10; maxPlayers = 14 }
    $m2 = Join-ThornswoodServerSettings $running $full $ThornswoodInstallKeys
    Yes 'a payload carrying every install key has nothing absent, and says nothing about it' (
        $m2.PSObject.Properties['Absent'] -and @($m2.Absent).Count -eq 0 -and @($m2.Said | Where-Object { $_ -like 'not in the release*' }).Count -eq 0)

    # The carry Deploy-Server sends to the box, run here against a stage.
    $root = Join-Path $T 'carry'
    Put (Join-Path $root 'server-settings.json') ($running | ConvertTo-Json -Depth 5)
    Put (Join-Path $root 'stage\server-settings.json') ($release | ConvertTo-Json -Depth 5)
    $carry = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\ServerSettings.ps1')) + "`r`n" +
             "`$Root = '$root'; `$Stage = 'stage'; `$ReleaseKeys = @('" + ($ThornswoodGamemodeKeys -join "','") + "')`r`n" + $settingsCarryBlock
    $out = @(& ([scriptblock]::Create($carry)) | ForEach-Object { [string]$_ })
    Yes 'the carry on the box ends CARRIED' (@($out | Where-Object { $_ -like 'CARRIED *' }).Count -eq 1)
    Yes '  and says what the release did not carry' (@($out | Where-Object { $_ -like 'not in the release*npcEnabled*' }).Count -eq 1)

    # ---- 2. the dev door's keys --------------------------------------------------
    Write-Host ''; Write-Host 'the dev door, from Publish-Server.ps1'
    $publish = Join-Path $repo 'scripts\release\Publish-Server.ps1'
    $lines = Get-Content -LiteralPath $publish
    $from = -1; $to = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($from -lt 0 -and $lines[$i] -match '^\s*\$seed = @''\s*$') { $from = $i + 1; continue }
        if ($from -ge 0 -and $lines[$i] -eq "'@") { $to = $i - 1; break }
    }
    Yes 'Publish-Server.ps1 has the roster script it sends to the dev server' ($from -gt 0 -and $to -gt $from)
    if ($to -le $from) { Done }
    $seed = ($lines[$from..$to]) -join "`r`n"
    $LIVEKEY = 'live-bot-key-' + [Guid]::NewGuid().ToString('N')
    $PASSKEY = 'live-pass-key-' + [Guid]::NewGuid().ToString('N')
    function Seed([string]$case, $door, [bool]$priv = $true) {
        $base = Join-Path $T ('seed-' + $case)
        $live = Join-Path $base 'live\private'
        $devRoot = Join-Path $base 'dev'
        if ($priv) {
            New-Item -ItemType Directory -Force -Path $live | Out-Null
            if ($door -is [string]) { Put (Join-Path $live 'door.json') $door }
            elseif ($null -ne $door) { Put (Join-Path $live 'door.json') ($door | ConvertTo-Json) }
            Put (Join-Path $live 'allowed.json') '{"profiles":[1,2,3]}'
        }
        Put (Join-Path $devRoot 'private\door.json') '{"site":"https://thornswood.net/dev","key":"the dev door before"}'
        $s = $seed.Replace("'C:\Thornswood-Server\private'", "'" + $live + "'").Replace('@@DEVROOT@@', $devRoot)
        $enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($s))
        $o = @(& $shell -NoProfile -NonInteractive -EncodedCommand $enc 2>&1 | ForEach-Object { ([string]$_).Trim() })
        return [pscustomobject]@{ Out = $o; Door = (Text (Join-Path $devRoot 'private\door.json')); Dev = (Join-Path $devRoot 'private'); Code = $LASTEXITCODE }
    }
    $quiet = { param($r) -not (($r.Out -join "`n").Contains($LIVEKEY) -or ($r.Out -join "`n").Contains($PASSKEY)) }
    $before = '{"site":"https://thornswood.net/dev","key":"the dev door before"}'

    $r = Seed 'good' @{ site = 'https://thornswood.net/'; key = $LIVEKEY; passKey = $PASSKEY }
    $d = $r.Door | ConvertFrom-Json
    Yes 'with the live door whole, the dev door gets the live key and join pass key and asks /dev' (
        $d.key -eq $LIVEKEY -and $d.passKey -eq $PASSKEY -and $d.site -eq 'https://thornswood.net/dev')
    Yes '  and the script ends DOOR CARRIED' ($r.Out -contains 'DOOR CARRIED' -and $r.Out -notcontains 'DOOR NOT CARRIED')
    Yes '  and prints no key' (& $quiet $r)

    $cases = @(
        @{ Name = 'no private folder'; Door = $null; Priv = $false; Says = 'no private folder' },
        @{ Name = 'no door.json'; Door = $null; Priv = $true; Says = 'no door\.json' },
        @{ Name = 'a door.json that does not read'; Door = '{ not json'; Priv = $true; Says = 'could not be read' },
        @{ Name = 'an empty door.json'; Door = ''; Priv = $true; Says = 'could not be read|is empty' },
        @{ Name = 'no join pass key'; Door = @{ site = 'https://thornswood.net'; key = $LIVEKEY }; Priv = $true; Says = 'has no passKey' },
        @{ Name = 'no key'; Door = @{ site = 'https://thornswood.net'; passKey = $PASSKEY }; Priv = $true; Says = 'has no key' },
        @{ Name = 'no address'; Door = @{ key = $LIVEKEY; passKey = $PASSKEY }; Priv = $true; Says = 'has no site' }
    )
    $n = 0
    foreach ($c in $cases) {
        $n++
        $r = Seed ('miss' + $n) $c.Door $c.Priv
        Yes ("live with {0}: DOOR NOT CARRIED, saying so" -f $c.Name) (
            $r.Out -contains 'DOOR NOT CARRIED' -and $r.Out -notcontains 'DOOR CARRIED' -and (($r.Out -join ' ') -match $c.Says))
        Yes '  and the dev door is exactly as it was, and nothing else is made on dev' (
            $r.Door -eq $before -and -not (Test-Path -LiteralPath (Join-Path $r.Dev 'allowed.json')))
        Yes '  and no key is printed' (& $quiet $r)
    }
    $src = [IO.File]::ReadAllText($publish)
    Yes 'Publish-Server stops with exit 1 when the script does not end DOOR CARRIED' (
        $src -match "(?s)\`$carried = \`$out -contains 'DOOR CARRIED'.*?if \(-not \`$carried\) \{\s*Die ")
    Yes '  and Die exits 1' ($src -match 'function Die\(\$m\) \{[^\n]*exit 1 \}')

    # ---- 3. Export-ServerPayload.ps1 ---------------------------------------------------
    Write-Host ''; Write-Host 'Export-ServerPayload.ps1'
    $export = Join-Path $repo 'scripts\release\Export-ServerPayload.ps1'
    $dist = Join-Path $T 'dist'
    $plug = Join-Path $T 'plugins'
    $zip = Join-Path $T 'out\server.zip'
    $record = Join-Path $T 'server-build.json'
    # Every server file the fork builds, as ServerBuild.ps1 holds them.
    $serverRels = @('dist_back/skymp5-server.js', 'dist_back/skymp5-server.js.map', 'package.json', 'yarn.lock', 'launch_server.bat', 'data/scripts/ActiveMagicEffect.pex')
    Put (Join-Path $dist 'scam_native.node') 'the recorded binary'
    foreach ($rel in $serverRels) { Put (Join-Path $dist ($rel -replace '/', '\')) ('the recorded ' + $rel) }
    $commit = 'abcdef0123456789abcdef0123456789abcdef01'
    $files = [ordered]@{}
    foreach ($rel in @('scam_native.node') + $serverRels) {
        $p = Join-Path $dist ($rel -replace '/', '\')
        $files[$rel] = [ordered]@{ sha256 = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = (Get-Item -LiteralPath $p).Length; commit = $commit }
    }
    # bytes as well: Export-ServerPayload holds the record to RecordShape.ps1 (#2180).
    Put $record ([ordered]@{ binary = 'scam_native.node'; sha256 = $files['scam_native.node'].sha256; bytes = $files['scam_native.node'].bytes; source = [ordered]@{ commit = $commit }; files = $files } | ConvertTo-Json -Depth 5)
    foreach ($n in 'Skyrim.esm', 'A.esp', 'B.esp') { Put (Join-Path $plug $n) ('plugin ' + $n) }
    function Order([string[]]$names) {
        $s = [ordered]@{ name = 'Thornswood'; port = 7777; thornswoodVoicePort = 7778; maxPlayers = 14
            loadOrder = @($names | ForEach-Object { (Join-Path $plug $_).Replace('\', '/') })
            startPoints = @(@{ worldOrCell = '0x3C'; pos = @(0, 0, 0); angleZ = 0 }) }
        Put (Join-Path $dist 'server-settings.json') ($s | ConvertTo-Json -Depth 6)
    }
    function Export {
        if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
        $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try {
            $o = (& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $export -Dist $dist -Zip $zip -OutDir (Join-Path $T 'out\_payload') -Record $record 2>&1 | Out-String)
            $code = $LASTEXITCODE
        } finally { $ErrorActionPreference = $old }
        return [pscustomobject]@{ Code = $code; Out = ($o -replace '\r?\n\s+\|\s+', ' '); Zip = (Test-Path -LiteralPath $zip) }
    }
    function Entries {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead($zip)
        try { return @($z.Entries | Where-Object { $_.Name } | ForEach-Object { $_.FullName.Replace('\', '/') }) } finally { $z.Dispose() }
    }
    function ZipOrder {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead($zip)
        try { $rd = New-Object IO.StreamReader($z.GetEntry('server-settings.json').Open()); try { return @(($rd.ReadToEnd() | ConvertFrom-Json).loadOrder) } finally { $rd.Dispose() } }
        finally { $z.Dispose() }
    }

    Order @('Skyrim.esm', 'A.esp', 'B.esp')
    $x = Export
    Yes ("a build with no gamemode.js is refused (exit {0})" -f $x.Code) ($x.Code -ne 0 -and $x.Out -match 'no gamemode\.js' -and $x.Out -match 'Nothing was packed')
    Yes '  and no zip is made' (-not $x.Zip)

    Put (Join-Path $dist 'gamemode.js') '// the gamemode'
    # The tables the gamemode reads as it loads (#5191): a build with none
    # would start a server whose gamemode stops at once.
    $x = Export
    Yes ("a build with no gamemode tables is refused (exit {0})" -f $x.Code) ($x.Code -ne 0 -and $x.Out -match 'no gamemode tables' -and $x.Out -match 'Nothing was packed')
    Yes '  and no zip is made' (-not $x.Zip)
    Put (Join-Path $dist 'gamemode-tables\WAY_OUT.json') '{}'
    Order @('Skyrim.esm', 'Missing.esp', 'A.esp', 'B.esp')
    $x = Export
    Yes ("a load order naming a plugin this machine does not have is refused (exit {0})" -f $x.Code) (
        $x.Code -ne 0 -and $x.Out -match 'Missing\.esp' -and $x.Out -match 'Nothing was packed')
    Yes '  and no zip is made with the shorter order' (-not $x.Zip)

    Order @('Skyrim.esm', 'A.esp', 'B.esp')
    $x = Export
    $ents = if ($x.Zip) { Entries } else { @() }
    Yes ("a build with both packs (exit {0})" -f $x.Code) ($x.Code -eq 0 -and $x.Zip); if ($x.Code) { Write-Host $x.Out }
    Yes '  with gamemode.js in it' ($ents -contains 'gamemode.js')
    Yes '  and its tables' ($ents -contains 'gamemode-tables/WAY_OUT.json')
    Yes '  and the whole order, in order' ((@(if ($x.Zip) { ZipOrder }) | ForEach-Object { ($_ -split '/')[-1] }) -join ',' -eq 'Skyrim.esm,A.esp,B.esp')
    Yes '  and says the build has no stamp' ($x.Out -match 'no thornswood-build\.json')
    Put (Join-Path $dist 'thornswood-build.json') '{"gamemode":"x"}'
    $x = Export
    Yes '  with a stamp, packs it and says nothing about one missing' ($x.Code -eq 0 -and (Entries) -contains 'thornswood-build.json' -and $x.Out -notmatch 'no thornswood-build\.json')

    # ---- 4. the installer ----------------------------------------------------------------
    Write-Host ''; Write-Host 'Install-ThornswoodServer.ps1'
    $inst = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Install-ThornswoodServer.ps1'))
    Yes 'a stage with no gamemode.js is refused with the rest, before anything is stopped' (
        $inst -match "(?s)if \(-not \(Test-Path -LiteralPath \`$gm\)\) \{\s*\`$bad \+= 'the payload has no gamemode\.js[^']*'\s*\} else \{" -and
        $inst.IndexOf("`$bad += 'the payload has no gamemode.js") -lt $inst.IndexOf('if ($bad.Count) { Refuse $bad }'))
    Yes 'a stage with no gamemode tables is refused with the rest, before anything is stopped (#5191)' (
        $inst.IndexOf("`$bad += 'the payload has no gamemode-tables") -gt 0 -and
        $inst.IndexOf("`$bad += 'the payload has no gamemode-tables") -lt $inst.IndexOf('if ($bad.Count) { Refuse $bad }'))
    Yes 'a put-back with a settings file missing says so' ($inst -match "(?s)\`$gone = @\(@\(\`$runPath, \`$backPath\).*?Say \(""there is no "" \+")
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
