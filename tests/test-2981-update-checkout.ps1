<#
  test-2981-update-checkout.ps1

      pwsh -NoProfile -File .\tests\test-2981-update-checkout.ps1

  Issue #2981. On 20 Oct the dev Ship on One refused the shared clone,
  C:\Thornswood-Repo, for one uncommitted change nobody made: engine\skymp
  was at cdd84651 while main pinned b6c76e45. The clone had been moved to
  origin/main by hand three times as the pin moved (#2866, #2881, #2925), and
  git checkout --detach origin/main never touches a submodule. Two minutes
  before, Check-ShipReady -Channel dev had said READY, with the change as a
  note, because on dev it asked its own question and not Ship's.

  It builds a scratch fork and a scratch Thornswood that pins it, in a temp
  folder, and checks:
    1. The incident: a clone moved by hand to a commit with a new pin shows
       engine/skymp as a tracked change, and Fresh-Checkout.ps1 (what Ship
       asks) refuses it naming the submodule, where it is, its pin, and
       Update-Checkout.ps1 as the line that closes it.
    2. Check-ShipReady.ps1 says NOT READY on dev for it, from the same answer
       (Get-CheckoutRows, lifted out of the script), with that line as the
       fix; and READY once it is closed.
    3. Update-Checkout.ps1 -Check says what it would move and moves nothing;
       a run moves the clone and engine/skymp to the pin, writes no git
       config, and leaves Ship nothing to refuse.
    4. Issue #3046: a worktree of that clone that never fetched engine/skymp
       still moves across a pin move with a plain git checkout. #2987 set
       submodule.recurse in the config every worktree reads, and on One that
       checkout stopped half moved. Update-Checkout run in such a worktree
       leaves the submodule alone. A move by hand in the clone itself leaves
       engine/skymp behind, Ship names it, and Update-Checkout takes it on.
    5. A detached clone behind main is told Update-Checkout.ps1, not git pull,
       which has no branch to move there.
    6. It refuses, moving nothing, whenever a move would leave something
       behind or carry it along: a tracked change, a submodule change of its
       own, a submodule commit no branch holds, a HEAD no branch holds.
       After a history rewrite (#3684) a -RewriteMap that gives such a commit
       a new id a branch holds lets it move on, with no archive branch; a map
       whose new id nothing holds, or one that is not there, still stops it.
    7. On a branch it does not move the branch, but brings the submodule to
       the branch's pin; a checkout that never fetched the submodule is left
       alone.
    8. The written step for the shared clone names the script.

  Writes only to a temp folder of its own, and removes it.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$Update = Join-Path $Repo 'scripts\release\Update-Checkout.ps1'
$Ready = Join-Path $Repo 'scripts\release\Check-ShipReady.ps1'
. (Join-Path $PSScriptRoot 'Windows.ps1')

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
    else       { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done { Write-Host ''; Write-Host "$($script:pass) passed, $($script:fail) failed"; exit ([int]($script:fail -gt 0)) }

Yes 'scripts\release\Update-Checkout.ps1 exists' (Test-Path -LiteralPath $Update)
. (Join-Path $Repo 'scripts\deploy\Fresh-Checkout.ps1')
$errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Ready, [ref]$null, [ref]$errs)
$fns = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true))
foreach ($name in 'New-Row', 'Get-ShipVerdict', 'Get-CheckoutRows') {
    $f = @($fns | Where-Object { $_.Name -eq $name })
    Yes "Check-ShipReady.ps1 has $name" ($f.Count -eq 1)
    if ($f.Count -eq 1) { Invoke-Expression $f[0].Extent.Text }
}
if ($script:fail) { Done }

