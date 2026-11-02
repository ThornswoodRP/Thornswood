<#
  test-1326-engine-secrets.ps1

      pwsh -NoProfile -File .\tests\test-1326-engine-secrets.ps1

  #1326. Check-Secrets reads the engine fork's files when engine\skymp is
  checked out, and says so when it is not.

  git ls-files lists a submodule as one gitlink, which is not a file, so the
  tree scan read every file of this repository and not one of the fork's,
  the tree every server and client build is made from. This runs the real
  scripts\dev\Check-Secrets.ps1 over a scratch repository whose engine/skymp
  is a submodule, with an obviously fake token planted in the fork:

    1. checked out, the planted token is found, named under engine/skymp/
       with its line and rule and never its value; a file the fork does not
       track is not read; the fork's own submodule (vcpkg) is named and left
    2. the allow list passes it by its engine/skymp/ path and rule, and only
       that one
    3. checked out at a commit other than the pin, the scan says which it read
    4. not checked out, the scan says so by name and still passes a clean
       tree; on GitHub that is a notice; -Submodules Require makes it a 2
    5. the nightly fetches engine/skymp at its pin, scans with Require, and
       takes it out again; the build scans the tree as before

  The fake value is put together at run time, so this file carries nothing a
  rule matches. Read only outside its own temp folder.
#>
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

$scan = Join-Path $repo 'scripts\dev\Check-Secrets.ps1'
$token = 'ghp' + '_' + ('Fake' * 9)
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$file, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
    [IO.File]::WriteAllText($file, $text, $utf8)
}
# Local paths as submodule addresses need protocol.file.allow (git 2.38.1 on).
function Invoke-ScratchGit([string]$dir, [string[]]$argv) {
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = @(& git -C $dir -c protocol.file.allow=always -c user.name=t -c user.email=t@t -c init.defaultBranch=main @argv 2>&1 | ForEach-Object { [string]$_ }) }
    finally { $ErrorActionPreference = $old }
    return $o
}
function Scan([hashtable]$a) {
    $global:LASTEXITCODE = 0
    $out = (@(& $scan @a *>&1 | ForEach-Object { [string]$_ }) -join "`n")
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}

