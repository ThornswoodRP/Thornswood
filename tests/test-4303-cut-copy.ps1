<#
  test-4303-cut-copy.ps1

      pwsh -NoProfile -File .\tests\test-4303-cut-copy.ps1

  Install-NexusRevision -Game copies a file when it cannot hard link it (another
  drive, or a file placed twice). It copied straight onto the name files.txt
  lists, so a run cut part way through a copy (a window closed, Ctrl+C, power
  lost) left that name short, and every run again stopped on it, saying
  something else wrote it (#4303). This holds that:
    1. NexusLayout.CopyWhole writes the copy as <name>.part and renames it once
       every byte is in: the file is whole and no .part is left;
    2. a .part already there stops the copy, and the name stays unwritten;
    3. LinkOrCopy's copy and the script's second placing of one file both go
       through CopyWhole, and nothing in the placing step copies onto $to;
    4. a run again takes out the .part of each file its files.txt lists.
  The run again over a real cut layout is test-2754's, on Windows.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
$cs = Join-Path $repo 'scripts/release/NexusLayout.cs'
$inr = [IO.File]::ReadAllText((Join-Path $repo 'scripts/release/Install-NexusRevision.ps1'))
$src = [IO.File]::ReadAllText($cs)
Add-Type -LiteralPath $cs
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4303-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
New-Item -ItemType Directory -Force -Path $T | Out-Null
try {
    $has = [bool]([Thornswood.Layout.NexusLayout].GetMethod('CopyWhole'))
    Yes 'NexusLayout has CopyWhole, the copy written under a name of its own and renamed' $has
    if ($has) {
        $from = Join-Path $T 'from.bin'
        $bytes = [byte[]]::new(3 * 1MB); (New-Object Random 4303).NextBytes($bytes)
        [IO.File]::WriteAllBytes($from, $bytes)
        $to = Join-Path $T 'Data/meshes/a.nif'
        [Thornswood.Layout.NexusLayout]::CopyWhole($from, $to)
        Yes '  the copy is whole, and no .part is left beside it' ((Test-Path -LiteralPath $to) -and [Thornswood.Layout.NexusLayout]::Sha256Of($to) -eq [Thornswood.Layout.NexusLayout]::Sha256Of($from) -and -not (Test-Path -LiteralPath ($to + '.part')))
        $to2 = Join-Path $T 'Data/meshes/b.nif'
        [IO.File]::WriteAllText($to2 + '.part', 'short')
        $threw = $false
        try { [Thornswood.Layout.NexusLayout]::CopyWhole($from, $to2) } catch { $threw = $true }
        Yes '  a .part already there stops it, and the name stays unwritten' ($threw -and -not (Test-Path -LiteralPath $to2))
    }
    $body = [regex]::Match($src, '(?s)public static bool LinkOrCopy\(string from, string to\)\s*\{(.*?)\n        \}').Groups[1].Value
    Yes 'LinkOrCopy copies through CopyWhole, never onto its own name' ($body -match 'CopyWhole\(from, to\)' -and $body -notmatch 'File\.Copy\(')
    $place = [regex]::Match($inr, '(?s)\$used = New-Object.*?\$lines\[0\] = \$whole').Value
    Yes 'the placing step copies a file placed twice through CopyWhole, and onto $to nowhere' ($place -match 'CopyWhole\(\$x\.Full, \$to\)' -and $place -notmatch '\[IO\.File\]::Copy\(')
    $out = [regex]::Match($inr, '(?s)the earlier layout''s files are being taken out\.''(.*?)# Folders the old layout left empty').Groups[1].Value
    Yes 'a run again takes out the .part of each file its files.txt lists' ($out -match '\.part')
}
finally {
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
}
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
