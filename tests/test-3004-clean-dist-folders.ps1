<#
  test-3004-clean-dist-folders.ps1

      pwsh -NoProfile -File .\tests\test-3004-clean-dist-folders.ps1

  Issue #3004. Clean-Everything.ps1 -Installers, -Packs and -Stage looked only
  in $Root\_dist. Since 22 September Ship, Publish-Update and the old
  installer's Package-Thornswood (until #4824) stage in
  <Where.ps1 Dist>\<install root's name>\_dist, one per install root, so it no
  longer saw the installers a Ship left (about 5 GB each), the pack zips or the
  packaging leftovers. A machine that shipped before #4824 still has them.

  This proves it now looks in both places: every _dist under Where.ps1 Dist
  (two roots, as One has), and the old $Root\_dist while one is there, said
  to be the old place. -DistRoot moves the first. And that it deletes
  nothing without -Delete.

  HOW. The real Clean-Everything, Where.ps1 and the VPS helpers are copied
  into a scratch repository under a temp folder and run there. ssh and scp
  are stand-ins on PATH that print nothing and note they were called, and
  the address given is 127.0.0.1, so nothing reaches the VPS. Nothing
  outside the temp folder is touched.
#>
[CmdletBinding()]
param([string]$Tools)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
. (Join-Path $PSScriptRoot 'Windows.ps1')
$Here = Split-Path -Parent $Here
if (-not $Tools) { $Tools = $Here }
$realRepo = $Tools

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# ---- 1. it asks Where.ps1 for the place -------------------------------------
$text = [IO.File]::ReadAllText([IO.Path]::Combine($realRepo, 'scripts', 'mods', 'Clean-Everything.ps1'))
Yes 'Clean-Everything asks Where.ps1 Dist' ($text -match "Where\.ps1'\)\s+Dist\b")
Yes '  and no longer reads one $dist under $Root' (-not ($text -match '\$dist\s*=\s*\$\(if \(Test-Path -LiteralPath \$Root\)'))

