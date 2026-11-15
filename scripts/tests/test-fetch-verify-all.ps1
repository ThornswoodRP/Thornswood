<#
  test-fetch-verify-all.ps1

  Fetch-Backups.ps1 checks EVERY backup it brings down, not only the newest
  (issue #2200).

  It used to run Restore-Backup.ps1 -CheckOnly against the newest file of the
  run and nothing else, so an older file that would not open was copied,
  counted and kept as a good backup. This runs the real Fetch-Backups.ps1
  against a fake ssh and scp (on PATH ahead of the real ones) and a fake
  Restore-Backup.ps1 beside a copy of it that refuses any file whose bytes
  start with BAD, and holds:

    - a bad older file and a good newest one: the run fails, both are named
      with their result, the bad one is renamed out of the backup pattern
      and kept, the good one stays
    - the same the other way round: the outcome does not depend on order
    - two good ones: both are checked, the run passes
    - no passphrase, or no Restore-Backup.ps1: a failure, never a pass
    - -NoVerify: nothing checked, says so, passes
    - a short copy is set aside too, and a set-aside file is fetched again
      on the next run rather than taken for a copy already here
    - the box is told the newest copy that opened, into offbox.txt in the
      watchdog's folder (#2755); never one nobody opened, and a box that
      does not take it fails the run

  Runs under Windows PowerShell 5.1 and PowerShell 7. No network, no VPS,
  nothing outside a scratch folder under the temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Vps = Join-Path (Split-Path -Parent (Split-Path -Parent $Here)) 'scripts\vps'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$exe = (Get-Process -Id $PID).Path
$root = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-fetch-verify-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$bin = Join-Path $root 'bin'
$null = New-Item -ItemType Directory -Force -Path $bin

# The fake ssh prints the listing in FAKE_LIST, or, asked to write
# offbox.txt, writes the name it was given into FAKE_MARK and says MARKED
# (nothing at all when FAKE_MARK_REFUSE is set); the fake scp copies from
# FAKE_SRC, and copies only FAKE_SHORT_BYTES bytes of the file FAKE_SHORT.
# Both are node, not PowerShell (#3168): the ten runs start them 35 times,
# and a PowerShell start costs the box about ten times a node start.
$node = (Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1)
if (-not $node) { Write-Host 'FAIL  node is not on PATH, and the fake ssh and scp are node'; exit 1 }
$node = $node.Source
Set-Content -LiteralPath (Join-Path $bin 'ssh.js') -Encoding ASCII -Value @'
const fs = require('fs');
const cmd = String(process.argv[process.argv.length - 1]);
const said = Buffer.from(cmd.slice(cmd.lastIndexOf(' ') + 1), 'base64').toString('utf16le');
const m = /offbox\.txt' -Value '([^']+)'/.exec(said);
if (m) {
  if (process.env.FAKE_MARK_REFUSE) { process.exit(1); }
  const at = /-LiteralPath '([^']+)'/.exec(said);
  fs.writeFileSync(process.env.FAKE_MARK, (at ? at[1] : said) + '\r\n' + m[1] + '\r\n', 'ascii');
  process.stdout.write('MARKED\n');
  process.exit(0);
}
process.stdout.write(fs.readFileSync(process.env.FAKE_LIST));
'@
# Each is started through a .cmd on Windows; elsewhere through a shell script,
# since only Windows runs a .cmd (#2989).
function Put-Launcher([string]$name) {
    if ($OnWindows) {
        Set-Content -LiteralPath (Join-Path $bin "$name.cmd") -Encoding ASCII -Value ('@"' + $node + '" "%~dp0' + $name + '.js" %*')
    } else {
        Set-Content -LiteralPath (Join-Path $bin $name) -Encoding ASCII -NoNewline -Value ("#!/bin/sh`nexec '" + $node + "' '" + (Join-Path $bin "$name.js") + "' ""`$@""`n")
        & chmod 755 (Join-Path $bin $name)
    }
}
Put-Launcher 'ssh'
Set-Content -LiteralPath (Join-Path $bin 'scp.js') -Encoding ASCII -Value @'
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2);
const src = String(a[a.length - 2]), dst = String(a[a.length - 1]);
const name = src.slice(src.lastIndexOf('/') + 1);
const from = path.join(process.env.FAKE_SRC, name);
if (!fs.existsSync(from)) { process.exit(1); }
let b = fs.readFileSync(from);
if (process.env.FAKE_SHORT === name) { b = b.subarray(0, parseInt(process.env.FAKE_SHORT_BYTES, 10)); }
fs.writeFileSync(dst, b);
'@
Put-Launcher 'scp'

