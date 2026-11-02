<#
  test-install-launcher-iconstamp.ps1

  Install-Launcher reads Launcher\.iconstamp to decide whether the icon art
  changed. A zero-byte stamp (a write cut short) came back from Get-Content
  -Raw as $null, and .Trim() on it stopped the whole install under StrictMode.

  What it proves:
    a scratch install with an empty .iconstamp exits 0 and puts the exe in place
    a scratch install with no stamp still exits 0

  A scratch root (not the dev or play root) leaves the Desktop and Explorer
  alone. Everything it writes is under its own temp folder.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$RepoDir = Split-Path -Parent $Here
$install = Join-Path $RepoDir 'scripts\release\Install-Launcher.ps1'
$ps = (Get-Process -Id $PID).Path

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-iconstamp-' + [Guid]::NewGuid().ToString('N'))
try {
    foreach ($case in 'empty', 'none') {
        $root = Join-Path $work "root-$case"
        $from = Join-Path $work "from-$case"
        $dir = Join-Path $root 'Launcher'
        New-Item -ItemType Directory -Force -Path $dir, $from | Out-Null
        [IO.File]::WriteAllText((Join-Path $from 'Thornswood.exe'), "stand-in $case")
        # The two icons the exe embeds, which Build-Launcher.ps1 writes beside
        # it and Install-Launcher.ps1 reads (#887, #4823).
        foreach ($n in 'app.ico', 'app-dev.ico') { Copy-Item -LiteralPath (Join-Path $RepoDir ('launcher\' + $n)) -Destination (Join-Path $from $n) }
        if ($case -eq 'empty') { [IO.File]::WriteAllBytes((Join-Path $dir '.iconstamp'), [byte[]]@()) }
        # Continue, so the child's stderr comes back as lines rather than stopping here.
        $ErrorActionPreference = 'Continue'
        $said = & $ps -NoProfile -ExecutionPolicy Bypass -File $install -Root $root -From $from -NoClose -NoPause 2>&1 | ForEach-Object { "$_" }
        $code = $LASTEXITCODE
        $ErrorActionPreference = 'Stop'
        Yes ("$case stamp: install exits 0 (got $code)") ($code -eq 0)
        Yes ("$case stamp: no null-method stop") (-not (($said -join "`n") -match 'null-valued'))
        $exe = Join-Path $dir 'Thornswood.exe'
        Yes ("$case stamp: the exe is in place") ((Test-Path -LiteralPath $exe) -and ([IO.File]::ReadAllText($exe) -eq "stand-in $case"))
        if ($code -ne 0) { $said | ForEach-Object { Write-Host "    | $_" } }
    }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0