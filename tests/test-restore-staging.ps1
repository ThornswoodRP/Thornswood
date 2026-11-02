<#
  test-restore-staging.ps1

      pwsh -NoProfile -File .\tests\test-restore-staging.ps1

  Restore-Backup.ps1 touches nothing at -To until the whole backup has been
  unpacked and checked somewhere else (issue #2203).

  WHY. It made -To and then unpacked straight into it, so an entry that would
  land outside the folder, or an unpack that failed halfway, left a new -To
  behind with some of the files in it, though the restore had failed.

  HOW. Builds small plain zips here (Restore-Backup.ps1 takes a zip as well as
  an .enc), some good and some bad: an entry named to climb out of the folder
  after a good one, a file that is not a zip, and two entries that cannot both
  be unpacked (a file and a folder of the same name). Runs Restore-Backup.ps1
  on each into a -To that is missing, missing with its parent missing, empty,
  and full. Checks a refused or failed restore leaves -To exactly as it was,
  makes no parent folder, writes nothing outside, and leaves no staging folder;
  and that a good one publishes every file byte for byte. On the code before
  #2203 the failed runs leave -To behind, so it fails.

  Talks to nothing, no VPS and no network. Writes only to its own scratch
  folder, removed at the end.
#>
[CmdletBinding()]
param([string]$Scratch)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here
$restore = Join-Path $repo 'scripts\vps\Restore-Backup.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$shell = if ($PSVersionTable.PSEdition -eq 'Core') { (Get-Process -Id $PID).Path } else { Join-Path $PSHOME 'powershell.exe' }
if (-not $Scratch) { $Scratch = Join-Path ([IO.Path]::GetTempPath()) ('tw-restore-stage-' + [Guid]::NewGuid().ToString('N')) }
$null = New-Item -ItemType Directory -Force -Path $Scratch
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function New-Zip([string]$Path, [object[]]$Entries) {
    $fs = [IO.File]::Open($Path, [IO.FileMode]::CreateNew)
    $za = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($e in $Entries) {
            $en = $za.CreateEntry($e[0])
            $s = $en.Open(); try { $b = [Text.Encoding]::UTF8.GetBytes([string]$e[1]); $s.Write($b, 0, $b.Length) } finally { $s.Dispose() }
        }
    } finally { $za.Dispose(); $fs.Dispose() }
}
function Run-Restore([string]$Zip, [string]$To) {
    $work = Join-Path $Scratch 'work'
    # The exit code decides: under Stop, Windows PowerShell 5.1 throws on any
    # line the child writes to stderr through 2>&1.
    $ErrorActionPreference = 'Continue'
    $out = & $shell -NoProfile -ExecutionPolicy Bypass -File $restore -Backup $Zip -To $To -Work $work -NoPause 2>&1 | Out-String
    return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}