$fakeRestore = @'
param([string]$Backup, [string]$KeyFile, [switch]$CheckOnly, [switch]$NoPause)
Add-Content -LiteralPath $env:FAKE_CHECKED -Value (Split-Path -Leaf $Backup)
$t = [IO.File]::ReadAllText($Backup)
if ($t.StartsWith('BAD')) { Write-Host 'fake: will not open'; exit 1 }
exit 0
'@

$oldPath = $env:PATH
$env:PATH = $bin + [IO.Path]::PathSeparator + $env:PATH

$n = 0
function Scene([hashtable]$files, [switch]$NoRestore, [switch]$NoKey, [string[]]$More = @(), [string]$Keep) {
    $script:n++
    $s = Join-Path $root ("s{0}" -f $script:n)
    $scripts = Join-Path $s 'scripts'
    $src = Join-Path $s 'box'
    $to = if ($Keep) { $Keep } else { Join-Path $s 'here' }
    $null = New-Item -ItemType Directory -Force -Path $scripts, $src, $to
    Copy-Item -LiteralPath (Join-Path $Vps 'Fetch-Backups.ps1') -Destination $scripts
    Copy-Item -LiteralPath (Join-Path $Vps 'Vps.ps1') -Destination $scripts
    $vj = Join-Path $Vps 'vps.json'
    if (Test-Path -LiteralPath $vj) { Copy-Item -LiteralPath $vj -Destination $scripts }
    if (-not $NoRestore) { Set-Content -LiteralPath (Join-Path $scripts 'Restore-Backup.ps1') -Value $fakeRestore -Encoding UTF8 }
    $key = Join-Path $s 'key.txt'
    if (-not $NoKey) { Set-Content -LiteralPath $key -Value 'not a real passphrase' }
    $list = @()
    foreach ($k in $files.Keys) {
        [IO.File]::WriteAllText((Join-Path $src $k), $files[$k])
        $list += ('{0}|{1}' -f $k, (Get-Item -LiteralPath (Join-Path $src $k)).Length)
    }
    $env:FAKE_LIST = Join-Path $s 'list.txt'
    Set-Content -LiteralPath $env:FAKE_LIST -Value $list -Encoding ASCII
    $env:FAKE_SRC = $src
    $env:FAKE_CHECKED = Join-Path $s 'checked.txt'
    $env:FAKE_MARK = Join-Path $s 'mark.txt'
    $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $scripts 'Fetch-Backups.ps1'),
              '-VpsHost', '203.0.113.9', '-VpsUser', 'nobody', '-To', $to, '-KeyFile', $key, '-NoPause') + $More
    $out = (& $exe @argv 2>&1 | Out-String)
    $code = $LASTEXITCODE
    $checked = @()
    if (Test-Path -LiteralPath $env:FAKE_CHECKED) { $checked = @(Get-Content -LiteralPath $env:FAKE_CHECKED) }
    $left = @(Get-ChildItem -LiteralPath $to -File | ForEach-Object { $_.Name })
    # Where the box was told to write, and the name, or nothing when it was not told.
    $mark = @()
    if (Test-Path -LiteralPath $env:FAKE_MARK) { $mark = @(Get-Content -LiteralPath $env:FAKE_MARK) }
    [pscustomobject]@{ Code = $code; Out = $out; Checked = $checked; Left = $left; To = $to; Mark = $mark }
}

$old = 'thornswood-20261009-031500.zip.enc'
$new = 'thornswood-20261010-031500.zip.enc'

