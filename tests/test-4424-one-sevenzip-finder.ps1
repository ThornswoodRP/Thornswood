<#
  test-4424-one-sevenzip-finder.ps1

      pwsh -NoProfile -File tests/test-4424-one-sevenzip-finder.ps1

  #4424. Nexus.ps1's Find-SevenZip (the Nexus scripts) and LoadOrder.ps1's
  Get-SevenZipPath (Check-CollectionRules) looked for 7-Zip by different
  rules, and the Add scripts in scripts\oneoff each carried a third list. So
  one machine could unpack a collection revision with the Nexus scripts while
  Check-CollectionRules said it had no 7-Zip, or the other way round on a PC
  with only Vortex's copy. This holds one finder, Find-SevenZip in
  scripts\release\SevenZip.ps1, for all of them:

    O  one finder: Find-SevenZip is defined once, in SevenZip.ps1, and no
       other script under scripts defines a 7-Zip finder or names a place
       7z.exe is installed; Nexus.ps1, LoadOrder.ps1, Get-SevenZip.ps1 and
       every Add script dot-source SevenZip.ps1; the Nexus scripts' "no
       7-Zip" messages say where it looked from the finder, not a list of
       their own.
    M  stand-in machines (scratch Program Files, Program Files (x86), per-user
       folder, data folder and PATH): Nexus.ps1 and LoadOrder.ps1, each
       loaded on its own, find the same 7-Zip, the one the rule names.
    G  Get-SevenZip.ps1 -Check prints the place the finder looks for 7-Zip's
       own Linux build, on any machine that is not Windows.

  Needs nothing but pwsh. Writes only under a temp folder.
#>
$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'Windows.ps1')   # $OnWindows and Get-BoxPowerShell (#2957)
$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond, [string]$why = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what"; if ($why) { Write-Host "      $why" } }
}
function Skip([string]$what) { Write-Host "SKIP  $what" }
function Src([string]$rel) { return [IO.File]::ReadAllText((Join-Path $Repo $rel)) }

$Scripts = Join-Path $Repo 'scripts'
$finderRel = 'scripts/release/SevenZip.ps1'
$all = @(Get-ChildItem -LiteralPath $Scripts -Recurse -File -Include '*.ps1', '*.psm1')
function RelOf($f) { return ($f.FullName.Substring($Repo.Length + 1) -replace '\\', '/') }

# ------------------------------------------------------------------ O
$definers = @($all | Where-Object { [IO.File]::ReadAllText($_.FullName) -match '(?m)^\s*function\s+(Find|Get)-[\w-]*SevenZip[\w-]*\b' } | ForEach-Object { RelOf $_ })
Yes 'O1 the only script under scripts that defines a function finding 7-Zip (Find- or Get-) is scripts/release/SevenZip.ps1' ($definers.Count -eq 1 -and $definers[0] -eq $finderRel) ($definers -join ', ')
$finds = @($all | Where-Object { ([IO.File]::ReadAllText($_.FullName) -split "`n" | Where-Object { $_ -match '(?m)^\s*function\s+Find-SevenZip\b' }).Count } | ForEach-Object { RelOf $_ })
Yes 'O2 Find-SevenZip is defined once' ($finds.Count -eq 1) ($finds -join ', ')
$spots = @($all | Where-Object { (RelOf $_) -ne $finderRel -and [IO.File]::ReadAllText($_.FullName) -match '(?i)7-Zip[\\/]+7z\.exe|resources[\\/]+7z\.exe' } | ForEach-Object { RelOf $_ })
Yes 'O3 no other script under scripts names a place 7z.exe is installed' ($spots.Count -eq 0) ($spots -join ', ')

$callers = @('scripts/release/Nexus.ps1', 'scripts/mods/LoadOrder.ps1', 'scripts/release/Get-SevenZip.ps1')
$callers += @(Get-ChildItem -LiteralPath (Join-Path $Scripts 'oneoff') -Filter 'Add-*.ps1' | Where-Object { [IO.File]::ReadAllText($_.FullName) -match '7-Zip' } | ForEach-Object { RelOf $_ })
foreach ($c in $callers) {
    $t = Src $c
    Yes "O4 $c dot-sources SevenZip.ps1" ($t -match "(?m)^\s*\.\s*\(Join-Path\s+\S+\s+'(\.\.\\release\\)?SevenZip\.ps1'\)")
}
$said = @($all | Where-Object { [IO.File]::ReadAllText($_.FullName) -match '7z\.exe in Program Files, or 7z, 7zz or 7za on PATH' } | ForEach-Object { RelOf $_ })
Yes 'O5 no "no 7-Zip" message carries a list of its own; each asks the finder where it looked' ($said.Count -eq 0) ($said -join ', ')

