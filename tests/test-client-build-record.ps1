<#
  test-client-build-record.ps1

  scripts\release\New-ClientBuildRecord.ps1, run for real against a stand-in
  client build and stand-in git repos under %TEMP%. No engine build, no
  network: the "fork" is a local repository and every clone is of a path.
  -Out always points under %TEMP%, so records\client-build.json is not touched.

  What this holds the script to:
    - Get-ForkBranch: the branch that is checked out wins; on a detached HEAD
      (how a submodule is checked out) origin/thornswood/engine-changes is
      preferred, then any remote branch holding HEAD, minus origin/; with no
      remote branch, the branch .gitmodules says the repository follows;
      otherwise what it was given;
    - Get-UpstreamBase: a merge-base it is given wins; otherwise the recorded
      base, only while it is still an ancestor of HEAD; otherwise nothing;
    - the record: all six files by sha256 and size, the fork commit (8), the
      branch, the patch-block count, and the time of the newest file;
    - it refuses a bundle with no THORNSWOOD PATCH block, a bundle with
      another server's marker, and a build missing one of the six, and in each
      case writes no record;
    - it warns when the clone has uncommitted client changes, and when a
      client source file is newer than the build;
    - a -Clone that is not a git clone is refused, not recorded with an empty
      commit;
    - a check that cannot run stops the record and writes nothing (#2711): a
      dirty check git cannot answer, a stale check with no client sources to
      walk, and a records\client-build.json that does not read.
#>
[CmdletBinding()]
param([string]$Scratch)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
# What this runs, every machine runs in PowerShell 7 since #5356, the box
# included, and this harness runs in it too.
$boxPs = Get-BoxPowerShell
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repoRoot = Split-Path -Parent $Here
$script = Join-Path $repoRoot 'scripts\release\New-ClientBuildRecord.ps1'
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($script, [ref]$tokens, [ref]$errors)
Yes 'New-ClientBuildRecord.ps1 parses' ($errors.Count -eq 0)
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) {
    if ('Get-ForkBranch', 'Get-UpstreamBase' -contains $f.Name) { . ([scriptblock]::Create($f.Extent.Text)) }
}
Yes 'Get-ForkBranch and Get-UpstreamBase are lifted out of it' ((Test-Path function:Get-ForkBranch) -and (Test-Path function:Get-UpstreamBase))

# The script runs with ErrorActionPreference Stop, as this file does, so a
# git that writes to stderr is a thrown error in Windows PowerShell. Safe
# turns that into a value a check can see instead of ending the run.
function Safe([scriptblock]$b) { try { & $b } catch { '<threw: ' + $_.Exception.Message + '>' } }

