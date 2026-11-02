<#
  test-install-client-step.ps1

      pwsh -NoProfile -File .\tests\test-install-client-step.ps1

  Install-Thornswood.ps1's client step puts in only the recorded client (#1001).

  The step ran Install-SkyMPClient.ps1, which copied the whole client build
  over the game's Data folder with no look at records\client-build.json, so
  "install everything" could put a client in the game folder that Ship then
  refused, or that was not what the dev server expects. docs/guide/settled-design.md: Sync-Client.ps1 puts the recorded files in the game folder
  and refuses any that is not the recorded build. The step runs Sync-Client
  now and Install-SkyMPClient.ps1 is gone.

  This lays the real Install-Thornswood.ps1 and the real Sync-Client.ps1 out in
  a scratch copy of the repository's layout, with a made up client build and a
  record of it, and runs the client step (-Only client -NoShip -NoPause) into a
  scratch install:
    - a build with one file that is not the recorded one: the run stops,
      exit 1, and nothing at all is copied;
    - the recorded build: exit 0, the six recorded files are in the game
      folder by sha256, and a file the record does not name is left out;
    - no build and a game folder without the client: exit 1;
    - no build and a game folder that already holds the recorded client:
      exit 0, nothing needed.
  And by reading: the step names Sync-Client.ps1, Install-SkyMPClient.ps1 is
  gone, and no script, test, launcher or installer file names it any more.

  Nothing it runs talks to the VPS, starts a game or touches a real install.
  Everything it writes is in its own temp folder.
