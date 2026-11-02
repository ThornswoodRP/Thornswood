<#
  test-3047-ci-engine-build.ps1

      pwsh -NoProfile -File .\tests\test-3047-ci-engine-build.ps1

  Issue #3047. A Ship machine takes CI's build of the pin, held to the
  records, and never needs an engine build of its own.

  WHAT WAS WRONG, measured on 21 Oct 2026. Engine builds are not the same
  bytes twice, so records CI made match only CI's artifact. PR #3040 moved the
  pin to 1a7b6eec; One's recorded engine build was still a b6c76e45 fork
  worktree; the dev Ship stopped at Check-ShipReady with "the build is not the
  recorded one", and every fix Check-ShipReady, Sync-Client, Setup-ShipMachine,
  Update-ShipRoot and Where.ps1 printed led to building the engine on One
  again, which could not have matched either. Run 39588485569's artifact held
  the exact client.

  Since #3399 (Patrick's A, 26 Oct) the build taken is the public fork's own
  build of the pin, thornswood-engine-<commit>, which engine.yml records,
  and not an artifact of this repository, whose storage was used up.

  WHAT IT HOLDS, in a scratch copy of the scripts with records made here and
  a stand-in GitHub, nothing sent anywhere:
    1. Find-EngineArtifact (EngineArtifact.ps1): no fork build, one whose
       artifact is past its 90 days, one still running and one red are each
       "none", saying so; every green push build of the commit that keeps
       its artifact is a candidate, newest first, and a red one is not; a
       GitHub that cannot be read throws rather than saying none.
    2. Install-EngineArtifact: the right build goes in as an engine build
       (build\dist\client and build\dist\server, the server zip and
       fork-build.json under artifact\, engine-artifact.json naming the fork's
       run), CR LF records and all, and the fork's other server files
       (gamemode.js, the settings, the .pdb) stay out. Refused, with nothing
       put in place and no half folder left: a client file that is not the
       record's (with fork-build.json made to agree), a file fork-build.json
       does not name, one it names wrongly, a build of another commit or
       from another run, a client file the record does not name, a server
       file that is not the record's or is missing, and a folder that is
       there already. Get-EngineArtifactFolderProblems: a folder of another
       pin is not this one's.
    3. Where.ps1 and where.js: EngineArtifact is engine-ci\<pin 12> in the
       machine's data, answered with no record and whether or not it is
       there; {"ci": true} makes it EngineBuild, so ClientDist and ServerDist
       are under it, the two agree, and a pin move is another folder; a
       server record with no commit stops with a sentence.
    4. Get-EngineArtifact.ps1 whole, with a stand-in gh: -Check says it is on
       GitHub (exit 2) and writes nothing; a run fetches it from the fork
       (exit 0) and removes its scratch; a second run finds it there (exit
       0); no fork build and a gh that fails each stop (exit 1) saying why.
       Two kept for the pin, the newer a build run again in the fork (other
       bytes): the older, the one the records name, is taken after the newer
       is held and passed over with why; neither the records' stops (exit 1)
       naming both runs.
    5. Sync-Client.ps1 on a machine that takes CI's build, with a stand-in
       Get-EngineArtifact.ps1: without -Check it fetches the missing folder and
       copies the client in; -Check fetches nothing and names the script; a
       fetch that fails stops it; a game folder that already holds the
       client fetches nothing; another -Dist is never filled. Its stop for a
       build that is not the record names CI's build and no rebuild.
    6. Setup-ShipMachine.ps1: Save-EngineBuild ci writes {"ci": true};
       Test-EngineBuildIsCi reads it; no fix offers -Rebuild. Check-ShipReady's
       Get-ClientRows: a CI build GitHub keeps passes before the Ship fetches
       it, one it cannot have fails saying why, and the fix otherwise names
       -EngineBuild ci. No fix in the five scripts sends a Ship machine to
       Build-Engine or a new record.

  Writes only in its own scratch folder, which it removes.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$env:THORNSWOOD_HARNESS = '1'
