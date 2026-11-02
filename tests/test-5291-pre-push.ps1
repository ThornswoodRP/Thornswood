<#
  test-5291-pre-push.ps1

      pwsh -NoProfile -File .\tests\test-5291-pre-push.ps1

  Issue #5291: a push runs the parse and writing checks the build check
  makes, on the commit being pushed, before it leaves the machine.
  .githooks/pre-push hands git's lines to scripts\dev\Check-Push.ps1, which
  runs scripts\dev\Check-Parse.ps1 and scripts\dev\Check-Words.ps1 from that
  commit. This pushes for real, from a scratch clone with
  core.hooksPath .githooks to a scratch bare repository, with the real hook,
  Check-Push.ps1, Check-Parse.ps1 (with Harness-Files.ps1, which it reads)
  and Get-ScratchDir.ps1, and a stand-in
  Check-Words.ps1 that fails on a file holding the word BREAK (the real one is
  held by tests\test-check-words.ps1), and checks that:

    1. a commit where everything parses and the words hold is pushed;
    2. a commit with a PowerShell script that does not parse is not, and the
       file and its line are named, and so is a .js under game that does not
       parse;
    3. a commit the writing check fails is not pushed, and says so;
    4. it checks the commit, not the edits beside it: a broken commit with
       its fix not yet committed is still refused, and the worktree it made
       for the commit is gone afterwards, from git and from the disk;
    5. deleting a branch on the remote checks nothing and goes;
    6. a commit from before Check-Parse.ps1 existed says its parse is not
       checked here, and is pushed when its words hold;
  and, read from this repository: build.yml parses through Check-Parse.ps1,
  so the hook and the build check read one list; the hook is stored LF and
  executable; and the guide says how a clone turns it on.

  Writes only its scratch folder, in the system's temp folder, and deletes it.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" }
}
function GitOk { $o = @(& git @args 2>&1); if ($LASTEXITCODE -ne 0) { throw ('git ' + ($args -join ' ') + ': ' + ($o -join ' ')) }; $o }