#>
[CmdletBinding()]
param()

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
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 } else { exit 0 }
}
function Sha256([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }

$install = Join-Path $Repo 'scripts\dev\Install-Thornswood.ps1'
$sync    = Join-Path $Repo 'scripts\release\Sync-Client.ps1'

# ---- by reading ---------------------------------------------------------------
$tokens = $null; $errs = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($install, [ref]$tokens, [ref]$errs)
Yes 'Install-Thornswood.ps1 parses' ($errs.Count -eq 0)
$text = [IO.File]::ReadAllText($install)
$m = [regex]::Match($text, "(?s)Key = 'client';.*?Script = '([^']+)'")
Yes ('the client step runs ' + $m.Groups[1].Value) ($m.Success -and $m.Groups[1].Value -eq '..\release\Sync-Client.ps1')
# By name anywhere under scripts, not by path: a path to a file that is gone is
# what tests\test-script-paths.ps1 fails on.
Yes 'Install-SkyMPClient.ps1 is gone' (@(Get-ChildItem -LiteralPath (Join-Path $Repo 'scripts') -Recurse -File -Filter 'Install-SkyMPClient.*').Count -eq 0)

$named = @()
foreach ($dir in 'scripts', 'tests', 'launcher', 'installer', 'site', '.github') {
    $root = Join-Path $Repo $dir
    if (-not (Test-Path -LiteralPath $root)) { continue }
    foreach ($f in Get-ChildItem -LiteralPath $root -Recurse -File -Include *.ps1, *.psm1, *.cmd, *.bat, *.js, *.cs, *.md, *.yml, *.txt) {
        if ($f.FullName -eq $PSCommandPath) { continue }
        # The #1179 retired harness names it on purpose to assert it is gone.
        if ($f.Name -eq 'test-hand-install-retired.ps1') { continue }
        if ([IO.File]::ReadAllText($f.FullName).Contains('Install-SkyMPClient')) { $named += $f.FullName.Substring($Repo.Length + 1) }
    }
}
Yes ('nothing names Install-SkyMPClient any more' + $(if ($named.Count) { ' (' + ($named -join ', ') + ')' } else { '' })) ($named.Count -eq 0)

# The step refuses to write into a game that is open, which would make every
# case below fail for a reason that is not this one.
if (Get-Process -Name 'SkyrimSE', 'skse64_loader' -ErrorAction SilentlyContinue) {
    Write-Host 'SKIP  Skyrim is running on this machine, and Install-Thornswood.ps1 stops before any step while it is'
    Done
}

# ---- a scratch copy of the repository's layout --------------------------------
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-client-step-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $tree = Join-Path $tmp 'repo'
    foreach ($d in 'scripts\dev', 'scripts\release', 'scripts\vps', 'records') { New-Item -ItemType Directory -Force -Path (Join-Path $tree $d) | Out-Null }
    Copy-Item -LiteralPath $install -Destination (Join-Path $tree 'scripts\dev')
    # Close-Launcher.ps1, which Install-Thornswood loads for its game check:
    # under Stop since #3006, a tree without it stops on the load, where
    # before the check was "not recognized" and the run went on.
    Copy-Item -LiteralPath (Join-Path $Repo 'scripts\dev\Close-Launcher.ps1') -Destination (Join-Path $tree 'scripts\dev')
    Copy-Item -LiteralPath $sync -Destination (Join-Path $tree 'scripts\release')
    # Sync-Client holds the record to RecordShape.ps1 (#2180, since #2271),
    # which reads it through Read-JsonFile.ps1, so both go in beside it.
    foreach ($f in 'Where.ps1', 'where.js', 'RecordShape.ps1', 'Read-JsonFile.ps1') {
        $p = Join-Path $Repo "scripts\release\$f"
        if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination (Join-Path $tree 'scripts\release') }
    }
    Copy-Item -LiteralPath (Join-Path $Repo 'scripts\vps\Vps.ps1') -Destination (Join-Path $tree 'scripts\vps')
    Copy-Item -LiteralPath (Join-Path $Repo 'scripts\vps\vps.json') -Destination (Join-Path $tree 'scripts\vps')

    # The real record's file names, with made up bytes and a record of those.
    $real = Get-Content -LiteralPath (Join-Path $Repo 'records\client-build.json') -Raw | ConvertFrom-Json
    $names = @($real.files.PSObject.Properties.Name)
    Yes ('the real record names the client files (' + $names.Count + ')') ($names.Count -ge 6)
    $good = Join-Path $tmp 'build-good'
    $files = [ordered]@{}
    $n = 0
    foreach ($rel in $names) {
        $p = Join-Path $good $rel
        New-Item -ItemType Directory -Force -Path (Split-Path $p -Parent) | Out-Null
        $n++
        [IO.File]::WriteAllText($p, "recorded client file $n $rel")
        $files[$rel] = [ordered]@{ sha256 = (Sha256 $p); bytes = (Get-Item -LiteralPath $p).Length }
    }
    # A file the build has and the record does not name. The old step copied
    # the whole build, so it went in; Sync-Client leaves it out.
    $extraRel = 'Data\Platform\Plugins\not-in-the-record.js'
    New-Item -ItemType Directory -Force -Path (Split-Path (Join-Path $good $extraRel) -Parent) | Out-Null
    [IO.File]::WriteAllText((Join-Path $good $extraRel), 'somebody else''s client')
    $rec = [ordered]@{ recordedUtc = '2026-09-29T00:00:00Z'; forkCommit = '0123456789abcdef0123456789abcdef01234567'; forkBranch = 'test'; files = $files }
    [IO.File]::WriteAllText((Join-Path $tree 'records\client-build.json'), ($rec | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))

    $bad = Join-Path $tmp 'build-bad'
    Copy-Item -LiteralPath $good -Destination $bad -Recurse
    [IO.File]::WriteAllText((Join-Path $bad $names[0]), 'an unrecorded build of this file')

    $ps = (Get-Process -Id $PID).Path
    function Step([string]$root, [string]$dist) {
        $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $tree 'scripts\dev\Install-Thornswood.ps1'),
                  '-Root', $root, '-Client', $dist, '-Server', (Join-Path $tmp 'no-server'),
                  '-ServerIp', '127.0.0.1', '-Only', 'client', '-NoShip', '-NoPause')
        $out = & $ps @argv 2>&1 | Out-String
        [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
    }
    function NewRoot([string]$name) {
        $r = Join-Path $tmp $name
        New-Item -ItemType Directory -Force -Path (Join-Path $r 'Game\Data') | Out-Null
        return $r
    }
    function InPlace([string]$root) {
        $k = 0
        foreach ($rel in $names) {
            $p = Join-Path $root "Game\$rel"
            if ((Test-Path -LiteralPath $p) -and (Sha256 $p) -eq $files[$rel].sha256) { $k++ }
        }
        return $k
    }
    function Any([string]$root) { @(Get-ChildItem -LiteralPath (Join-Path $root 'Game\Data') -Recurse -File).Count }

    # ---- a build that is not the recorded one ---------------------------------
    $r1 = NewRoot 'install-bad'
    $s = Step $r1 $bad
    Yes 'a build with a file that is not the recorded one stops the step, exit 1' ($s.Code -eq 1)
    Yes 'and says the build is not the recorded one' ($s.Out -match 'the build is not the recorded one')
    Yes 'and Install-Thornswood says the step did not finish' ($s.Out -match 'SkyMP client did not finish')
    Yes 'and nothing at all was copied into the game folder' ((Any $r1) -eq 0)

    # ---- the recorded build ----------------------------------------------------
    $r2 = NewRoot 'install-good'
    $s = Step $r2 $good
    Yes 'the recorded build goes in, exit 0' ($s.Code -eq 0)
    Yes ('every recorded file is in the game folder by sha256 (' + (InPlace $r2) + ' of ' + $names.Count + ')') ((InPlace $r2) -eq $names.Count)
    Yes 'a file of the build the record does not name is left out' (-not (Test-Path -LiteralPath (Join-Path $r2 "Game\$extraRel")))
    Yes 'and nothing but the recorded files was written' ((Any $r2) -eq $names.Count)
    Yes 'the step''s own check of what it leaves behind passes' ($s.Out -match '\[ok\]\s+SKSE\\Plugins\\MpClientPlugin\.dll')

    # ---- no build at all -------------------------------------------------------
    $r3 = NewRoot 'install-none'
    $s = Step $r3 (Join-Path $tmp 'no-build')
    Yes 'no build and no client in the game folder: the step stops, exit 1' ($s.Code -eq 1 -and $s.Out -match 'client build not found')
    Yes 'having copied nothing' ((Any $r3) -eq 0)

    $s = Step $r2 (Join-Path $tmp 'no-build')
    Yes 'no build and the recorded client already in place: exit 0, nothing needed' ($s.Code -eq 0 -and $s.Out -match 'already in the game folder')

    # A game folder with a client that is not the recorded one, and the
    # recorded build: the recorded one replaces it.
    [IO.File]::WriteAllText((Join-Path $r2 "Game\$($names[1])"), 'another server''s copy')
    $s = Step $r2 $good
    Yes 'a client file that is not the recorded one is replaced by the recorded one' ($s.Code -eq 0 -and (InPlace $r2) -eq $names.Count)
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Done