try {
    $r = Scene @{ $old = 'BAD older'; $new = 'good newest' }
    Yes "a bad older file and a good newest one: the run fails (exit $($r.Code))" ($r.Code -ne 0)
    Yes '  both were checked, not only the newest' ((@($r.Checked | Sort-Object) -join ',') -eq (@($old, $new | Sort-Object) -join ','))
    Yes '  each is named with its result' ($r.Out -match ('FAILED\s+' + [regex]::Escape($old)) -and $r.Out -match ('OK\s+' + [regex]::Escape($new)))
    Yes '  the bad one is renamed out of the backup pattern and kept, not deleted' (
        ($r.Left -notcontains $old) -and @($r.Left | Where-Object { $_ -like "$old.failed-*" }).Count -eq 1)
    Yes '  the good one stays as a backup' ($r.Left -contains $new)
    Yes '  and fetch.log names both' ((Get-Content -Raw (Join-Path $r.To 'fetch.log')) -match [regex]::Escape($old))
    Yes '  the box is told the newest copy that opened, in the watchdog''s folder' ($r.Mark.Count -eq 2 -and $r.Mark[0] -eq 'C:\Thornswood-Watch\offbox.txt' -and $r.Mark[1] -eq $new)

    $keep = $r.To
    $r2 = Scene @{ $old = 'good now'; $new = 'good newest' } -Keep $keep
    Yes "a set-aside file is fetched again next run, not taken for one already here (exit $($r2.Code))" (
        $r2.Code -eq 0 -and $r2.Checked -contains $old -and $r2.Left -contains $old)

    $r = Scene @{ $old = 'good older'; $new = 'BAD newest' }
    Yes "the other way round, a bad newest: the run fails all the same (exit $($r.Code))" ($r.Code -ne 0)
    Yes '  and the bad newest is the one set aside' (($r.Left -notcontains $new) -and ($r.Left -contains $old))
    Yes '  so the box is told the older one, the newest that opened' ($r.Mark.Count -eq 2 -and $r.Mark[1] -eq $old)

    $r = Scene @{ $old = 'good'; $new = 'good' }
    Yes "two good files: both checked and the run passes (exit $($r.Code))" ($r.Code -eq 0 -and $r.Checked.Count -eq 2)
    Yes '  and the box is told the newest' ($r.Mark.Count -eq 2 -and $r.Mark[1] -eq $new -and $r.Out -match ('told the box the newest copy here is ' + [regex]::Escape($new)))
    $r = Scene @{ $old = 'good'; $new = 'good' } -Keep $r.To
    Yes "nothing new: the box is told the newest all the same, so the line moves on (exit $($r.Code))" ($r.Code -eq 0 -and $r.Checked.Count -eq 0 -and $r.Mark.Count -eq 2 -and $r.Mark[1] -eq $new)
    $env:FAKE_MARK_REFUSE = '1'
    $r = Scene @{ $old = 'good'; $new = 'good' }
    $env:FAKE_MARK_REFUSE = ''
    Yes "a box that does not take offbox.txt fails the run and says so (exit $($r.Code))" ($r.Code -ne 0 -and $r.Out -match 'NOT TOLD' -and $r.Mark.Count -eq 0)

    $r = Scene @{ $old = 'good'; $new = 'good' } -NoKey
    Yes "no passphrase is a failure, never a pass (exit $($r.Code))" ($r.Code -ne 0 -and $r.Out -match 'NOT CHECKED' -and $r.Checked.Count -eq 0)
    Yes '  and the box is told nothing, since none of them was opened' ($r.Mark.Count -eq 0 -and $r.Out -match 'box was not told')

    $r = Scene @{ $old = 'good'; $new = 'good' } -NoRestore
    Yes "no Restore-Backup.ps1 beside it is a failure (exit $($r.Code))" ($r.Code -ne 0 -and $r.Out -match 'NOT CHECKED')

    $r = Scene @{ $old = 'BAD'; $new = 'good' } -More @('-NoVerify')
    Yes "-NoVerify checks nothing, says so, and passes (exit $($r.Code))" (
        $r.Code -eq 0 -and $r.Checked.Count -eq 0 -and $r.Out -match 'NOT checked' -and $r.Left -contains $old)
    Yes '  and tells the box nothing' ($r.Mark.Count -eq 0 -and $r.Out -match 'box was not told')

    $env:FAKE_SHORT = $old; $env:FAKE_SHORT_BYTES = '3'
    $r = Scene @{ $old = 'good but long'; $new = 'good' }
    $env:FAKE_SHORT = ''
    Yes "a short copy fails the run and is set aside, not kept as a backup (exit $($r.Code))" (
        $r.Code -ne 0 -and $r.Out -match 'SHORT' -and ($r.Left -notcontains $old) -and
        @($r.Left | Where-Object { $_ -like "$old.failed-*" }).Count -eq 1 -and $r.Checked -notcontains $old)
} finally {
    $env:PATH = $oldPath
    Remove-Item -LiteralPath $root -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
