<#
  test-server-build-record.ps1

  records\server-build.json names every server file the fork builds, and
  New-ServerBuildRecord.ps1 records only files it can tie to the fork's commit
  (issues #1200 and #1214).

  WHY THIS EXISTS. On 29 September the record named one file, scam_native.node.
  The JavaScript half the server runs (dist_back\skymp5-server.js) was nowhere
  in it, so when its bytes turned out to equal a build dated 24 September
  nobody could say from the record whether it was built from the pinned fork
  commit. It was (the fork's server TypeScript last changed on 17 September),
  but that took a clean rebuild to show.

  HOW. A made up fork, a git repository shaped like the real one, with a server
  build folder whose every file is right. Then each way a file can be from
  somewhere else, one at a time:
    1. server-bundle-sources.js, which reads the bundle's source map: the
       fork's TypeScript word for word passes; a TypeScript file the fork has
       differently, one it does not have, and a source outside the fork are
       each named; a package's own TypeScript that is not installed, and a
       namespace name, are not read
    2. New-ServerBuildRecord.ps1 on the good build: every file listed, each
       with its hash and the fork's commit, and ServerBuild.ps1 holds the build
       folder to the record it wrote
    3. and it refuses, writing nothing, a bundle built from other TypeScript,
       a bundle that does not name its map, a package.json or yarn.lock that is
       not the fork's, compiled Papyrus that is not the fork's or that the fork
       does not compile, a launch_server.bat that is not the configure's, and
       packages that are not the ones yarn.lock names
    3b. when the build compiled the Papyrus itself (build\skymp5-scripts\pex,
       fork #31, #1220): that compile is recorded and the committed .pex left
       alone; the committed one in the build, a compile older than its .psc and
       a compile with no .psc are each refused
    4. ServerBuild.ps1 on a folder: a file from another build, a server file
       the record does not list, a record of the binary alone and a record
       whose files name another commit are each a problem
    5. an engine that loads light plugins says so in the record (#1715)
    6. a check that cannot run stops it, writing nothing (#2711): a dirty
       check git cannot answer, no skymp5-server\cpp to walk, a bundle that
       cannot be read (named as that), and a records\server-build.json that
       does not read

  Run under whichever PowerShell runs this file. Needs node, yarn and git;
  connects to nothing.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $Here)
$recorder = Join-Path $repo 'scripts\release\New-ServerBuildRecord.ps1'
$bundle = Join-Path $repo 'scripts\release\server-bundle-sources.js'
. (Join-Path $repo 'scripts\deploy\ServerBuild.ps1')

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
foreach ($t in 'node', 'yarn', 'git') {
    if (-not (Get-Command $t -ErrorAction SilentlyContinue)) { Write-Host "SKIP  $t is not on this machine"; Done }
}

$utf8 = New-Object Text.UTF8Encoding($false)
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-srvrec-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$fork = Join-Path $T 'fork'
$dist = Join-Path $fork 'build\dist\server'
$out = Join-Path $T 'server-build.json'
$shell = (Get-Process -Id $PID).Path

function Put([string]$path, [string]$text) {
    $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text, $utf8)
}
function Run-Native([scriptblock]$b) {
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& $b 2>&1 | ForEach-Object { "$_" }); return [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($o -join "`n") } }
    finally { $ErrorActionPreference = $eap }
}
# The map esbuild writes: sources relative to the bundle's folder, which
# build-ts puts at <fork>\build\dist\server\dist_back, and what each said.
function Write-Map([string]$path, [string[]]$sources, [string[]]$contents) {
    $m = [ordered]@{ version = 3; sources = $sources; sourcesContent = $contents; mappings = 'AAAA'; names = @() }
    Put $path ($m | ConvertTo-Json -Depth 4)
}
$ts = "export const hello = 'from the fork';`n"
$pkgJs = "module.exports = 1;`n"
function Write-GoodBuild {
    if (Test-Path -LiteralPath $dist) { Remove-Item -LiteralPath $dist -Recurse -Force }
    Put (Join-Path $dist 'scam_native.node') 'the addon'
    Put (Join-Path $dist 'dist_back\skymp5-server.js') "var a=1;`n//# sourceMappingURL=skymp5-server.js.map`n"
    Write-Map (Join-Path $dist 'dist_back\skymp5-server.js.map') @('../../../../skymp5-server/ts/index.ts', '../../../../skymp5-server/node_modules/pkg/index.js',
                                                                  '../../../../skymp5-server/node_modules/pkg/src/index.ts', 'node-modules-polyfills:util') `
                                                                @($ts, $pkgJs, 'their own typescript', 'polyfill')
    Copy-Item -LiteralPath (Join-Path $fork 'skymp5-server\package.json') -Destination (Join-Path $dist 'package.json')
    Copy-Item -LiteralPath (Join-Path $fork 'skymp5-server\yarn.lock') -Destination (Join-Path $dist 'yarn.lock')
    Copy-Item -LiteralPath (Join-Path $fork 'build\skymp5-server\launch_server.bat.tmp') -Destination (Join-Path $dist 'launch_server.bat')
    Put (Join-Path $dist 'data\scripts\ActiveMagicEffect.pex') 'compiled papyrus'
    Put (Join-Path $dist 'gamemode.js') '// ours, not the fork''s'
    Put (Join-Path $dist 'server-settings.json') '{}'
    Put (Join-Path $dist 'scam_native.pdb') 'symbols'
}
function Record {
    if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
    $r = Run-Native { & $shell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $recorder -Dist $dist -Clone $fork -Out $out }
    $r | Add-Member -NotePropertyName Written -NotePropertyValue (Test-Path -LiteralPath $out)
    # What it said as one line: PowerShell 7 colours a thrown message and
    # wraps it at the window's width behind a "|", so a long path splits it.
    $flat = (($r.Out -replace '\x1b\[[0-9;]*m', '') -replace '\s*\r?\n\s*\|?\s*', ' ')
    $r | Add-Member -NotePropertyName Said -NotePropertyValue $flat
    return $r
}

try {
    # ---- a fork shaped like the real one --------------------------------------
    Put (Join-Path $fork 'skymp5-server\ts\index.ts') $ts
    Put (Join-Path $fork 'skymp5-server\package.json') '{ "name": "skymp5-server", "version": "0.0.0", "license": "AGPL-3.0" }'
    Put (Join-Path $fork 'skymp5-server\yarn.lock') "# yarn lockfile v1`n`n`n"
    Put (Join-Path $fork 'skymp5-scripts\pex\ActiveMagicEffect.pex') 'compiled papyrus'
    Put (Join-Path $fork 'skymp5-scripts\psc\ActiveMagicEffect.psc') 'Scriptname ActiveMagicEffect'
    Put (Join-Path $fork 'skymp5-server\cpp\addon\main.cpp') 'int main() { return 0; }'
    Put (Join-Path $fork '.gitignore') "build/`nnode_modules/`n"
    [void](Run-Native { git -C $fork init -q })
    [void](Run-Native { git -C $fork -c user.email=t@t -c user.name=t add -A })
    [void](Run-Native { git -C $fork -c user.email=t@t -c user.name=t commit -q -m 'the fork' })
    $commit = (Run-Native { git -C $fork rev-parse HEAD }).Out.Trim()
    Push-Location -LiteralPath (Join-Path $fork 'skymp5-server')
    try { [void](Run-Native { yarn install --frozen-lockfile --offline }) } finally { Pop-Location }
    # A package the bundle carries, installed; its own TypeScript is not.
    Put (Join-Path $fork 'skymp5-server\node_modules\pkg\index.js') $pkgJs
    Put (Join-Path $fork 'build\skymp5-server\launch_server.bat.tmp') "node dist_back/skymp5-server.js`npause`n"
    Write-GoodBuild
    Yes ('a made up fork at ' + $commit.Substring(0, 8) + ', with a server build') ($commit -match '^[0-9a-f]{40}$')

    # ---- 1. the bundle's sources ----------------------------------------------
    Write-Host ''; Write-Host 'server-bundle-sources.js'
    $map = Join-Path $dist 'dist_back\skymp5-server.js.map'
    $r = Run-Native { node $bundle $map $fork }
    Yes ("the fork's own TypeScript, word for word, passes: " + $r.Out) ($r.Code -eq 0 -and $r.Out -match 'SOURCES OK 4 1')
    $bad = Join-Path $T 'bad.js.map'
    Write-Map $bad @('../../../../skymp5-server/ts/index.ts') @("export const hello = 'from another commit';`n")
    $r = Run-Native { node $bundle $bad $fork }
    Yes 'TypeScript the fork has differently is named' ($r.Code -eq 1 -and $r.Out -match "skymp5-server/ts/index\.ts in the bundle is not the fork's")
    Write-Map $bad @('../../../../skymp5-server/ts/gone.ts') @('export {};')
    $r = Run-Native { node $bundle $bad $fork }
    Yes 'TypeScript the fork does not have is named' ($r.Code -eq 1 -and $r.Out -match 'skymp5-server/ts/gone\.ts, which the fork does not have')
    Write-Map $bad @('../../../../skymp5-server/ts/index.ts', '../../../../somewhere/else.ts') @($ts, 'x')
    $r = Run-Native { node $bundle $bad $fork }
    Yes 'a source outside the fork is named' ($r.Code -eq 1 -and $r.Out -match "somewhere/else\.ts, which is not in the fork's skymp5-server")
    Write-Map $bad @('../../../../skymp5-server/node_modules/pkg/index.js') @($pkgJs)
    $r = Run-Native { node $bundle $bad $fork }
    Yes 'a bundle with none of the server''s own TypeScript is refused' ($r.Code -eq 1 -and $r.Out -match "none of the server's own TypeScript")
    Write-Map $bad @('../../../../skymp5-server/ts/index.ts', '../../../../skymp5-server/node_modules/pkg/index.js') @($ts, 'module.exports = 2;')
    $r = Run-Native { node $bundle $bad $fork }
    Yes 'an installed package that is not what the bundle carries is named' ($r.Code -eq 1 -and $r.Out -match 'node_modules/pkg/index\.js in the bundle')

    # ---- 2. the recorder, on the good build ------------------------------------
    Write-Host ''; Write-Host 'New-ServerBuildRecord.ps1'
    $r = Record
    Yes ("a good build is recorded (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Written)
    if (-not $r.Written) { Write-Host $r.Out }
    $rec = $null
    if ($r.Written) { $rec = [IO.File]::ReadAllText($out) | ConvertFrom-Json }
    $names = @(if ($rec) { $rec.files.PSObject.Properties | ForEach-Object { $_.Name } })
    $want = @('data/scripts/ActiveMagicEffect.pex', 'dist_back/skymp5-server.js', 'dist_back/skymp5-server.js.map', 'launch_server.bat', 'package.json', 'scam_native.node', 'yarn.lock')
    Yes ('  listing every server file and nothing else: ' + ($names -join ', ')) (($names -join '|') -eq ($want -join '|'))
    Yes '  each with its hash and the fork''s commit' ($rec -and @($names | Where-Object { $rec.files.$_.commit -ne $commit -or $rec.files.$_.sha256 -notmatch '^[0-9a-f]{64}$' }).Count -eq 0)
    Yes '  and sha256 at the top is still the binary''s' ($rec -and $rec.sha256 -eq $rec.files.'scam_native.node'.sha256 -and $rec.source.commit -eq $commit)
    Yes '  and ServerBuild.ps1 holds the build to it' ($rec -and @(Get-ThornswoodServerBuildProblems $rec (Get-ThornswoodServerFolderSums $dist)).Count -eq 0)
    Yes '  with no byte order mark in front of it' ($r.Written -and [IO.File]::ReadAllBytes($out)[0] -eq 0x7B)
    Yes '  and, for a fork that cannot tell a light plugin, no lightPlugins (#1715)' ($rec -and -not ($rec.PSObject.Properties.Name -contains 'lightPlugins'))
    $good = if ($r.Written) { [IO.File]::ReadAllText($out) } else { '' }

    # ---- 3. and what it refuses -------------------------------------------------
    foreach ($case in @(
        @{ Label = 'a bundle built from other TypeScript'; Why = "skymp5-server/ts/index\.ts in the bundle is not the fork's";
           Do = { Write-Map $map @('../../../../skymp5-server/ts/index.ts') @("export const hello = 'from another commit';`n") } },
        @{ Label = 'a bundle that does not name its map'; Why = 'does not name skymp5-server\.js\.map';
           Do = { Put (Join-Path $dist 'dist_back\skymp5-server.js') "var a=1;`n" } },
        @{ Label = 'a package.json that is not the fork''s'; Why = "package\.json in the build is not the fork's";
           Do = { Put (Join-Path $dist 'package.json') '{ "name": "another" }' } },
        @{ Label = 'a yarn.lock that is not the fork''s'; Why = "yarn\.lock in the build is not the fork's";
           Do = { Put (Join-Path $dist 'yarn.lock') '# another lock' } },
        @{ Label = 'compiled Papyrus that is not the fork''s'; Why = "ActiveMagicEffect\.pex in the build is not the fork's";
           Do = { Put (Join-Path $dist 'data\scripts\ActiveMagicEffect.pex') 'another compile' } },
        @{ Label = 'compiled Papyrus the fork does not compile'; Why = 'Extra\.pex in the build is not one the fork compiles';
           Do = { Put (Join-Path $dist 'data\scripts\Extra.pex') 'from somewhere' } },
        @{ Label = 'a launch_server.bat the configure did not write'; Why = 'launch_server\.bat in the build is not the one';
           Do = { Put (Join-Path $dist 'launch_server.bat') 'node something-else.js' } },
        @{ Label = 'packages that are not the ones yarn.lock names'; Why = 'are not the ones its yarn\.lock names';
           Do = { Remove-Item -LiteralPath (Join-Path $fork 'skymp5-server\node_modules\.yarn-integrity') -Force } }
    )) {
        Write-GoodBuild
        & $case.Do
        $r = Record
        $ok = $r.Code -ne 0 -and -not $r.Written -and $r.Out -match $case.Why -and $r.Out -match 'NOT RECORDED'
        Yes ("{0} is refused and nothing is written (exit {1})" -f $case.Label, $r.Code) $ok
        if (-not $ok) { Write-Host (($r.Out -split "`n" | Select-Object -Last 8) -join "`n") -ForegroundColor DarkGray }
    }
    Push-Location -LiteralPath (Join-Path $fork 'skymp5-server')
    try { [void](Run-Native { yarn install --frozen-lockfile --offline }) } finally { Pop-Location }
    Put (Join-Path $fork 'skymp5-server\node_modules\pkg\index.js') $pkgJs
    Write-GoodBuild

    # ---- 3b. Papyrus the build compiled itself (#1220) -----------------------
    # With the Creation Kit's compiler the fork compiles into
    # build\skymp5-scripts\pex and leaves the committed .pex alone (fork #31).
    Write-Host ''; Write-Host 'Papyrus compiled into the build folder'
    $builtDir = Join-Path $fork 'build\skymp5-scripts\pex'
    $built = Join-Path $builtDir 'ActiveMagicEffect.pex'
    $committedPex = Join-Path $fork 'skymp5-scripts\pex\ActiveMagicEffect.pex'
    Put $built 'compiled on this machine'
    Put (Join-Path $dist 'data\scripts\ActiveMagicEffect.pex') 'compiled on this machine'
    $r = Record
    Yes ("the build's own compile is recorded (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Written)
    if (-not $r.Written) { Write-Host (($r.Out -split "`n" | Select-Object -Last 8) -join "`n") -ForegroundColor DarkGray }
    Yes '  and the committed .pex is untouched' ([IO.File]::ReadAllText($committedPex) -eq 'compiled papyrus')
    Put (Join-Path $dist 'data\scripts\ActiveMagicEffect.pex') 'compiled papyrus'
    $r = Record
    Yes 'the committed .pex in the build is refused once the build compiled its own' (
        $r.Code -ne 0 -and -not $r.Written -and $r.Out -match "ActiveMagicEffect\.pex in the build is not the fork's build\\skymp5-scripts\\pex")
    Put (Join-Path $dist 'data\scripts\ActiveMagicEffect.pex') 'compiled on this machine'
    (Get-Item -LiteralPath $built).LastWriteTime = (Get-Item -LiteralPath (Join-Path $fork 'skymp5-scripts\psc\ActiveMagicEffect.psc')).LastWriteTime.AddMinutes(-5)
    $r = Record
    Yes 'a compiled .pex older than its .psc is refused' ($r.Code -ne 0 -and -not $r.Written -and $r.Out -match 'ActiveMagicEffect\.pex is older than skymp5-scripts\\psc\\ActiveMagicEffect\.psc')
    Put $built 'compiled on this machine'
    Put (Join-Path $builtDir 'Stray.pex') 'left from a .psc the fork no longer has'
    Put (Join-Path $dist 'data\scripts\Stray.pex') 'left from a .psc the fork no longer has'
    $r = Record
    Yes 'a compiled .pex with no .psc in the fork is refused' ($r.Code -ne 0 -and -not $r.Written -and $r.Out -match 'Stray\.pex has no \.psc')
    Remove-Item -LiteralPath (Join-Path $fork 'build\skymp5-scripts') -Recurse -Force
    Write-GoodBuild

    # ---- 4. ServerBuild.ps1 on a folder ----------------------------------------
    Write-Host ''; Write-Host 'ServerBuild.ps1'
    if ($good) {
        $rec = $good | ConvertFrom-Json
        Put (Join-Path $dist 'dist_back\skymp5-server.js') "var a=2;`n//# sourceMappingURL=skymp5-server.js.map`n"
        $p = @(Get-ThornswoodServerBuildProblems $rec (Get-ThornswoodServerFolderSums $dist) 'the build' 'the record')
        Yes ('a JavaScript half from another build is a problem: ' + ($p -join '; ')) ($p.Count -eq 1 -and $p[0] -match '^dist_back/skymp5-server\.js in the build is not the build the record records')
        Write-GoodBuild
        Put (Join-Path $dist 'dist_back\other.js') 'left behind'
        Put (Join-Path $dist 'second.node') 'another addon'
        $p = @(Get-ThornswoodServerBuildProblems $rec (Get-ThornswoodServerFolderSums $dist) 'the build' 'the record')
        Yes 'server files the record does not list are problems, not gamemode.js, the settings or the symbols' (
            $p.Count -eq 2 -and ($p -join ' ') -match 'dist_back/other\.js in the build is a server file' -and ($p -join ' ') -match 'second\.node')
        Write-GoodBuild
        $p = @(Get-ThornswoodServerBuildProblems ([pscustomobject]@{ binary = 'scam_native.node'; sha256 = $rec.sha256; source = $rec.source }) (Get-ThornswoodServerFolderSums $dist))
        Yes 'a record of the binary alone is a problem' ($p.Count -eq 1 -and $p[0] -match 'lists no server files')
        $other = $good | ConvertFrom-Json
        $other.files.'dist_back/skymp5-server.js'.commit = '0123456789abcdef0123456789abcdef01234567'
        $p = @(Get-ThornswoodServerBuildProblems $other (Get-ThornswoodServerFolderSums $dist) 'the build' 'the record')
        Yes 'a record saying one file was built from another commit is a problem' ($p.Count -eq 1 -and $p[0] -match 'dist_back/skymp5-server\.js was built from 01234567')
        Yes 'and the good build against its own record has none' (@(Get-ThornswoodServerBuildProblems $rec (Get-ThornswoodServerFolderSums $dist)).Count -eq 0)
    }

    # ---- 5. an engine that loads light plugins (#1715) -------------------------
    # Deploy-Gamemode.ps1 lists light plugins in the server's load order only
    # when the record says the engine loads them, and the record says so when
    # the commit it names has espm::IsLightPlugin. From the commit, not the
    # disk: a header that is only on disk says nothing.
    Write-Host ''; Write-Host 'lightPlugins'
    $lo = Join-Path $fork 'libespm\include\libespm\LoadOrder.h'
    Put $lo "namespace espm {`nbool IsLightPlugin(std::string_view fileName, uint32_t tes4Flags) noexcept;`n}`n"
    Write-GoodBuild
    $r = Record
    $rec = if ($r.Written) { [IO.File]::ReadAllText($out) | ConvertFrom-Json } else { $null }
    Yes 'a header on disk that the recorded commit does not have: no lightPlugins' ($rec -and -not ($rec.PSObject.Properties.Name -contains 'lightPlugins'))
    [void](Run-Native { git -C $fork -c user.email=t@t -c user.name=t add -A })
    [void](Run-Native { git -C $fork -c user.email=t@t -c user.name=t commit -q -m 'light plugins' })
    $r = Record
    $rec = if ($r.Written) { [IO.File]::ReadAllText($out) | ConvertFrom-Json } else { $null }
    Yes ('a recorded commit with IsLightPlugin: "lightPlugins": true (exit {0})' -f $r.Code) ($rec -and $rec.lightPlugins -eq $true)
    Yes '  and it says so' ($r.Out -match 'light\s+loads light plugins')

    # ---- 6. a check that cannot run stops the record (#2711) ------------------
    # The dirty check read '' from a git that could not answer, which is what a
    # clean clone says; the source walk skipped a cpp\ that was not there; the
    # recorded base and the bundle's tail sat in empty catches.
    Write-Host ''; Write-Host 'a check that cannot run'
    Write-GoodBuild
    $r = Record
    Yes ('the good build still records (exit {0})' -f $r.Code) ($r.Code -eq 0 -and $r.Written)
    $index = Join-Path $fork '.git\index'
    $indexBytes = [IO.File]::ReadAllBytes($index)
    [IO.File]::WriteAllText($index, 'not an index')
    $r = Record
    [IO.File]::WriteAllBytes($index, $indexBytes)
    Yes 'a dirty check git cannot answer stops the record, nothing written' ($r.Code -ne 0 -and -not $r.Written)
    Yes '  and says which check could not run' ($r.Said -match 'cannot read whether the clone is committed')

    $cpp = Join-Path $fork 'skymp5-server\cpp'
    Rename-Item -LiteralPath $cpp -NewName 'cpp-away'
    try { $r = Record } finally { Rename-Item -LiteralPath (Join-Path $fork 'skymp5-server\cpp-away') -NewName 'cpp' }
    Yes 'a source walk with no skymp5-server\cpp stops the record, nothing written' ($r.Code -ne 0 -and -not $r.Written)
    Yes '  and says the check cannot be made' ($r.Said -match 'no skymp5-server\\cpp in' -and $r.Said -match 'older than its sources cannot be checked')

    # The bundle held open by something else for the whole run.
    $held = [IO.File]::Open((Join-Path $dist 'dist_back\skymp5-server.js'), 'Open', 'Read', 'None')
    try { $r = Record } finally { $held.Dispose() }
    Yes 'a bundle that cannot be read is refused, nothing written' ($r.Code -ne 0 -and -not $r.Written)
    Yes '  and named as unreadable, not as naming no map' ($r.Said -match 'skymp5-server\.js could not be read' -and $r.Said -notmatch 'does not name skymp5-server\.js\.map')

    # A records\server-build.json that does not read: a copy of the recorder
    # in a tree of its own, since it reads the record beside it.
    $tree = Join-Path $T 'tree'
    foreach ($p in 'scripts\release\New-ServerBuildRecord.ps1', 'scripts\release\Read-JsonFile.ps1', 'scripts\release\server-bundle-sources.js', 'scripts\deploy\ServerBuild.ps1') {
        $to = Join-Path $tree $p
        $null = [IO.Directory]::CreateDirectory((Split-Path -Parent $to))
        Copy-Item -LiteralPath (Join-Path $repo $p) -Destination $to
    }
    Put (Join-Path $tree 'records\server-build.json') '{ "source": '
    $realRecorder = $recorder
    $recorder = Join-Path $tree 'scripts\release\New-ServerBuildRecord.ps1'
    try { $r = Record } finally { $recorder = $realRecorder }
    Yes 'a recorded base that does not read stops the record, nothing written' ($r.Code -ne 0 -and -not $r.Written)
    Yes '  and names the record' ($r.Said -match 'server-build\.json is not valid JSON')
}
finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
