<#
.SYNOPSIS
  Checks the files of a launcher release draft on any machine, with no signing setup: each against SHA256SUMS, and with -RequireSigned every program's signature the way an installed launcher checks it (issue #2163).

.DESCRIPTION
  release.yml drafts the launcher for each v<version> tag: Thornswood.exe,
  the native libraries beside it (#4823, the launcher is compiled to native
  code and is a folder) and SHA256SUMS with a line for each. Since #2163 its
  hosted job signs every program there, and its "verify" job downloads that
  draft onto a runner of its own, which holds no signing client, no
  records\signing\signing.json and no Azure sign in, and runs this. So a
  signed release is accepted by a second machine on its files alone before
  anybody ships it. The same command checks a draft by hand anywhere:
  download its files into one folder and point -Dir at it.

  The checks, in order, each printed as PASS or FAIL:
    1. SHA256SUMS is there and names Thornswood.exe; it names each file once,
       each file it names is there and its sha256 is its line, and no program
       (.exe or .dll) is in the folder that it does not name (the checksum
       layer stays first, as Ship has it).
    2. With -RequireSigned: the publish gate (Get-PublishSignRefusal in
       Assert-PublishSigned.ps1) accepts every program it names. That is
       Authenticode Valid, a Subject naming ExpectedSigner, and
       launcher\app\Signature.cs, the class every installed launcher uses to
       accept an update.
    3. With -RequireSigned: a copy of Thornswood.exe with one byte changed
       inside what Authenticode hashes (the DOS stub text) is refused by both
       the checksum and the signature check, so a failed signature is a
       refusal on this very file, not only on the pilot's.
  Until #4824 the draft also carried setup-stub.exe, the old installer's
  program, which went with it. Exit 0 only when every check holds. Reads
  only; writes nothing but a temporary copy for check 3, which it removes.

.PARAMETER Dir
  The folder holding SHA256SUMS and every file it names.

.PARAMETER RequireSigned
  Every program has to pass the publish gate and the launcher's own check.
  Without it only the checksums are checked and the signatures are reported.

.PARAMETER ExpectedSigner
  What the signer's Subject has to contain. Without it, ExpectedSigner from
  launcher\app\Updater.cs in this checkout.

.EXAMPLE
  .\scripts\release\Test-ReleaseFiles.ps1 -Dir $env:TEMP\draft -RequireSigned
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Dir,
    [switch]$RequireSigned,
    [string]$ExpectedSigner
)
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = (Resolve-Path (Join-Path $Here '..\..')).Path
. (Join-Path $Here 'Assert-PublishSigned.ps1')

$script:fails = 0
function Check([bool]$ok, [string]$what) {
    if ($ok) { Write-Host ('PASS  ' + $what) -ForegroundColor Green }
    else { Write-Host ('FAIL  ' + $what) -ForegroundColor Red; $script:fails++ }
}
function Sha([string]$p) { return (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() }
function Finish {
    if ($script:fails) { Write-Host ("{0} check(s) failed. Do not ship these files." -f $script:fails) -ForegroundColor Red; exit 1 }
    Write-Host 'release files OK' -ForegroundColor Green
    exit 0
}

$exe = Join-Path $Dir 'Thornswood.exe'
$sums = Join-Path $Dir 'SHA256SUMS'
Check (Test-Path -LiteralPath $sums) 'SHA256SUMS is there'
if ($script:fails) { Finish }

# 1. Each line "<sha256>  <name>" (sha256sum's shape), each name once.
$lines = @([IO.File]::ReadAllLines($sums) | Where-Object { $_.Trim() })
$named = [ordered]@{}
$odd = @()
foreach ($line in $lines) {
    $m = [regex]::Match($line, '(?i)^\s*([0-9a-f]{64})\s+\*?([A-Za-z0-9][A-Za-z0-9._-]*)\s*$')
    if (-not $m.Success) { $odd += $line; continue }
    $n = $m.Groups[2].Value
    if ($named.Contains($n)) { $odd += $line; continue }
    $named[$n] = $m.Groups[1].Value.ToLowerInvariant()
}
Check ($odd.Count -eq 0) ('every line of SHA256SUMS is a sha256 and a name, each name once' + $(if ($odd.Count) { ', not: ' + ($odd -join ' | ') } else { '' }))
Check ($named.Contains('Thornswood.exe')) 'SHA256SUMS names Thornswood.exe'
foreach ($n in @($named.Keys)) {
    $p = Join-Path $Dir $n
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { Check $false "$n, which SHA256SUMS names, is there"; continue }
    $have = Sha $p
    Check ($have -eq $named[$n]) ("$n is the file SHA256SUMS names (" + $have + ')')
}
$loose = @(Get-ChildItem -LiteralPath $Dir -File | Where-Object { $_.Extension -in '.exe', '.dll' -and -not $named.Contains($_.Name) } | ForEach-Object { $_.Name })
Check ($loose.Count -eq 0) ('no program here that SHA256SUMS does not name' + $(if ($loose.Count) { ': ' + ($loose -join ', ') } else { '' }))
if ($script:fails) { Finish }

$programs = @($named.Keys | Where-Object { [IO.Path]::GetExtension($_) -in '.exe', '.dll' })
foreach ($n in $programs) {
    $sig = Get-AuthenticodeSignature -LiteralPath (Join-Path $Dir $n)
    $who = if ($sig.SignerCertificate) { $sig.SignerCertificate.Subject } else { 'nobody' }
    Write-Host ('      ' + $n + ' Authenticode: ' + $sig.Status + ', signed by ' + $who)
}

if ($RequireSigned) {
    if (-not $ExpectedSigner) { $ExpectedSigner = Get-ExpectedSignerFragment -RepoRoot $Repo }
    # 2. The publish gate and the launcher's own check, on every program.
    foreach ($n in $programs) {
        $why = Get-PublishSignRefusal -Path (Join-Path $Dir $n) -ExpectedSigner $ExpectedSigner
        Check (-not $why) ("the publish gate and the launcher's Signature.cs accept $n" + $(if ($why) { ': ' + $why } else { '' }))
    }
    if ($script:fails) { Finish }
    # 3. One byte changed where Authenticode hashes: refused by both checks.
    # Offset 0x4E is the DOS stub text. A byte in the signature blob itself
    # is outside the hash and proves nothing (docs\SIGNED-RELEASES.md 7).
    # Only for a launcher check 2 accepted: on one it refused, there is no
    # signature for a changed byte to break.
    $bad = Join-Path ([IO.Path]::GetTempPath()) ('release-files-tampered-' + [guid]::NewGuid().ToString('N') + '.exe')
    try {
        $b = [IO.File]::ReadAllBytes($exe); $b[0x4E] = $b[0x4E] -bxor 0xFF
        [IO.File]::WriteAllBytes($bad, $b)
        Check ((Sha $bad) -ne (Sha $exe)) 'a one byte change fails the checksum'
        Check ([bool](Get-PublishSignRefusal -Path $bad -ExpectedSigner $ExpectedSigner)) 'a one byte change fails the signature check'
    } finally { Remove-Item -LiteralPath $bad -Force -ErrorAction SilentlyContinue }
}
Finish