# Commits made here need a name, and a submodule from a folder needs the file
# protocol, which git refuses by default. Both only for this process.
# Nor does any git here start a maintenance or gc run of its own after a
# fetch, commit or push, or a signing program for a commit nobody checks the
# signature of: the runs were 44 of the 627 git processes this harness
# started, on a box whose processors are what PR builds wait on (#3168).
# None of them changes what a checkout or Update-Checkout.ps1 does.
$keep = @{}
$envs = @{
    GIT_AUTHOR_NAME = 't'; GIT_AUTHOR_EMAIL = 't@t'; GIT_COMMITTER_NAME = 't'; GIT_COMMITTER_EMAIL = 't@t'
    GIT_CONFIG_COUNT = '4'; GIT_CONFIG_KEY_0 = 'protocol.file.allow'; GIT_CONFIG_VALUE_0 = 'always'
    GIT_CONFIG_KEY_1 = 'maintenance.auto'; GIT_CONFIG_VALUE_1 = 'false'; GIT_CONFIG_KEY_2 = 'gc.auto'; GIT_CONFIG_VALUE_2 = '0'
    GIT_CONFIG_KEY_3 = 'commit.gpgsign'; GIT_CONFIG_VALUE_3 = 'false'
    GIT_CONFIG_NOSYSTEM = '1'; THORNSWOOD_FRESH_CHECKED = ''
}
foreach ($k in $envs.Keys) { $keep[$k] = [Environment]::GetEnvironmentVariable($k); [Environment]::SetEnvironmentVariable($k, $envs[$k]) }

function G([string]$dir) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & git -C $dir @args 2>&1 | ForEach-Object { "$_" }
    $c = $LASTEXITCODE; $ErrorActionPreference = $old
    if ($c -ne 0) { throw "git $($args -join ' ') failed in $dir ($c): $($out -join ' ')" }
    return @($out)
}
function Rev([string]$dir, [string]$what = 'HEAD') { return ([string]@(G $dir rev-parse $what)[0]).Trim() }
function Short([string]$sha) { return $sha.Substring(0, 8) }
function Commit([string]$dir, [string]$name) {
    Set-Content -LiteralPath (Join-Path $dir $name) -Value $name
    $null = G $dir add -- $name
    $null = G $dir commit -q -m $name
    return (Rev $dir)
}
# The commits the fork and Thornswood's main get, written straight into the
# bare repository by one git fast-import (#3168). A seed clone took an add, a
# commit and a push for each, and the push a receive-pack, an upload-pack and
# a pack-objects of its own: about 25 processes a pin, where this is one.
# The history is the same shape: one commit each, with the same files and
# pins, each on top of the one before, and main moves only when a scene
# moves it. Each commit is its message and then its fast-import M lines;
# it returns their shas in order.
function Import([string]$bare, [string]$from, [object[]]$commits) {
    $s = New-Object Text.StringBuilder
    for ($i = 1; $i -le $commits.Count; $i++) {
        $c = @($commits[$i - 1])
        [void]$s.Append("commit refs/heads/main`nmark :$i`ncommitter t <t@t> now`ndata <<EOT`n$($c[0])`nEOT`n")
        if ($i -gt 1) { [void]$s.Append("from :$($i - 1)`n") } elseif ($from) { [void]$s.Append("from $from`n") }
        foreach ($m in @($c | Select-Object -Skip 1)) { [void]$s.Append("$m`n") }
    }
    # Fed through a stream of its own: a pipe from PowerShell to git would end
    # each line as the machine does, and fast-import reads LF only. It keeps
    # what it wrote as a pack, where under 100 objects it would start
    # unpack-objects to spread them out loose.
    $marks = Join-Path $tmp 'marks.txt'
    $si = New-Object Diagnostics.ProcessStartInfo 'git'
    $si.Arguments = "--git-dir=`"$bare`" -c fastimport.unpackLimit=0 fast-import --quiet --date-format=now --export-marks=`"$marks`""
    $si.UseShellExecute = $false; $si.RedirectStandardInput = $true; $si.RedirectStandardError = $true
    $p = [Diagnostics.Process]::Start($si)
    $b = [Text.Encoding]::UTF8.GetBytes($s.ToString())
    $p.StandardInput.BaseStream.Write($b, 0, $b.Length); $p.StandardInput.Close()
    $err = $p.StandardError.ReadToEnd(); $p.WaitForExit()
    if ($p.ExitCode -ne 0) { throw "git fast-import failed in $bare ($($p.ExitCode)): $err" }
    $shas = @{}
    foreach ($l in [IO.File]::ReadAllLines($marks)) { $k, $v = $l -split ' ', 2; $shas[$k] = $v.Trim() }
    return @(for ($i = 1; $i -le $commits.Count; $i++) { $shas[":$i"] })
}
# A file, its content its own name as Commit writes it unless said, and the pin.
function File([string]$name, [string]$text = $name) { return "M 100644 inline $name`ndata <<EOT`n$text`nEOT" }
function Link([string]$sha) { return "M 160000 $sha engine/skymp" }
function Pin([string]$on, [string]$sha, [string]$msg) { return @(Import $top $on @(, @($msg, (Link $sha))))[0] }
# Whether any config git reads in that checkout sets submodule.recurse.
function Recurse([string]$dir) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $null = & git -C $dir config --get-all submodule.recurse 2>&1
    $c = $LASTEXITCODE; $ErrorActionPreference = $old
    return ($c -eq 0)
}
function Status([string]$dir) { return @(G $dir status --porcelain --untracked-files=no | Where-Object { $_ }) }