$root = Join-Path $Scratch ('ts-client-record-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $root
$env:GIT_CONFIG_NOSYSTEM = '1'
$env:GIT_TERMINAL_PROMPT = '0'
function G { $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; $o = & git -c user.name=t -c user.email=t@t -c init.defaultBranch=main -c protocol.file.allow=always -c core.autocrlf=false @args 2>&1; $ErrorActionPreference = $eap; if ($LASTEXITCODE) { throw "git $($args -join ' '): $o" }; $o }
function Put([string]$p, [string]$text) {
    $d = Split-Path -Parent $p
    if (-not (Test-Path -LiteralPath $d)) { $null = New-Item -ItemType Directory -Force -Path $d }
    [IO.File]::WriteAllText($p, $text)
}

try {
    # ---- stand-in fork: main (upstream) and thornswood/engine-changes ---------
    $fork = Join-Path $root 'fork'
    $null = G init -q $fork
    Put (Join-Path $fork 'skymp5-client\src\index.ts') 'upstream'
    Put (Join-Path $fork 'skymp5-server\a.txt') 'server'
    $null = G -C $fork add -A; $null = G -C $fork commit -q -m upstream
    $upBase = (G -C $fork rev-parse HEAD).Trim()
    $null = G -C $fork checkout -q -b thornswood/engine-changes
    Put (Join-Path $fork 'skymp5-client\src\index.ts') 'ours'
    $null = G -C $fork commit -q -am ours
    $null = G -C $fork checkout -q -b side
    Put (Join-Path $fork 'side.txt') 'side'
    $null = G -C $fork add -A; $null = G -C $fork commit -q -m side
    $sideTip = (G -C $fork rev-parse HEAD).Trim()
    $null = G -C $fork checkout -q thornswood/engine-changes
    $null = G -C $fork checkout -q -b lonely
    Put (Join-Path $fork 'lonely.txt') 'x'
    $null = G -C $fork add -A; $null = G -C $fork commit -q -m lonely
    $null = G -C $fork checkout -q thornswood/engine-changes

    # ---- 1. Get-ForkBranch ------------------------------------------------------
    $clone = Join-Path $root 'clone'
    $null = G clone -q --no-local $fork $clone
    Yes 'a branch that is checked out is the branch' ((Safe { Get-ForkBranch $clone 'some/branch' }) -eq 'some/branch')
    $null = G -C $clone checkout -q --detach origin/thornswood/engine-changes
    Yes 'on a detached HEAD, origin/thornswood/engine-changes is preferred' ((Safe { Get-ForkBranch $clone 'HEAD' }) -eq 'thornswood/engine-changes')
    Yes 'and an empty branch name is filled the same way' ((Safe { Get-ForkBranch $clone '' }) -eq 'thornswood/engine-changes')
    $null = G -C $clone checkout -q --detach origin/side
    Yes 'a HEAD only another remote branch holds is named by that branch, without origin/' ((Safe { Get-ForkBranch $clone 'HEAD' }) -eq 'side')

    # A superproject that follows the fork on a branch, with a single-branch
    # submodule clone that knows no remote branch holding its HEAD.
    $super = Join-Path $root 'super'
    $null = G init -q $super
    Put (Join-Path $super 'README') 'x'
    $null = G -C $super add -A; $null = G -C $super commit -q -m init
    $null = G -C $super submodule add -q -b lonely $fork engine/skymp
    $sub = Join-Path $super 'engine\skymp'
    $null = G -C $sub checkout -q --detach
    $null = G -C $sub update-ref -d refs/remotes/origin/lonely
    foreach ($ref in @(G -C $sub for-each-ref --format='%(refname)' refs/remotes)) { if ($ref) { $null = G -C $sub update-ref -d $ref } }
    $null = G -C $super config -f .gitmodules submodule.engine/skymp.branch lonely
    Yes 'with no remote branch, the branch .gitmodules follows the fork on' ((Safe { Get-ForkBranch $sub 'HEAD' }) -eq 'lonely')
    $null = G -C $super config -f .gitmodules --unset submodule.engine/skymp.branch
    Yes 'with nothing to go on it gives back what it was given' ((Safe { Get-ForkBranch $sub 'HEAD' }) -eq 'HEAD')

    # ---- 2. Get-UpstreamBase ----------------------------------------------------
    $null = G -C $clone checkout -q --detach origin/thornswood/engine-changes
    Yes 'a merge-base it is given wins' ((Safe { Get-UpstreamBase $clone 'abc123' $upBase }) -eq 'abc123')
    Yes 'otherwise the recorded base, while it is an ancestor of HEAD' ((Safe { Get-UpstreamBase $clone '' $upBase }) -eq $upBase)
    Yes 'a recorded base that is not an ancestor of HEAD is dropped' ((Safe { Get-UpstreamBase $clone '' $sideTip }) -eq '')
    Yes 'a recorded base the clone does not know is dropped' ((Safe { Get-UpstreamBase $clone '' ('f' * 40) }) -eq '')
    Yes 'and with neither, nothing' ((Safe { Get-UpstreamBase $clone '' '' }) -eq '')

    # ---- 3. the record ----------------------------------------------------------
    $six = @(
        'Data\SKSE\Plugins\MpClientPlugin.dll',
        'Data\SKSE\Plugins\SkyrimPlatform.dll',
        'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformImpl.dll',
        'Data\Platform\Distribution\RuntimeDependencies\SkyrimPlatformCEF.exe.hidden',
        'Data\Platform\Plugins\skymp5-client.js',
        'Data\Scripts\TESModPlatform.pex')
    function NewDist([string]$bundle) {
        $d = Join-Path $root ('dist-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
        foreach ($rel in $six) { Put (Join-Path $d $rel) ("bytes of $rel") }
        Put (Join-Path $d 'Data\Platform\Plugins\skymp5-client.js') $bundle
        # The build is newer than the clone's sources, as a real one is.
        Get-ChildItem -LiteralPath $d -Recurse -File | ForEach-Object { $_.LastWriteTimeUtc = [DateTime]::UtcNow.AddMinutes(5) }
        $d
    }
    function Run([string]$dist, [string]$cl, [string]$recorder = $script) {
        $out = Join-Path $root ('rec-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.json')
        $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        $o = (& $boxPs -NoProfile -ExecutionPolicy Bypass -File $recorder -Dist $dist -Clone $cl -Out $out 2>&1 | Out-String)
        $code = $LASTEXITCODE; $ErrorActionPreference = $eap
        [pscustomobject]@{ Code = $code; Out = $o; Path = $out; Doc = $(if (Test-Path -LiteralPath $out) { Get-Content -LiteralPath $out -Raw | ConvertFrom-Json } else { $null }) }
    }

    $dist = NewDist "/* THORNSWOOD PATCH 1 */ a(); /* THORNSWOOD PATCH 2 */ b();"
    $r = Run $dist $clone
    $head8 = (G -C $clone rev-parse --short=8 HEAD).Trim()
    Yes 'a good build is recorded, exit 0' ($r.Code -eq 0 -and $null -ne $r.Doc)
    if ($r.Doc) {
        $ok = $true
        foreach ($rel in $six) {
            $p = Join-Path $dist $rel
            $want = (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant()
            $e = $r.Doc.files.$rel
            if (-not $e -or $e.sha256 -ne $want -or [int64]$e.bytes -ne (Get-Item -LiteralPath $p).Length) { $ok = $false }
        }
        Yes 'all six files are in it by sha256 and size' $ok
        Yes 'the fork commit is HEAD, eight characters' ($r.Doc.forkCommit -eq $head8)
        Yes 'the branch of a detached clone is thornswood/engine-changes' ($r.Doc.forkBranch -eq 'thornswood/engine-changes')
        Yes 'the patch blocks are counted' ([int]$r.Doc.thornswoodPatchBlocks -eq 2)
        Yes 'the fork named is ThornswoodRP/skymp' ($r.Doc.fork -eq 'https://github.com/ThornswoodRP/skymp')
        Yes 'builtUtc is the newest of the six' ([IO.File]::ReadAllText($r.Path) -match '"builtUtc":\s*"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"')
        Yes 'no stale or dirty warning for a clean, newer build' ($r.Out -notmatch 'newer than the build' -and $r.Out -notmatch 'uncommitted')
    }

    $r = Run (NewDist 'plain bundle') $clone
    Yes 'a bundle with no THORNSWOOD PATCH block is refused, nothing written' ($r.Code -ne 0 -and $r.Out -match 'no THORNSWOOD PATCH' -and -not (Test-Path -LiteralPath $r.Path))
    $r = Run (NewDist '/* THORNSWOOD PATCH */ Daedric();') $clone
    Yes 'a bundle with another server''s marker is refused, nothing written' ($r.Code -ne 0 -and $r.Out -match 'another server' -and -not (Test-Path -LiteralPath $r.Path))
    $d = NewDist '/* THORNSWOOD PATCH */'
    Remove-Item -LiteralPath (Join-Path $d 'Data\Scripts\TESModPlatform.pex')
    $r = Run $d $clone
    Yes 'a build missing one of the six is refused, nothing written' ($r.Code -ne 0 -and $r.Out -match 'missing Data\\Scripts\\TESModPlatform\.pex' -and -not (Test-Path -LiteralPath $r.Path))
    $r = Run (Join-Path $root 'no-dist') $clone
    Yes 'a dist that is not there is refused' ($r.Code -ne 0 -and $r.Out -match 'client dist not found')

    $dist = NewDist '/* THORNSWOOD PATCH */'
    Put (Join-Path $clone 'skymp5-client\src\index.ts') 'edited'
    (Get-Item -LiteralPath (Join-Path $clone 'skymp5-client\src\index.ts')).LastWriteTimeUtc = [DateTime]::UtcNow.AddMinutes(30)
    $r = Run $dist $clone
    Yes 'uncommitted client changes are warned about' ($r.Code -eq 0 -and $r.Out -match 'uncommitted client or server changes')
    Yes 'a source file newer than the build is warned about, by name' ($r.Out -match 'newer than the build' -and $r.Out -match 'index\.ts')
    $null = G -C $clone checkout -q -- .

    # ---- 4. a check that cannot run stops the record (#2711) --------------------
    # Each of these used to land in an empty catch, and the record was written
    # with nothing dirty and nothing stale.
    $index = Join-Path $clone '.git\index'
    $indexBytes = [IO.File]::ReadAllBytes($index)
    [IO.File]::WriteAllText($index, 'not an index')
    $r = Run (NewDist '/* THORNSWOOD PATCH */') $clone
    [IO.File]::WriteAllBytes($index, $indexBytes)
    Yes 'a dirty check git cannot answer stops the record, nothing written' ($r.Code -ne 0 -and -not (Test-Path -LiteralPath $r.Path))
    Yes '  and says which check could not run' ($r.Out -match 'cannot read whether the client and server sources are committed' -and $r.Out -match 'Nothing was recorded')

    $noSrc = Join-Path $root 'clone-no-src'
    $null = G clone -q --no-local $fork $noSrc
    $null = G -C $noSrc rm -q -r skymp5-client
    $null = G -C $noSrc commit -q -m 'no client sources'
    $r = Run (NewDist '/* THORNSWOOD PATCH */') $noSrc
    Yes 'a stale check with no client sources to walk stops the record, nothing written' ($r.Code -ne 0 -and -not (Test-Path -LiteralPath $r.Path))
    Yes '  and says the stale check cannot be made' ($r.Out -match 'no skymp5-client\\src in' -and $r.Out -match 'older than its sources cannot be checked')

    # A records\client-build.json that does not read: a copy of the script in a
    # tree of its own, since the script reads the record beside it.
    $tree = Join-Path $root 'tree'
    $null = New-Item -ItemType Directory -Force -Path (Join-Path $tree 'scripts\release'), (Join-Path $tree 'records')
    foreach ($n in 'New-ClientBuildRecord.ps1', 'Read-JsonFile.ps1') { Copy-Item -LiteralPath (Join-Path $repoRoot "scripts\release\$n") -Destination (Join-Path $tree 'scripts\release') }
    [IO.File]::WriteAllText((Join-Path $tree 'records\client-build.json'), '{ "upstreamBase": ')
    $r = Run (NewDist '/* THORNSWOOD PATCH */') $clone (Join-Path $tree 'scripts\release\New-ClientBuildRecord.ps1')
    Yes 'a recorded base that does not read stops the record, nothing written' ($r.Code -ne 0 -and -not (Test-Path -LiteralPath $r.Path))
    Yes '  and names the record' ($r.Out -match 'client-build\.json is not valid JSON')
    Remove-Item -LiteralPath (Join-Path $tree 'records\client-build.json')
    $r = Run (NewDist '/* THORNSWOOD PATCH */') $clone (Join-Path $tree 'scripts\release\New-ClientBuildRecord.ps1')
    Yes 'with no record yet there is no base to carry, and the record is written' ($r.Code -eq 0 -and $null -ne $r.Doc)

    $notGit = Join-Path $root 'not-a-clone'
    $null = New-Item -ItemType Directory -Force -Path $notGit
    $env:GIT_CEILING_DIRECTORIES = $root
    $r = Run (NewDist '/* THORNSWOOD PATCH */') $notGit
    Remove-Item Env:\GIT_CEILING_DIRECTORIES
    Yes 'a -Clone that is not a git clone is refused, not recorded with an empty commit' ($r.Code -ne 0 -and -not (Test-Path -LiteralPath $r.Path))
}
finally {
    Remove-Item Env:\GIT_CEILING_DIRECTORIES -EA SilentlyContinue
    Get-ChildItem -LiteralPath $root -Recurse -Force -EA SilentlyContinue | ForEach-Object { try { $_.Attributes = 'Normal' } catch { } }
    Remove-Item -LiteralPath $root -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) { exit 1 }
exit 0
