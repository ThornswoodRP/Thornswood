<#
  test-client-by-hash.ps1

      pwsh -NoProfile -File .\launcher\tests\test-client-by-hash.ps1
      pwsh -NoProfile -File .\launcher\tests\test-client-by-hash.ps1 -Repo <a copy of the repository>

  Whether the six client runtime files in client-build.json leave this machine
  as ours only when their bytes are the recorded build. To Do entry 128.

  Until 24 September Test-ShipOtherServer in Ship-Rules.ps1 called a path in
  the record ours without opening the file, while the note over it said "ours
  by recorded hash". A bundle with one byte changed, or another launcher's
  bundle at the same path, went into a pack as ours. The old installer's
  Package-Thornswood.ps1 kept whatever sat at those six paths, including when
  it built out of the Steam copy; it went with that installer (#4824), and
  the setup's game files now come from the feed's own packs and client
  runtime, which parts 2 and 3 hold. The entry's words: "A test that passes because
  of something we did to the file is not a test." Its done-when: a copy of the
  bundle with one byte changed is classified as foreign or unrecognised, while
  the unmodified bundle is still accepted.

  Four parts.
    1. The rule, against a made up game folder and a record written for it.
       The recorded bytes are ours. One byte changed, another launcher's file
       and a missing file are not, and none of those is listed as removed.
    2. Publish-Update's own Test-Machine and removal diff, lifted out of the
       script by text, over that folder with one byte of the bundle changed.
    3. Check-Secrets.ps1 over a scratch pack that carries the client. It judges the bytes it reads, not the game folder's: the
       recorded build passes run on its own, and a pack with one byte changed
       fails even when the caller's $GameDir holds the recorded build.
    4. This machine's game folder, when there is one: the real record against
       the real files, and a scratch copy of the real bundle with one byte
       changed. The game folder is only read.
  And Checks.ClientPatched, the text search for our own name, is gone.

  -Repo runs it against another copy of the repository: Ship-Rules.ps1,
  Publish-Update.ps1, client-build.json and app\*.cs,
  unpacked from git archive. Pointed at 6851ed4, main before this change, it
  fails 15 of its checks on the machine that ships, 14 where there is no game
  folder. Part 3 is skipped there, since Check-Secrets.ps1 came later. Pointed
  at 4e72a03, this branch merged with main before Check-Secrets judged the
  bytes, it fails the three checks of part 3 that need the bytes to decide.

  Writes only to a temp folder of its own, and removes it.
#>
param(
    [string]$Repo,
    [string]$Game = (Join-Path ([string](& (Join-Path $PSScriptRoot '..\..\scripts\release\Where.ps1') Install)) 'Game')
)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $Repo) {
    # This harness is in launcher\tests\, the repository is two folders up.
    $Repo = $PSScriptRoot
    if (-not $Repo) { $Repo = Split-Path -Parent $MyInvocation.MyCommand.Definition }
    $Repo = Split-Path -Parent (Split-Path -Parent $Repo)
}