# The fork's artifacts alone in 1 to 6: section 7 holds the package (#5152)
# with a stand-in registry, so no harness asks the real one.
$env:THORNSWOOD_ENGINE_REGISTRY = 'none'
$Here = Split-Path -Parent $PSScriptRoot
$utf8 = New-Object Text.UTF8Encoding($false)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Threw([scriptblock]$b) { try { & $b | Out-Null; return '' } catch { return $_.Exception.Message } }
function Put([string]$p, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $p))
    [IO.File]::WriteAllText($p, $text, $utf8)
}
function ShaText([string]$t) { return ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($utf8.GetBytes($t))) -replace '-', '').ToLowerInvariant() }
function ShaFile([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Same([string]$a, [string]$b) { return $a -and $b -and ([IO.Path]::GetFullPath($a).TrimEnd('\', '/') -eq [IO.Path]::GetFullPath($b).TrimEnd('\', '/')) }

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-3047-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$oldLad = $env:LOCALAPPDATA
$oldScratch = $env:THORNSWOOD_SCRATCH_ROOT
try {
    # ---- a scratch checkout: the real scripts, records made here ----------
    $repo = Join-Path $T 'repo'
    $null = New-Item -ItemType Directory -Force -Path $repo
    Copy-Item -LiteralPath (Join-Path $Here 'scripts') -Destination (Join-Path $repo 'scripts') -Recurse
    Copy-Item -LiteralPath (Join-Path $Here 'layout.json') -Destination $repo
    $env:LOCALAPPDATA = Join-Path $T 'localappdata'
    $env:THORNSWOOD_SCRATCH_ROOT = Join-Path $T 'scratch'
    $null = New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA

    $commit = '1a7b6eecdb38e09655bd5c10c5627923bd1e3cba'
    $client = [ordered]@{
        'Data\SKSE\Plugins\MpClientPlugin.dll'   = 'CLIENT-PLUGIN'
        'Data\Platform\Plugins\skymp5-client.js' = 'CLIENT-BUNDLE'
        'Data\Scripts\TESModPlatform.pex'        = 'CLIENT-PEX'
    }
    $fork = [ordered]@{
        'scam_native.node'               = 'the addon'
        'dist_back/skymp5-server.js'     = 'the javascript half'
        'dist_back/skymp5-server.js.map' = 'its map'
        'package.json'                   = '{"name":"skymp5-server"}'
        'yarn.lock'                      = '# lock'
        'launch_server.bat'              = 'node dist_back/skymp5-server.js'
        'data/scripts/ActiveMagicEffect.pex' = 'compiled papyrus'
    }
    function ClientRecordText([string]$c, [string]$at = '2026-10-21T11:00:08Z') {
        $files = [ordered]@{}
        foreach ($k in $client.Keys) { $files[$k] = [ordered]@{ sha256 = (ShaText $client[$k]); bytes = $client[$k].Length } }
        return (([ordered]@{ recordedUtc = $at; fork = 'https://github.com/ThornswoodRP/skymp'; forkBranch = 'thornswood/engine-changes'; forkCommit = $c.Substring(0, 8); files = $files }) | ConvertTo-Json -Depth 5).Replace("`r`n", "`n")
    }
    function ServerRecordText([string]$c) {
        $files = [ordered]@{}
        foreach ($k in $fork.Keys) { $files[$k] = [ordered]@{ sha256 = (ShaText $fork[$k]); bytes = $fork[$k].Length; commit = $c } }
        $src = [ordered]@{ repo = 'https://github.com/ThornswoodRP/skymp.git'; commit = $c }
        return (([ordered]@{ binary = 'scam_native.node'; sha256 = (ShaText $fork['scam_native.node']); source = $src; files = $files }) | ConvertTo-Json -Depth 5).Replace("`r`n", "`n")
    }
    # The libraries in the client file and their texts (#3099).
    $libText = "Copyright (c) 2012 - present, Victor Zverovich`nPermission is hereby granted"
    function LicenceRecordText([string]$c) {
        $ports = [ordered]@{ fmt = [ordered]@{ version = '11.2.0'; portVersion = 0; licence = 'MIT'; in = @('Data\SKSE\Plugins\MpClientPlugin.dll'); sha256 = (ShaText $libText); bytes = $libText.Length } }
        return (([ordered]@{ forkCommit = $c.Substring(0, 8); readWith = 'llvm-pdbutil'; files = [ordered]@{ 'Data\SKSE\Plugins\MpClientPlugin.dll' = @('fmt') }; ports = $ports }) | ConvertTo-Json -Depth 5).Replace("`r`n", "`n")
    }
    function Put-Licences([string]$dir, [string]$c) {
        Put (Join-Path $dir 'records\client-licences.json') (LicenceRecordText $c)
        Put (Join-Path $dir 'records\client-licences\fmt.txt') $libText
    }
    function Set-Records([string]$c) {
        Put (Join-Path $repo 'records\client-build.json') (ClientRecordText $c)
        Put (Join-Path $repo 'records\server-build.json') (ServerRecordText $c)
        Put-Licences $repo $c
    }
    Set-Records $commit

    . (Join-Path $repo 'scripts\release\EngineArtifact.ps1')

    # The fork's build as gh run download leaves thornswood-engine-<commit>:
    # fork-build.json and build\, every file in it named with its sha256,
    # size and time. -Rebuilt changes a client file's bytes (a build run again
    # in the fork is other bytes); $edit changes the folder or the manifest
    # before fork-build.json is written.
    $ForkRepo = 'ThornswoodRP/skymp'
    function New-ForkBuild([string]$dir, [long]$runId = 39588485569, [string]$c = $commit, [hashtable]$Rebuilt = @{}, [scriptblock]$edit) {
        if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force }
        $put = [ordered]@{}
        foreach ($k in $client.Keys) { $put['build/dist/client/' + ($k -replace '\\', '/')] = $(if ($Rebuilt.ContainsKey($k)) { $Rebuilt[$k] } else { $client[$k] }) }
        foreach ($k in $fork.Keys) { $put['build/dist/server/' + $k] = $fork[$k] }
        # What else the fork's build folder holds, which no record names.
        $put['build/dist/server/gamemode.js'] = 'the fork''s own gamemode'
        $put['build/dist/server/server-settings.json'] = '{}'
        $put['build/dist/server/scam_native.pdb'] = 'symbols'
        $put['build/skymp5-server/launch_server.bat.tmp'] = $fork['launch_server.bat']
        $put['build/licences/licences.json'] = '{"ports":{}}'
        $files = [ordered]@{}
        foreach ($rel in $put.Keys) {
            $pth = Join-Path $dir $rel
            Put $pth $put[$rel]
            $files[$rel] = [ordered]@{ sha256 = (ShaFile $pth); bytes = (Get-Item -LiteralPath $pth).Length; lastWriteUtc = '2026-10-21T10:40:00Z' }
        }
        $m = [ordered]@{ repository = $ForkRepo; repositoryId = 1375283516; event = 'push'; ref = 'refs/heads/thornswood/engine-changes'; commit = $c; runId = $runId; runAttempt = 1
                         runUrl = "https://github.com/$ForkRepo/actions/runs/$runId"; files = $files }
        if ($edit) { & $edit $dir $m }
        Put (Join-Path $dir 'fork-build.json') ($m | ConvertTo-Json -Depth 5)
        return $dir
    }
    # fork-build.json made to agree with the folder as it now is.
    function Restamp([string]$dir) {
        $m = [IO.File]::ReadAllText((Join-Path $dir 'fork-build.json')) | ConvertFrom-Json
        $files = [ordered]@{}
        $base = (Resolve-Path -LiteralPath $dir).ProviderPath.TrimEnd('\', '/')
        foreach ($f in @(Get-ChildItem -LiteralPath $dir -Recurse -File | Where-Object { $_.Name -ne 'fork-build.json' } | Sort-Object FullName)) {
            $files[$f.FullName.Substring($base.Length + 1).Replace('\', '/')] = [ordered]@{ sha256 = (ShaFile $f.FullName); bytes = $f.Length; lastWriteUtc = '2026-10-21T10:40:00Z' }
        }
        $m.files = $files
        Put (Join-Path $dir 'fork-build.json') ($m | ConvertTo-Json -Depth 5)
    }
    function Run-Of([long]$id, [string]$status = 'completed', [string]$conclusion = 'success') {
        return [pscustomobject]@{ id = $id; html_url = "https://github.com/$ForkRepo/actions/runs/$id"; status = $status; conclusion = $conclusion
                                  head_sha = $commit; head_branch = 'thornswood/engine-changes'; event = 'push'; repository = [pscustomobject]@{ id = 1375283516; full_name = $ForkRepo } }
    }
    function Art-Of([long]$id, [bool]$expired = $false) {
        return [pscustomobject]@{ id = $id; name = ('thornswood-engine-' + $commit); expired = $expired; digest = 'sha256:' + ('a' * 64); size_in_bytes = 34677624 }
    }
    $run = Run-Of 39588485569
    $art = Art-Of 12340888147

    # ================================================ 1. Find-EngineArtifact ==
    Write-Host ''; Write-Host '1. Find-EngineArtifact'
    # A stand-in GitHub: the fork's runs of the commit, and each run's
    # artifacts by run id.
    function Stand-In($runs, [hashtable]$arts) {
        $o = [pscustomobject]@{ Asked = New-Object Collections.Generic.List[string]; Get = $null }
        $o.Get = {
            param($path)
            $o.Asked.Add($path)
            if ($path -like "repos/$ForkRepo/actions/workflows/thornswood-pr-windows.yml/runs?head_sha=$commit*") { return [pscustomobject]@{ workflow_runs = @($runs) } }
            if ($path -match "^repos/$ForkRepo/actions/runs/(\d+)/artifacts\?name=thornswood-engine-$commit") { $a = $arts[[long]$Matches[1]]; return [pscustomobject]@{ artifacts = @($(if ($a) { $a })) } }
            throw "stand-in GitHub was asked $path"
        }.GetNewClosure()
        return $o
    }
    $f = Find-EngineArtifact $commit (Stand-In @() @{}).Get
    Yes '1. no fork build at all: none, saying a pin names a head the fork built' ($f.State -eq 'none' -and $f.Why -match 'has no build of a push of 1a7b6eec' -and $f.Why -match 'A pin names a head')
    $f = Find-EngineArtifact $commit (Stand-In @($run) @{ 39588485569 = (Art-Of 1 $true) }).Get
    Yes '1. one whose artifact is past its 90 days: none, saying the pin then needs new records' ($f.State -eq 'none' -and $f.Why -match '90 days' -and $f.Why -match 'new records')
    $f = Find-EngineArtifact $commit (Stand-In @((Run-Of 39600000000 'in_progress' '')) @{}).Get
    Yes '1. one still running: none, saying to run this again once it has finished' ($f.State -eq 'none' -and $f.Why -match 'still building' -and $f.Why -match '39600000000')
    $f = Find-EngineArtifact $commit (Stand-In @((Run-Of 39600000000 'completed' 'failure')) @{}).Get
    Yes '1. one that ended red: none, naming it' ($f.State -eq 'none' -and $f.Why -match 'ended failure')
    $newRun = Run-Of 39600000000
    $newArt = Art-Of 12350000000
    $f = Find-EngineArtifact $commit (Stand-In @($run, $newRun) @{ 39588485569 = $art; 39600000000 = $newArt }).Get
    Yes '1. two green ones: both are candidates, newest first' ($f.State -eq 'found' -and @($f.Candidates).Count -eq 2 -and [long]$f.Candidates[0].Artifact.id -eq 12350000000 -and [long]$f.Candidates[0].Run.id -eq 39600000000 -and [long]$f.Candidates[1].Run.id -eq 39588485569)
    Yes '1.   Run and Artifact are the newest, and the Why names both runs' ([long]$f.Artifact.id -eq 12350000000 -and [long]$f.Run.id -eq 39600000000 -and $f.Why -match '39600000000' -and $f.Why -match '39588485569' -and $f.Why -match 'the ones this checkout records')
    $f = Find-EngineArtifact $commit (Stand-In @($run, (Run-Of 39600000000 'completed' 'failure')) @{ 39588485569 = $art; 39600000000 = $newArt }).Get
    Yes '1. a red newer run is no candidate' ($f.State -eq 'found' -and @($f.Candidates).Count -eq 1 -and [long]$f.Run.id -eq 39588485569)
    $si = Stand-In @($run) @{ 39588485569 = $art }
    $f = Find-EngineArtifact $commit $si.Get
    Yes '1. the green push build is found, naming its run' ($f.State -eq 'found' -and $f.Why -match '39588485569')
    Yes '1.   asked of the fork''s build, for this commit, a push and the branch, never of this repository' ($si.Asked[0] -match "^repos/$ForkRepo/actions/workflows/thornswood-pr-windows\.yml/runs\?head_sha=$commit&event=push&branch=thornswood%2Fengine-changes" -and
        @($si.Asked | Where-Object { $_ -cmatch 'ThornswoodRP/Thornswood' }).Count -eq 0)
    $e = Threw { Find-EngineArtifact $commit { param($p) throw 'HTTP 401: Bad credentials' } }
    Yes '1. a GitHub that cannot be read throws, and is not "none"' ($e -match 'Bad credentials')

    # ============================================ 2. Install-EngineArtifact ==
    Write-Host ''; Write-Host '2. Install-EngineArtifact'
    $into = [string](& (Join-Path $repo 'scripts\release\Where.ps1') EngineArtifact)
    $parent = Split-Path -Parent $into
    function Left { return @(Get-ChildItem -LiteralPath $parent -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '.partial-*' }).Count }
    function Refused([string]$tag, [scriptblock]$spoil, [string]$says, $withRun = $run) {
        $a = New-ForkBuild (Join-Path $T ('fork-' + ($tag -replace '[^A-Za-z]', '')))
        & $spoil $a
        $e = Threw { Install-EngineArtifact -From $a -Repo $repo -Into $into -Run $withRun -Artifact $art }
        Yes ("2. refused: $tag" + $(if ($e) { '  (' + $e.Substring(0, [Math]::Min(150, $e.Length)) + ')' } else { '' })) (
            $e -match 'nothing was put in place' -and $e -match $says -and -not (Test-Path -LiteralPath $into) -and (Left) -eq 0)
    }
    Refused 'a client file that is not the record''s, fork-build.json made to agree' { param($a) Put (Join-Path $a 'build/dist/client/Data/Scripts/TESModPlatform.pex') 'A REBUILT PEX'; Restamp $a } 'TESModPlatform\.pex in the fork''s build is not the file records\\client-build\.json names'
    Refused 'a file fork-build.json does not name' { param($a) Put (Join-Path $a 'build/dist/client/Data/extra.dll') 'x' } 'extra\.dll is in the artifact and fork-build\.json does not name it'
    Refused 'a file fork-build.json names wrongly' { param($a) Put (Join-Path $a 'build/dist/server/scam_native.node') 'other bytes' } 'scam_native\.node is not the file fork-build\.json names'
    Refused 'a build of another commit' { param($a) $m = [IO.File]::ReadAllText((Join-Path $a 'fork-build.json')) | ConvertFrom-Json; $m.commit = 'b6c76e45' + ('0' * 32); Put (Join-Path $a 'fork-build.json') ($m | ConvertTo-Json -Depth 5) } 'fork-build\.json names commit b6c76e45'
    Refused 'a build from another run than the one asked for' { param($a) } 'fork-build\.json names run 39588485569, not 39600000000' $newRun
    Refused 'a client file the record does not name, fork-build.json made to agree' { param($a) Put (Join-Path $a 'build/dist/client/Data/extra.dll') 'x'; Restamp $a } 'records\\client-build\.json does not name it'
    Refused 'a server file that is not the record''s, fork-build.json made to agree' { param($a) Put (Join-Path $a 'build/dist/server/dist_back/skymp5-server.js') 'another bundle'; Restamp $a } 'skymp5-server\.js in the fork''s build\\dist\\server is not the build records\\server-build\.json records'
    Refused 'a server file missing, fork-build.json made to agree' { param($a) Remove-Item -LiteralPath (Join-Path $a 'build/dist/server/package.json'); Restamp $a } 'package\.json is not in the fork''s build\\dist\\server'

    Put (Join-Path $repo 'records\client-build.json') (ClientRecordText $commit).Replace("`n", "`r`n")
    Put (Join-Path $repo 'records\server-build.json') (ServerRecordText $commit).Replace("`n", "`r`n")
    $a = New-ForkBuild (Join-Path $T 'fork-good')
    $stamp = Install-EngineArtifact -From $a -Repo $repo -Into $into -Run $run -Artifact $art
    Yes '2. the right build goes in, CR LF records and all' ((Test-Path -LiteralPath $into) -and (Left) -eq 0)
    $allClient = $true
    foreach ($k in $client.Keys) { $pth = Join-Path $into ('build\dist\client\' + $k); if (-not (Test-Path -LiteralPath $pth) -or (ShaFile $pth) -ne (ShaText $client[$k])) { $allClient = $false } }
    Yes '2.   every client file is in build\dist\client, as recorded' $allClient
    $sums = Get-ThornswoodServerFolderSums (Join-Path $into 'build\dist\server')
    Yes '2.   the server files are in build\dist\server, and hold to the record' ($sums.Count -eq $fork.Count -and $sums['scam_native.node'] -eq (ShaText $fork['scam_native.node']))
    Yes '2.   and the fork''s gamemode, settings and symbols stay out' (-not (Test-Path -LiteralPath (Join-Path $into 'build\dist\server\gamemode.js')) -and -not (Test-Path -LiteralPath (Join-Path $into 'build\dist\server\server-settings.json')) -and
        -not (Test-Path -LiteralPath (Join-Path $into 'build\dist\server\scam_native.pdb')))
    $zips = @(Get-ChildItem -LiteralPath (Join-Path $into 'artifact\server') -Filter '*.zip')
    Yes '2.   the server zip the store keeps is under artifact\server, with its .json, for -ServerBuild' ($zips.Count -eq 1 -and (Test-Path -LiteralPath ([IO.Path]::ChangeExtension($zips[0].FullName, '.json'))) -and
        $zips[0].Name -eq $stamp.serverZip -and $null -ne (Test-ThornswoodServerBuildArtifact -Zip $zips[0].FullName -Record (Join-Path $repo 'records\server-build.json')))
    Yes '2.   and fork-build.json beside it' (Test-Path -LiteralPath (Join-Path $into 'artifact\fork-build.json'))
    Yes '2.   engine-artifact.json names the commit, the fork, its artifact and its run' ($stamp.commit -eq $commit -and $stamp.repository -eq $ForkRepo -and $stamp.artifact -eq ('thornswood-engine-' + $commit) -and
        [long]$stamp.runId -eq 39588485569 -and $stamp.run -match "$ForkRepo/actions/runs/39588485569" -and $stamp.serverZip -match '^server-1a7b6eecdb38-')
    $e = Threw { Install-EngineArtifact -From $a -Repo $repo -Into $into -Run $run -Artifact $art }
    Yes '2. a folder that is there already is never written into' ($e -match 'is there already')
    Yes '2. Get-EngineArtifactFolderProblems: the folder is this pin''s' (@(Get-EngineArtifactFolderProblems $into $repo).Count -eq 0)
    $sf = Join-Path $into 'engine-artifact.json'
    $keep = [IO.File]::ReadAllText($sf)
    [IO.File]::WriteAllText($sf, $keep.Replace($commit, ('b6c76e45' + ('0' * 32))), $utf8)
    Yes '2.   and one that holds another pin''s build is not' (@(Get-EngineArtifactFolderProblems $into $repo) -match 'this checkout pins').Count -gt 0
    [IO.File]::WriteAllText($sf, $keep, $utf8)
    Set-Records $commit

    # ============================================ 3. Where.ps1 and where.js ==
    Write-Host ''; Write-Host '3. Where.ps1 and where.js'
    $w = Join-Path $repo 'scripts\release\Where.ps1'
    $wj = Join-Path $repo 'scripts\release\where.js'
    function AskJs([string]$what) { $o = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; try { return ([string](& node $wj $what 2>&1)).Trim() } finally { $ErrorActionPreference = $o } }
    $machine = Join-Path $env:LOCALAPPDATA 'Thornswood'
    Yes '3. EngineArtifact is engine-ci\<pin 12> in this machine''s data' (Same (& $w EngineArtifact) (Join-Path $machine 'engine-ci\1a7b6eecdb38'))
    Yes '3.   and where.js says the same' (Same (AskJs EngineArtifact) (& $w EngineArtifact))
    Yes '3. with no record, EngineBuild is still the checkout''s engine' (Same (& $w EngineBuild) (Join-Path $repo 'engine\skymp'))
    $recFile = Join-Path $machine 'engine-build.json'
    [IO.File]::WriteAllText($recFile, '{ "ci": true }', $utf8)
    Yes '3. {"ci": true}: EngineBuild is EngineArtifact' (Same (& $w EngineBuild) (& $w EngineArtifact))
    Yes '3.   ClientDist and ServerDist are under it' ((Same (& $w ClientDist) (Join-Path $into 'build\dist\client')) -and (Same (& $w ServerDist) (Join-Path $into 'build\dist\server')))
    Yes '3.   and where.js agrees' ((Same (AskJs EngineBuild) (& $w EngineBuild)) -and (Same (AskJs ClientDist) (& $w ClientDist)))
    $moved = 'c63fe63700000000000000000000000000000000'
    Set-Records $moved
    Yes '3. a pin move is another folder, not the old one' (Same (& $w ClientDist) (Join-Path $machine 'engine-ci\c63fe6370000\build\dist\client'))
    Yes '3.   answered though it is not there yet' (-not (Test-Path -LiteralPath (& $w ClientDist)))
    Put (Join-Path $repo 'records\server-build.json') '{"binary":"scam_native.node"}'
    $e = Threw { & $w ClientDist }
    Yes '3. a server record with no commit stops with a sentence' ($e -match 'names no fork commit')
    Yes '3.   and where.js stops too' ((AskJs ClientDist) -match 'names no fork commit')
    Set-Records $commit
    Remove-Item -LiteralPath $recFile -Force

    # ==================================== 4. Get-EngineArtifact.ps1 whole ==
    Write-Host ''; Write-Host '4. Get-EngineArtifact.ps1'
    Remove-Item -LiteralPath $into -Recurse -Force
    $good = New-ForkBuild (Join-Path $T 'fork-for-gh')
    $ghState = Join-Path $T 'gh-state'
    $null = New-Item -ItemType Directory -Force -Path $ghState
    function Save-GhState($runs, [hashtable]$arts) {
        [IO.File]::WriteAllText((Join-Path $ghState 'runs.json'), (ConvertTo-Json -InputObject ([ordered]@{ workflow_runs = @($runs) }) -Depth 5), $utf8)
        foreach ($k in $arts.Keys) { [IO.File]::WriteAllText((Join-Path $ghState ('arts-' + $k + '.json')), (ConvertTo-Json -InputObject ([ordered]@{ artifacts = @($arts[$k]) }) -Depth 5), $utf8) }
    }
    Save-GhState @($run) @{ 39588485569 = $art }
    $ghFake = Join-Path $T 'gh-stand-in.ps1'
    [IO.File]::WriteAllText($ghFake, @'
$state = $env:TS_GH_STATE
[IO.File]::AppendAllText((Join-Path $state 'calls.txt'), (($args -join ' ') + "`n"))
if ($env:TS_GH_FAIL) { [Console]::Error.WriteLine('HTTP 401: Bad credentials'); exit 1 }
if ($args[0] -eq 'api' -and $args[1] -like 'repos/ThornswoodRP/skymp/actions/workflows/thornswood-pr-windows.yml/runs?*') {
  if ($env:TS_GH_NONE) { '{"workflow_runs":[]}' } else { [IO.File]::ReadAllText((Join-Path $state 'runs.json')) }
  exit 0
}
if ($args[0] -eq 'api' -and $args[1] -match '^repos/ThornswoodRP/skymp/actions/runs/(\d+)/artifacts\?') {
  $one = Join-Path $state ('arts-' + $Matches[1] + '.json')
  if (Test-Path -LiteralPath $one) { [IO.File]::ReadAllText($one) } else { '{"artifacts":[]}' }
  exit 0
}
if ($args[0] -eq 'run' -and $args[1] -eq 'download') {
  $dir = $args[[Array]::IndexOf($args, '--dir') + 1]
  $from = $env:TS_GH_ARTIFACT
  $one = Join-Path $state ('artifact-' + $args[2] + '.txt')
  if (Test-Path -LiteralPath $one) { $from = [IO.File]::ReadAllText($one).Trim() }
  Copy-Item -LiteralPath $from -Destination $dir -Recurse
  exit 0
}
[Console]::Error.WriteLine('stand-in gh was asked ' + ($args -join ' ')); exit 1
'@, $utf8)
    $env:TS_GH_STATE = $ghState; $env:TS_GH_ARTIFACT = $good
    $env:TS_GH_FAIL = ''; $env:TS_GH_NONE = ''
    $get = Join-Path $repo 'scripts\release\Get-EngineArtifact.ps1'
    $ps = (Get-Process -Id $PID).Path
    function Fetch([string[]]$more) {
        $o = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $t = & $ps -NoProfile -ExecutionPolicy Bypass -File $get -Gh $ghFake -NoPause @more 2>&1 | Out-String; return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $t } }
        finally { $ErrorActionPreference = $o }
    }
    $name = 'thornswood-engine-' + $commit
    $r = Fetch @('-Check')
    Yes ("4. -Check: on GitHub, exit 2 (exit {0})" -f $r.Code) ($r.Code -eq 2 -and $r.Out -match "keeps $name")
    Yes '4.   and nothing was fetched or written' (-not (Test-Path -LiteralPath $into) -and -not ([IO.File]::ReadAllText((Join-Path $ghState 'calls.txt')) -match 'run download'))
    $r = Fetch @()
    Yes ("4. a run fetches it and makes it the engine build (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Out -match 'every file held to the records' -and (Test-Path -LiteralPath (Join-Path $into 'build\dist\client\Data\Scripts\TESModPlatform.pex')))
    Yes '4.   it downloaded the fork''s build by its run and name, from the fork' ([IO.File]::ReadAllText((Join-Path $ghState 'calls.txt')) -match "run download 39588485569 --name $name --dir .+ --repo ThornswoodRP/skymp")
    Yes '4.   and asked this repository for nothing' (-not ([IO.File]::ReadAllText((Join-Path $ghState 'calls.txt')) -cmatch 'ThornswoodRP/Thornswood'))
    Yes '4.   and left no scratch behind' (@(Get-ChildItem -LiteralPath $env:THORNSWOOD_SCRATCH_ROOT -Force -ErrorAction SilentlyContinue).Count -eq 0)
    $r = Fetch @()
    Yes ("4. a second run finds it there and fetches nothing (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Out -match 'here already')
    Remove-Item -LiteralPath $into -Recurse -Force
    $env:TS_GH_NONE = '1'
    $r = Fetch @()
    Yes ("4. no fork build: exit 1, saying so (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Out -match 'STOP\. .*has no build of a push of 1a7b6eec' -and -not (Test-Path -LiteralPath $into))
    $env:TS_GH_NONE = ''; $env:TS_GH_FAIL = '1'
    $r = Fetch @()
    Yes ("4. a gh that fails: exit 1, naming what it said (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Out -match 'could not be asked' -and $r.Out -match 'Bad credentials')
    $env:TS_GH_FAIL = ''

    # Two green fork builds of the pin: the newer one is that build run again
    # in the fork, which is other bytes, so the records name only the older.
    $later = New-ForkBuild (Join-Path $T 'fork-later') 39600000000 -Rebuilt @{ 'Data\SKSE\Plugins\MpClientPlugin.dll' = 'CLIENT-PLUGIN, BUILT AGAIN' }
    Save-GhState @($run, $newRun) @{ 39588485569 = $art; 39600000000 = $newArt }
    [IO.File]::WriteAllText((Join-Path $ghState 'artifact-39600000000.txt'), $later, $utf8)
    [IO.File]::WriteAllText((Join-Path $ghState 'calls.txt'), '', $utf8)
    $r = Fetch @('-Check')
    Yes ("4. two kept: -Check says it is on GitHub, exit 2 (exit {0})" -f $r.Code) ($r.Code -eq 2 -and $r.Out -match "keeps 2 $name" -and -not ([IO.File]::ReadAllText((Join-Path $ghState 'calls.txt')) -match 'run download'))
    $r = Fetch @()
    $calls = @([IO.File]::ReadAllLines((Join-Path $ghState 'calls.txt')) | Where-Object { $_ -match '^run download' })
    Yes ("4. two kept, the newer other bytes: the older is taken (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Out -match 'every file held to the records' -and ([IO.File]::ReadAllText((Join-Path $into 'engine-artifact.json')) | ConvertFrom-Json).runId -eq 39588485569)
    Yes '4.   it held the newer first and said why it passed it over' ($calls.Count -eq 2 -and $calls[0] -match '^run download 39600000000 ' -and $calls[1] -match '^run download 39588485569 ' -and
        $r.Out -match "run 39600000000's $name is not the build this checkout records \(build\\dist\\client\\Data\\SKSE\\Plugins\\MpClientPlugin\.dll in the fork's build is not the file")
    Yes '4.   and left no scratch behind' (@(Get-ChildItem -LiteralPath $env:THORNSWOOD_SCRATCH_ROOT -Force -ErrorAction SilentlyContinue).Count -eq 0)
    Remove-Item -LiteralPath $into -Recurse -Force
    $alsoLater = New-ForkBuild (Join-Path $T 'fork-also-later') -Rebuilt @{ 'Data\Scripts\TESModPlatform.pex' = 'CLIENT-PEX, BUILT AGAIN' }
    [IO.File]::WriteAllText((Join-Path $ghState 'artifact-39588485569.txt'), $alsoLater, $utf8)
    $r = Fetch @()
    Yes ("4. two kept and neither the records': exit 1 naming both runs (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Out -match "STOP\. no $name the fork keeps is the build this checkout records" -and $r.Out -match 'run 39600000000: ' -and $r.Out -match 'run 39588485569: ' -and -not (Test-Path -LiteralPath $into))
    Yes '4.   and left no scratch behind' (@(Get-ChildItem -LiteralPath $env:THORNSWOOD_SCRATCH_ROOT -Force -ErrorAction SilentlyContinue).Count -eq 0)
    foreach ($x in 'arts-39600000000.json', 'artifact-39600000000.txt', 'artifact-39588485569.txt') { Remove-Item -LiteralPath (Join-Path $ghState $x) -Force }
    Save-GhState @($run) @{ 39588485569 = $art }

    # ================================================= 5. Sync-Client.ps1 ==
    Write-Host ''; Write-Host '5. Sync-Client.ps1'
    [IO.File]::WriteAllText($recFile, '{ "ci": true }', $utf8)
    $real = Join-Path $repo 'scripts\release\Get-EngineArtifact-real.ps1'
    Move-Item -LiteralPath $get -Destination $real
    [IO.File]::WriteAllText($get, @'
param([switch]$Check, [switch]$NoPause)
[IO.File]::AppendAllText($env:TS_FETCH_CALLS, "fetch`n")
if ($env:TS_FETCH_FAIL) { Write-Host 'STOP. stand-in: the fork keeps no build of 1a7b6eec.'; exit 1 }
& (Join-Path $PSScriptRoot 'Get-EngineArtifact-real.ps1') -Gh $env:TS_GH -NoPause
exit $LASTEXITCODE
'@, $utf8)
    $env:TS_GH = $ghFake
    $env:TS_FETCH_CALLS = Join-Path $T 'fetch-calls.txt'
    $env:TS_FETCH_FAIL = ''
    $sync = Join-Path $repo 'scripts\release\Sync-Client.ps1'
    $game = Join-Path $T 'ship-root\Game'
    function Sync([string[]]$more) {
        $o = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try { $t = & $ps -NoProfile -ExecutionPolicy Bypass -File $sync -Game $game -NoPause @more 2>&1 | Out-String; return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $t } }
        finally { $ErrorActionPreference = $o }
    }
    function Fetches { if (Test-Path -LiteralPath $env:TS_FETCH_CALLS) { return @([IO.File]::ReadAllLines($env:TS_FETCH_CALLS)).Count } else { return 0 } }
    $null = New-Item -ItemType Directory -Force -Path $game
    $r = Sync @('-Check')
    Yes ("5. -Check with the folder not there: exit 1, naming Get-EngineArtifact (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Out -match 'Get-EngineArtifact\.ps1 fetches')
    Yes '5.   and it fetched nothing' ((Fetches) -eq 0)
    $env:TS_FETCH_FAIL = '1'
    $r = Sync @()
    Yes ("5. a fetch that fails stops it (exit {0})" -f $r.Code) ($r.Code -eq 1 -and $r.Out -match 'could not be fetched' -and (Fetches) -eq 1 -and -not (Test-Path -LiteralPath (Join-Path $game 'Data')))
    $env:TS_FETCH_FAIL = ''
    $r = Sync @()
    $inGame = $true
    foreach ($k in $client.Keys) { $p = Join-Path $game $k; if (-not (Test-Path -LiteralPath $p) -or (ShaFile $p) -ne (ShaText $client[$k])) { $inGame = $false } }
    Yes ("5. without -Check it fetches CI's build and copies the client in (exit {0})" -f $r.Code) ($r.Code -eq 0 -and (Fetches) -eq 2 -and $inGame -and (Test-Path -LiteralPath $into))
    Remove-Item -LiteralPath $into -Recurse -Force
    $r = Sync @()
    Yes ("5. a game folder that holds the client fetches nothing (exit {0})" -f $r.Code) ($r.Code -eq 0 -and (Fetches) -eq 2)
    Remove-Item -LiteralPath (Join-Path $game 'Data') -Recurse -Force
    $r = Sync @('-Dist', (Join-Path $T 'someone-elses-build'))
    Yes ("5. another -Dist is never filled from GitHub (exit {0})" -f $r.Code) ($r.Code -eq 1 -and (Fetches) -eq 2 -and $r.Out -match 'Setup-ShipMachine\.ps1 -EngineBuild ci')
    $stale = Join-Path $T 'stale-build'
    foreach ($k in $client.Keys) { Put (Join-Path $stale $k) ('REBUILT ' + $client[$k]) }
    $r = Sync @('-Dist', $stale)
    Yes ("5. a build that is not the record names CI's build, not a rebuild (exit {0})" -f $r.Code) (
        $r.Code -eq 1 -and $r.Out -match 'Setup-ShipMachine\.ps1 -EngineBuild ci' -and $r.Out -notmatch 'Rebuild, then' -and $r.Out -notmatch 'New-ClientBuildRecord\.ps1, then')
    Remove-Item -LiteralPath $get -Force
    Move-Item -LiteralPath $real -Destination $get
    Remove-Item -LiteralPath $recFile -Force

    # ============================== 6. Setup-ShipMachine and Check-ShipReady ==
    Write-Host ''; Write-Host '6. Setup-ShipMachine.ps1 and Check-ShipReady.ps1'
    $setup = Join-Path $Here 'scripts\release\Setup-ShipMachine.ps1'
    $ready = Join-Path $Here 'scripts\release\Check-ShipReady.ps1'
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($setup, [ref]$null, [ref]$null)
    foreach ($n in 'Save-EngineBuild', 'Test-EngineBuildIsCi') {
        $fn = $ast.Find({ param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n }.GetNewClosure(), $true)
        Yes ("6. Setup-ShipMachine.ps1 has $n") ([bool]$fn)
        if ($fn) { . ([scriptblock]::Create($fn.Extent.Text)) }
    }
    $rf = Join-Path $T 'setup\engine-build.json'
    Yes '6. Save-EngineBuild ci writes {"ci": true}, with no folder asked for' (-not (Save-EngineBuild $rf 'ci') -and ([IO.File]::ReadAllText($rf) | ConvertFrom-Json).ci -eq $true)
    Yes '6.   and Test-EngineBuildIsCi reads it' (Test-EngineBuildIsCi $rf)
    $why = Save-EngineBuild $rf (Join-Path $T 'no-such-fork')
    Yes '6. a fork folder with no build is refused, naming -EngineBuild ci' ($why -match '-EngineBuild ci' -and (Test-EngineBuildIsCi $rf))
    # No fix offers -Rebuild, and since #3056 the switch itself is gone: the
    # guide no longer names it, and a build made on the machine never matches
    # a record CI made.
    $offered = @()
    $tokens = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($setup, [ref]$tokens, [ref]$null)
    foreach ($tok in $tokens) { if ($tok.Kind -in 'StringLiteral', 'StringExpandable' -and $tok.Text -match 'Setup-ShipMachine\.ps1 -Rebuild') { $offered += $tok.Extent.StartLineNumber } }
    Yes ('6. no fix in Setup-ShipMachine.ps1 offers -Rebuild' + $(if ($offered.Count) { ': line ' + ($offered -join ', ') } else { '' })) ($offered.Count -eq 0)
    $setupAst = [System.Management.Automation.Language.Parser]::ParseFile($setup, [ref]$null, [ref]$null)
    Yes '6. Setup-ShipMachine.ps1 has no -Rebuild switch (#3056)' (-not ($setupAst.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'Rebuild' }))

    $ast = [System.Management.Automation.Language.Parser]::ParseFile($ready, [ref]$null, [ref]$null)
    foreach ($n in 'New-Row', 'Get-ClientRows') {
        $fn = $ast.Find({ param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n }.GetNewClosure(), $true)
        if ($fn) { . ([scriptblock]::Create($fn.Extent.Text)) }
    }
    $null = New-Item -ItemType Directory -Force -Path $game
    $cliRec = Join-Path $repo 'records\client-build.json'
    $missing = Join-Path $T 'not-fetched\build\dist\client'
    function Row($ci) { return @(Get-ClientRows $sync $cliRec $game $missing $ci | Where-Object { $_.What -like 'the recorded client*' })[0] }
    $r = Row ([pscustomobject]@{ Code = 2; Said = '' })
    Yes '6. Check-ShipReady: CI''s build GitHub keeps passes before the Ship fetches it' ($r.Ok -and $r.Detail -match 'the Ship fetches it first')
    $r = Row ([pscustomobject]@{ Code = 1; Said = 'the fork''s thornswood-pr-windows.yml has no build of a push of 1a7b6eec' })
    Yes '6.   one it cannot have fails as a need, saying why' (-not $r.Ok -and $r.Level -eq 'need' -and $r.Detail -match 'cannot be fetched: the fork''s thornswood-pr-windows\.yml has no build' -and $r.Fix -match 'Get-EngineArtifact\.ps1')
    $r = Row $null
    Yes '6.   with no CI build asked about, the fix names -EngineBuild ci and no rebuild' (-not $r.Ok -and $r.Fix -match 'Setup-ShipMachine\.ps1 -EngineBuild ci' -and $r.Fix -notmatch 'Build-Engine')

    # No fix a Ship machine reads sends it to a rebuild or a new record.
    $sent = @()
    foreach ($n in 'Check-ShipReady.ps1', 'Sync-Client.ps1', 'Setup-ShipMachine.ps1', 'Update-ShipRoot.ps1', 'Ship.ps1', 'Where.ps1') {
        $tokens = $null
        [void][System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Here ('scripts\release\' + $n)), [ref]$tokens, [ref]$null)
        foreach ($tok in $tokens) {
            if ($tok.Kind -in 'StringLiteral', 'StringExpandable' -and ($tok.Text -match '(?i)build the fork with|build it there|Rebuild, then|Rebuild the client|Build-Engine\.ps1 -Fork built')) { $sent += ('{0}:{1}' -f $n, $tok.Extent.StartLineNumber) }
        }
    }
    Yes ('6. no fix in the scripts a Ship machine reads sends it to build the engine' + $(if ($sent.Count) { ': ' + ($sent -join ', ') } else { '' })) ($sent.Count -eq 0)

    # ============================== 7. The fork's package of the build (#5152) ==
    Write-Host ''; Write-Host '7. the fork''s package'
    if (Test-Path -LiteralPath $into) { Remove-Item -LiteralPath $into -Recurse -Force }
    $pk = New-ForkBuild (Join-Path $T 'fork-for-package')
    $pkZip = Join-Path $T 'package.zip'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($pk, $pkZip)
    $zipSum = ShaFile $pkZip
    # The package is under thornswoodrp, where builds go since the fork moved
    # there (#5184), unless -Ns says evilpatrick06, where older ones stay.
    function New-Registry([hashtable]$over = @{}, [string]$Ns = 'thornswoodrp') {
        $m = [ordered]@{
            schemaVersion = 2; mediaType = 'application/vnd.oci.image.manifest.v1+json'
            layers = @([ordered]@{ mediaType = 'application/zip'; digest = "sha256:$zipSum"; size = (Get-Item -LiteralPath $pkZip).Length })
            annotations = [ordered]@{ 'org.opencontainers.image.revision' = $commit; 'org.thornswood.fork-build.sha256' = (ShaFile (Join-Path $pk 'fork-build.json')) }
        }
        foreach ($k in $over.Keys) { & $over[$k] $m }
        $asked = New-Object System.Collections.Generic.List[string]
        $script:asked = $asked
        $mText = $m | ConvertTo-Json -Depth 6
        $zipPath = $pkZip
        $sum = $zipSum
        return {
            param([string]$Url, [hashtable]$Headers, [string]$File)
            $asked.Add($Url + ' ' + [string]$Headers['Authorization'])
            # As ghcr.io: no anonymous token for a package it has no public
            # copy of (#5184).
            if ($Url -like 'https://reg.test/token?*') {
                if ($Url -notlike "*scope=repository:$Ns/thornswood-engine:pull*") { [IO.File]::WriteAllText($File, '{"errors":[{"code":"DENIED"}]}'); return 403 }
                [IO.File]::WriteAllText($File, '{"token":"anon"}'); return 200
            }
            if ($Url -eq "https://reg.test/v2/$Ns/thornswood-engine/manifests/$commit") { if ($over.ContainsKey('gone')) { return 404 }; [IO.File]::WriteAllText($File, $mText); return 200 }
            if ($Url -eq "https://reg.test/v2/$Ns/thornswood-engine/blobs/sha256:$sum") { Copy-Item -LiteralPath $zipPath -Destination $File; return 200 }
            return 404
        }.GetNewClosure()
    }
    $http = New-Registry
    $l = Get-EnginePackageBuild -Commit $commit -Registry 'https://reg.test' -Http $http -Look
    Yes '7. -Look finds the package by the full commit, and fetches nothing' ($l.State -eq 'found' -and $l.Artifact.name -eq "reg.test/thornswoodrp/thornswood-engine:$commit" -and @($script:asked | Where-Object { $_ -like '*/blobs/*' }).Count -eq 0)
    $dl = Join-Path $T 'package-out'
    $p = Get-EnginePackageBuild -Commit $commit -Registry 'https://reg.test' -Http $http -Into $dl
    Yes '7. the build comes out of it with its run from fork-build.json' ($p.State -eq 'found' -and $p.Run.id -eq 39588485569 -and (Test-Path -LiteralPath (Join-Path $dl 'fork-build.json')))
    Yes '7.   every manifest and blob was asked with the pull token' (@($script:asked | Where-Object { $_ -match '/(manifests|blobs)/' }).Count -eq 3 -and @($script:asked | Where-Object { $_ -match '/(manifests|blobs)/' -and $_ -notmatch 'Bearer anon$' }).Count -eq 0)
    Yes '7.   and it is the build the records name' (@(Get-EngineArtifactProblems $dl $repo ([long]$p.Run.id)).Count -eq 0)
    $stamp = Install-EngineArtifact -From $dl -Repo $repo -Into $into -Run $p.Run -Artifact $p.Artifact
    Yes '7. installed, engine-artifact.json names the package and its digest' ($stamp.artifact -like '*thornswood-engine:*' -and $stamp.digest -eq "sha256:$zipSum" -and $stamp.runId -eq 39588485569)
    Remove-Item -LiteralPath $into -Recurse -Force

    $old = Get-EnginePackageBuild -Commit $commit -Registry 'https://reg.test' -Http (New-Registry -Ns 'evilpatrick06') -Look
    Yes '7. a build from before the fork moved is found under evilpatrick06, asked after thornswoodrp, whose refused token is no package there (#5184)' ($old.State -eq 'found' -and $old.Artifact.name -eq "reg.test/evilpatrick06/thornswood-engine:$commit" -and
        @($script:asked | Where-Object { $_ -like '*/token?*' })[0] -match 'repository:thornswoodrp/' -and @($script:asked | Where-Object { $_ -like '*/token?*' })[1] -match 'repository:evilpatrick06/' -and
        @($script:asked | Where-Object { $_ -match '/manifests/' }).Count -eq 1 -and @($script:asked | Where-Object { $_ -match '/manifests/' })[0] -match '/v2/evilpatrick06/')
    $none = Get-EnginePackageBuild -Commit $commit -Registry 'https://reg.test' -Http (New-Registry -Ns 'someone-else') -Look
    Yes '7. a package neither owner lets anyone read: none, naming both refusals' ($none.State -eq 'none' -and $none.Why -match 'no package thornswoodrp/thornswood-engine that can be read without an account \(HTTP 403' -and $none.Why -match 'evilpatrick06/thornswood-engine')
    $e = Threw { Get-EnginePackageBuild -Commit $commit -Registry 'https://reg.test' -Http { param($u, $h, $f) return 500 } -Look }
    Yes '7. any other refusal of the token still throws' ($e -match 'gave no pull token for thornswoodrp/thornswood-engine \(HTTP 500\)')
    $g = Get-EnginePackageBuild -Commit $commit -Registry 'https://reg.test' -Http (New-Registry @{ gone = { param($m) } }) -Look
    Yes '7. no package (a pin from before fork #131): none, saying so' ($g.State -eq 'none' -and $g.Why -match 'keeps no package')
    $e = Threw { Get-EnginePackageBuild -Commit $commit -Registry 'https://reg.test' -Http (New-Registry @{ rev = { param($m) $m.annotations['org.opencontainers.image.revision'] = ('e' * 40) } }) -Look }
    Yes '7. a manifest of another commit throws' ($e -match 'names another commit')
    $e = Threw { Get-EnginePackageBuild -Commit $commit -Registry 'https://reg.test' -Http (New-Registry @{ sum = { param($m) $m.layers[0].size = 1 } }) -Into (Join-Path $T 'package-bad1') }
    Yes '7. a blob that is not the manifest''s zip throws, and nothing is unpacked' ($e -match 'not the zip its manifest names' -and -not (Test-Path -LiteralPath (Join-Path $T 'package-bad1')))
    $e = Threw { Get-EnginePackageBuild -Commit $commit -Registry 'https://reg.test' -Http (New-Registry @{ fb = { param($m) $m.annotations['org.thornswood.fork-build.sha256'] = ('0' * 64) } }) -Into (Join-Path $T 'package-bad2') }
    Yes '7. a fork-build.json the manifest does not name throws' ($e -match 'not the one its manifest names')
    $e = Threw { Get-EnginePackageBuild -Commit $commit -Registry 'https://reg.test' -Http { param($u, $h, $f) throw 'connection refused' } -Look }
    Yes '7. a registry that cannot be reached throws, and is not "none"' ($e -match 'connection refused')
    $ga = [IO.File]::ReadAllText((Join-Path $Here 'scripts\release\Get-EngineArtifact.ps1'))
    Yes '7. Get-EngineArtifact.ps1 asks the package before the artifacts, and holds it to the records' ($ga.IndexOf('Get-EnginePackageBuild') -gt 0 -and $ga.IndexOf('Get-EnginePackageBuild') -lt $ga.IndexOf('Find-EngineArtifact $commit') -and $ga -match 'Get-EngineArtifactProblems \$dl \$RepoDir \(\[long\]\$p\.Run\.id\)')
}
finally {
    $env:LOCALAPPDATA = $oldLad
    $env:THORNSWOOD_SCRATCH_ROOT = $oldScratch
    foreach ($v in 'TS_GH_STATE', 'TS_GH_ARTIFACT', 'TS_GH_FAIL', 'TS_GH_NONE', 'TS_GH', 'TS_FETCH_CALLS', 'TS_FETCH_FAIL') { Remove-Item -LiteralPath ('Env:' + $v) -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