# ---- read from this repository ----------------------------------------------
$build = [IO.File]::ReadAllText((Join-Path $repo '.github/workflows/build.yml'))
Yes 'build.yml parses the PowerShell scripts through Check-Parse.ps1' ($build -match '[\\/]scripts[\\/]dev[\\/]Check-Parse\.ps1 -What PowerShell')
Yes 'and the game scripts through it too, with no list of its own' (($build -match '[\\/]scripts[\\/]dev[\\/]Check-Parse\.ps1 -What Scripts') -and ($build -notmatch 'ParseFile') -and ($build -notmatch 'node --check \$f'))
$eol = ((& git -C $repo ls-files --eol -- .githooks/pre-push) -join '').Trim()
Yes ".githooks/pre-push is stored LF, so Git for Windows' sh reads it ($eol)" ($eol -match '^i/lf\s')
$mode = ((& git -C $repo ls-files -s -- .githooks/pre-push) -join '').Trim()
Yes "and executable ($mode)" ($mode -match '^100755 ')
. (Join-Path $PSScriptRoot 'Guide-Text.ps1')
$guide = Get-GuidePage 'set-up-a-machine'
Yes 'docs/guide/set-up-a-machine.md says how a clone turns the hook on' ($guide.Contains('git config core.hooksPath .githooks'))
$cloud = [IO.File]::ReadAllText((Join-Path $repo 'scripts/dev/Setup-CloudSession.sh'))
Yes 'and a cloud session turns it on by itself (Setup-CloudSession.sh, held by test-3055)' ($cloud.Contains('config core.hooksPath .githooks'))

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'SKIP  the pushes: there is no node here, which the parse check needs'
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('pre-push-test-' + [Guid]::NewGuid().ToString('N'))
$keep = [Environment]::GetEnvironmentVariable('THORNSWOOD_SCRATCH_ROOT')
$here = Get-Location
try {
    $sr = Join-Path $scratch 'clone'
    $bare = Join-Path $scratch 'remote.git'
    $tmpRoot = Join-Path $scratch 'temp'
    $null = New-Item -ItemType Directory -Force -Path $tmpRoot
    $env:THORNSWOOD_SCRATCH_ROOT = $tmpRoot

    $null = New-Item -ItemType Directory -Force -Path (Join-Path $sr 'scripts/dev'), (Join-Path $sr 'scripts/release'), (Join-Path $sr '.githooks'), (Join-Path $sr 'game'), (Join-Path $sr 'site'), (Join-Path $sr 'voice'), (Join-Path $sr 'tests')
    foreach ($f in 'Check-Push.ps1', 'Check-Parse.ps1', 'Harness-Files.ps1') { Copy-Item -LiteralPath (Join-Path $repo "scripts/dev/$f") -Destination (Join-Path $sr 'scripts/dev') }
    Copy-Item -LiteralPath (Join-Path $repo 'scripts/release/Get-ScratchDir.ps1') -Destination (Join-Path $sr 'scripts/release')
    Copy-Item -LiteralPath (Join-Path $repo '.githooks/pre-push') -Destination (Join-Path $sr '.githooks')
    # The stand-in writing check: fails on any tracked file holding BREAK, and
    # writes down the folder it was asked to read.
    Set-Content -LiteralPath (Join-Path $sr 'scripts/dev/Check-Words.ps1') -Value @'
param([string]$Root)
Add-Content -LiteralPath (Join-Path $env:THORNSWOOD_SCRATCH_ROOT 'words-roots.txt') -Value $Root
$hits = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Filter *.md | Where-Object { (Get-Content -Raw -LiteralPath $_.FullName) -match 'BREAK' })
foreach ($h in $hits) { Write-Host ('{0}: a word the writing rules ban (stand-in)' -f $h.Name) }
if ($hits.Count) { exit 1 }
Write-Host 'the writing rules hold (stand-in)'
exit 0
'@
    Set-Content -LiteralPath (Join-Path $sr 'scripts/dev/ok.ps1') -Value "param([int]`$n)`n`$n + 1"
    Set-Content -LiteralPath (Join-Path $sr 'game/gamemode.js') -Value "'use strict';`nmodule.exports = 1;"
    Set-Content -LiteralPath (Join-Path $sr 'site/server.js') -Value "module.exports = 2;"
    Set-Content -LiteralPath (Join-Path $sr 'voice/voice-server.js') -Value "module.exports = 3;"
    Set-Content -LiteralPath (Join-Path $sr 'README.md') -Value 'A plain read me.'

    $null = GitOk init -q --bare $bare
    $null = GitOk init -q $sr
    $null = GitOk -C $sr config user.name 'Pre-push test'
    $null = GitOk -C $sr config user.email 'pre-push-test@example.invalid'
    $null = GitOk -C $sr config core.autocrlf false
    $null = GitOk -C $sr config core.hooksPath .githooks
    $null = GitOk -C $sr remote add origin $bare
    $null = GitOk -C $sr add -A
    $null = GitOk -C $sr update-index --chmod=+x .githooks/pre-push
    $null = GitOk -C $sr commit -q -m base
    $null = GitOk -C $sr branch -M main
    Set-Location -LiteralPath $sr

    function Push([string[]]$what) {
        $out = @(& git -C $sr push origin @what 2>&1 | ForEach-Object { "$_" })
        [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($out -join "`n") }
    }
    function Remote([string]$ref) { $o = @(& git -C $bare rev-parse --verify --quiet $ref 2>$null); if ($LASTEXITCODE -ne 0) { '' } else { ($o -join '').Trim() } }
    function Head { ((GitOk -C $sr rev-parse HEAD) -join '').Trim() }

    # 1
    $r = Push @('main')
    Yes "1. a commit where everything parses and the words hold is pushed (exit $($r.Code))" ($r.Code -eq 0 -and (Remote 'main') -eq (Head))
    Yes '   and the hook said both checks passed' ($r.Text -match 'parse passed' -and $r.Text -match 'writing rules passed')
    $good = Head

    # 2
    Set-Content -LiteralPath (Join-Path $sr 'scripts/dev/broken.ps1') -Value "function Broken {`n  if (`$true) {`n"
    $null = GitOk -C $sr add -A; $null = GitOk -C $sr commit -q -m 'broken ps1'
    $r = Push @('main')
    Yes "2. a commit with a script that does not parse is not pushed (exit $($r.Code))" ($r.Code -ne 0 -and (Remote 'main') -eq $good)
    # Check-Parse.ps1 names it file:line:, or as an annotation (file=...,line=n::) on a GitHub runner.
    Yes '   and the file and its line are named' ($r.Text -match 'scripts/dev/broken\.ps1(:\d+:|,line=\d+::)' -and $r.Text -match 'parse FAILED')
    $null = GitOk -C $sr reset -q --hard $good
    Set-Content -LiteralPath (Join-Path $sr 'game/broken.js') -Value "function ( {"
    $null = GitOk -C $sr add -A; $null = GitOk -C $sr commit -q -m 'broken js'
    $r = Push @('main')
    Yes '   so is a .js at the top of game that does not parse' ($r.Code -ne 0 -and $r.Text -match 'game/broken\.js' -and (Remote 'main') -eq $good)
    $null = GitOk -C $sr reset -q --hard $good

    # 3
    Add-Content -LiteralPath (Join-Path $sr 'README.md') -Value 'A BREAK of the rules.'
    $null = GitOk -C $sr add -A; $null = GitOk -C $sr commit -q -m 'words'
    $r = Push @('main')
    Yes "3. a commit the writing check fails is not pushed (exit $($r.Code)), and says so" ($r.Code -ne 0 -and $r.Text -match 'writing rules FAILED' -and $r.Text -match 'README\.md' -and (Remote 'main') -eq $good)
    $null = GitOk -C $sr reset -q --hard $good

    # 4
    Set-Content -LiteralPath (Join-Path $sr 'scripts/dev/broken.ps1') -Value "function Broken {`n"
    $null = GitOk -C $sr add -A; $null = GitOk -C $sr commit -q -m 'broken again'
    Set-Content -LiteralPath (Join-Path $sr 'scripts/dev/broken.ps1') -Value "function Broken { }"
    Remove-Item -LiteralPath (Join-Path $tmpRoot 'words-roots.txt') -ErrorAction SilentlyContinue
    $r = Push @('main')
    Yes "4. a broken commit with its fix not yet committed is still refused (exit $($r.Code))" ($r.Code -ne 0 -and $r.Text -match 'broken\.ps1' -and (Remote 'main') -eq $good)
    $roots = @(Get-Content -LiteralPath (Join-Path $tmpRoot 'words-roots.txt') -ErrorAction SilentlyContinue)
    Yes ('   the commit was read in a worktree of its own (' + ($roots -join ', ') + ')') ($roots.Count -eq 1 -and $roots[0] -ne $sr -and $roots[0].StartsWith($tmpRoot))
    $wt = @(GitOk -C $sr worktree list --porcelain | Where-Object { $_ -like 'worktree *' })
    $left = @(Get-ChildItem -LiteralPath $tmpRoot -Directory)
    Yes "   and that worktree is gone afterwards, from git ($($wt.Count) listed) and from the disk ($($left.Count) left)" ($wt.Count -eq 1 -and $left.Count -eq 0)
    $null = GitOk -C $sr checkout -q -- .
    $broken = Head

    # 5
    $null = GitOk -C $sr push -q origin "${good}:refs/heads/old"
    $r = Push @(':old')
    Yes "5. deleting a branch on the remote checks nothing and goes, with HEAD broken (exit $($r.Code))" ($r.Code -eq 0 -and -not (Remote 'refs/heads/old') -and $r.Text -cnotmatch 'FAILED' -and $r.Text -notmatch 'pre-push:')
    $null = GitOk -C $sr reset -q --hard $good

    # 6
    $null = GitOk -C $sr rm -q scripts/dev/Check-Parse.ps1
    $null = GitOk -C $sr commit -q -m 'before Check-Parse'
    $r = Push @('main')
    Yes "6. a commit with no Check-Parse.ps1 says its parse is not checked here, and is pushed (exit $($r.Code))" ($r.Code -eq 0 -and $r.Text -match 'no scripts/dev/Check-Parse\.ps1, so its parse is not checked here' -and (Remote 'main') -eq (Head))
} finally {
    Set-Location -LiteralPath $here
    [Environment]::SetEnvironmentVariable('THORNSWOOD_SCRATCH_ROOT', $keep)
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
