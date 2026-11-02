<#
  test-check-build.ps1

  scripts\release\Check-Build.ps1, run for real against a stand-in Data folder
  and a stand-in manifest under %TEMP%. No game server, no network: every run
  passes -Manifest, so the script never asks the VPS for one.

  What this holds Check-Build.ps1 to:
    - a build that is byte for byte the manifest is fine, exit 0;
    - a plugin the manifest names and the folder lacks is missing, exit 2;
    - a plugin of another size is the wrong file, and says both sizes;
    - a plugin of the same size and other bytes is the wrong file too;
    - crc32 is read the way the server writes it (zlib CRC-32 as a signed
      int32, so half of all files carry a negative number), and the same
      number written unsigned is the same file, not a crash;
    - a manifest saved with a BOM still reads;
    - -All lists the fine ones;
    - a manifest with no mods, a manifest that is not there and a Data folder
      that is not there each stop with exit 1;
    - a plugin name with [ ] in it is found.
#>
[CmdletBinding()]
param([string]$Scratch)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
# What this runs, every machine runs in PowerShell 7 since #5356, the box
# included, and this harness runs in it too.
$boxPs = Get-BoxPowerShell
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repoRoot = Split-Path -Parent $Here
$script = Join-Path $repoRoot 'scripts\release\Check-Build.ps1'
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# The harness's own crc32, small files only, written independently of the
# script's compiled one so the two check each other.
$poly = [Convert]::ToUInt32('EDB88320', 16)
$all = [uint32]::MaxValue
$tbl = New-Object 'uint32[]' 256
for ($i = 0; $i -lt 256; $i++) {
    [uint32]$c = $i
    for ($k = 0; $k -lt 8; $k++) { if ($c -band 1) { $c = [uint32]($poly -bxor ($c -shr 1)) } else { $c = $c -shr 1 } }
    $tbl[$i] = $c
}
function CrcU([string]$p) {
    [uint32]$c = $all
    foreach ($b in [IO.File]::ReadAllBytes($p)) { $c = [uint32]($tbl[($c -bxor $b) -band 0xFF] -bxor ($c -shr 8)) }
    return [uint32]($c -bxor $all)
}
function CrcS([string]$p) { [BitConverter]::ToInt32([BitConverter]::GetBytes((CrcU $p)), 0) }

$root = Join-Path $Scratch ('ts-check-build-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$data = Join-Path $root 'Data'
$null = New-Item -ItemType Directory -Force -Path $data
function Put([string]$name, [string]$text) { [IO.File]::WriteAllText((Join-Path $data $name), $text) }

# A plugin whose crc32 has its top bit set, so the signed form is negative.
$n = 0
do { $n++; Put 'High.esp' ("high bit $n"); } while ((CrcU (Join-Path $data 'High.esp')) -lt [uint32]2147483648)
Put 'Skyrim.esm' 'the master'
Put 'Mod [Patch].esp' 'bracketed'

function Entry([string]$name, [switch]$Unsigned) {
    $p = Join-Path $data $name
    $crc = if ($Unsigned) { [int64](CrcU $p) } else { [int64](CrcS $p) }
    [ordered]@{ filename = $name; size = (Get-Item -LiteralPath $p).Length; crc32 = $crc }
}
function Manifest([object[]]$mods, [switch]$Bom) {
    $p = Join-Path $root ('m-' + [guid]::NewGuid().ToString('N').Substring(0, 6) + '.json')
    $json = (@{ mods = $mods } | ConvertTo-Json -Depth 5)
    [IO.File]::WriteAllText($p, $json, (New-Object Text.UTF8Encoding($Bom.IsPresent)))
    $p
}
function Run([string]$man, [string]$dataDir = $data, [switch]$All) {
    $a = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $script, '-Data', $dataDir, '-Manifest', $man, '-NoPause')
    if ($All) { $a += '-All' }
    $eap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $out = (& $boxPs @a 2>&1 | Out-String)
    $code = $LASTEXITCODE; $ErrorActionPreference = $eap
    [pscustomobject]@{ Code = $code; Out = $out }
}

try {
    Yes 'stand-in: High.esp has a negative signed crc32' ((CrcS (Join-Path $data 'High.esp')) -lt 0)

    $good = @((Entry 'Skyrim.esm'), (Entry 'High.esp'), (Entry 'Mod [Patch].esp'))
    $r = Run (Manifest $good)
    Yes 'a build that matches is fine, exit 0' ($r.Code -eq 0 -and $r.Out -match '3 fine, 0 missing, 0 the wrong file')
    Yes 'and says it is byte for byte what the server expects' ($r.Out -match 'byte for byte what the server expects')
    Yes 'a negative crc32 matches (the signed form the server writes)' ($r.Out -notmatch 'High\.esp')
    Yes 'a plugin with [ ] in its name is found' ($r.Out -cnotmatch 'Missing \(')

    $r = Run (Manifest $good -Bom)
    Yes 'a manifest saved with a BOM still reads' ($r.Code -eq 0 -and $r.Out -match '3 fine')

    $r = Run (Manifest $good) -All
    Yes '-All lists the fine ones' ($r.Out -match 'Fine \(3\)' -and $r.Out -match 'Skyrim\.esm')

    $uns = @((Entry 'Skyrim.esm' -Unsigned), (Entry 'High.esp' -Unsigned))
    $r = Run (Manifest $uns)
    Yes 'the same crc32 written unsigned is the same file, not a crash' ($r.Code -eq 0 -and $r.Out -match '2 fine, 0 missing, 0 the wrong file')

    $miss = @((Entry 'Skyrim.esm')) + @([ordered]@{ filename = 'Gone.esp'; size = 10; crc32 = 1 })
    $r = Run (Manifest $miss)
    Yes 'a plugin the folder lacks is missing, exit 2' ($r.Code -eq 2 -and $r.Out -match 'Missing \(1\)' -and $r.Out -match 'Gone\.esp')

    $e = Entry 'Skyrim.esm'; $e.size = $e.size + 5
    $r = Run (Manifest @($e))
    Yes 'another size is the wrong file, both sizes said, exit 2' ($r.Code -eq 2 -and $r.Out -match 'Wrong file \(1\)' -and $r.Out -match 'bytes, the server has')

    $e = Entry 'Skyrim.esm'; $e.crc32 = $e.crc32 + 1
    $r = Run (Manifest @($e))
    Yes 'the same size with other bytes is the wrong file' ($r.Code -eq 2 -and $r.Out -match 'same size, different contents')

    $r = Run (Manifest @())
    Yes 'a manifest with no mods stops, exit 1' ($r.Code -eq 1 -and $r.Out -match 'no mods')
    $r = Run (Join-Path $root 'nope.json')
    Yes 'a manifest that is not there stops, exit 1' ($r.Code -eq 1 -and $r.Out -match 'No such manifest')
    $r = Run (Manifest $good) (Join-Path $root 'NoData')
    Yes 'a Data folder that is not there stops, exit 1' ($r.Code -eq 1 -and $r.Out -match 'No such folder')
}
finally {
    Remove-Item -LiteralPath $root -Recurse -Force -EA SilentlyContinue
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail -gt 0) { exit 1 }
exit 0
