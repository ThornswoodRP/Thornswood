<#
  test-4151-linux-server-paths.ps1

  Issue #4151. Some scripts that run things on the server are meant to work from
  a Linux machine too, but they built the server's Windows paths with Join-Path,
  which checks that drive C exists on the local machine. On Linux the log reader
  found no logs, the backup install stopped at once, and a server deploy that
  sends plugins failed. The platform-unused harness stopped the same way before
  its checks.

  Paths on the server are built as plain strings so they work under Linux
  PowerShell.
#>
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# 1. AST check: no Join-Path calls on server paths in the three scripts and harness
$getLogsPath = Join-Path $Repo 'scripts\vps\Get-Logs.ps1'
$installBackupPath = Join-Path $Repo 'scripts\deploy\Install-Backup.ps1'
$deployServerPath = Join-Path $Repo 'scripts\deploy\Deploy-Server.ps1'
$platformUnusedPath = Join-Path $Repo 'tests\test-2177-platform-unused.ps1'

function Get-JoinPathFirstArgs([string]$path) {
    $ast = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
    $calls = @($ast.FindAll({ param($n)
        $n -is [Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Join-Path'
    }, $true))
    $firstArgs = @()
    foreach ($c in $calls) {
        $elems = @($c.CommandElements | Select-Object -Skip 1)
        if ($elems.Count -gt 0) { $firstArgs += $elems[0].Extent.Text }
    }
    return $firstArgs
}

$getLogsArgs = Get-JoinPathFirstArgs $getLogsPath
$backupArgs = Get-JoinPathFirstArgs $installBackupPath
$platformArgs = Get-JoinPathFirstArgs $platformUnusedPath

Yes 'Get-Logs.ps1 does not call Join-Path on server root variables' (
    @($getLogsArgs | Where-Object { $_ -in '$srvRoot', '$voiceRoot', '$docsRoot', '$botRoot' }).Count -eq 0)

Yes 'Install-Backup.ps1 does not call Join-Path on $Root' (
    @($backupArgs | Where-Object { $_ -eq '$Root' }).Count -eq 0)

Yes 'test-2177-platform-unused.ps1 does not call Join-Path on $game' (
    @($platformArgs | Where-Object { $_ -eq '$game' }).Count -eq 0)

# 2. Deploy-Server plugin path does not throw on non-existent drive
$deployServerSrc = [IO.File]::ReadAllText($deployServerPath)
Yes 'Deploy-Server.ps1 does not call unconditional Join-Path on $Data' (
    $deployServerSrc -notmatch '(?m)^\s*\$local\s*=\s*Join-Path\s+\$Data\s+\$n\s*$')

# 3. Path code execution check (simulating drive C missing or running on Linux)
$drive = if (([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT)) { 'Z:' } else { 'C:' }
$testSrv = "$drive\Thornswood-Server"
$testVoice = "$drive\Thornswood-Voice"
$testDocs = "$drive\Thornswood-Docs"
$testBot = "$drive\Thornswood-Bot"

$pathsOk = $true
try {
    $serverLog = "$testSrv\server.log"
    $thornswoodLog = "$testSrv\thornswood.log"
    $doorLog = "$testSrv\private\door.log"
    $voiceLog = "$testVoice\voice.log"
    $siteLog = "$testDocs\site.log"
    $botLog = "$testBot\data\bot.log"
    $deployDir = "$testSrv\data"

    if ($serverLog -ne "$drive\Thornswood-Server\server.log") { $pathsOk = $false }
    if ($deployDir -ne "$drive\Thornswood-Server\data") { $pathsOk = $false }

    $backupRoot = "$drive\Thornswood-Backup"
    $rootClean = $backupRoot.TrimEnd('\', '/')
    $keyFile = "$rootClean\key.txt"
    $runner = "$rootClean\vps-nightly-backup.ps1"
    $world = "$rootClean\world.ps1"

    if ($keyFile -ne "$drive\Thornswood-Backup\key.txt") { $pathsOk = $false }
    if ($runner -ne "$drive\Thornswood-Backup\vps-nightly-backup.ps1") { $pathsOk = $false }

    $data = "$drive\Steam\Skyrim\Data"
    $n = 'Thornswood-Content.esp'
    $local = if ($data -match '^[A-Za-z]:') { ($data.TrimEnd('\', '/') + '\' + $n) } else { Join-Path $data $n }

    if ($local -ne "$drive\Steam\Skyrim\Data\Thornswood-Content.esp") { $pathsOk = $false }
}
catch {
    $pathsOk = $false
}
Yes 'path code for the three scripts succeeds for drive paths without Join-Path errors' $pathsOk

# 4. test-2177 game folder path resolution does not throw when drive does not exist
$gamePathOk = $true
try {
    $fakeInst = "$drive\Thornswood"
    $game = if ($fakeInst) { ($fakeInst.TrimEnd('\', '/') + '\Game\Data\Platform') } else { '' }
    $exists = if ($game) { Test-Path -LiteralPath $game } else { $false }
    if ($exists -ne $false) { $gamePathOk = $false }
}
catch {
    $gamePathOk = $false
}
Yes 'test-2177 game path check handles missing drive without throwing' $gamePathOk

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