function Get-Tree([string]$Dir) {
    if (-not (Test-Path -LiteralPath $Dir)) { return '<none>' }
    $root = (Resolve-Path -LiteralPath $Dir).Path.TrimEnd('\') + '\'
    return (@(Get-ChildItem -LiteralPath $Dir -Recurse -Force | Sort-Object FullName | ForEach-Object {
        $r = $_.FullName.Substring($root.Length)
        if ($_.PSIsContainer) { "D $r" } else { "F $r " + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    }) -join "`n")
}
function Get-Stages([string]$Dir) { @(Get-ChildItem -LiteralPath $Dir -Force -Directory -EA SilentlyContinue | Where-Object { $_.Name -like '.*.restore-*' -or $_.Name -like '.restore-probe-*' }) }

try {
    $good = @(@('NOTES.txt', 'taken on the test box'), @('game/world/changeForms/0.json', '{"profileId":7,"isDeleted":false}'), @('game/private/door.json', '{"k":"v"}'))
    $zGood = Join-Path $Scratch 'good.zip'; New-Zip $zGood $good
    $zClimb = Join-Path $Scratch 'climb.zip'; New-Zip $zClimb @(@('game/world/changeForms/0.json', '{"profileId":7}'), @('../escaped.txt', 'out'))
    $zBroken = Join-Path $Scratch 'broken.zip'; [IO.File]::WriteAllText($zBroken, 'this is not a zip at all')
    $zClash = Join-Path $Scratch 'clash.zip'; New-Zip $zClash @(@('game/a.txt', 'first'), @('game/x', 'a file'), @('game/x/y.txt', 'a file under a file'))

    $out1 = Join-Path $Scratch 'out1'
    foreach ($case in @(@('an entry that climbs out', $zClimb), @('a file that is not a zip', $zBroken), @('an unpack that fails halfway', $zClash))) {
        $to = Join-Path $out1 ('to-' + [Guid]::NewGuid().ToString('N').Substring(0, 6))
        $null = New-Item -ItemType Directory -Force -Path $out1
        $r = Run-Restore $case[1] $to
        Yes ("missing -To, " + $case[0] + ": the run fails") ($r.Code -ne 0)
        Yes ("missing -To, " + $case[0] + ": nothing is made at -To") (-not (Test-Path -LiteralPath $to))
        Yes ("missing -To, " + $case[0] + ": no staging folder is left beside it") ((Get-Stages $out1).Count -eq 0)
    }
    Yes 'the climbing entry wrote nothing outside the folder' (-not (Test-Path -LiteralPath (Join-Path $out1 'escaped.txt')) -and -not (Test-Path -LiteralPath (Join-Path $Scratch 'escaped.txt')))

    # A parent that is not there is not left behind either.
    $deep = Join-Path $Scratch 'no-parent\a\b'
    $r = Run-Restore $zClash (Join-Path $deep 'to')
    Yes 'missing parent, failed unpack: the run fails' ($r.Code -ne 0)
    Yes 'missing parent, failed unpack: no parent folder is made' (-not (Test-Path -LiteralPath (Join-Path $Scratch 'no-parent')))

    # An empty -To that was there stays empty.
    foreach ($case in @(@('an entry that climbs out', $zClimb), @('an unpack that fails halfway', $zClash))) {
        $to = Join-Path $Scratch ('empty-' + [Guid]::NewGuid().ToString('N').Substring(0, 6))
        $null = New-Item -ItemType Directory -Path $to
        $r = Run-Restore $case[1] $to
        Yes ("empty -To, " + $case[0] + ": the run fails") ($r.Code -ne 0)
        Yes ("empty -To, " + $case[0] + ": -To is still there and still empty") ((Test-Path -LiteralPath $to) -and @(Get-ChildItem -LiteralPath $to -Force).Count -eq 0)
        Yes ("empty -To, " + $case[0] + ": no staging folder is left beside it") ((Get-Stages $Scratch).Count -eq 0)
    }

    # A full -To is refused and not touched, good backup or bad.
    $full = Join-Path $Scratch 'full'
    $null = New-Item -ItemType Directory -Path (Join-Path $full 'keep')
    [IO.File]::WriteAllText((Join-Path $full 'keep\mine.txt'), 'somebody''s file')
    $before = Get-Tree $full
    foreach ($z in @($zGood, $zClash)) {
        $r = Run-Restore $z $full
        Yes ("full -To, " + (Split-Path -Leaf $z) + ": refused") ($r.Code -ne 0)
        Yes ("full -To, " + (Split-Path -Leaf $z) + ": every file in it is as it was") ((Get-Tree $full) -eq $before)
    }

    # Good backups publish every file, byte for byte.
    $ref = Join-Path $Scratch 'ref'; [IO.Compression.ZipFile]::ExtractToDirectory($zGood, $ref); $want = Get-Tree $ref
    $to = Join-Path $Scratch 'ok-missing'
    $r = Run-Restore $zGood $to
    Yes 'missing -To, good backup: the run succeeds' ($r.Code -eq 0)
    Yes 'missing -To, good backup: every file is there, byte for byte' ((Get-Tree $to) -eq $want)
    $to = Join-Path $Scratch 'ok-empty'; $null = New-Item -ItemType Directory -Path $to
    $r = Run-Restore $zGood $to
    Yes 'empty -To, good backup: the run succeeds' ($r.Code -eq 0)
    Yes 'empty -To, good backup: every file is there, byte for byte' ((Get-Tree $to) -eq $want)
    Yes 'no staging folder is left after the good runs' ((Get-Stages $Scratch).Count -eq 0)
    Yes 'the decrypted-zip work folder is left empty' (@(Get-ChildItem -LiteralPath (Join-Path $Scratch 'work') -Force -EA SilentlyContinue).Count -eq 0)
}
finally {
    Remove-Item -LiteralPath $Scratch -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }