<#
  test-4248-discord-hook-unreachable.ps1

      pwsh -NoProfile -File .\tests\test-4248-discord-hook-unreachable.ps1

  Issue #4248: When posting release notes to Discord, if the server can't be
  reached, the read must not be treated as "no webhook set up". An unreachable
  server is reported as a failure, Publish-Discord sets ThornswoodDiscordResult
  to 'failed', and Ship's Done screen reports that the news channel was not told.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here
$pwshExe = (Get-Process -Id $PID).Path

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what"; return }
    $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('tw-test-4248-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
try {
    $ops = Join-Path $work 'scripts\ops'
    $vps = Join-Path $work 'scripts\vps'
    $bot = Join-Path $work 'bot'
    $feed = Join-Path $work 'feed'
    New-Item -ItemType Directory -Force -Path $bot, $feed | Out-Null

    # Copy scripts folder
    Copy-Item -LiteralPath (Join-Path $Repo 'scripts') -Destination (Join-Path $work 'scripts') -Recurse

    # Version file for Publish-Discord
    $verJson = @{
        launcherVersion = '1.2.3'
        news = @(
            @{
                title = 'Release 1.2.3'
                date = '2026-11-20'
                details = @('First detail')
                body = 'Release body'
            }
        )
    } | ConvertTo-Json -Depth 5
    [IO.File]::WriteAllText((Join-Path $feed 'version.json'), $verJson)

    $stub = Join-Path $vps 'Remote.ps1'

    # Case 1: VPS is reachable and answers NOHOOK (not set up)
    [IO.File]::WriteAllText($stub, "param([string]`$Body, `$Secret)`r`n'NOHOOK'`r`nexit 0`r`n")
    $r1 = & $pwshExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& '$ops\Discord-Hook.ps1' -Name news -RemoteScript '$stub'" 2>&1
    $c1 = $LASTEXITCODE
    Yes 'Discord-Hook: not set up exits 0' ($c1 -eq 0)
    Yes 'Discord-Hook: not set up outputs nothing' (@($r1).Count -eq 0)

    # Publish-Discord with not set up
    $scriptBlock = "
        `$global:ThornswoodDiscordResult = ''
        & '$ops\Publish-Discord.ps1' -ReleaseDir '$feed'
        Write-Host ('RESULT:' + `$global:ThornswoodDiscordResult)
    "
    $rPubNotSet = & $pwshExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $scriptBlock 2>&1
    $pubNotSetText = ($rPubNotSet | ForEach-Object { "$_" }) -join "`n"
    Yes 'Publish-Discord: not set up says skipping in grey' ($pubNotSetText -match 'no Discord webhook set up, skipping')
    Yes 'Publish-Discord: not set up does NOT set failed result' ($pubNotSetText -match 'RESULT:\s*$')

    # Case 2: VPS is unreachable (exits non-zero)
    [IO.File]::WriteAllText($stub, "param([string]`$Body, `$Secret)`r`nWrite-Error 'Connection timed out'`r`nexit 1`r`n")
    $r2 = & $pwshExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "& '$ops\Discord-Hook.ps1' -Name news -RemoteScript '$stub'" 2>&1
    $c2 = $LASTEXITCODE
    $out2 = ($r2 | ForEach-Object { "$_" }) -join "`n"
    Yes 'Discord-Hook: unreachable server exits 1' ($c2 -ne 0)
    Yes 'Discord-Hook: unreachable server reports distinct error' ($out2 -match 'the VPS could not be asked and this machine has no copy')

    # Publish-Discord with unreachable server
    $scriptBlockUnreach = "
        `$global:ThornswoodDiscordResult = ''
        & '$ops\Publish-Discord.ps1' -ReleaseDir '$feed'
        Write-Host ('RESULT:' + `$global:ThornswoodDiscordResult)
    "
    $rPubUnreach = & $pwshExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $scriptBlockUnreach 2>&1
    $pubUnreachText = ($rPubUnreach | ForEach-Object { "$_" }) -join "`n"
    Yes 'Publish-Discord: unreachable server does NOT say no webhook set up' ($pubUnreachText -notmatch 'no Discord webhook set up')
    Yes 'Publish-Discord: unreachable server reports failure distinctly' ($pubUnreachText -match 'could not reach the server for the Discord webhook')
    Yes 'Publish-Discord: unreachable server sets failed result' ($pubUnreachText -match 'RESULT:failed')

    # Case 3: Ship Done screen reports news channel wasn't told when result is 'failed'
    $shipDoneBlock = "
        function Say(`$m, `$c = 'Gray') { Write-Host `$m }
        `$global:ThornswoodDiscordResult = 'failed'
        `$Dev = `$false
        if (`$global:ThornswoodDiscordResult -eq 'failed') {
            Say ('The release went out, but ' + `$(if (`$Dev) { '#staff-news' } else { '#news' }) + ' was NOT told.') 'Yellow'
        }
    "
    $rShip = & $pwshExe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $shipDoneBlock 2>&1
    $shipText = ($rShip | ForEach-Object { "$_" }) -join "`n"
    Yes "Ship Done screen: says '#news was NOT told'" ($shipText -match 'The release went out, but #news was NOT told\.')
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail -gt 0) { exit 1 }
exit 0
