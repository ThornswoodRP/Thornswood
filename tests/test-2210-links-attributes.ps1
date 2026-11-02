<#
  test-2210-links-attributes.ps1

      pwsh -NoProfile -File .\tests\test-2210-links-attributes.ps1

  Issue #2210. OwnGame.Links asks every file in the game folder how many names
  it has, on every refresh, up to three times each. It opened each one for
  reading, and opening for reading is what the virus scanner checks: on One,
  12.13 ms a file against 0.20 ms opened for attributes only, which made
  "Preparing the game folder" four minutes whatever had changed.

  WHAT IT CHECKS.
    1. Links opens the file for its attributes alone (FILE_READ_ATTRIBUTES
       through CreateFile), never FileStream with FileAccess.Read.
    2. Links, lifted from launcher\app\OwnGame.cs with what it needs, builds
       the way the launcher project builds (Add-LauncherType, the .NET 10 SDK,
       tests\Launcher-Csc.ps1, #2821), on any system. On Windows it is run
       over scratch files: one name is 1, a hard link makes 2, dropping it is
       1 again, a file another handle holds with no sharing at all is still
       counted, and a missing file throws FileNotFoundException, as
       FileStream did, which every caller catches.

  Writes only a scratch folder under the temp directory, removed at the end.
#>
[CmdletBinding()]
param([string]$AppPath)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
if (-not $AppPath) { $AppPath = Join-Path $Repo 'launcher\app' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}

$og = [IO.File]::ReadAllText((Join-Path $AppPath 'OwnGame.cs'))

function Get-CsMember([string]$text, [string]$declaration) {
    $at = $text.IndexOf($declaration, [StringComparison]::Ordinal)
    if ($at -lt 0) { return $null }
    $i = $text.IndexOf('{', $at + $declaration.Length)
    if ($i -lt 0) { return $null }
    $depth = 0
    while ($i -lt $text.Length) {
        $c = $text[$i]
        $n = if ($i + 1 -lt $text.Length) { $text[$i + 1] } else { [char]0 }
        if ($c -eq '/' -and $n -eq '/') { $i = $text.IndexOf("`n", $i); if ($i -lt 0) { return $null }; continue }
        if ($c -eq '@' -and $n -eq '"') {
            $i += 2
            while ($i -lt $text.Length) {
                if ($text[$i] -eq '"') { if ($i + 1 -lt $text.Length -and $text[$i + 1] -eq '"') { $i += 2; continue }; break }
                $i++
            }
            $i++; continue
        }
        if ($c -eq '"' -or $c -eq "'") {
            $q = $c; $i++
            while ($i -lt $text.Length -and $text[$i] -ne $q) { if ($text[$i] -eq '\') { $i++ }; $i++ }
            $i++; continue
        }
        if ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') {
            $depth--
            if ($depth -eq 0) { return $text.Substring($at, $i + 1 - $at) }
        }
        $i++
    }
    return $null
}

$links = Get-CsMember $og 'static int Links(string path)'
Yes 'Links is in OwnGame.cs' ([bool]$links)
if (-not $links) { Done }
Yes 'Links opens for attributes alone through CreateFile' ($links.Contains('CreateFile(') -and $links.Contains('FileReadAttributes'))
Yes 'Links no longer opens the file for reading' (-not $links.Contains('FileAccess.Read') -and -not $links.Contains('new FileStream'))
Yes 'FileReadAttributes is 0x80 and the share mode lets everything else in' (
    $og -match 'const uint FileReadAttributes = 0x80;' -and $og -match 'const uint FileShareAll = 0x7;')

$struct = Get-CsMember $og 'struct FileInfoByHandle'
$fileTime = Get-CsMember $og 'struct FileTime'
$consts = ([regex]::Matches($og, '(?m)^\s*const uint (FileReadAttributes|FileShareAll|OpenExisting|BackupSemantics) = [^;]+;') | ForEach-Object { $_.Value.Trim() }) -join "`n"
$imports = ([regex]::Matches($og, '(?s)\[LibraryImport\("kernel32\.dll"[^\]]*\]\s*(?:\[return: [^\]]*\]\s*)?private static partial (?:bool GetFileInformationByHandle|SafeFileHandle CreateFile)\([^;]+;') | ForEach-Object { $_.Value }) -join "`n"
Yes 'lifted the two structs, the two imports and the four constants' ($struct -and $fileTime -and ($imports -split 'static partial').Count -eq 3 -and ($consts -split "`n").Count -eq 4)

. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # builds launcher code the way the project does (#2821, #4823)
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }
$ns = 'Links2210_' + [guid]::NewGuid().ToString('N').Substring(0, 8)
$built = $true
try {
$null = Add-LauncherType -Source @"
using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace $ns {
    public static partial class OwnGame {
        $fileTime
        [StructLayout(LayoutKind.Sequential)]
        $struct
        $imports
        $consts
        public $links
    }
}
"@
} catch { $built = $false; Write-Host $_.Exception.Message }
Yes 'Links and what it needs build the way the launcher does' $built
if (-not $built) { Done }
if (-not $OnWindows) {
    Write-Host 'SKIP  2, Links run: it opens the file through CreateFile in kernel32, and the links are made with cmd.exe''s mklink, which only Windows has'
    Done
}
$t = [type]"$ns.OwnGame"

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-2210-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $a = Join-Path $work 'a.txt'
    $b = Join-Path $work 'b.txt'
    [IO.File]::WriteAllText($a, 'one')
    Yes 'a file with one name counts 1' ($t::Links($a) -eq 1)
    & (Get-WindowsPath 'System32\cmd.exe') /c mklink /H "$b" "$a" | Out-Null
    Yes 'a hard link makes 2' ($t::Links($a) -eq 2 -and $t::Links($b) -eq 2)
    $held = [IO.File]::Open($a, 'Open', 'ReadWrite', 'None')
    try { Yes 'a file another handle holds with no sharing is still counted' ($t::Links($b) -eq 2) }
    finally { $held.Dispose() }
    Remove-Item -LiteralPath $b
    Yes 'dropping the link is 1 again' ($t::Links($a) -eq 1)
    $threw = $null
    try { [void]$t::Links((Join-Path $work 'missing.txt')) } catch { $threw = $_.Exception }
    while ($threw -and $threw.InnerException -and $threw -isnot [IO.FileNotFoundException]) { $threw = $threw.InnerException }
    Yes 'a missing file throws FileNotFoundException, as FileStream did' ($threw -is [IO.FileNotFoundException])
}
finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
Done