# Update-Checkout.ps1 run whole, as One runs it: in PowerShell 7, which runs
# every script since #5356.
$shell = Get-BoxPowerShell
function Run([string]$dir, [string[]]$more = @()) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = & $shell -NoProfile -ExecutionPolicy Bypass -File $Update -RepoDir $dir -NoPause @more *>&1 | Out-String
    $c = $LASTEXITCODE; $ErrorActionPreference = $old
    return [pscustomobject]@{ Code = $c; Out = $out }
}
function DevRows([string]$dir) {
    $env:THORNSWOOD_FRESH_CHECKED = ''
    $st = Get-FreshCheckoutState -RepoDir $dir -AnyBranch:(Test-FreshAnyBranch -RepoDir $dir -Channel 'dev')
    return [pscustomobject]@{ State = $st; Verdict = (Get-ShipVerdict @(Get-CheckoutRows $st)) }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('t2981-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory $tmp | Out-Null
try {
    # The fork, with three commits for main to pin in turn.
    $sub = Join-Path $tmp 'skymp.git'
    $null = G $tmp init -q --bare -b main $sub
    $s1, $s2, $s3 = Import $sub '' @(@('one.txt', (File 'one.txt')), @('two.txt', (File 'two.txt')), @('three.txt', (File 'three.txt')))

    # Thornswood, pinning the fork's first commit, with the .gitmodules git
    # submodule add writes for it.
    $top = Join-Path $tmp 'Thornswood.git'
    $null = G $tmp init -q --bare -b main $top
    $t1 = @(Import $top '' @(, @('pin one', (File '.gitmodules' "[submodule `"engine/skymp`"]`n`tpath = engine/skymp`n`turl = ../skymp.git"), (Link $s1))))[0]

    # The shared clone: detached at origin/main, engine/skymp fetched.
    $one = Join-Path $tmp 'Thornswood-Repo'
    $null = G $tmp clone -q $top $one
    $null = G $one submodule update -q --init
    $null = G $one checkout -q --detach origin/main
    Yes '0. the shared clone starts clean, engine/skymp at the first pin' (@(Status $one).Count -eq 0 -and (Rev (Join-Path $one 'engine\skymp')) -eq $s1)

    # ---- 1. the incident: the pin moves, the clone is moved by hand ----
    $t2 = Pin $t1 $s2 'pin two'
    $null = G $one fetch -q origin
    $null = G $one checkout -q --detach origin/main
    $stat = @(Status $one)
    Yes "1. a bare git checkout --detach origin/main leaves engine/skymp behind: $($stat -join ',')" ($stat.Count -eq 1 -and $stat[0] -match 'engine/skymp$' -and (Rev (Join-Path $one 'engine\skymp')) -eq $s1)
    $d = DevRows $one
    $st = $d.State
    Yes "1. Fresh-Checkout refuses it as dirty: $($st.Message)" (-not $st.Ok -and $st.Problem -eq 'dirty')
    Yes '1. and names the submodule, where it is and what it is pinned to' (
        @($st.Submodules).Count -eq 1 -and $st.Submodules[0].Path -eq 'engine/skymp' -and $st.Submodules[0].Have -eq $s1 -and $st.Submodules[0].Pin -eq $s2 -and
        $st.Message -match ('engine/skymp is at ' + (Short $s1) + ', not the ' + (Short $s2) + ' this commit pins'))
    Yes "1. its fix is Update-Checkout.ps1: $($st.Fix)" ($st.Fix -eq '.\scripts\release\Update-Checkout.ps1' -and $st.Message -match 'Update-Checkout\.ps1 brings it to the pin')
    $m = ''; try { $env:THORNSWOOD_FRESH_CHECKED = ''; Assert-FreshCheckout -RepoDir $one -What 'Ship' -AnyBranch *> $null } catch { $m = $_.Exception.Message }
    Yes "1. so Ship refuses it, with the same words: $m" ($m -match '^Ship refused: checkout has 1 uncommitted change\(s\) to tracked files: engine/skymp is at' -and $m -match 'Nothing was sent')

    # ---- 2. Check-ShipReady -Channel dev says so ----
    Yes '2. Check-ShipReady -Channel dev is NOT READY for it' (-not $d.Verdict.Ready -and @($d.Verdict.Gaps).Count -eq 1)
    Yes '2. its gap carries the refusal and Update-Checkout.ps1 as the fix' (
        $d.Verdict.Gaps[0].Detail -eq $st.Message -and $d.Verdict.Gaps[0].Fix -eq '.\scripts\release\Update-Checkout.ps1')

    # ---- 3. Update-Checkout ----
    $r = Run $one @('-Check')
    Yes "3. -Check exits 2 when a run would move something (exit $($r.Code))" ($r.Code -eq 2)
    Yes '3. and says engine/skymp would go to its pin' ($r.Out -match ('engine/skymp from ' + (Short $s1) + ' to the ' + (Short $s2)))
    Yes '3. and moved nothing' ((Rev (Join-Path $one 'engine\skymp')) -eq $s1 -and @(Status $one).Count -eq 1)
    $r = Run $one
    Yes "3. a run exits 0 (exit $($r.Code))" ($r.Code -eq 0)
    if ($r.Code -ne 0) { Write-Host $r.Out }
    Yes '3. engine/skymp is at the pin and nothing is changed' ((Rev (Join-Path $one 'engine\skymp')) -eq $s2 -and @(Status $one).Count -eq 0 -and (Rev $one) -eq $t2)
    Yes '3. it writes no submodule.recurse, which every worktree would read (#3046)' (-not (Recurse $one))
    Yes '3. it ends on what Ship takes' ($r.Out -match 'checkout is origin/main at .*, clean, as Ship takes it')
    $d = DevRows $one
    Yes '3. and Check-ShipReady -Channel dev is READY' ($d.State.Ok -and $d.Verdict.Ready)
    $r = Run $one @('-Check')
    Yes "3. -Check then exits 0, nothing to move (exit $($r.Code))" ($r.Code -eq 0 -and $r.Out -match 'Nothing to move')

    # ---- 4. a worktree that never fetched engine/skymp, across a pin move ----
    $wt = Join-Path $one 'worktrees\claude-releases'
    $null = G $one worktree add -q --detach $wt $t2
    Yes '4. the worktree has engine/skymp unfetched, as git worktree add leaves it' (-not (Test-Path -LiteralPath (Join-Path $wt 'engine\skymp\.git')))
    $t3 = Pin $t2 $s3 'pin three'
    $null = G $wt fetch -q origin
    $o = ''; $c = 0
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $o = & git -C $wt checkout -q --detach origin/main 2>&1 | Out-String; $c = $LASTEXITCODE
    $ErrorActionPreference = $old
    $wtDir = ([string]@(G $wt rev-parse --absolute-git-dir)[0]).Trim()
    Yes "4. a plain git checkout there moves across the pin move (exit $c) $($o.Trim())" ($c -eq 0 -and (Rev $wt) -eq $t3 -and @(Status $wt).Count -eq 0)
    Yes '4. and leaves no modules folder or gitlink behind, as #3046 found on One' (
        -not (Test-Path -LiteralPath (Join-Path $wtDir 'modules')) -and -not (Test-Path -LiteralPath (Join-Path $wt 'engine\skymp\.git')))
    $r = Run $wt
    Yes "4. Update-Checkout run in that worktree leaves engine/skymp unfetched (exit $($r.Code))" (
        $r.Code -eq 0 -and $r.Out -match 'engine/skymp is not fetched in this checkout' -and -not (Test-Path -LiteralPath (Join-Path $wt 'engine\skymp\.git')) -and -not (Recurse $wt))
    $null = G $one worktree remove --force $wt

    $null = G $one fetch -q origin
    $null = G $one checkout -q --detach origin/main
    Yes '4. in the clone a move by hand leaves engine/skymp behind again' ((Rev $one) -eq $t3 -and (Rev (Join-Path $one 'engine\skymp')) -eq $s2 -and @(Status $one).Count -eq 1)
    Yes '4. which Ship names, with Update-Checkout as the fix' ((DevRows $one).State.Fix -eq '.\scripts\release\Update-Checkout.ps1')
    $r = Run $one
    Yes "4. and Update-Checkout takes it to the new pin (exit $($r.Code))" ($r.Code -eq 0 -and (Rev (Join-Path $one 'engine\skymp')) -eq $s3 -and @(Status $one).Count -eq 0)
    # The checkout 7 puts on a branch: this clone as it stands now, at the
    # third pin with engine/skymp fetched and at it. A copy of the folder, where
    # a clone and a git submodule update --init were 20 processes, most of them
    # the shell git submodule is (#3168).
    $two = Join-Path $tmp 'mine'
    Copy-Item -Recurse -Force -LiteralPath $one -Destination $two

    # ---- 5. behind, detached ----
    $t4 = @(Import $top $t3 @(, @('notes.txt', (File 'notes.txt'))))[0]
    $d = DevRows $one
    Yes "5. a detached clone behind main is told Update-Checkout, not git pull: $($d.State.Message)" (
        $d.State.Problem -eq 'behind' -and $d.State.Fix -eq '.\scripts\release\Update-Checkout.ps1' -and $d.State.Message -notmatch 'git pull' -and -not $d.Verdict.Ready)
    $r = Run $one
    Yes "5. and Update-Checkout moves it there (exit $($r.Code))" ($r.Code -eq 0 -and (Rev $one) -eq $t4 -and (DevRows $one).Verdict.Ready)

    # ---- 6. it refuses, and moves nothing ----
    $t5 = Pin $t4 $s2 'pin two again'
    $null = G $one fetch -q origin
    $h = Rev $one; $subDir = Join-Path $one 'engine\skymp'; $sh = Rev $subDir

    Add-Content -LiteralPath (Join-Path $one 'notes.txt') -Value 'edit'
    $r = Run $one
    Yes "6a. a tracked change here: refused, exit 1 (exit $($r.Code))" ($r.Code -eq 1 -and $r.Out -match 'tracked change\(s\) here that are not a submodule' -and $r.Out -match 'Nothing was moved')
    Yes '6a. and nothing moved' ((Rev $one) -eq $h -and (Rev $subDir) -eq $sh)
    $null = G $one checkout -q -- notes.txt

    Add-Content -LiteralPath (Join-Path $subDir 'one.txt') -Value 'edit'
    $r = Run $one
    Yes "6b. a change inside engine/skymp: refused (exit $($r.Code))" ($r.Code -eq 1 -and $r.Out -match 'engine/skymp has 1 uncommitted change\(s\) of its own')
    Yes '6b. and nothing moved' ((Rev $one) -eq $h -and (Rev $subDir) -eq $sh)
    $null = G $subDir checkout -q -- one.txt

    $lone = Commit $subDir 'local.txt'
    $r = Run $one
    Yes "6c. engine/skymp at a commit no branch holds: refused (exit $($r.Code))" ($r.Code -eq 1 -and $r.Out -match ('engine/skymp is at ' + (Short $lone) + ', which no branch of the fork') -and $r.Out -match 'branch archive/')
    Yes '6c. and nothing moved, the commit still checked out' ((Rev $one) -eq $h -and (Rev $subDir) -eq $lone)
    # 6f. #3684: after a history rewrite the fork's commit has a new id a
    # branch holds, and the rewrite's map says so: it moves, with no archive.
    $smap = Join-Path $tmp 'fork-commit-map.txt'
    Set-Content -LiteralPath $smap -Value @('old                                      new', "$lone $sh")
    $r = Run $one @('-RewriteMap', $smap)
    Yes "6f. engine/skymp at a commit a rewrite map gives a held new id: moves on (exit $($r.Code))" (
        $r.Code -eq 0 -and $r.Out -match ('engine/skymp at ' + (Short $lone) + ' is ' + (Short $sh) + ' since the history rewrite') -and (Rev $one) -eq $t5 -and (Rev $subDir) -eq $s2)
    Yes '6f. and makes no archive branch in the fork' (@(G $subDir branch --list 'archive/*').Count -eq 0)
    $null = G $subDir checkout -q $sh

    $null = G $one -c submodule.recurse=false commit -q --allow-empty -m 'only here'
    $mine = Rev $one
    $r = Run $one
    Yes "6d. HEAD at a commit no branch holds: refused (exit $($r.Code))" ($r.Code -eq 1 -and $r.Out -match ('HEAD is at ' + (Short $mine) + ', which no branch'))
    Yes '6d. and nothing moved' ((Rev $one) -eq $mine)
    # 6e. #3684: the same HEAD after a history rewrite. A map whose new id no
    # branch holds is still refused; one whose new id main holds moves on.
    $map = Join-Path $tmp 'commit-map.txt'
    Set-Content -LiteralPath $map -Value @('old                                      new', "$mine $('1' * 40)")
    $r = Run $one @('-RewriteMap', $map)
    Yes "6e. a rewrite map whose new id nothing holds: still refused (exit $($r.Code))" ($r.Code -eq 1 -and $r.Out -match ('HEAD is at ' + (Short $mine)) -and (Rev $one) -eq $mine)
    Set-Content -LiteralPath $map -Value @('old                                      new', "$mine $h")
    # Both maps in one argument, the way pwsh -File hands "a,b" over.
    $r = Run $one @('-RewriteMap', "$map,$smap")
    Yes "6e. a rewrite map giving it a new id main holds: moves to main, both maps named in one argument (exit $($r.Code))" (
        $r.Code -eq 0 -and $r.Out -match ('HEAD at ' + (Short $mine) + ' is ' + (Short $h) + ' since the history rewrite') -and (Rev $one) -eq $t5)
    Yes '6e. and makes no archive branch' (@(G $one branch --list 'archive/*').Count -eq 0)
    $r = Run $one @('-RewriteMap', (Join-Path $tmp 'no-such-map.txt'))
    Yes "6e. a -RewriteMap that is not there stops the run (exit $($r.Code))" ($r.Code -eq 1 -and $r.Out -match 'no-such-map\.txt is not there')
    $null = G $one -c submodule.recurse=false checkout -q --detach $h

    $r = Run $one
    Yes "6. with all of that put back it moves (exit $($r.Code))" ($r.Code -eq 0 -and (Rev $one) -eq $t5 -and (Rev $subDir) -eq $s2 -and @(Status $one).Count -eq 0)

    # ---- 7. a branch, and a checkout that never fetched the submodule ----
    $null = G $two -c submodule.recurse=false checkout -q -B main $t3
    $null = G $two branch -q --set-upstream-to origin/main
    $null = G $two -c submodule.recurse=false pull -q --ff-only origin main
    Yes '7. git pull on a branch leaves engine/skymp behind too' (@(Status $two).Count -eq 1 -and (Rev (Join-Path $two 'engine\skymp')) -eq $s3)
    $r = Run $two
    Yes "7. Update-Checkout on a branch does not move it, and brings engine/skymp to its pin (exit $($r.Code))" (
        $r.Code -eq 0 -and $r.Out -match 'git pull moves a branch' -and ([string]@(G $two rev-parse --abbrev-ref HEAD)[0]).Trim() -eq 'main' -and
        (Rev (Join-Path $two 'engine\skymp')) -eq $s2 -and @(Status $two).Count -eq 0)

    $bare = Join-Path $tmp 'nosub'
    $null = G $tmp clone -q $top $bare
    $r = Run $bare
    Yes "7. a checkout that never fetched engine/skymp: left alone, exit 0 (exit $($r.Code))" (
        $r.Code -eq 0 -and $r.Out -match 'engine/skymp is not fetched in this checkout' -and -not (Test-Path -LiteralPath (Join-Path $bare 'engine\skymp\.git')))
} finally {
    foreach ($k in $keep.Keys) { [Environment]::SetEnvironmentVariable($k, $keep[$k]) }
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

# 8, that CLAUDE.md's written step names the script, left with CLAUDE.md for
# the private ops repo (#3693), whose tests/test-ops-docs.js holds it.

Done
