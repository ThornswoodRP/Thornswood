<#
  test-hand-install-retired.ps1

      pwsh -NoProfile -File .\tests\test-hand-install-retired.ps1

  The fourteen hand-install / patch scripts from issue #1179 either refuse at
  their first line or are gone, and the three still-legit deploy/dev paths are
  left alone.

  WHY THIS EXISTS. Found auditing collection revision 2 (#476), 29 Sep. The
  collection installs the mods now, and Add-Bodies / Add-JContainers /
  Add-TempleRespawn already throw STOP. These fourteen still wrote into the
  game folder, a plugin list or Vortex staging, and several ended in a Ship.
  Done when each stops (pattern of Add-Bodies.ps1) or is deleted, held here.

  What it checks:
    1. each oneoff hand-install listed in #1179 has a throw STOP as
       its first statement after param, names #1179, and opens RETIRED;
    2. a dry run of one of them exits non-zero and says STOP (touches nothing);
    3. Install-SkyMPClient.ps1 is gone (Sync-Client.ps1 replaced it, #1001);
    4. Install-Thornswood.ps1 and Install-ThornswoodContent.ps1 still exist and
       do NOT carry a retirement STOP (legit deploy/dev paths);
    5. Install-Thornswood.ps1 no longer runs Fix-MaleBody.ps1 as a step.

  Read only apart from a scratch folder for the one dry run.
#>
[CmdletBinding()]
param()

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

$Utf8 = New-Object Text.UTF8Encoding($false)

$stopScripts = @(
    'scripts\oneoff\Add-Accuracy.ps1',
    'scripts\oneoff\Add-CartTravel.ps1',
    'scripts\oneoff\Add-McmShortcut.ps1',
    'scripts\oneoff\Enable-MCM.ps1',
    'scripts\oneoff\Fix-QuickLoot.ps1',
    'scripts\oneoff\Fix-MaleBody.ps1',
    'scripts\oneoff\Remove-Plugin.ps1',
    'scripts\oneoff\Set-UnboundMenu.ps1',
    'scripts\oneoff\Add-SkyrimUnbound.ps1',
    'scripts\oneoff\Fix-PluginProblems.ps1',
    'scripts\oneoff\Run-Everything.ps1'
)

foreach ($rel in $stopScripts) {
    $path = Join-Path $Repo $rel
    Yes ("$rel is there") (Test-Path -LiteralPath $path)
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $text = [IO.File]::ReadAllText($path, $Utf8)
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($text, $path, [ref]$tokens, [ref]$errors)
    Yes ("$rel parses") (@($errors).Count -eq 0)

    $first = $null
    if ($ast.EndBlock -and @($ast.EndBlock.Statements).Count) { $first = $ast.EndBlock.Statements[0] }
    Yes ("$rel first statement is a throw") ($first -is [System.Management.Automation.Language.ThrowStatementAst])
    $said = ''
    if ($first -is [System.Management.Automation.Language.ThrowStatementAst]) { $said = $first.Extent.Text }
    Yes ("$rel throw says STOP") ($said -match "\('STOP\.")
    Yes ("$rel throw names #1179") ($said -match '#1179')
    Yes ("$rel throw says retired / installs nothing") ($said -match '(?i)retired' -and $said -match '(?i)installs nothing')

    $headEnd = $text.IndexOf('#>')
    $header = if ($headEnd -gt 0) { $text.Substring(0, $headEnd) } else { '' }
    Yes ("$rel header opens RETIRED. DO NOT RUN.") ($header -match 'RETIRED\. DO NOT RUN')
    Yes ("$rel header names #1179") ($header -match '#1179')
}

# One dry run: Add-Accuracy against nothing real; NoPause so it does not wait.
$acc = Join-Path $Repo 'scripts\oneoff\Add-Accuracy.ps1'
$pwsh = (Get-Process -Id $PID).Path
$out = & $pwsh -NoProfile -ExecutionPolicy Bypass -File $acc -NoPause 2>&1 | Out-String
$code = $LASTEXITCODE
Yes ("Add-Accuracy.ps1 run exits non-zero (exit $code)") ($code -ne 0)
Yes 'and the run says STOP and #1179' ($out -match 'STOP\. Add-Accuracy\.ps1 is retired' -and $out -match '#1179')

# Install-SkyMPClient gone; Sync-Client is the path.
# Assert by Filter under scripts\, not Join-Path to the gone file: a path to a
# file that is gone is what tests\test-script-paths.ps1 fails on (same pattern
# as tests\test-install-client-step.ps1).
Yes 'Install-SkyMPClient.ps1 is gone from scripts' (@(Get-ChildItem -LiteralPath (Join-Path $Repo 'scripts') -Recurse -File -Filter 'Install-SkyMPClient.*').Count -eq 0)
Yes 'Sync-Client.ps1 is there instead' (Test-Path -LiteralPath (Join-Path $Repo 'scripts\release\Sync-Client.ps1'))

# Legit deploy/dev paths stay runnable (no retirement STOP).
foreach ($rel in @('scripts\dev\Install-Thornswood.ps1', 'scripts\deploy\Install-ThornswoodContent.ps1')) {
    $path = Join-Path $Repo $rel
    Yes ("$rel is there") (Test-Path -LiteralPath $path)
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $text = [IO.File]::ReadAllText($path, $Utf8)
    Yes ("$rel is not retired with a STOP throw") ($text -notmatch "throw \('STOP\.")
}

$install = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\dev\Install-Thornswood.ps1'), $Utf8)
Yes 'Install-Thornswood.ps1 no longer runs Fix-MaleBody as a step' ($install -notmatch "Script\s*=\s*'[^']*Fix-MaleBody\.ps1'")
Yes 'and still runs Sync-Client for the client step' ($install -match "Sync-Client\.ps1")
Yes 'and still runs Install-ThornswoodContent for content' ($install -match "Install-ThornswoodContent\.ps1")

# Index rows: scripts\oneoff\README.md, the one-off folder's own index, since
# #4740 moved these out of scripts\mods and its list.
$index = [IO.File]::ReadAllText((Join-Path $Repo 'scripts\oneoff\README.md'), $Utf8)
foreach ($name in @('Add-Accuracy.ps1', 'Add-CartTravel.ps1', 'Fix-MaleBody.ps1', 'Set-UnboundMenu.ps1')) {
    $row = @($index -split "`r?`n" | Where-Object { $_.StartsWith('| `' + $name + '`') })
    Yes ("scripts\oneoff\README.md lists $name as refusing to run") ($row.Count -ge 1 -and ($row[0] -match 'refuses to run'))
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
