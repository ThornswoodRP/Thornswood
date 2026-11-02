<#
  test-459-store-deploy.ps1

      pwsh -NoProfile -File .\tests\test-459-store-deploy.ps1

  A recorded server build deployed out of the box's store, from a machine
  with no engine build (#459): Publish-Server.ps1 -FromStore and
  Deploy-Server.ps1 -FromStore, and the pieces both stand on.

  WHY. Since #2467 every publish and full deploy keeps the server build it
  sends in C:\Thornswood-Deploys\server as server-<commit 12>-<hash 16>.zip
  with its .json. -FromStore takes the build records\server-build.json names
  out of there, so it must be held to the record exactly as a build sent from
  a machine is: the zip its .json names for that record and no other, its
  bytes as named, every file the record's, nothing else in it. A store that
  answers with another build, or a zip someone swapped, has to stop the
  deploy before anything running is touched.

  HOW. Real artifacts made by New-ThornswoodServerBuildArtifact from a build
  folder in a temp folder, and stores made from them, some spoiled on purpose.
  Expand-ThornswoodStoredServerBuild (ServerBuild.ps1) runs here and in a
  PowerShell 7 of its own, as the box runs it. The far side texts
  (the store listing, Deploy-Server's store block and its settings block) run
  against scratch folders. Publish-Server.ps1, Deploy-Server.ps1 and the
  installer are run whole only for the refusals that come before anything is
  sent, against a host that does not exist. The whole runs against a
  stand-in box are in tests\test-install-server.ps1 (Publish-Server) and
  tests\test-deploy-server-swap.ps1 (Deploy-Server), in the nightly checks.

  Nothing leaves this machine.
#>
[CmdletBinding()]
param()
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

. (Join-Path $Repo 'scripts\deploy\ServerArtifact.ps1')
. (Join-Path $Repo 'scripts\deploy\ServerSettings.ps1')
$utf8 = New-Object Text.UTF8Encoding($false)
$pwsh = (Get-Process -Id $PID).Path
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-459-store-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = [IO.Directory]::CreateDirectory($T)

function Put([string]$path, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text, $utf8)
}
# What a PowerShell this starts writes, its errors as well, one string a line.
# A line the child writes to stderr can come back through 2>&1 as an error
# record, and with Stop the first one ended this harness before the refusal
# it carried was read (#2739). A child's refusal is what these checks read, so here, and
# only inside this function, a stderr line is read rather than stopped on.
# The child's exit code is still in $LASTEXITCODE afterwards.
function Out-Child([string]$exe, [string[]]$a) {
    $ErrorActionPreference = 'Continue'
    @(& $exe @a 2>&1 | ForEach-Object { "$_" })
}
$commit = 'abcdef0123456789abcdef0123456789abcdef01'
# A build folder: every file ServerBuild.ps1 counts as the fork's, $Binary the binary.
function Build([string]$dir, [string]$Binary) {
    Put (Join-Path $dir 'scam_native.node') $Binary
    Put (Join-Path $dir 'dist_back\skymp5-server.js') '// the JavaScript half'
    Put (Join-Path $dir 'dist_back\skymp5-server.js.map') '{ "version": 3 }'
    Put (Join-Path $dir 'package.json') '{ "name": "skymp5-server" }'
    Put (Join-Path $dir 'yarn.lock') '# yarn lockfile v1'
    Put (Join-Path $dir 'launch_server.bat') 'node dist_back/skymp5-server.js'
    Put (Join-Path $dir 'data\scripts\ActiveMagicEffect.pex') 'compiled papyrus'
    Put (Join-Path $dir 'server-settings.json') '{ "port": 7777 }'
    return $dir
}
# Its record, the way New-ServerBuildRecord.ps1 writes one.
function Record([string]$dir, [string]$path, [switch]$Light, [switch]$Crlf) {
    $sums = Get-ThornswoodServerFolderSums $dir
    $files = [ordered]@{}
    foreach ($rel in @($sums.Keys | Sort-Object)) { $files[$rel] = [ordered]@{ sha256 = $sums[$rel]; bytes = 1; commit = $commit } }
    $rec = [ordered]@{ binary = 'scam_native.node'; sha256 = $sums['scam_native.node']; bytes = 1; builtUtc = '2026-10-16T00:00:00Z'
                       source = [ordered]@{ repo = 'https://github.com/ThornswoodRP/skymp.git'; branch = 'thornswood/engine-changes'; commit = $commit; upstream = ''; upstreamBase = '' }
                       files = $files; recorded = '2026-10-16' }
    if ($Light) { $rec['lightPlugins'] = $true }
    $text = ($rec | ConvertTo-Json -Depth 5) + "`n"
    if ($Crlf) { $text = $text.Replace("`r`n", "`n").Replace("`n", "`r`n") }
    Put $path $text
    return $path
}
function RecObj([string]$path) { return ([IO.File]::ReadAllText($path) | ConvertFrom-Json) }
function SumOf([string]$path) { return (Get-ThornswoodRecordSum ([IO.File]::ReadAllBytes($path))) }
function Expand([string]$store, [string]$recPath) {
    $into = Join-Path $T ('into-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $null = [IO.Directory]::CreateDirectory($into)
    $r = Expand-ThornswoodStoredServerBuild -Store $store -Record (RecObj $recPath) -RecordSum (SumOf $recPath) -Into $into
    $r | Add-Member -NotePropertyName Into -NotePropertyValue $into
    return $r
}
# A store with one artifact in it, made by New-ThornswoodServerBuildArtifact.
function Store([string]$name, [string]$build, [string]$recPath) {
    $dir = Join-Path $T $name
    $a = New-ThornswoodServerBuildArtifact -From $build -Record $recPath -OutDir $dir
    return [pscustomobject]@{ Dir = $dir; A = $a }
}
# A zip of these entries, stored the way Artifact.ps1 writes one, named and
# described in $dir as an artifact for $recPath would be: for the spoiled stores.
function HandZip([string]$dir, [string]$recPath, [hashtable]$entries) {
    Initialize-ThornswoodArtifactType
    [string[]]$names = @($entries.Keys)
    [Array]::Sort($names, [StringComparer]::Ordinal)
    $datas = New-Object 'byte[][]' $names.Count
    for ($i = 0; $i -lt $names.Count; $i++) { $datas[$i] = [byte[]]$entries[$names[$i]] }
    $null = [IO.Directory]::CreateDirectory($dir)
    $tmp = Join-Path $dir 'building.zip'
    [ThornswoodArtifactZip]::WriteStored($tmp, $names, $datas)
    $sha = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLowerInvariant()
    $name = 'server-' + $commit.Substring(0, 12) + '-' + $sha.Substring(0, 16) + '.zip'
    Move-Item -LiteralPath $tmp -Destination (Join-Path $dir $name)
    $meta = [ordered]@{ component = 'server'; name = $name; commit = $commit; sha256 = $sha; size = 1; recordSha256 = (SumOf $recPath); files = @() }
    [IO.File]::WriteAllText((Join-Path $dir ([IO.Path]::ChangeExtension($name, '.json'))), ($meta | ConvertTo-Json -Depth 5), $utf8)
    return $name
}
function Bytes([string]$text) { return $utf8.GetBytes($text) }
function Lf([string]$path) { $l1 = [Text.Encoding]::GetEncoding(28591); return $l1.GetBytes($l1.GetString([IO.File]::ReadAllBytes($path)).Replace("`r`n", "`n")) }

try {
    $buildA = Build (Join-Path $T 'buildA') 'binary A'
    $recA = Record $buildA (Join-Path $T 'recA.json')
    $buildB = Build (Join-Path $T 'buildB') 'binary B'
    $recB = Record $buildB (Join-Path $T 'recB.json')
    $sA = Store 'storeA' $buildA $recA

    # ---- 1. Expand-ThornswoodStoredServerBuild, here ------------------------------
    $r = Expand $sA.Dir $recA
    Yes 'the store''s build for the record is taken: its name, no problem' ($r.Name -eq $sA.A.Name -and -not $r.Problem)
    Yes '  every file the record lists is written, each the recorded bytes, and nothing else of the fork''s' (
        @(Get-ThornswoodServerBuildProblems (RecObj $recA) (Get-ThornswoodServerFolderSums $r.Into) 'the stage' 'recA').Count -eq 0 -and
        -not (Test-Path -LiteralPath (Join-Path $r.Into 'server-build.json')) -and -not (Test-Path -LiteralPath (Join-Path $r.Into 'server-settings.json')))
    Yes '  and it says which build and how many files' (($r.Said -join ' ') -match [regex]::Escape($sA.A.Name) -and ($r.Said -join ' ') -match '7 files')

    $recA2 = Record $buildA (Join-Path $T 'recA-crlf.json') -Crlf
    $r = Expand $sA.Dir $recA2
    Yes 'the same record with CR LF line ends is the same record: the same build is taken' ($r.Name -eq $sA.A.Name -and -not $r.Problem)

    $r = Expand $sA.Dir $recB
    Yes 'a record the store has no build for is refused, naming the commit''s other build' ($r.Problem -match 'holds no server build of abcdef01 with this record' -and $r.Problem -match [regex]::Escape([IO.Path]::GetFileNameWithoutExtension($sA.A.Name)))
    Yes '  and writes nothing' (@(Get-ChildItem -LiteralPath $r.Into -Recurse -File).Count -eq 0)

    $r = Expand (Join-Path $T 'no-store') $recA
    Yes 'a box with no store at all is refused the same way' ($r.Problem -match 'holds no server build')

    # A zip swapped for another under the name and .json of the right one.
    $sw = Join-Path $T 'swapped'
    Copy-Item -LiteralPath $sA.Dir -Destination $sw -Recurse
    $sB = Store 'storeB' $buildB $recB
    Copy-Item -LiteralPath $sB.A.Zip -Destination (Join-Path $sw $sA.A.Name) -Force
    $r = Expand $sw $recA
    Yes 'a zip that is not the one its name and .json say is refused' ($r.Problem -match 'is not the zip its name and its \.json say')

    # A .json naming the record over a zip of another build: the sums are right,
    # the contents are not.
    $recBytesA = Lf $recA
    $good = [ordered]@{}
    foreach ($rel in @((Get-ThornswoodServerFolderSums $buildA).Keys)) { $good[$rel] = [IO.File]::ReadAllBytes((Join-Path $buildA ($rel -replace '/', '\'))) }
    $e = @{}; foreach ($k in $good.Keys) { $e[$k] = $good[$k] }; $e['server-build.json'] = $recBytesA; $e['dist_back/extra.js'] = (Bytes '// from somewhere else')
    $null = HandZip (Join-Path $T 'extra') $recA $e
    $r = Expand (Join-Path $T 'extra') $recA
    Yes 'a zip with a file the record does not list is refused' ($r.Problem -match 'dist_back/extra\.js is in it and the record does not list it')

    $e = @{}; foreach ($k in $good.Keys) { if ($k -ne 'yarn.lock') { $e[$k] = $good[$k] } }; $e['server-build.json'] = $recBytesA
    $null = HandZip (Join-Path $T 'short') $recA $e
    $r = Expand (Join-Path $T 'short') $recA
    Yes 'a zip missing a file the record lists is refused' ($r.Problem -match 'yarn\.lock is listed in the record and not in it')

    $e = @{}; foreach ($k in $good.Keys) { $e[$k] = $good[$k] }; $e['server-build.json'] = $recBytesA; $e['scam_native.node'] = (Bytes 'binary Z')
    $null = HandZip (Join-Path $T 'wrongbin') $recA $e
    $r = Expand (Join-Path $T 'wrongbin') $recA
    Yes 'a zip whose binary is not the recorded one is refused' ($r.Problem -match 'scam_native\.node in it is not the build the record names')

    $e = @{}; foreach ($k in $good.Keys) { $e[$k] = $good[$k] }; $e['server-build.json'] = (Lf $recB)
    $null = HandZip (Join-Path $T 'wrongrec') $recA $e
    $r = Expand (Join-Path $T 'wrongrec') $recA
    Yes 'a zip carrying another record is refused' ($r.Problem -match 'its server-build\.json is not this record')

    $e = @{}; foreach ($k in $good.Keys) { $e[$k] = $good[$k] }
    $null = HandZip (Join-Path $T 'norec') $recA $e
    $r = Expand (Join-Path $T 'norec') $recA
    Yes 'a zip carrying no record is refused' ($r.Problem -match 'it carries no server-build\.json')

    $two = Join-Path $T 'two'
    Copy-Item -LiteralPath $sA.Dir -Destination $two -Recurse
    $e = @{}; foreach ($k in $good.Keys) { $e[$k] = $good[$k] }; $e['server-build.json'] = $recBytesA; $e['dist_back/extra.js'] = (Bytes '// another')
    $null = HandZip $two $recA $e
    $r = Expand $two $recA
    Yes 'a store with two builds for one record is refused, since one record makes one zip' ($r.Problem -match 'holds 2 server builds for one record')

    # ---- 2. the same, in a PowerShell 7 of its own, as the box runs it ---------
    $probe = Join-Path $T 'probe.ps1'
    $probeText = @'
param([string]$Lib, [string]$Json, [string]$Store, [string]$Rec, [string]$Into)
. $Json
. $Lib
$r = Expand-ThornswoodStoredServerBuild -Store $Store -Record ([IO.File]::ReadAllText($Rec) | ConvertFrom-Json) -RecordSum (Get-ThornswoodRecordSum ([IO.File]::ReadAllBytes($Rec))) -Into $Into
'NAME ' + $r.Name
'PROBLEM ' + $r.Problem
'FILES ' + @(Get-ChildItem -LiteralPath $Into -Recurse -File).Count
'@
    [IO.File]::WriteAllText($probe, $probeText, $utf8)
    $lib = Join-Path $Repo 'scripts\deploy\ServerBuild.ps1'
    $jsonLib = Join-Path $Repo 'scripts\release\Read-JsonFile.ps1'
    $i1 = Join-Path $T 'intoa'; $null = [IO.Directory]::CreateDirectory($i1)
    $o = @(Out-Child $boxPs @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $probe, '-Lib', $lib, '-Json', $jsonLib, '-Store', $sA.Dir, '-Rec', $recA2, '-Into', $i1))
    Yes 'in the box''s shell, the store''s build is taken: its name, all seven files, no problem' ($o -contains ('NAME ' + $sA.A.Name) -and $o -contains 'PROBLEM ' -and $o -contains 'FILES 7')
    $i2 = Join-Path $T 'intob'; $null = [IO.Directory]::CreateDirectory($i2)
    $o = @(Out-Child $boxPs @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $probe, '-Lib', $lib, '-Json', $jsonLib, '-Store', $sw, '-Rec', $recA, '-Into', $i2))
    Yes '  and a swapped zip is refused there too, writing nothing' (@($o | Where-Object { $_ -match '^PROBLEM .*is not the zip its name' }).Count -eq 1 -and $o -contains 'FILES 0')

    # ---- 3. which zip the store keeps, asked before anything is sent --------------
    $storeDir = $sA.Dir
    $short = $commit.Substring(0, 12)
    $lines = @(. ([scriptblock]::Create($ThornswoodServerStoreListText)))
    $o = ConvertFrom-ThornswoodServerStoreLines $lines (SumOf $recA)
    Yes 'the store listing names the zip for the record, and the box answered' ($o.Answered -and $o.Name -eq $sA.A.Name -and -not $o.Many)
    $o = ConvertFrom-ThornswoodServerStoreLines $lines (SumOf $recB)
    Yes '  and for a record it has none for, no zip, the commit''s other named' ($o.Answered -and -not $o.Name -and @($o.Others).Count -eq 1)
    $storeDir = Join-Path $T 'no-store'
    $o = ConvertFrom-ThornswoodServerStoreLines @(. ([scriptblock]::Create($ThornswoodServerStoreListText))) (SumOf $recA)
    Yes '  and a box with no store says so, and has none' ($o.Answered -and -not $o.Name)
    $storeDir = $two
    $o = ConvertFrom-ThornswoodServerStoreLines @(. ([scriptblock]::Create($ThornswoodServerStoreListText))) (SumOf $recA)
    Yes '  and two for one record are said as such' ($o.Many -and -not $o.Name)
    Yes 'an answer without its last line is no answer' (-not (ConvertFrom-ThornswoodServerStoreLines @('HAS ' + [IO.Path]::GetFileNameWithoutExtension($sA.A.Name) + ' x y') (SumOf $recA)).Answered)

    # ---- 4. a build CI made, held here before -ServerBuild sends it ---------------
    $tb = Test-ThornswoodServerBuildArtifact -Zip $sA.A.Zip -Record $recA
    Yes 'a server zip that is the recorded build is taken, as the artifact Send-ThornswoodArtifact sends' (
        $tb.Component -eq 'server' -and $tb.Name -eq $sA.A.Name -and $tb.Sha256 -eq $sA.A.Sha256 -and (Test-Path -LiteralPath $tb.RecordPath))
    $why = ''
    try { $null = Test-ThornswoodServerBuildArtifact -Zip $sA.A.Zip -Record $recB } catch { $why = $_.Exception.Message }
    Yes '  one of another record is refused, nothing sent' ($why -match 'is a build of another record' -and $why -match 'Nothing was sent')
    $lone = Join-Path $T 'lone'; $null = [IO.Directory]::CreateDirectory($lone)
    Copy-Item -LiteralPath $sA.A.Zip -Destination $lone
    $why = ''
    try { $null = Test-ThornswoodServerBuildArtifact -Zip (Join-Path $lone $sA.A.Name) -Record $recA } catch { $why = $_.Exception.Message }
    Yes '  one with no .json beside it is refused' ($why -match 'has no \.json beside it')
    $why = ''
    try { $null = Test-ThornswoodServerBuildArtifact -Zip (Join-Path $sw $sA.A.Name) -Record $recA } catch { $why = $_.Exception.Message }
    Yes '  one whose bytes are not its name''s is refused' ($why -match 'is not the zip its name')

    # ---- 5. Deploy-Server's store block on the box, against a scratch root --------
    $root = Join-Path $T 'root'
    $null = [IO.Directory]::CreateDirectory((Join-Path $root '.stage-x'))
    Copy-Item -LiteralPath $recA -Destination (Join-Path $root '.stage-x\server-build.json')
    $block = Join-Path $T 'store-block.ps1'
    # What Deploy-Server puts in front of it: Read-JsonFile.ps1 and RecordShape.ps1 (Swap.ps1's $ThornswoodRecordShapeText).
    $shapeText = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\release\Read-JsonFile.ps1')) + "`r`n" + [IO.File]::ReadAllText((Join-Path $Repo 'scripts\release\RecordShape.ps1')) + "`r`n"
    [IO.File]::WriteAllText($block, ($shapeText + [IO.File]::ReadAllText((Join-Path $Repo 'scripts\deploy\ServerBuild.ps1')) + "`r`n" +
        "`$Root = '" + $root + "'`r`n`$Stage = '.stage-x'`r`n`$Store = '" + $sA.Dir + "'`r`n" + $ThornswoodStoreExpandBlock), $utf8)
    # The stage is named with a leading dot, as Deploy-Server names it. Windows
    # reads that as an ordinary folder; Linux hides it, and the block's
    # Get-Item does not find a hidden folder, so this run needs Windows.
    if ($OnWindows) {
        $o = @(Out-Child $boxPs @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $block) | ForEach-Object { $_.Trim() })
        Yes 'Deploy-Server''s store block takes the build into the stage and ends STORED <name>' (
            $o -contains ('STORED ' + $sA.A.Name) -and (Test-Path -LiteralPath (Join-Path $root '.stage-x\scam_native.node')) -and
            (Test-Path -LiteralPath (Join-Path $root '.stage-x\data\scripts\ActiveMagicEffect.pex')))
    } else { Write-Host 'SKIP  the store block taking a build: its stage .stage-x is hidden off Windows, where a leading dot hides a folder from Get-Item' }
    [IO.File]::WriteAllText($block, ($shapeText + [IO.File]::ReadAllText((Join-Path $Repo 'scripts\deploy\ServerBuild.ps1')) + "`r`n" +
        "`$Root = '" + $root + "'`r`n`$Stage = '.stage-x'`r`n`$Store = '" + $sB.Dir + "'`r`n" + $ThornswoodStoreExpandBlock), $utf8)
    $o = @(Out-Child $boxPs @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $block) | ForEach-Object { $_.Trim() })
    Yes '  and with no build for the record it ends STORE REFUSED, the stage cleared' ($o -contains 'STORE REFUSED' -and -not (Test-Path -LiteralPath (Join-Path $root '.stage-x')))

    # ---- 6. Deploy-Server's settings block for -FromStore -------------------------
    function StoreCarry([string]$was, [string]$settings) {
        $null = [IO.Directory]::CreateDirectory((Join-Path $root '.stage-y'))
        Put (Join-Path $root 'server-settings.json') $settings
        Copy-Item -LiteralPath $recA -Destination (Join-Path $root 'server-build.json') -Force
        $f = Join-Path $T 'carry-block.ps1'
        [IO.File]::WriteAllText($f, ([IO.File]::ReadAllText((Join-Path $Repo 'scripts\deploy\ServerSettings.ps1')) + "`r`n" + $ThornswoodRecordSumText + "`r`n" +
            "`$Root = '" + $root + "'`r`n`$Stage = '.stage-y'`r`n`$WasRecord = '" + $was + "'`r`n" + $settingsStoreBlock), $utf8)
        return @(Out-Child $boxPs @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $f) | ForEach-Object { $_.Trim() })
    }
    $live = '{ "port": 7777, "thornswoodRequirePass": true, "loadOrder": [ "C:/Thornswood-Server/plugins/Skyrim.esm" ] }'
    $o = StoreCarry (SumOf $recA) $live
    $carried = @($o | Where-Object { $_ -match '^CARRIED [0-9a-f]{64}$' })
    Yes 'the -FromStore settings block copies the running settings into the stage unchanged' (
        $carried.Count -eq 1 -and ([IO.File]::ReadAllText((Join-Path $root '.stage-y\server-settings.json'))) -eq $live -and
        $carried[0].Substring(8) -eq (Get-FileHash -LiteralPath (Join-Path $root '.stage-y\server-settings.json') -Algorithm SHA256).Hash.ToLowerInvariant())
    $o = StoreCarry (SumOf $recB) $live
    Yes '  and when the box''s record changed since the run read it, CARRY REFUSED and the stage cleared' (
        $o -contains 'CARRY REFUSED' -and (($o -join ' ') -match 'changed since this run read it') -and -not (Test-Path -LiteralPath (Join-Path $root '.stage-y')))
    $o = StoreCarry (SumOf $recA) '{ "port": 7777 }'
    Yes '  and a server whose join pass switch is not true or false is refused (#1319)' ($o -contains 'CARRY REFUSED' -and (($o -join ' ') -match 'thornswoodRequirePass is missing'))

    # ---- 7. the refusals that come before anything is sent ------------------------
    $publish = Join-Path $Repo 'scripts\release\Publish-Server.ps1'
    $deploy = Join-Path $Repo 'scripts\deploy\Deploy-Server.ps1'
    function RunPs([string]$script, [string[]]$a) {
        $o = @(Out-Child $pwsh (@('-NoProfile', '-File', $script) + $a))
        $code = $LASTEXITCODE
        # An error is printed wrapped at the window's width, each piece behind
        # a "| ": put the sentence back together before it is read.
        $esc = [string][char]27
        $flat = @($o | ForEach-Object { $_ -split "`n" } | ForEach-Object {
            $l = ($_ -replace ([regex]::Escape($esc) + '\[[0-9;]*m'), '')
            $k = $l.IndexOf('| ')
            if ($k -ge 0 -and $l.Substring(0, $k).Trim() -eq '') { $l = $l.Substring($k + 2) }
            $l.Trim() }) -join ' '
        return [pscustomobject]@{ Code = $code; Out = $flat }
    }
    $nowhere = 'harness.invalid'
    foreach ($c in @(
        @{ Label = '-FromStore -PutBack'; A = @('-FromStore', '-PutBack'); Why = '-FromStore publishes a server build out of the store; -PutBack and -TaskOnly publish none' },
        @{ Label = '-FromStore -Dist'; A = @('-FromStore', '-Dist', $buildA); Why = '-FromStore packs no build' },
        @{ Label = '-FromStore -SkipBuild'; A = @('-FromStore', '-SkipBuild'); Why = '-FromStore packs no build' },
        @{ Label = '-FromStore -DropPlugins'; A = @('-FromStore', '-DropPlugins', 'A.esp'); Why = 'so it drops no plugin' },
        @{ Label = '-ServerBuild alone'; A = @('-ServerBuild', $sA.A.Zip); Why = 'Give -FromStore with it' })) {
        $r = RunPs $publish (@('-Channel', 'dev', '-VpsHost', $nowhere, '-VpsUser', 'nobody', '-NoPause') + $c.A)
        Yes ('Publish-Server ' + $c.Label + ' stops before anything is sent, saying why') ($r.Code -ne 0 -and $r.Out.Contains($c.Why) -and $r.Out.Contains('Nothing was sent') -and $r.Out -notmatch 'Copying')
    }
    foreach ($c in @(
        @{ Label = '-FromStore -GamemodeOnly'; A = @('-FromStore', '-GamemodeOnly'); Why = 'Use one' },
        @{ Label = '-FromStore -PutBack'; A = @('-FromStore', '-PutBack'); Why = 'Use one' },
        @{ Label = '-FromStore -RequirePass on'; A = @('-FromStore', '-RequirePass', 'on'); Why = '-FromStore sets no setting' },
        @{ Label = '-FromStore -Dist'; A = @('-FromStore', '-Dist', $buildA); Why = 'not from -Dist' },
        @{ Label = '-FromStore -DropPlugins'; A = @('-FromStore', '-DropPlugins', 'A.esp'); Why = '-PutBack, -GamemodeOnly and -FromStore send none' },
        @{ Label = '-ServerBuild alone'; A = @('-ServerBuild', $sA.A.Zip); Why = 'Give -FromStore with it' })) {
        $r = RunPs $deploy (@('-Vps', $nowhere, '-User', 'nobody', '-Now') + $c.A)
        Yes ('Deploy-Server ' + $c.Label + ' stops before anything is sent, saying why') ($r.Code -ne 0 -and $r.Out.Contains($c.Why) -and $r.Out -notmatch 'Staging in')
    }
    if (Get-Command node -ErrorAction SilentlyContinue) {
        $inst = Join-Path $Repo 'scripts\deploy\Install-ThornswoodServer.ps1'
        $o = @(Out-Child $boxPs @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $inst, '-FromStore', '-PutBack', '-AllowGamingPc', '-Root', (Join-Path $T 'inst-root')) | ForEach-Object { $_.Trim() })
        Yes 'the installer refuses -FromStore with -PutBack, changing nothing' ($o -contains 'INSTALL REFUSED' -and (($o -join ' ') -match '-FromStore installs a server build out of the store'))
    }

    # ---- 8. where each script does it, read ---------------------------------------
    $inst = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\deploy\Install-ThornswoodServer.ps1'))
    $iTake = $inst.IndexOf('$got = Expand-ThornswoodStoredServerBuild')
    Yes 'the installer takes the build out of the store after the payload is unpacked and before what it shipped into data is listed' (
        $iTake -gt $inst.IndexOf('Expand-Archive -LiteralPath $Zip -DestinationPath $stageDir') -and $iTake -lt $inst.IndexOf('[IO.File]::WriteAllLines((Join-Path $stageDir ''.payload-data.txt'')'))
    Yes '  onto a running server only: no server-settings.json in the root is a refusal' ($inst -match 'there is no server in \$Root to keep them from')
    Yes '  and refuses an engine that reads light plugins another way than the running one (#1715)' ($inst -match '\$runLight -ne \$newLight')
    $iPlug = $inst.IndexOf('taken from $Root\plugins into the stage')
    Yes '  and copies the running server''s plugins before the load order is resolved against the stage' ($iPlug -gt $inst.IndexOf('$s = $m.Settings') -and $iPlug -lt $inst.IndexOf('# The load order resolves, against the stage'))
    Yes '  and refuses a plugin of ours the running order does not name' ($inst.Contains('which the running server''''s load order does not name'))
    $pub = [IO.File]::ReadAllText($publish)
    Yes 'Publish-Server asks the box which zip its store keeps before it copies anything' ($pub.IndexOf('Get-ThornswoodStoredServerBuild -Record $Record') -gt 0 -and $pub.IndexOf('Get-ThornswoodStoredServerBuild -Record $Record') -lt $pub.IndexOf("Head 'Copying'"))
    Yes '  and sends a -ServerBuild zip only after holding it to the record' ($pub.IndexOf('$sent = Test-ThornswoodServerBuildArtifact') -gt 0 -and $pub.IndexOf('$sent = Test-ThornswoodServerBuildArtifact') -lt $pub.IndexOf('Send-ThornswoodArtifact -Artifact $sent'))
    Yes '  and tells the installer -FromStore, with the store named' ($pub -match "instArgs \+= \(`" -FromStore -Store '")
    Yes '  and its payload carries no server file' ($pub -match 'and -FromStore takes them from the store')
    Yes '  and never asks Where.ps1 for a build' ($pub -match "if \(-not \`$Dist -and -not \`$FromStore\) \{ \`$Dist = & \(Join-Path \`$Here 'Where\.ps1'\) ServerDist \}")
    $ds = [IO.File]::ReadAllText($deploy)
    Yes 'Deploy-Server asks the box which zip its store keeps before anything is staged' ($ds.IndexOf('$stored = Get-ThornswoodStoredServerBuild') -gt 0 -and $ds.IndexOf('$stored = Get-ThornswoodStoredServerBuild') -lt $ds.IndexOf('Write-Host "Staging in'))
    $iStore = $ds.IndexOf('$storeOut = @(Remote $storeScript')
    Yes '  and takes it out of the store after the files are sent and before the settings and the check' ($iStore -gt $ds.IndexOf('& scp @ssh $send[$rel]') -and $iStore -lt $ds.IndexOf('$carryOut = @(Remote $carryScript'))
    Yes '  and holds the stage to the record''s own hashes for every server file' ($ds -match "foreach \(\`$rel in \`$serverFiles\) \{ \`$hashes\[\`$rel\] = ")
    Yes '  and lets no setting move: release keys none, the running file copied' ($ds -match '(?s)if \(\$FromStore\) \{\s+(#[^\n]*\s+)*\$liveKeys = @\(\)' -and $ds -match '\$settingsStoreBlock')
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
