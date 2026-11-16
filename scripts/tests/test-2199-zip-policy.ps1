<#
  test-2199-zip-policy.ps1

  Restore-Backup.ps1 holds a backup zip to an entry policy of its own before
  anything is written, and writes every entry itself rather than handing the
  zip to ExtractToDirectory (issue #2199).

  Adversarial zips are built here entry by entry, so their names and their
  external attributes are exactly what this says, and each is run through the
  real Restore-Backup.ps1 (unencrypted, so no key is needed). Each must be
  refused with its named reason, with nothing made at -To, no staging folder
  left beside it and nothing written outside it, and -CheckOnly must refuse it
  too so Fetch-Backups' check catches it. A good backup still unpacks.

  Cases: traversal, a rooted name, a drive name, an alternate stream, a
  symlink and a device by unix mode, a reparse point by Windows attribute, a
  case and slash collision, a file where a folder is needed, a reserved
  device name, a part ending in a dot, a doubled slash, an oversized name.

  Windows PowerShell 5.1 and PowerShell 7. Touches nothing outside a scratch
  folder under the temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Unpack = Join-Path (Split-Path -Parent (Split-Path -Parent $Here)) 'scripts\vps\Restore-Backup.ps1'
$exe = (Get-Process -Id $PID).Path

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-2199-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $root

$living = '{"profileId": 7, "isDeleted": false}'
# The good part every zip carries, so a refusal is the bad entry's doing.
$good = @(
    @{ Name = 'NOTES.txt'; Text = 'taken today' },
    @{ Name = 'game/world/changeForms/0.json'; Text = $living },
    @{ Name = 'game/private/'; Dir = $true }
)

$n = 0
function New-Zip([object[]]$extra) {
    $script:n++
    $zip = Join-Path $root ("z{0}.zip" -f $script:n)
    $fs = [IO.File]::Open($zip, 'CreateNew')
    $za = New-Object IO.Compression.ZipArchive($fs, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($e in ($good + $extra)) {
            $en = $za.CreateEntry($e.Name)
            if ($e.ContainsKey('Attr')) { $en.ExternalAttributes = [int]$e.Attr }
            if (-not $e.Dir) {
                $w = New-Object IO.StreamWriter($en.Open())
                try { $w.Write([string]$e.Text) } finally { $w.Dispose() }
            }
        }
    } finally { $za.Dispose(); $fs.Dispose() }
    return $zip
}

function Run([string]$zip, [string[]]$more) {
    $to = Join-Path $root ('out' + $script:n)
    $work = Join-Path $root ('work' + $script:n)
    $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $Unpack, '-Backup', $zip, '-To', $to, '-Work', $work, '-NoPause') + $more
    $out = (& $exe @argv 2>&1 | Out-String)
    [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out; To = $to }
}

function Stray {
    @(Get-ChildItem -LiteralPath $root -Force | Where-Object { $_.Name -like '.out*' -or $_.Name -like 'evil*' -or $_.Name -like '.restore-probe*' })
}

try {
    $r = Run (New-Zip @()) @()
    Yes "a good backup still unpacks (exit $($r.Code))" (
        $r.Code -eq 0 -and (Test-Path -LiteralPath (Join-Path $r.To 'game\world\changeForms\0.json')) -and
        (Test-Path -LiteralPath (Join-Path $r.To 'game\private') -PathType Container))

    $cases = @(
        @('traversal',                  @{ Name = '../evil.txt'; Text = 'x' },                       'outside the folder'),
        @('a rooted name',              @{ Name = '/evil-rooted.txt'; Text = 'x' },                  'outside the folder'),
        @('a drive name',               @{ Name = 'C:/evil-drive.txt'; Text = 'x' },                 'outside the folder'),
        @('an alternate data stream',   @{ Name = 'NOTES2.txt:hidden'; Text = 'x' },                 'outside the folder'),
        @('a symlink (unix mode)',      @{ Name = 'game/link'; Text = 'C:/Windows'; Attr = (0xA1FF -shl 16) }, 'unsupported entry type'),
        @('a device (unix mode)',       @{ Name = 'game/dev'; Text = ''; Attr = (0x21B6 -shl 16) },  'unsupported entry type'),
        @('a reparse point (Windows)',  @{ Name = 'game/junction'; Text = ''; Attr = 0x400 },        'unsupported entry type'),
        @('a case and slash collision', @{ Name = 'GAME\World\changeForms\0.json'; Text = $living }, 'collision'),
        @('a file where a folder is needed', @{ Name = 'game/world'; Text = 'x' },                   'collision'),
        @('a reserved device name',     @{ Name = 'game/CON.txt'; Text = 'x' },                      'bad name'),
        @('a part ending in a dot',     @{ Name = 'game/evil./x.txt'; Text = 'x' },                  'bad name'),
        @('a doubled slash',            @{ Name = 'game//x.txt'; Text = 'x' },                       'bad name'),
        @('an oversized name',          @{ Name = ('game/' + ('a' * 300) + '.txt'); Text = 'x' },    'oversized')
    )
    foreach ($c in $cases) {
        $zip = New-Zip @($c[1])
        $r = Run $zip @()
        Yes ("{0}: refused with '{1}' (exit {2})" -f $c[0], $c[2], $r.Code) ($r.Code -ne 0 -and $r.Out -match [regex]::Escape($c[2]))
        Yes ("  nothing made at -To, no staging folder left, nothing outside") (
            -not (Test-Path -LiteralPath $r.To) -and (Stray).Count -eq 0 -and
            -not (Test-Path -LiteralPath (Join-Path (Split-Path -Parent $root) 'evil.txt')))
        $r = Run $zip @('-CheckOnly')
        Yes ("  and -CheckOnly refuses it too (exit {0})" -f $r.Code) ($r.Code -ne 0 -and $r.Out -match 'entry policy')
    }

    $src = (Get-Content -LiteralPath $Unpack -Raw)
    Yes 'Restore-Backup no longer calls ExtractToDirectory' ($src -notmatch '\]::ExtractToDirectory\(')
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
