<#
  test-2233-inuse-image.ps1

      pwsh -NoProfile -File .\scripts\tests\test-2233-inuse-image.ps1

  Issue #2233. Build-Generated counted every SkyrimSE.exe, skse64_loader.exe or
  launcher whose path it could not read as holding the folder. On the VPS the
  four build runners are four accounts, so one runner's stand-in Skyrim stopped
  another runner's build. Such a process now counts only when one of the
  install's own programs is running, which is told from the folder's side: a
  running program's file cannot be opened for writing.

  WHAT IT CHECKS. Test-ImageRunning and Get-RunningInstallImages, lifted from
  scripts\mods\Build-Generated.ps1 with PowerShell's parser, over a scratch
  install under the temp directory:
    1. a copy of ping.exe named Game\SkyrimSE.exe, running: running, and listed
    2. once it has exited: not running, and nothing listed
    3. a missing file, and a read-only file nobody runs: not running
  And in the text of Get-FolderUsers: an unreadable process is no longer
  counted on its name alone, only while an image from the folder is running.
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

$path = Join-Path $Repo 'scripts\mods\Build-Generated.ps1'
$tokens = $null; $errs = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errs)
$fns = @{}
foreach ($f in $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $true)) { $fns[$f.Name] = $f.Extent.Text }
foreach ($n in 'Test-ImageRunning', 'Get-RunningInstallImages', 'Get-FolderUsers') { Yes "Build-Generated.ps1 defines $n" ($fns.ContainsKey($n)) }
if (-not ($fns.ContainsKey('Test-ImageRunning') -and $fns.ContainsKey('Get-RunningInstallImages'))) {
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail); exit 1
}
. ([scriptblock]::Create($fns['Test-ImageRunning'] + "`n" + $fns['Get-RunningInstallImages']))

$users = $fns['Get-FolderUsers']
Yes 'an unreadable process is no longer counted on its name alone' (-not $users.Contains('whose folder Windows does not say'))
Yes 'it counts only while one of the folder''s own programs is running' (
    $users.Contains('Get-RunningInstallImages $root') -and $users.Contains('if ($images.Count)'))

function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Windows.ps1')
if (-not $OnWindows) { Write-Host 'SKIP  the runs: a copy of Windows'' PING.EXE stands in for Skyrim, and this is not Windows'; Done }

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-2233-' + [guid]::NewGuid().ToString('N'))
$game = Join-Path $work 'Game'
New-Item -ItemType Directory -Force -Path $game, (Join-Path $work 'Launcher') | Out-Null
try {
    $sky = Join-Path $game 'SkyrimSE.exe'
    Copy-Item -LiteralPath (Get-WindowsPath 'System32\PING.EXE') -Destination $sky
    $p = Start-Process -FilePath $sky -ArgumentList '-n', '30', '127.0.0.1' -PassThru -WindowStyle Hidden
    try {
        Start-Sleep -Milliseconds 500
        Yes '1: a running Game\SkyrimSE.exe is running' (Test-ImageRunning $sky)
        $listed = Get-RunningInstallImages $work
        Yes '1: and is listed as one of the folder''s running programs' ($listed.Count -eq 1 -and $listed[0] -ieq $sky)
    } finally { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; $p.WaitForExit() }
    Yes '2: once it has exited, it is not running' (-not (Test-ImageRunning $sky))
    Yes '2: and nothing is listed' ((Get-RunningInstallImages $work).Count -eq 0)
    Yes '3: a missing file is not running' (-not (Test-ImageRunning (Join-Path $game 'nothing.exe')))
    $ro = Join-Path $work 'Launcher\Thornswood.exe'
    [IO.File]::WriteAllText($ro, 'not a program')
    (Get-Item -LiteralPath $ro).IsReadOnly = $true
    Yes '3: a read-only file nobody runs is not running' (-not (Test-ImageRunning $ro))
    (Get-Item -LiteralPath $ro).IsReadOnly = $false
}
finally { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
Done