$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
    else       { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

# The answer to one question, or $null when asking it threw (a function the
# scripts under test do not have, for one). Checks compare against $true or
# $false explicitly, so a throw is a FAIL whichever answer was wanted.
function Ask([scriptblock]$q) {
    try { return [bool](& $q) }
    catch { Write-Host ("      threw: " + $_.Exception.Message) -ForegroundColor Red; return $null }
}

# Worked out apart from the rule under test, with a different implementation.
function Sha([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }

function Set-OneByteChanged([string]$p, [int]$at) {
    $b = [IO.File]::ReadAllBytes($p)
    $b[$at] = [byte]($b[$at] -bxor 1)
    [IO.File]::WriteAllBytes($p, $b)
}

# What the lifted Publish-Update removal diff calls when it says how it
# compared; quiet here.
function Say($m, $c = 'Gray') { }

$realRecord = Join-Path $Repo 'records\client-build.json'
$names = @((Get-Content -LiteralPath $realRecord -Raw | ConvertFrom-Json).files.PSObject.Properties.Name)
$bundle = 'Data\Platform\Plugins\skymp5-client.js'
$dll    = 'Data\SKSE\Plugins\MpClientPlugin.dll'

$scratch  = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-client-by-hash-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
# Laid out like the repository since phase 8 of issue #440: Ship-Rules in
# scripts\release, the record in records\, Check-Secrets in scripts\dev.
$fixTools = Join-Path $scratch 'scripts\release'
$fixRecords = Join-Path $scratch 'records'
$fixDev = Join-Path $scratch 'scripts\dev'
$fixGame  = Join-Path $scratch 'Game'

try {
    # ---- 1. the rule -----------------------------------------------------------
    Write-Host ''
    Write-Host 'The rule, against a made up game folder' -ForegroundColor Cyan

    $null = New-Item -ItemType Directory -Force -Path $fixTools, $fixRecords, $fixDev, $fixGame
    Copy-Item -LiteralPath (Join-Path $Repo 'scripts\release\Ship-Rules.ps1') -Destination $fixTools
# Ship-Rules holds ui-gone.json to RecordShape.ps1 (#2180), which loads Read-JsonFile.ps1.
foreach ($n in 'RecordShape.ps1', 'Read-JsonFile.ps1', 'RepoPlugins.ps1', 'CollectionRevision.ps1') { Copy-Item -LiteralPath (Join-Path $Repo ('scripts\release\' + $n)) -Destination $fixTools }
    Copy-Item -LiteralPath (Join-Path $Repo 'records\ui-gone.json') -Destination $fixRecords
    $files = [ordered]@{}
    foreach ($n in $names) {
        $full = Join-Path $fixGame $n
        $null = New-Item -ItemType Directory -Force -Path (Split-Path $full -Parent)
        [IO.File]::WriteAllText($full, 'made up client runtime file for test-client-by-hash: ' + $n)
        $files[$n] = [ordered]@{ sha256 = (Sha $full); bytes = (Get-Item -LiteralPath $full).Length }
    }
    [ordered]@{ forkCommit = 'harness'; files = $files } | ConvertTo-Json -Depth 4 |
        Set-Content -LiteralPath (Join-Path $fixRecords 'client-build.json') -Encoding UTF8
    $bundleFull = Join-Path $fixGame $bundle
    $dllFull    = Join-Path $fixGame $dll
    $goodBundle = [IO.File]::ReadAllBytes($bundleFull)

    . (Join-Path $fixTools 'Ship-Rules.ps1')
    Yes ("Ship-Rules.ps1 read all {0} paths out of the record" -f $names.Count) ($ShipClientFiles.Count -eq $names.Count)

    # Before anything says where the game is. There is nothing to hash.
    Yes 'asked with no file and no $GameDir, the bundle is not called ours' ((Ask { Test-ShipOtherServer $bundle }) -eq $true)

    $GameDir = $fixGame
    foreach ($n in $names) {
        Yes ("ours, the recorded bytes: {0}" -f $n) ((Ask { (Test-ShipOtherServer $n) -or (Test-ShipMachine $n) }) -eq $false)
    }
    # Where the file system keeps case (Linux), the path in lower case is a
    # file of its own, so it is given the same bytes while it is asked (#2989).
    $lowFull = Join-Path $fixGame $bundle.ToLowerInvariant()
    $lowMade = -not (Test-Path -LiteralPath $lowFull)
    if ($lowMade) {
        $null = New-Item -ItemType Directory -Force -Path (Split-Path $lowFull -Parent)
        [IO.File]::WriteAllBytes($lowFull, $goodBundle)
    }
    Yes 'whatever the case of the path' ((Ask { Test-ShipOtherServer $bundle.ToLowerInvariant() }) -eq $false)
    if ($lowMade) { Remove-Item -LiteralPath (Join-Path $fixGame ($bundle.Split('\')[0].ToLowerInvariant())) -Recurse -Force }
    Yes 'Test-ShipClientRecorded takes the file itself too' ((Ask { Test-ShipClientRecorded $bundle $bundleFull }) -eq $true)

    Set-OneByteChanged $bundleFull 7
    Yes 'one byte changed in the bundle: not ours' ((Ask { Test-ShipOtherServer $bundle }) -eq $true)
    Yes 'so never shipped and never listed as removed' ((Ask { Test-ShipMachine $bundle }) -eq $true)
    Yes 'and not the recorded build, asked with the file' ((Ask { Test-ShipClientRecorded $bundle $bundleFull }) -eq $false)
    Yes 'the other five are still ours' (@($names | Where-Object { $_ -ne $bundle -and (Test-ShipOtherServer $_) }).Count -eq 0)

    [IO.File]::WriteAllText($bundleFull, 'var anotherLaunchersClient = true;')
    Yes 'another launcher''s bundle at the same path: not ours' ((Ask { Test-ShipOtherServer $bundle }) -eq $true)

    [IO.File]::WriteAllBytes($bundleFull, $goodBundle)
    Yes 'the recorded bytes put back: ours again, so it is the bytes that decide' ((Ask { Test-ShipOtherServer $bundle }) -eq $false)

    $goodDll = [IO.File]::ReadAllBytes($dllFull)
    Remove-Item -LiteralPath $dllFull -Force
    Yes 'a client file that is not there is not called ours, so it is never listed as removed' ((Ask { Test-ShipMachine $dll }) -eq $true)
    [IO.File]::WriteAllBytes($dllFull, $goodDll)

    # The rest of the rule is untouched.
    Yes 'our own overlay beside the bundle still ships' ((Ask { Test-ShipOtherServer 'Data\Platform\Plugins\thornswood-front.js' }) -eq $false)
    Yes 'somebody else''s plugin beside it still does not' ((Ask { Test-ShipOtherServer 'Data\Platform\Plugins\other-server.js' }) -eq $true)
    Yes 'a path the record does not name is never called the recorded build' ((Ask { Test-ShipClientRecorded 'Data\Platform\Plugins\thornswood-front.js' }) -eq $false)

    # ---- 2. Publish-Update, lifted by text -------------------------------------
    Write-Host ''
    Write-Host 'Publish-Update.ps1: the scan and the removals' -ForegroundColor Cyan

    $pub = Get-Content -LiteralPath (Join-Path $Repo 'scripts\release\Publish-Update.ps1') -Raw
    $tm = [regex]::Match($pub, '(?m)^function Test-Machine\(.*$')
    $diff = [regex]::Match($pub, '(?ms)^\$changed = @\(\); \$removed = @\(\)\r?$.*?^\$removed\s+= @\(\$removed \| Where-Object \{[^\r\n]*Test-Machine[^\r\n]*\r?$')
    Yes 'Publish-Update.ps1 still defines Test-Machine on one line' $tm.Success
    Yes 'and still filters its removals by Test-Machine' $diff.Success
    Yes 'and its scan leaves out what Test-Machine claims' ($pub -match 'if \(Test-Machine \$rel\) \{ continue \}')
    # Ship-Rules finds the file through $GameDir; if the scan stops walking that
    # folder, the client would go back to being judged without its bytes. Since
    # #1517 (#1156) it walks $listedGame, the long name of the same folder, so
    # a short 8.3 TEMP does not cut the relative paths wrong.
    Yes 'and its scan walks the folder it calls $GameDir, by its long name' (
        ($pub -match '\$listedGame = \(Get-Item -LiteralPath \$GameDir\)\.FullName') -and
        ($pub -match 'Get-ChildItem -LiteralPath \$listedGame -Recurse -File -Force'))
    if ($tm.Success -and $diff.Success) {
        . ([scriptblock]::Create($tm.Value))
        # The last pack carried all six and an overlay of ours that has gone.
        $prev = @{}
        foreach ($n in $names) { $prev[$n] = '1:1' }
        $prev['Data\Platform\Plugins\thornswood-gone.js'] = '1:1'
        Set-OneByteChanged $bundleFull 7
        $sep = [string][IO.Path]::DirectorySeparatorChar
        $prefix = $GameDir.TrimEnd($sep) + $sep
        $now = @{}
        foreach ($f in (Get-ChildItem -LiteralPath $GameDir -Recurse -File -Force)) {
            $rel = $f.FullName.Substring($prefix.Length).Replace($sep, '\')
            if (Test-Machine $rel) { continue }
            $now[$rel] = '1:1'
        }
        . ([scriptblock]::Create($diff.Value))
        Yes 'a pack leaves the altered bundle out' (-not $now.ContainsKey($bundle))
        Yes 'and carries the five that are the recorded build' (@($names | Where-Object { $_ -ne $bundle -and $now.ContainsKey($_) }).Count -eq ($names.Count - 1))
        Yes 'and does not list the bundle as removed, so no tester loses theirs' ($removed -notcontains $bundle)
        Yes 'the lifted diff is live: an overlay of ours that went is still removed' ($removed -contains 'Data\Platform\Plugins\thornswood-gone.js')
        [IO.File]::WriteAllBytes($bundleFull, $goodBundle)
    }

    # ---- 3. Check-Secrets, over what was built ----------------------------------
    Write-Host ''
    Write-Host 'Check-Secrets.ps1: a pack that carries the client' -ForegroundColor Cyan

    $scanSrc = Join-Path $Repo 'scripts\dev\Check-Secrets.ps1'
    if (-not (Test-Path -LiteralPath $scanSrc)) {
        Write-Host 'SKIP  no Check-Secrets.ps1 in these tools; it arrived with entry 236' -ForegroundColor Yellow
    } else {
        # Beside the made up record, so it reads that record through Ship-Rules.
        $scan = Join-Path $fixDev 'Check-Secrets.ps1'
        Copy-Item -LiteralPath $scanSrc -Destination $scan
        $shell = (Get-Process -Id $PID).Path
        Add-Type -AssemblyName System.IO.Compression
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        # A pack holds the game under game/.
        $packDir  = Join-Path $scratch 'pack'
        foreach ($n in $names) {
            $d = Join-Path $packDir ('game\' + $n)
            $null = New-Item -ItemType Directory -Force -Path (Split-Path $d -Parent)
            Copy-Item -LiteralPath (Join-Path $fixGame $n) -Destination $d
        }
        $goodZip = Join-Path $scratch 'pack-recorded.zip'
        [IO.Compression.ZipFile]::CreateFromDirectory($packDir, $goodZip)
        Set-OneByteChanged (Join-Path $packDir ('game\' + $bundle)) 7
        $badZip = Join-Path $scratch 'pack-altered.zip'
        [IO.Compression.ZipFile]::CreateFromDirectory($packDir, $badZip)

        # On its own, the way a person runs it over a pack: no $GameDir anywhere.
        $null = & $shell -NoProfile -File $scan -Zip $goodZip
        Yes 'run on its own, a pack carrying the recorded build passes' ($LASTEXITCODE -eq 0)
        $out = @(& $shell -NoProfile -File $scan -Zip $badZip)
        Yes 'a pack whose bundle has one byte changed fails' ($LASTEXITCODE -eq 1)
        Yes 'and the line names the bundle and the rule' (($out -join "`n") -match 'skymp5-client\.js.*client-not-recorded-build')

        # Called with & by a script whose $GameDir holds the recorded build, the
        # way Publish-Update calls it. The bytes in the zip decide, not the game
        # folder's.
        $GameDir = $fixGame
        $null = & $scan -Zip $badZip 6>$null
        Yes 'called by a script whose $GameDir holds the recorded build, the altered pack still fails' ($LASTEXITCODE -eq 1)
    }

    # ---- 4. this machine's game folder -----------------------------------------
    Write-Host ''
    Write-Host 'This machine''s game folder' -ForegroundColor Cyan

    # Join-Path stops on a drive this machine does not have (C: off Windows),
    # so whether the folder is here at all is asked first.
    if (-not (Test-Path -LiteralPath $Game) -or -not (Test-Path -LiteralPath (Join-Path $Game 'SkyrimSE.exe'))) {
        Write-Host ("SKIP  no game folder at {0}; nothing on this machine to measure" -f $Game) -ForegroundColor Yellow
    } else {
        # The real record now, from the real tools folder.
        . (Join-Path $Repo 'scripts\release\Ship-Rules.ps1')
        $rec = Get-Content -LiteralPath $realRecord -Raw | ConvertFrom-Json
        $GameDir = $Game
        $recorded = 0
        foreach ($n in $names) {
            $full = Join-Path $Game $n
            $is = (Test-Path -LiteralPath $full) -and ((Sha $full) -eq ([string]$rec.files.$n.sha256).ToLowerInvariant())
            if ($is) { $recorded++ }
            $said = 'not the recorded build'
            if ($is) { $said = 'the recorded build' }
            Yes ("the rule agrees with Get-FileHash about {0}: {1}" -f $n, $said) ((Ask { -not (Test-ShipOtherServer $n) }) -eq $is)
        }
        Write-Host ("      {0} of {1} client files in {2} are the recorded build" -f $recorded, $names.Count, $Game) -ForegroundColor DarkGray

        # The bundle itself, the file the entry named, in a scratch copy.
        $realFull = Join-Path $Game $bundle
        if (-not (Test-Path -LiteralPath $realFull)) {
            Write-Host "SKIP  no $bundle in $Game" -ForegroundColor Yellow
        } else {
            $copyGame = Join-Path $scratch 'real\Game'
            $copy = Join-Path $copyGame $bundle
            $null = New-Item -ItemType Directory -Force -Path (Split-Path $copy -Parent)
            Copy-Item -LiteralPath $realFull -Destination $copy
            $GameDir = $copyGame
            $realIs = (Sha $copy) -eq ([string]$rec.files.$bundle.sha256).ToLowerInvariant()
            if ($realIs) {
                Yes 'an unmodified copy of this machine''s bundle is ours' ((Ask { Test-ShipOtherServer $bundle }) -eq $false)
            } else {
                Write-Host "SKIP  this machine's bundle is not the recorded build, so there is no unmodified copy to accept" -ForegroundColor Yellow
            }
            Set-OneByteChanged $copy 100
            Yes 'the same copy with one byte changed is not' ((Ask { Test-ShipOtherServer $bundle }) -eq $true)
        }
    }

    # ---- and the text search is gone ---------------------------------------------
    Write-Host ''
    Write-Host 'The launcher' -ForegroundColor Cyan
    $checks = Get-Content -LiteralPath (Join-Path $Repo 'launcher\app\Checks.cs') -Raw
    Yes 'Checks.ClientPatched, the text search for our own name, is gone' (-not ($checks -match 'static bool ClientPatched\s*\('))
    $callers = @(Get-ChildItem -LiteralPath (Join-Path $Repo 'launcher\app') -Filter '*.cs' -File |
                 Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match '(?<!bool\s+)ClientPatched\s*\(\s*\)' })
    Yes 'and nothing in the launcher calls it' ($callers.Count -eq 0)
}
finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $pass, $fail)
if ($fail) { exit 1 }
exit 0