# ---- 2. run in a scratch repository -----------------------------------------
$exe = (Get-Process -Id $PID).Path
$T = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-3004-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$savedPath = $env:PATH
$savedVpsLocal = $env:THORNSWOOD_VPS_LOCAL
try {
    New-Item -ItemType Directory -Force -Path $T | Out-Null

    # ssh and scp that print nothing, exit 0 and only note they were called.
    $bin = Join-Path $T 'bin'
    New-Item -ItemType Directory -Force -Path $bin | Out-Null
    $calls = Join-Path $T 'ssh-calls.txt'
    foreach ($n in 'ssh', 'scp') {
        if ($OnWindows) {
            [IO.File]::WriteAllText((Join-Path $bin ($n + '.cmd')), ("@echo off`r`necho {0}>>`"{1}`"`r`nexit /b 0`r`n" -f $n, $calls))
        }
        else {
            $stub = Join-Path $bin $n
            [IO.File]::WriteAllText($stub, ("#!/bin/sh`necho {0} >> '{1}'`nexit 0`n" -f $n, $calls))
            & chmod +x $stub
        }
    }
    $env:PATH = $bin + [IO.Path]::PathSeparator + $env:PATH
    # Never the real box, whatever a script falls back to.
    $env:THORNSWOOD_VPS_LOCAL = Join-Path $T 'no-vps.json'

    $repo = Join-Path $T 'Thornswood-Repo'
    foreach ($rel in 'layout.json', 'scripts\release\Where.ps1', 'scripts\vps\Vps.ps1', 'scripts\vps\Send-Script.ps1',
                     'scripts\vps\vps.json', 'scripts\mods\Clean-Everything.ps1') {
        $parts = $rel -split '\\'
        $from = $realRepo; $to = $repo
        foreach ($p in $parts) { $from = Join-Path $from $p; $to = Join-Path $to $p }
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
        Copy-Item -LiteralPath $from -Destination $to
    }
    New-Item -ItemType Directory -Force -Path (Join-Path $repo '.git') | Out-Null
    $clean = Join-Path (Join-Path (Join-Path $repo 'scripts') 'mods') 'Clean-Everything.ps1'

    function Put([string]$path, [int]$bytes, [datetime]$when) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
        [IO.File]::WriteAllBytes($path, (New-Object byte[] $bytes))
        (Get-Item -LiteralPath $path).LastWriteTime = $when
    }
    function Under([string]$root, [string[]]$names) {
        $p = $root
        foreach ($n in $names) { $p = Join-Path $p $n }
        return $p
    }
    function Run([string[]]$argList) {
        # Windows PowerShell 5.1 turns a child's stderr into a stopping error
        # under Stop; the child's words are what is checked, so it carries on.
        $ErrorActionPreference = 'Continue'
        $out = & $exe -NoProfile -ExecutionPolicy Bypass -File $clean @argList 2>&1 | Out-String
        return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
    }
    function Says([string]$out, [string]$label, [string]$name) {
        # The label is shown with Windows' separator whatever the platform.
        return $out.Contains($label + '\' + $name)
    }

    # Where.ps1 Dist in the scratch repository: out\dist.
    $dist = Under $repo @('out', 'dist')
    $day = [datetime]'2026-10-20 12:00'
    $files = @(
        (Under $dist @('release-devbuild', '_dist', 'Thornswood-Setup.zip')),
        (Under $dist @('release-main', '_dist', 'Thornswood-Setup.exe')),
        (Under $dist @('release-main', '_dist', 'pack-20261018-0100.zip')),
        (Under $dist @('release-main', '_dist', 'pack-20261019-0100.zip')),
        (Under $dist @('release-main', '_dist', 'pack-20261020-0100.zip')),
        (Under $dist @('release-devbuild', '_dist', 'stage', 'a.bin'))
    )
    $i = 0
    foreach ($f in $files) { Put $f 1024 $day.AddHours($i); $i++ }
    # A folder under Dist with no _dist in it is not an install root's staging.
    Put (Under $dist @('launcher', 'Thornswood.exe')) 10 $day

    # The old place: an install folder with a _dist from before 22 September.
    $root = Join-Path $T 'Thornswood'
    $oldDist = Join-Path $root '_dist'
    $old = @(
        (Join-Path $oldDist 'Thornswood-Setup.zip'),
        (Join-Path $oldDist 'pack-20260915-0100.zip'),
        (Under $oldDist @('sfx', 'b.bin'))
    )
    foreach ($f in $old) { Put $f 2048 ([datetime]'2026-09-15 01:00') }

    $common = @('-Root', $root, '-Vps', '127.0.0.1', '-User', 'nobody', '-NoPause')
    $r = Run (@('-Installers', '-Packs', '-Stage') + $common)
    Yes ("Clean-Everything -Installers -Packs -Stage runs (exit $($r.Code))") ($r.Code -eq 0)
    Yes '  lists the installer staged for the dev root' (Says $r.Out 'release-devbuild\_dist' 'Thornswood-Setup.zip')
    Yes '  and the one staged for the main root' (Says $r.Out 'release-main\_dist' 'Thornswood-Setup.exe')
    Yes '  and the old $Root\_dist one, said to be the old place' ($r.Out -match ([regex]::Escape($oldDist) + '[\\/]Thornswood-Setup\.zip[^\r\n]*the old place'))
    Yes '  keeps the newest two packs of the main root' ($r.Out -match 'release-main\\_dist: 3 pack zip\(s\), keeping the newest 2')
    Yes '  and the one pack in the old place' ($r.Out -match ([regex]::Escape($oldDist) + ': 1 pack zip\(s\), keeping the newest 1'))
    Yes '  lists the packaging stage under Dist' (Says $r.Out 'release-devbuild\_dist' 'stage')
    Yes '  and the sfx leftover in the old place' ($r.Out -match ([regex]::Escape($oldDist) + '[\\/]sfx'))
    Yes '  counts six things on this machine (three installers, one pack, two leftovers)' ($r.Out -match 'this machine\s+\(6 item\(s\)\)')
    Yes '  does not look inside a Dist folder with no _dist' (-not $r.Out.Contains('launcher\_dist'))
    $left = @(@($files + $old) | Where-Object { -not (Test-Path -LiteralPath $_) })
    Yes ('  and deletes nothing without -Delete' + $(if ($left.Count) { ': gone ' + ($left -join ', ') } else { '' })) ($left.Count -eq 0)

    # -DistRoot moves where releases are looked for; no install folder here.
    $elsewhere = Join-Path $T 'elsewhere'
    Put (Under $elsewhere @('other-root', '_dist', 'Thornswood-Setup.zip')) 512 $day
    $r = Run @('-Installers', '-DistRoot', $elsewhere, '-Root', (Join-Path $T 'no-install'), '-Vps', '127.0.0.1', '-User', 'nobody', '-NoPause')
    Yes ("-DistRoot is where it looks (exit $($r.Code))") ($r.Code -eq 0 -and (Says $r.Out 'other-root\_dist' 'Thornswood-Setup.zip'))
    Yes '  and only there' (-not $r.Out.Contains('release-devbuild') -and -not $r.Out.Contains('release-main') -and -not $r.Out.Contains('the old place'))

    # Nothing staged anywhere: it says none and stops cleanly.
    $r = Run @('-Installers', '-Packs', '-Stage', '-DistRoot', (Join-Path $T 'no-dist'), '-Root', (Join-Path $T 'no-install'), '-Vps', '127.0.0.1', '-User', 'nobody', '-NoPause')
    Yes ("with no Dist folder and no install it says none (exit $($r.Code))") ($r.Code -eq 0 -and ([regex]::Matches($r.Out, '(?m)^\s+none\s*$')).Count -ge 2)
}
finally {
    $env:PATH = $savedPath
    $env:THORNSWOOD_VPS_LOCAL = $savedVpsLocal
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
