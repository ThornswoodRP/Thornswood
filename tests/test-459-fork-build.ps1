<#
  test-459-fork-build.ps1

      pwsh -NoProfile -File .\tests\test-459-fork-build.ps1

  The fork's own build of the engine, taken by engine.yml (#459, Patrick's B
  of 16 Oct): scripts\release\ForkEngineBuild.ps1, and -BuiltBy in
  New-ServerBuildRecord.ps1 and New-ClientBuildRecord.ps1.

  WHY. engine.yml records the fork's build, and only when that build is the
  one asked for; it compiles nothing (#3014, #3399), so with no fork build
  it stops. A Ship machine holds the same build with the same checks
  (Get-ForkEngineBuildProblems, EngineArtifact.ps1). Each of those is a line
  a later edit could change with nothing else going red:
    1. Find-ForkEngineBuild, against a stand-in GitHub: no build, a build of
       another branch, event, repository or commit (none, all four, saying
       nothing is compiled in its place); a green push build with its
       artifact (found, the newest such); one whose artifact is gone (none);
       one still running (stop); one red (stop); and a lookup that fails
       throws rather than saying there is none.
    2. Expand-ForkEngineBuild, on artifacts made here: the right one goes
       into the fork's build folder with fork-build.json's times, to the tick
       and in UTC whatever the zip says; and each of these is refused with
       nothing put in the fork: a download whose sha256 is not GitHub's
       digest, another commit, another run, a pull request's build, a file
       that is not the one named, a file named and missing, a file not
       named, a path outside build/, a time with no zone, a build with no
       build/licences/licences.json (#3099), and a fork whose build folder is
       there already. Get-ForkEngineBuildProblems on a folder unpacked by
       hand (as gh run download leaves one) finds the same: none for the
       right one, the sentence for a wrong one.
    3. -BuiltBy, on a made up fork whose files were written after the build
       (as a checkout made after it is): both records are written and hold
       the build to the commit's time, not the checkout's dates; without it
       the same build warns that its sources are newer; and a build written
       before the commit was made is refused by both.

  Writes only under a temp folder, which it removes. Needs git; part 3 also
  node and yarn (it skips that part, saying so, without them). Connects to
  nothing.
#>
[CmdletBinding()]
param()
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$root = Split-Path -Parent $Here
. (Join-Path $root 'scripts\release\ForkEngineBuild.ps1')
Add-Type -AssemblyName System.IO.Compression.FileSystem

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Threw([scriptblock]$b) { try { & $b; return '' } catch { return [string]$_.Exception.Message } }

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-forkbuild-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $T
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$p, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $p))
    [IO.File]::WriteAllText($p, $text, $utf8)
}