# ------------------------------------------------------------------ M
$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-4424-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $T | Out-Null
$pwsh = Get-BoxPowerShell
try {
    # The child sets the stand-in places itself before it loads the script:
    # Windows sets ProgramFiles and ProgramFiles(x86) afresh for every new
    # process, so a value the parent set never reaches the child there.
    $runner = Join-Path $T 'find.ps1'
    [IO.File]::WriteAllText($runner, @'
param([string]$Lib, [string]$PF, [string]$PF86, [string]$Local, [string]$Data, [string]$Bin)
$ErrorActionPreference = 'Stop'
try {
    $env:ProgramFiles = $PF; ${env:ProgramFiles(x86)} = $PF86; $env:LOCALAPPDATA = $Local
    $env:XDG_DATA_HOME = $Data; $env:PATH = $Bin
    . $Lib
    $got = if (Get-Command Find-SevenZip -ErrorAction SilentlyContinue) { Find-SevenZip } elseif (Get-Command Get-SevenZipPath -ErrorAction SilentlyContinue) { Get-SevenZipPath } else { 'NO FINDER' }
    Write-Output ('GOT=' + [string]$got)
} catch { Write-Output ('THREW=' + $_.Exception.Message) }
'@)

    function Put([string]$path) {
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
        [IO.File]::WriteAllText($path, 'a stand-in for 7-Zip')
        if (-not $OnWindows) { [IO.File]::SetUnixFileMode($path, [IO.UnixFileMode]'UserRead, UserWrite, UserExecute') }
        return $path
    }
    function P([string]$root, [string[]]$parts) { $p = $root; foreach ($x in $parts) { $p = Join-Path $p $x }; return $p }
    $exe = if ($OnWindows) { '.exe' } else { '' }

    # One stand-in machine: fresh folders, and only what $make puts there.
    function Machine([string]$name, [scriptblock]$make) {
        $m = Join-Path $T $name
        $env = @{
            PF = (Join-Path $m 'pf'); PF86 = (Join-Path $m 'pf86'); Local = (Join-Path $m 'local')
            Data = (Join-Path $m 'data'); Bin = (Join-Path $m 'bin')
        }
        foreach ($d in $env.Values) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
        $want = & $make $env
        $got = @{}
        foreach ($lib in 'scripts/release/Nexus.ps1', 'scripts/mods/LoadOrder.ps1') {
            $o = @(& $pwsh -NoProfile -File $runner -Lib (Join-Path $Repo $lib) -PF $env.PF -PF86 $env.PF86 -Local $env.Local -Data $env.Data -Bin $env.Bin 2>&1 | ForEach-Object { "$_" })
            $line = @($o | Where-Object { $_ -match '^(GOT|THREW)=' }) | Select-Object -Last 1
            $got[$lib] = if ($line) { $line } else { 'SAID ' + ($o -join ' ') }
        }
        $n = $got['scripts/release/Nexus.ps1']; $l = $got['scripts/mods/LoadOrder.ps1']
        Yes "M $name`: Nexus.ps1 finds $(if ($want) { 'the one the rule names' } else { 'none' })" ($n -eq ('GOT=' + $want)) "Nexus.ps1: $n; wanted $want"
        Yes "M $name`: LoadOrder.ps1 finds the same" ($l -eq ('GOT=' + $want)) "LoadOrder.ps1: $l; wanted $want"
    }

    Machine 'vortex-only' { param($e) Put (P $e.PF @('Black Tree Gaming Ltd', 'Vortex', 'resources', '7z.exe')) }
    Machine 'per-user-7zip' { param($e) Put (P $e.Local @('Programs', '7-Zip', '7z.exe')) }
    Machine 'x86-7zip' { param($e) Put (P $e.PF86 @('7-Zip', '7z.exe')) }
    Machine 'installed-before-vortex' { param($e) $w = Put (P $e.PF @('7-Zip', '7z.exe')); $null = Put (P $e.PF @('Black Tree Gaming Ltd', 'Vortex', 'resources', '7z.exe')); $w }
    Machine 'path-7zz-before-7z' { param($e) $null = Put (P $e.Bin @('7z' + $exe)); Put (P $e.Bin @('7zz' + $exe)) }
    Machine 'nothing' { param($e) '' }
    if (-not $OnWindows) {
        Machine 'own-build-before-path' { param($e) $null = Put (P $e.Bin @('7zz')); Put (P $e.Data @('thornswood', '7zip-25.01', '7zz')) }
    } else { Skip 'M own-build-before-path: 7-Zip''s own Linux build is looked for only off Windows' }

    # -------------------------------------------------------------- G
    if (-not $OnWindows) {
        $data = Join-Path $T 'g-data'
        $own = Put (P $data @('thornswood', '7zip-25.01', '7zz'))
        $was = $env:XDG_DATA_HOME
        try {
            $env:XDG_DATA_HOME = $data
            $o = @(& $pwsh -NoProfile -File (Join-Path $Repo 'scripts/release/Get-SevenZip.ps1') -Check 2>&1 | ForEach-Object { "$_" })
            $code = $LASTEXITCODE
        } finally { $env:XDG_DATA_HOME = $was }
        Yes 'G Get-SevenZip.ps1 -Check prints the place the finder looks, on this machine too' ($code -eq 0 -and ($o | Select-Object -Last 1) -eq $own) ("exit $code`: " + ($o -join ' '))
    } else { Skip 'G Get-SevenZip.ps1 is for Linux' }
}
finally { if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force } }

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
if ($script:fail) { exit 1 }
