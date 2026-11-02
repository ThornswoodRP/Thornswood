<#
  test-release-files.ps1

      pwsh -NoProfile -File .\tests\test-release-files.ps1

  scripts\release\Test-ReleaseFiles.ps1 is what release.yml's "verify" job
  runs on a runner of its own against a signed draft (#2163): each file
  against SHA256SUMS, then the publish gate and the launcher's Signature.cs
  on every program. The draft is the launcher as a folder since #4823:
  Thornswood.exe and the native libraries beside it. A check that passes
  everything is worse than none, so this plants each way a draft can be wrong
  and makes sure each one is refused, offline, with stand-in bytes: a program
  SHA256SUMS does not name, a hash that does not match on the exe or on a
  library, no line for the exe, a line given twice, a name with a path in it,
  a file that is missing, and an unsigned launcher when a signed one is
  required. The signed path needs a real signed launcher, which this
  cannot make offline; it was measured on 12 Oct against the live 1.2.4
  launcher, signed on One (#2163), and the verify job runs it on every signed
  draft.

  Windows only, like the script: Get-AuthenticodeSignature is a Windows
  cmdlet. Writes only under its own temp folder.
#>
[CmdletBinding()]
param()
$env:THORNSWOOD_HARNESS = '1'
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Script = Join-Path (Split-Path -Parent $Here) 'scripts\release\Test-ReleaseFiles.ps1'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  Test-ReleaseFiles.ps1 reads Authenticode, which is Windows only'
    exit 0
}
Yes 'Test-ReleaseFiles.ps1 is there' (Test-Path -LiteralPath $Script)
$t = $null; $e = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$t, [ref]$e)
Yes 'it parses' (@($e).Count -eq 0)

$ps = (Get-Process -Id $PID).Path
$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-release-files-' + [Guid]::NewGuid().ToString('N'))

# A folder shaped like a draft: the launcher and a native library beside it,
# as stand-ins, and a SHA256SUMS for them. $sumsFor names the files listed;
# $wrong puts a hash that is not the file's; $extra adds lines as they are.
function New-Draft([string]$name, [string[]]$sumsFor = @('libSkiaSharp.dll', 'Thornswood.exe'), [string]$wrong = '', [string[]]$leave = @(), [string[]]$extra = @()) {
    $d = Join-Path $work $name
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    [IO.File]::WriteAllText((Join-Path $d 'Thornswood.exe'), 'MZ stand-in launcher, not signed')
    [IO.File]::WriteAllText((Join-Path $d 'libSkiaSharp.dll'), 'MZ stand-in native library')
    $lines = @()
    foreach ($n in $sumsFor) {
        $h = (Get-FileHash -LiteralPath (Join-Path $d $n) -Algorithm SHA256).Hash.ToLower()
        if ($n -eq $wrong) { $h = ('0' * 64) }
        $lines += ("$h  $n")
    }
    $lines += $extra
    Set-Content -LiteralPath (Join-Path $d 'SHA256SUMS') -Value $lines -Encoding ascii
    foreach ($n in $leave) { Remove-Item -LiteralPath (Join-Path $d $n) -Force }
    return $d
}
function Run([string]$dir, [switch]$Signed) {
    $a = @('-NoProfile', '-File', $Script, '-Dir', $dir)
    if ($Signed) { $a += '-RequireSigned' }
    # Continue, so Windows PowerShell 5.1 does not turn a line the child
    # wrote to stderr into a stop here.
    $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $out = & $ps @a 2>&1 | ForEach-Object { [string]$_ }; $code = $LASTEXITCODE }
    finally { $ErrorActionPreference = $old }
    return [pscustomobject]@{ Code = $code; Text = ($out -join "`n") }
}

try {
    New-Item -ItemType Directory -Force -Path $work | Out-Null

    $r = Run (New-Draft 'good')
    Yes "checksums that match pass without -RequireSigned (exit $($r.Code))" ($r.Code -eq 0 -and $r.Text -match 'release files OK')
    Yes '  and it says the launcher is not signed' ($r.Text -match 'Thornswood\.exe Authenticode: (?!Valid)\w+, signed by nobody')
    Yes '  nor the library beside it' ($r.Text -match 'libSkiaSharp\.dll Authenticode: (?!Valid)\w+, signed by nobody')

    $r = Run (New-Draft 'unsigned') -Signed
    Yes "an unsigned launcher is refused when a signed one is required (exit $($r.Code))" ($r.Code -eq 1)
    Yes '  by the publish gate, in its own words' ($r.Text -match 'FAIL  the publish gate' -and $r.Text -match 'not Authenticode Valid')
    Yes '  for every program, the library too' ($r.Text -match 'FAIL  the publish gate and the launcher''s Signature\.cs accept Thornswood\.exe' -and
        $r.Text -match 'FAIL  the publish gate and the launcher''s Signature\.cs accept libSkiaSharp\.dll')
    Yes '  and it says not to ship' ($r.Text -match 'Do not ship these files')

    $r = Run (New-Draft 'mismatch' -wrong 'Thornswood.exe')
    Yes "a launcher whose hash is not its line is refused (exit $($r.Code))" ($r.Code -eq 1 -and $r.Text -match 'FAIL  Thornswood\.exe is the file SHA256SUMS names')

    $r = Run (New-Draft 'libmismatch' -wrong 'libSkiaSharp.dll')
    Yes "a native library whose hash is not its line is refused (exit $($r.Code))" ($r.Code -eq 1 -and $r.Text -match 'FAIL  libSkiaSharp\.dll is the file SHA256SUMS names')

    $r = Run (New-Draft 'noexe' -sumsFor @('libSkiaSharp.dll'))
    Yes "a SHA256SUMS with no line for the launcher is refused (exit $($r.Code))" ($r.Code -eq 1 -and $r.Text -match 'FAIL  SHA256SUMS names Thornswood\.exe')

    $r = Run (New-Draft 'nolib' -sumsFor @('Thornswood.exe'))
    Yes "a library beside the launcher that SHA256SUMS does not name is refused (exit $($r.Code))" ($r.Code -eq 1 -and $r.Text -match 'FAIL  no program here that SHA256SUMS does not name: libSkiaSharp\.dll')

    $r = Run (New-Draft 'twice' -sumsFor @('Thornswood.exe', 'Thornswood.exe', 'libSkiaSharp.dll'))
    Yes "a SHA256SUMS that names the launcher twice is refused (exit $($r.Code))" ($r.Code -eq 1 -and $r.Text -match 'FAIL  every line of SHA256SUMS is a sha256 and a name, each name once')

    $r = Run (New-Draft 'pathname' -extra @(('0' * 64) + '  ..\Thornswood.exe'))
    Yes "a name with a path in it is refused, and nothing outside the folder is read (exit $($r.Code))" ($r.Code -eq 1 -and $r.Text -match 'FAIL  every line of SHA256SUMS is a sha256 and a name, each name once, not: ')

    $r = Run (New-Draft 'missing' -leave @('libSkiaSharp.dll'))
    Yes "a draft with a file missing is refused (exit $($r.Code))" ($r.Code -eq 1 -and $r.Text -match 'FAIL  libSkiaSharp\.dll, which SHA256SUMS names, is there')

    $r = Run (Join-Path $work 'nowhere')
    Yes "a folder that is not there is refused (exit $($r.Code))" ($r.Code -eq 1)

    Yes "the script's words have no em dash" ([IO.File]::ReadAllText($Script).IndexOf([char]0x2014) -lt 0)
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