$C = 'a' * 40
$name = Get-ForkEngineArtifactName $C
try {
    # ---- 1. which build ------------------------------------------------------
    Write-Host ''; Write-Host 'Find-ForkEngineBuild'
    function Run-Of([long]$id, [string]$status, [string]$conclusion, [string]$sha = $C, [string]$branch = 'thornswood/engine-changes', [string]$event = 'push', [string]$repo = 'ThornswoodRP/skymp', [long]$repoId = 1375283516) {
        return [pscustomobject]@{ id = $id; status = $status; conclusion = $conclusion; head_sha = $sha; head_branch = $branch; event = $event
                                  repository = [pscustomobject]@{ id = $repoId; full_name = $repo }; html_url = "https://github.com/ThornswoodRP/skymp/actions/runs/$id" }
    }
    function Art([long]$id, [bool]$expired = $false, [string]$n = $name) {
        return [pscustomobject]@{ id = $id; name = $n; expired = $expired; archive_download_url = "https://api.github.com/x/$id/zip"; digest = 'sha256:' + ('0' * 64) }
    }
    # A stand-in GitHub: the runs, and each run's artifacts by run id.
    function Stand-In($runs, [hashtable]$arts) {
        $asked = New-Object System.Collections.Generic.List[string]
        $get = {
            param($path)
            $asked.Add($path)
            if ($path -match '/actions/workflows/') { return [pscustomobject]@{ workflow_runs = @($runs) } }
            if ($path -match '/actions/runs/(\d+)/artifacts') { $a = $arts[[int]$Matches[1]]; return [pscustomobject]@{ artifacts = @($(if ($a) { $a })) } }
            throw "nothing at $path"
        }.GetNewClosure()
        return @{ Get = $get; Asked = $asked }
    }

    $s = Stand-In @() @{}
    $f = Find-ForkEngineBuild $C $s.Get
    Yes 'no fork build at all: none, and nothing is built in its place' ($f.State -eq 'none' -and $f.Why -match 'has no build' -and $f.Why -match 'no build of it to record' -and $f.Why -notmatch 'builds it')
    Yes '  the runs are asked of the fork''s workflow, for this commit, a push, and the branch' ($s.Asked[0] -match '^repos/ThornswoodRP/skymp/actions/workflows/thornswood-pr-windows\.yml/runs\?' -and
        $s.Asked[0] -match "head_sha=$C" -and $s.Asked[0] -match 'event=push' -and $s.Asked[0] -match 'branch=thornswood%2Fengine-changes')

    $s = Stand-In @((Run-Of 9 'completed' 'success' -branch 'thornswood/1649-x'), (Run-Of 8 'completed' 'success' -event 'pull_request'),
                    (Run-Of 7 'completed' 'success' -repo 'someone/skymp' -repoId 99), (Run-Of 6 'completed' 'success' -sha ('b' * 40))) @{ 9 = (Art 90); 8 = (Art 80); 7 = (Art 70); 6 = (Art 60) }
    $f = Find-ForkEngineBuild $C $s.Get
    Yes 'a build of another branch, event, repository or commit is not taken, whatever the query gave' ($f.State -eq 'none' -and $s.Asked.Count -eq 1)

    $s = Stand-In @((Run-Of 14 'completed' 'success' -repo 'Thornswood/skymp'), (Run-Of 15 'completed' 'success' -repo 'ThornswoodRP/skymp' -repoId 99)) @{ 14 = (Art 140); 15 = (Art 150) }
    $f = Find-ForkEngineBuild $C $s.Get
    Yes 'a run is the fork''s by its id, so one under the fork''s new owner is taken and another repository under its old name is not (#5184)' ($f.State -eq 'found' -and $f.Run.id -eq 14)

    $s = Stand-In @((Run-Of 10 'completed' 'success'), (Run-Of 12 'completed' 'success'), (Run-Of 11 'completed' 'failure')) @{ 10 = (Art 100); 12 = (Art 120) }
    $f = Find-ForkEngineBuild $C $s.Get
    Yes 'a green push build with its artifact is found, the newest such' ($f.State -eq 'found' -and $f.Run.id -eq 12 -and $f.Artifact.id -eq 120)
    Yes '  its artifact is asked for by name' ($s.Asked[1] -eq "repos/ThornswoodRP/skymp/actions/runs/12/artifacts?name=$name&per_page=100")

    $s = Stand-In @((Run-Of 13 'completed' 'success')) @{ 13 = (Art 130 $true) }
    $f = Find-ForkEngineBuild $C $s.Get
    Yes 'a green build whose artifact is gone (expired, or from before the fork kept one): none, saying to run that build again in the fork' ($f.State -eq 'none' -and $f.Why -match '90 days' -and $f.Why -match 'Run that build again in the fork')
    $s = Stand-In @((Run-Of 14 'completed' 'success')) @{ 14 = (Art 140 $false 'server-dist') }
    Yes '  and one that kept only other artifacts: none' ((Find-ForkEngineBuild $C $s.Get).State -eq 'none')

    $s = Stand-In @((Run-Of 15 'in_progress' ''), (Run-Of 14 'completed' 'failure')) @{}
    $f = Find-ForkEngineBuild $C $s.Get
    Yes 'a fork build still running: stop, naming it' ($f.State -eq 'stop' -and $f.Why -match 'still building' -and $f.Why -match 'runs/15')
    $s = Stand-In @((Run-Of 16 'queued' ''), (Run-Of 13 'completed' 'success')) @{ 13 = (Art 130) }
    Yes '  but a green build with its artifact is taken even while a newer one runs' ((Find-ForkEngineBuild $C $s.Get).State -eq 'found')

    $s = Stand-In @((Run-Of 17 'completed' 'failure')) @{}
    $f = Find-ForkEngineBuild $C $s.Get
    Yes 'a fork build that ended red: stop, naming it and how it ended' ($f.State -eq 'stop' -and $f.Why -match 'ended failure' -and $f.Why -match 'runs/17')

    $bad = { param($path) throw 'Response status code does not indicate success: 401 (Unauthorized).' }
    $e = Threw { Find-ForkEngineBuild $C $bad }
    Yes 'a lookup that fails throws, and is never taken for a fork with no build' ($e -match '401')

    # ---- 2. the build put in the fork --------------------------------------------
    Write-Host ''; Write-Host 'Expand-ForkEngineBuild'
    $times = @{ 'build/dist/server/scam_native.node' = '2026-10-16T13:07:48.1234567Z'; 'build/dist/server/dist_back/skymp5-server.js' = '2026-10-16T12:56:56.0000000Z'
                'build/dist/client/Data/Platform/Plugins/skymp5-client.js' = '2026-10-16T12:50:00.5000000Z'; 'build/skymp5-server/launch_server.bat.tmp' = '2026-10-16T12:40:00.0000000Z'
                'build/licences/licences.json' = '2026-10-16T13:08:00.0000000Z'; 'build/licences/zlib.txt' = '2026-10-16T13:08:00.0000000Z' }
    # An artifact as the fork's build keeps it; $edit changes the folder or
    # the manifest before it is zipped. Returns @{ Zip; Digest }.
    function New-Artifact([string]$tag, [scriptblock]$edit) {
        $dir = Join-Path $T ('art-' + $tag)
        $files = [ordered]@{}
        foreach ($rel in @($times.Keys | Sort-Object)) {
            Put (Join-Path $dir $rel) ('the bytes of ' + $rel)
            $p = Join-Path $dir $rel
            $files[$rel] = [ordered]@{ sha256 = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = (Get-Item -LiteralPath $p).Length; lastWriteUtc = $times[$rel] }
        }
        $m = [ordered]@{ repository = 'ThornswoodRP/skymp'; repositoryId = 1375283516; event = 'push'; ref = 'refs/heads/thornswood/engine-changes'; commit = $C; runId = 42; runAttempt = 1
                         runUrl = 'https://github.com/ThornswoodRP/skymp/actions/runs/42'; files = $files }
        if ($edit) { & $edit $dir $m }
        Put (Join-Path $dir 'fork-build.json') ($m | ConvertTo-Json -Depth 5)
        $zip = Join-Path $T ('art-' + $tag + '.zip')
        [IO.Compression.ZipFile]::CreateFromDirectory($dir, $zip)
        return @{ Zip = $zip; Digest = 'sha256:' + (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() }
    }
    function New-Fork([string]$tag) { $f = Join-Path $T ('fork-' + $tag); $null = New-Item -ItemType Directory -Force -Path $f; return $f }
    function Try-Expand($a, [string]$tag, [string]$commit = $C, [long]$run = 42, [string]$digest = $null) {
        $fork = New-Fork $tag
        if ($null -eq $digest) { $digest = $a.Digest }
        $e = Threw { $null = Expand-ForkEngineBuild -Zip $a.Zip -Commit $commit -RunId $run -Digest $digest -Fork $fork -Scratch (Join-Path $T ('x-' + $tag)) }
        return @{ Error = $e; Fork = $fork; Put = (Test-Path -LiteralPath (Join-Path $fork 'build')) }
    }

    $good = New-Artifact 'good' $null
    $fork = New-Fork 'good'
    $m = Expand-ForkEngineBuild -Zip $good.Zip -Commit $C -RunId 42 -Digest $good.Digest -Fork $fork -Scratch (Join-Path $T 'x-good')
    $all = $true; $timesOk = $true
    foreach ($rel in $times.Keys) {
        $p = Join-Path $fork $rel
        if (-not (Test-Path -LiteralPath $p)) { $all = $false; continue }
        $want = [DateTime]::Parse($times[$rel], [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal)
        if ((Get-Item -LiteralPath $p).LastWriteTimeUtc.Ticks -ne $want.Ticks) { $timesOk = $false; Write-Host "  $rel is $((Get-Item -LiteralPath $p).LastWriteTimeUtc.ToString('o')), not $($want.ToString('o'))" }
    }
    Yes 'the fork''s build goes into the fork''s build folder, every file at its path' ($all -and [string]$m.commit -eq $C)
    Yes '  each with the time fork-build.json gives, to the tick, in UTC' $timesOk
    Yes '  and fork-build.json stays out of the fork' (-not (Test-Path -LiteralPath (Join-Path $fork 'fork-build.json')))

    $r = Try-Expand $good 'digest' -digest ('sha256:' + ('f' * 64))
    Yes 'a download that is not the artifact GitHub keeps (its digest) is refused, nothing put in' ($r.Error -match 'not the one GitHub keeps' -and -not $r.Put)
    $r = Try-Expand $good 'nodigest' -digest ''
    Yes '  with no digest from GitHub, the rest is still held, and the right build goes in' (-not $r.Error -and $r.Put)
    $r = Try-Expand $good 'commit' -commit ('b' * 40)
    Yes 'a build of another commit is refused' ($r.Error -match 'names commit' -and -not $r.Put)
    $r = Try-Expand $good 'run' -run 43
    Yes 'a build from another run is refused' ($r.Error -match 'names run 42, not 43' -and -not $r.Put)
    $a = New-Artifact 'old' { param($d, $m) $m.repository = 'EvilPatrick06/skymp'; $m.Remove('repositoryId') }
    $r = Try-Expand $a 'old'
    Yes 'a build from before the fork wrote its id, under its old name, is taken (#5184)' (-not $r.Error -and $r.Put)
    $a = New-Artifact 'otherid' { param($d, $m) $m['repositoryId'] = 99 }
    $r = Try-Expand $a 'otherid'
    Yes '  one that names another repository''s id is refused, whatever name it gives' ($r.Error -match 'names repository id 99' -and -not $r.Put)
    $a = New-Artifact 'noid' { param($d, $m) $m.Remove('repositoryId') }
    $r = Try-Expand $a 'noid'
    Yes '  one with no id is held to the name the fork had before builds named it, EvilPatrick06/skymp' ($r.Error -match 'and no id, not EvilPatrick06/skymp' -and -not $r.Put)
    $a = New-Artifact 'pr' { param($d, $m) $m.event = 'pull_request'; $m.ref = 'refs/pull/79/merge' }
    $r = Try-Expand $a 'pr'
    Yes 'a pull request''s build is refused: only a push to thornswood/engine-changes' ($r.Error -match 'not a push to thornswood/engine-changes' -and -not $r.Put)
    $a = New-Artifact 'tamper' { param($d, $m) Put (Join-Path $d 'build/dist/server/scam_native.node') 'other bytes' }
    $r = Try-Expand $a 'tamper'
    Yes 'a file that is not the one fork-build.json names is refused' ($r.Error -match 'scam_native\.node is not the file' -and -not $r.Put)
    $a = New-Artifact 'missing' { param($d, $m) Remove-Item -LiteralPath (Join-Path $d 'build/dist/server/dist_back/skymp5-server.js') }
    $r = Try-Expand $a 'missing'
    Yes 'a file named and not in the artifact is refused' ($r.Error -match 'skymp5-server\.js is in fork-build\.json and not in the artifact' -and -not $r.Put)
    $a = New-Artifact 'extra' { param($d, $m) Put (Join-Path $d 'build/dist/server/second.node') 'a second addon' }
    $r = Try-Expand $a 'extra'
    Yes 'a file in the artifact that fork-build.json does not name is refused' ($r.Error -match 'second\.node is in the artifact and fork-build\.json does not name it' -and -not $r.Put)
    $a = New-Artifact 'outside' { param($d, $m) Put (Join-Path $d 'tools/x.ps1') 'x'; $m.files['tools/x.ps1'] = [ordered]@{ sha256 = (Get-FileHash -LiteralPath (Join-Path $d 'tools/x.ps1') -Algorithm SHA256).Hash.ToLowerInvariant(); bytes = 1; lastWriteUtc = '2026-10-16T00:00:00Z' } }
    $r = Try-Expand $a 'outside'
    Yes 'a path outside build/ is refused' ($r.Error -match 'tools/x\.ps1, which is not a path under build/' -and -not $r.Put)
    $a = New-Artifact 'zone' { param($d, $m) $m.files['build/dist/server/scam_native.node'].lastWriteUtc = '2026-10-16T13:07:48' }
    $r = Try-Expand $a 'zone'
    Yes 'a time with no zone is refused, never read as this machine''s' ($r.Error -match 'has no zone' -and -not $r.Put)
    $a = New-Artifact 'nobin' { param($d, $m) Remove-Item -LiteralPath (Join-Path $d 'build/skymp5-server/launch_server.bat.tmp'); $m.files.Remove('build/skymp5-server/launch_server.bat.tmp') }
    $r = Try-Expand $a 'nobin'
    Yes 'a build with no launch_server.bat.tmp (the record holds launch_server.bat to it) is refused' ($r.Error -match 'does not name build/skymp5-server/launch_server\.bat\.tmp' -and -not $r.Put)
    $a = New-Artifact 'nolicences' { param($d, $m) Remove-Item -LiteralPath (Join-Path $d 'build/licences') -Recurse; $m.files.Remove('build/licences/licences.json'); $m.files.Remove('build/licences/zlib.txt') }
    $r = Try-Expand $a 'nolicences'
    Yes 'a build that did not measure its client files'' libraries (no build/licences/licences.json, #3099) is refused' ($r.Error -match 'does not name build/licences/licences\.json' -and -not $r.Put)
    $fork = New-Fork 'there'
    Put (Join-Path $fork 'build\CMakeCache.txt') 'another build'
    $e = Threw { $null = Expand-ForkEngineBuild -Zip $good.Zip -Commit $C -RunId 42 -Digest $good.Digest -Fork $fork -Scratch (Join-Path $T 'x-there') }
    Yes 'a fork with a build folder already is refused, so two builds are never mixed' ($e -match 'there already' -and -not (Test-Path -LiteralPath (Join-Path $fork 'build\dist')))

    # The same holding on a folder unpacked by hand, as gh run download leaves
    # one for a Ship machine (EngineArtifact.ps1, #3399).
    $held = Get-ForkEngineBuildProblems (Join-Path $T 'art-good') $C 42
    Yes 'Get-ForkEngineBuildProblems: an unpacked folder of the right build has none, and gives fork-build.json' ($held.Why.Count -eq 0 -and [string]$held.Manifest.commit -eq $C)
    $held = Get-ForkEngineBuildProblems (Join-Path $T 'art-tamper') $C 42
    Yes '  one with a file that is not the one named says so' ($held.Why.Count -ge 1 -and ($held.Why -join ' ') -match 'scam_native\.node is not the file')
    $held = Get-ForkEngineBuildProblems (Join-Path $T 'art-good') $C 43
    Yes '  and one of another run says so' (($held.Why -join ' ') -match 'names run 42, not 43')
    $bare = Join-Path $T 'bare'; $null = New-Item -ItemType Directory -Force -Path $bare
    $held = Get-ForkEngineBuildProblems $bare $C 42
    Yes '  and a folder with no fork-build.json has no manifest, saying so' ($null -eq $held.Manifest -and ($held.Why -join ' ') -match 'no fork-build\.json')

    # ---- 3. -BuiltBy in the two record scripts ----------------------------------
    Write-Host ''; Write-Host '-BuiltBy'
    $tools = @('node', 'yarn', 'git' | Where-Object { -not (Get-Command $_ -ErrorAction SilentlyContinue) })
    if ($tools.Count) { Write-Host ('SKIP  part 3: {0} not on this machine' -f ($tools -join ', ')) }
    else {
        $shell = (Get-Process -Id $PID).Path
        function Run-Script([string]$script, [string[]]$a) {
            $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
            try { $o = @(& $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $root $script) @a 2>&1 | ForEach-Object { "$_" }); return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($o -join "`n") } }
            finally { $ErrorActionPreference = $eap }
        }
        function G { $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; $o = & git -c user.name=t -c user.email=t@t -c init.defaultBranch=main -c core.autocrlf=false @args 2>&1; $ErrorActionPreference = $eap; if ($LASTEXITCODE) { throw "git $($args -join ' '): $o" }; ($o | Out-String).Trim() }
        # A fork committed at a known time, then "checked out": every source
        # written now, after the build below.
        $fk = Join-Path $T 'fork'
        $ts = "export const hello = 'from the fork';`n"
        Put (Join-Path $fk 'skymp5-server\ts\index.ts') $ts
        Put (Join-Path $fk 'skymp5-server\cpp\addon.cpp') '// the addon'
        Put (Join-Path $fk 'skymp5-server\package.json') '{ "name": "skymp5-server", "version": "0.0.0", "license": "AGPL-3.0" }'
        Put (Join-Path $fk 'skymp5-server\yarn.lock') "# yarn lockfile v1`n`n`n"
        Put (Join-Path $fk 'skymp5-scripts\pex\ActiveMagicEffect.pex') 'compiled papyrus'
        Put (Join-Path $fk 'skymp5-scripts\psc\ActiveMagicEffect.psc') 'Scriptname ActiveMagicEffect'
        Put (Join-Path $fk 'skymp5-client\src\index.ts') 'the client'
        Put (Join-Path $fk '.gitignore') "build/`nnode_modules/`n"
        $null = G init -q $fk
        $null = G -C $fk add -A
        $env:GIT_COMMITTER_DATE = '2026-10-16T12:00:00Z'; $env:GIT_AUTHOR_DATE = '2026-10-16T12:00:00Z'
        try { $null = G -C $fk commit -q -m 'the fork' } finally { Remove-Item Env:GIT_COMMITTER_DATE, Env:GIT_AUTHOR_DATE }
        $commit = G -C $fk rev-parse HEAD
        Push-Location -LiteralPath (Join-Path $fk 'skymp5-server')
        try { $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; $null = & yarn install --frozen-lockfile --offline 2>&1; $ErrorActionPreference = $eap } finally { Pop-Location }
        $dist = Join-Path $fk 'build\dist\server'
        Put (Join-Path $fk 'build\skymp5-server\launch_server.bat.tmp') "node dist_back/skymp5-server.js`npause`n"
        Put (Join-Path $dist 'scam_native.node') 'the addon'
        Put (Join-Path $dist 'dist_back\skymp5-server.js') "var a=1;`n//# sourceMappingURL=skymp5-server.js.map`n"
        Put (Join-Path $dist 'dist_back\skymp5-server.js.map') ([ordered]@{ version = 3; sources = @('../../../../skymp5-server/ts/index.ts'); sourcesContent = @($ts); mappings = 'AAAA'; names = @() } | ConvertTo-Json)
        Copy-Item -LiteralPath (Join-Path $fk 'skymp5-server\package.json') -Destination (Join-Path $dist 'package.json')
        Copy-Item -LiteralPath (Join-Path $fk 'skymp5-server\yarn.lock') -Destination (Join-Path $dist 'yarn.lock')
        Copy-Item -LiteralPath (Join-Path $fk 'build\skymp5-server\launch_server.bat.tmp') -Destination (Join-Path $dist 'launch_server.bat')
        Put (Join-Path $dist 'data\scripts\ActiveMagicEffect.pex') 'compiled papyrus'
        $cd = Join-Path $fk 'build\dist\client'
        foreach ($rel in 'Data\SKSE\Plugins\MpClientPlugin.dll', 'Data\SKSE\Plugins\SkyrimPlatform.dll', 'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformImpl.dll',
                         'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformCEF.exe.hidden', 'Data\Scripts\TESModPlatform.pex') { Put (Join-Path $cd $rel) $rel }
        Put (Join-Path $cd 'Data\Platform\Plugins\skymp5-client.js') '/* THORNSWOOD PATCH */ var c = 1;'
        # The build: an hour after the commit, and before the checkout's files.
        $built = [DateTime]::Parse('2026-10-16T13:00:00Z', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal)
        function Set-BuildTime([DateTime]$utc) {
            foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $fk 'build') -Recurse -File)) { [IO.File]::SetLastWriteTimeUtc($f.FullName, $utc) }
        }
        Set-BuildTime $built
        $srvOut = Join-Path $T 'server-build.json'
        $cliOut = Join-Path $T 'client-build.json'
        $run = 'https://github.com/ThornswoodRP/skymp/actions/runs/42'

        $r = Run-Script 'scripts\release\New-ServerBuildRecord.ps1' @('-Dist', $dist, '-Clone', $fk, '-Out', $srvOut)
        Yes 'without -BuiltBy, a build older than the checkout''s sources says they are newer than the binary' ($r.Out -match 'addon\.cpp is newer than the binary')
        Remove-Item -LiteralPath $srvOut -Force -ErrorAction SilentlyContinue
        $r = Run-Script 'scripts\release\New-ServerBuildRecord.ps1' @('-Dist', $dist, '-Clone', $fk, '-Out', $srvOut, '-BuiltBy', $run)
        $rec = if (Test-Path -LiteralPath $srvOut) { [IO.File]::ReadAllText($srvOut) | ConvertFrom-Json } else { $null }
        Yes 'with -BuiltBy, the server is recorded, held to the commit''s time and not the checkout''s dates' ($r.Code -eq 0 -and $rec -and [string]$rec.source.commit -eq $commit -and
            $r.Out -match 'built by https://github\.com/ThornswoodRP/skymp/actions/runs/42' -and $r.Out -notmatch 'newer than the binary')
        Yes '  and builtUtc is the binary''s own time' ($rec -and ([string]$rec.builtUtc -eq '2026-10-16T13:00:00Z' -or ($rec.builtUtc -is [DateTime] -and $rec.builtUtc.ToUniversalTime() -eq $built)))
        # Papyrus the build compiled: newer than the commit, older than this checkout's .psc.
        Put (Join-Path $fk 'build\skymp5-scripts\pex\ActiveMagicEffect.pex') 'compiled here'
        Put (Join-Path $dist 'data\scripts\ActiveMagicEffect.pex') 'compiled here'
        Set-BuildTime $built
        Remove-Item -LiteralPath $srvOut -Force -ErrorAction SilentlyContinue
        $r = Run-Script 'scripts\release\New-ServerBuildRecord.ps1' @('-Dist', $dist, '-Clone', $fk, '-Out', $srvOut, '-BuiltBy', $run)
        Yes '  Papyrus the build compiled is held to the commit''s time too, not the checkout''s .psc' ($r.Code -eq 0 -and (Test-Path -LiteralPath $srvOut))
        $r = Run-Script 'scripts\release\New-ServerBuildRecord.ps1' @('-Dist', $dist, '-Clone', $fk, '-Out', $srvOut)
        Yes '  where without -BuiltBy that compile reads as older than its .psc' ($r.Out -match 'is older than skymp5-scripts\\psc\\ActiveMagicEffect\.psc')
        Remove-Item -LiteralPath (Join-Path $fk 'build\skymp5-scripts') -Recurse -Force
        Put (Join-Path $dist 'data\scripts\ActiveMagicEffect.pex') 'compiled papyrus'
        Set-BuildTime $built

        $r = Run-Script 'scripts\release\New-ClientBuildRecord.ps1' @('-Dist', $cd, '-Clone', $fk, '-Out', $cliOut)
        Yes 'without -BuiltBy, the client says its sources are newer than the build' ($r.Out -match 'source file\(s\) are newer than the build')
        Remove-Item -LiteralPath $cliOut -Force -ErrorAction SilentlyContinue
        $r = Run-Script 'scripts\release\New-ClientBuildRecord.ps1' @('-Dist', $cd, '-Clone', $fk, '-Out', $cliOut, '-BuiltBy', $run)
        $crec = if (Test-Path -LiteralPath $cliOut) { [IO.File]::ReadAllText($cliOut) | ConvertFrom-Json } else { $null }
        Yes 'with -BuiltBy, the client is recorded, held to the commit''s time, with no stale warning' ($r.Code -eq 0 -and $crec -and $commit.StartsWith([string]$crec.forkCommit) -and
            $r.Out -match 'built by https://github\.com/ThornswoodRP/skymp/actions/runs/42' -and $r.Out -notmatch 'newer than the build')

        # Written before the commit was made: not a build of it.
        $early = [DateTime]::Parse('2026-10-16T11:00:00Z', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal)
        Set-BuildTime $early
        Remove-Item -LiteralPath $srvOut, $cliOut -Force -ErrorAction SilentlyContinue
        $r = Run-Script 'scripts\release\New-ServerBuildRecord.ps1' @('-Dist', $dist, '-Clone', $fk, '-Out', $srvOut, '-BuiltBy', $run)
        Yes 'a server build written before its commit was made is refused with -BuiltBy, nothing written' ($r.Code -ne 0 -and $r.Out -match 'before commit' -and -not (Test-Path -LiteralPath $srvOut))
        $r = Run-Script 'scripts\release\New-ClientBuildRecord.ps1' @('-Dist', $cd, '-Clone', $fk, '-Out', $cliOut, '-BuiltBy', $run)
        Yes 'a client build written before its commit was made is refused with -BuiltBy, nothing written' ($r.Code -ne 0 -and $r.Out -match 'before commit' -and -not (Test-Path -LiteralPath $cliOut))
    }
} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
