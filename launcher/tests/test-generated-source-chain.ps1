<#
  test-generated-source-chain.ps1

      pwsh -NoProfile -File .\launcher\tests\test-generated-source-chain.ps1

  Get-GeneratedLoosePandoraFiles (scripts\mods\Generated.ps1) reads Pandora's
  files from Vortex's record in the folder an install's game folder was made
  from (made.txt source=). On One on 11 Oct the dev release folder and the main
  install were both made from C:\Thornswood-DevBuild\Game, a Thornswood folder
  that holds no Vortex record, so every Ship from them stopped; then that folder
  was deleted. It now follows each Thornswood folder's record back to the one
  Vortex deploys into, and falls back to the game folder the record names.

  WHAT IT CHECKS, on scratch folders under the temp directory:
    1. source= is the Vortex folder itself: read from there.
    2. source= is another Thornswood folder: followed back to the Vortex folder.
    3. that Thornswood folder is gone: game= is used.
    4. two records naming each other end the chain rather than spinning, and
       game= is still used.
    5. no record anywhere: refused, naming the record it looked for.
    6. a byte order mark at the start of made.txt does not hide source=.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot) }
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
. (Join-Path $Repo 'scripts\mods\Generated.ps1')

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-gensrc-' + [guid]::NewGuid().ToString('N'))
function Made([string]$root, [string]$text, [switch]$Bom) {
    $d = Join-Path $root 'Profile\OwnGame'
    New-Item -ItemType Directory -Force -Path $d | Out-Null
    $enc = New-Object Text.UTF8Encoding($Bom.IsPresent)
    [IO.File]::WriteAllText((Join-Path $d 'made.txt'), $text, $enc)
}
function Try-Files([string]$root) {
    try { return @(Get-GeneratedLoosePandoraFiles $root) -join ',' } catch { return 'THREW ' + $_.Exception.Message }
}

try {
    $steam = Join-Path $work 'steam'
    New-Item -ItemType Directory -Force -Path (Join-Path $steam 'Data') | Out-Null
    $record = '{"stagingPath":"x","files":[' +
        '{"relPath":"Pandora Behaviour Engine+.exe","source":"Pandora"},' +
        '{"relPath":"Pandora_Engine\\a.txt","source":"Pandora"},' +
        '{"relPath":"other.esp","source":"Other"}]}'
    [IO.File]::WriteAllText((Join-Path $steam 'Data\vortex.deployment.json'), $record)

    $dev = Join-Path $work 'devbuild'
    New-Item -ItemType Directory -Force -Path (Join-Path $dev 'Game\Data') | Out-Null
    Made $dev "source=$steam`r`ngame=$steam`r`n"
    $rel = Join-Path $work 'release'
    Made $rel "source=$(Join-Path $dev 'Game')`r`ngame=$steam`r`n"

    $want = 'Pandora Behaviour Engine+.exe,Pandora_Engine\a.txt'
    Yes '1: source is the Vortex folder, read from there' ((Try-Files $dev) -eq $want)
    Yes '2: source is another Thornswood folder, followed back to the Vortex folder' ((Try-Files $rel) -eq $want)

    $bom = Join-Path $work 'bom'
    Made $bom "source=$steam`r`ngame=$steam`r`n" -Bom
    Yes '6: a byte order mark does not hide source=' ((Try-Files $bom) -eq $want)

    Remove-Item -LiteralPath $dev -Recurse -Force
    Yes '3: that Thornswood folder is gone, so game= is used' ((Try-Files $rel) -eq $want)

    $a = Join-Path $work 'a'; $b = Join-Path $work 'b'
    New-Item -ItemType Directory -Force -Path (Join-Path $a 'Game'), (Join-Path $b 'Game') | Out-Null
    Made $a "source=$(Join-Path $b 'Game')`r`ngame=$steam`r`n"
    Made $b "source=$(Join-Path $a 'Game')`r`ngame=$steam`r`n"
    Yes '4: two records naming each other end the chain, and game= is used' ((Try-Files $a) -eq $want)

    $none = Join-Path $work 'none'
    Made $none "source=$(Join-Path $work 'nowhere')`r`ngame=$(Join-Path $work 'nowhere-either')`r`n"
    $r = Try-Files $none
    Yes '5: no record anywhere is refused, naming the record it looked for' ($r -like "THREW Vortex's record (*vortex.deployment.json) cannot be read*")
}
finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