$savedActions = $env:GITHUB_ACTIONS
$env:GITHUB_ACTIONS = ''
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-1326-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null
$noAllow = Join-Path $T 'no-allow.txt'
Put $noAllow '# nothing allowed'
try {
    # The fork: a clean file, the planted token on line 2, and a submodule of
    # its own, the way vcpkg is one of the fork's.
    $fork = Join-Path $T 'fork'
    New-Item -ItemType Directory -Force -Path $fork | Out-Null
    [void](Invoke-ScratchGit $fork @('init', '-q'))
    Put (Join-Path $fork 'README.md') "The fork.`n"
    Put (Join-Path $fork 'skymp5-server\ts\deploy.ts') ("const a = 1;`nconst t = '" + $token + "';`n")
    [void](Invoke-ScratchGit $fork @('add', '-A'))
    [void](Invoke-ScratchGit $fork @('update-index', '--add', '--cacheinfo', ('160000,' + ('1' * 40) + ',vcpkg')))
    [void](Invoke-ScratchGit $fork @('commit', '-q', '-m', 'fork'))
    $pin = ((Invoke-ScratchGit $fork @('rev-parse', 'HEAD')) | Select-Object -First 1).Trim()

    # This repository's stand-in, with the fork as engine/skymp.
    $tree = Join-Path $T 'tree'
    New-Item -ItemType Directory -Force -Path $tree | Out-Null
    [void](Invoke-ScratchGit $tree @('init', '-q'))
    Put (Join-Path $tree 'README.md') "A clean file.`n"
    [void](Invoke-ScratchGit $tree @('add', '-A'))
    [void](Invoke-ScratchGit $tree @('submodule', 'add', '-q', $fork, 'engine/skymp'))
    [void](Invoke-ScratchGit $tree @('commit', '-q', '-m', 'tree'))
    $sub = Join-Path $tree 'engine\skymp'
    Yes 'the scratch tree has engine/skymp as a submodule, checked out' (Test-Path -LiteralPath (Join-Path $sub 'skymp5-server\ts\deploy.ts'))

    # ---- 1. checked out ------------------------------------------------------
    Write-Host ''; Write-Host 'engine/skymp checked out'
    Put (Join-Path $sub 'loose\unadded.txt') ($token + "`n")
    $r = Scan @{ Root = $tree; Allow = $noAllow }
    Yes ("a token planted in the fork fails the tree (exit {0})" -f $r.Code) ($r.Code -eq 1)
    Yes '  named under engine/skymp/, with its line and rule' ($r.Out.Contains('engine/skymp/skymp5-server/ts/deploy.ts:2  github-token'))
    Yes '  and never its value, nor the tail of it' (-not $r.Out.Contains($token) -and -not $r.Out.Contains($token.Substring($token.Length - 12)))
    Yes '  a file the fork does not track is not read' (-not $r.Out.Contains('unadded'))
    Yes '  the scan says how many of the fork''s files it read, and at which commit' ($r.Out -match ('engine/skymp: 3 tracked files at ' + $pin.Substring(0, 12) + ', 2 read as text'))
    Yes '  and names the fork''s own submodule as not read' ($r.Out -match 'engine/skymp: its own submodules are other people''s code and were not read: vcpkg')
    Yes '  this repository''s own files are read as before' ($r.Out -match '\d+ tracked files, \d+ read as text')

    # ---- 2. the allow list ------------------------------------------------------
    $allow = Join-Path $T 'allow.txt'
    Put $allow "engine/skymp/skymp5-server/ts/deploy.ts  github-token`n"
    $r = Scan @{ Root = $tree; Allow = $allow }
    Yes ("allowed by its engine/skymp/ path and rule, it passes (exit {0})" -f $r.Code) ($r.Code -eq 0 -and $r.Out -match '1 known non-secret')
    Put $allow "skymp5-server/ts/deploy.ts  github-token`nengine/skymp/skymp5-server/ts/deploy.ts  discord-webhook`n"
    $r = Scan @{ Root = $tree; Allow = $allow }
    Yes '  the path without engine/skymp/, or another rule, passes nothing' ($r.Code -eq 1 -and $r.Out.Contains('engine/skymp/skymp5-server/ts/deploy.ts:2  github-token'))

    # ---- 3. checked out somewhere else ---------------------------------------------
    Put (Join-Path $sub 'later.txt') "a later commit`n"
    [void](Invoke-ScratchGit $sub @('add', 'later.txt'))
    [void](Invoke-ScratchGit $sub @('commit', '-q', '-m', 'later'))
    $now = ((Invoke-ScratchGit $sub @('rev-parse', 'HEAD')) | Select-Object -First 1).Trim()
    $r = Scan @{ Root = $tree; Allow = $noAllow }
    Yes 'checked out at a commit other than the pin, the scan says which it read' (
        $r.Out -match ('engine/skymp is checked out at ' + $now.Substring(0, 12) + ', not at ' + $pin.Substring(0, 12)))
    Yes '  and reads what is checked out' ($r.Out -match 'engine/skymp: 4 tracked files')

    # ---- 4. not checked out ------------------------------------------------------------
    Write-Host ''; Write-Host 'engine/skymp not checked out'
    [void](Invoke-ScratchGit $tree @('submodule', 'deinit', '-q', '-f', 'engine/skymp'))
    Yes 'deinit leaves engine/skymp an empty folder, the way a checkout without submodules does' (
        (Test-Path -LiteralPath $sub) -and @(Get-ChildItem -LiteralPath $sub -Force).Count -eq 0)
    $r = Scan @{ Root = $tree; Allow = $noAllow }
    Yes ("a clean tree still passes (exit {0})" -f $r.Code) ($r.Code -eq 0)
    Yes '  and says engine/skymp was not read, and how to fetch it' (
        $r.Out -match 'engine/skymp: it is not checked out here, so none of its files were read' -and $r.Out -match 'git submodule update --init --depth 1 engine/skymp')
    $env:GITHUB_ACTIONS = 'true'
    $r = Scan @{ Root = $tree; Allow = $noAllow }
    $env:GITHUB_ACTIONS = ''
    Yes '  on GitHub that is a notice on .gitmodules' ($r.Code -eq 0 -and $r.Out -match '::notice file=\.gitmodules::engine/skymp: it is not checked out')
    $r = Scan @{ Root = $tree; Allow = $noAllow; Submodules = 'Require' }
    Yes ("-Submodules Require makes it not a pass (exit {0})" -f $r.Code) ($r.Code -eq 2 -and $r.Out -match 'could not read engine/skymp')

    # ---- 5. the workflows ------------------------------------------------------------------
    Write-Host ''; Write-Host 'the workflows'
    $night = [IO.File]::ReadAllText((Join-Path $repo '.github\workflows\nightly.yml'))
    $a = $night.IndexOf('name: Scan the tree for secrets')
    $b = if ($a -ge 0) { $night.IndexOf('- name:', $a + 10) } else { -1 }
    $step = if ($a -ge 0 -and $b -gt $a) { $night.Substring($a, $b - $a) } else { '' }
    $fetch = $step.IndexOf('submodule update --init --depth 1 engine/skymp')
    $run = $step.IndexOf('Check-Secrets.ps1 -Submodules Require')
    $out = $step.IndexOf('submodule deinit -q -f engine/skymp')
    Yes 'the nightly fetches engine/skymp at its pin, then scans with -Submodules Require, then takes it out' (
        $fetch -gt 0 -and $run -gt $fetch -and $out -gt $run)
    Yes '  with long paths on, for the fork''s deepest' ($step -match 'git -c core\.longpaths=true submodule update' -and $step -match 'git -c core\.longpaths=true submodule deinit')
    Yes '  and a fetch that failed is a failed step, after the tree is still scanned' (
        $step -match '\$fetched = \(\$LASTEXITCODE -eq 0\)' -and $step -match 'if \(\$code -eq 0 -and -not \$fetched\) \{ \$code = 1 \}' -and $step -match 'exit \$code')
    $build = [IO.File]::ReadAllText((Join-Path $repo '.github\workflows\build.yml'))
    Yes 'the build on every pull request still scans the tree' ($build -match 'name: Scan the tree for secrets' -and $build -match '\.[\\/]scripts[\\/]dev[\\/]Check-Secrets\.ps1\r?\n')
} finally {
    $env:GITHUB_ACTIONS = $savedActions
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
