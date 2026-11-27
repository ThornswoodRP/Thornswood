<#
  test-4211-restart-checked.ps1

      pwsh -NoProfile -File scripts/tests/test-4211-restart-checked.ps1

  Issue #4211. Rotate-BotToken.ps1, Set-DiscordLogin.ps1 and Install-Bot.ps1
  (a full run, and -SetPing) restart the bot or the site on the box and only
  printed what the restart said. Each had its own list of lines it treated as
  trouble, and the lists differed, so a bot that was not restarted or never
  said it connected, or a site that did not come back, ended 0, sometimes
  after a green line. Now each looks for the line each restart prints when it
  worked ('bot reconnected', 'site restarted, answering on <port>'), and
  without it prints a red FAILED line naming the step and ends 1. What counts
  as trouble is one list, in Write-BotToken.ps1 beside the restarts.

  HOW. Rotate-BotToken.ps1, Set-DiscordLogin.ps1 and Install-Bot.ps1 -SetPing
  run whole from a scratch copy of scripts\, in a child pwsh. In the copy,
  Send-Secret.ps1 ends with stand-ins for the box: what is sent is recorded,
  and the answer is what the case says the box answered. What is typed comes
  on the child's standard input. A full Install-Bot run needs Python and a
  staged bot, so its ending (from the file check to the end) is taken out of
  the real script and run with what the settings step answered. Nothing leaves this machine, and the
  token here is made up.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$S = [IO.Path]::DirectorySeparatorChar

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

# Made up: the first part is an 18 digit application id in base64, as Discord's are.
$app = '123456789012345678'
$token = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($app)).TrimEnd('=') + '.Gx0aaa.not-a-real-token-for-the-test-only'

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-4211-' + [Guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $work | Out-Null
    Copy-Item -LiteralPath (Join-Path $Repo 'scripts') -Destination (Join-Path $work 'scripts') -Recurse
    foreach ($d in 'bot', 'records', 'layout.json') {
        $p = Join-Path $Repo $d
        if (Test-Path -LiteralPath $p) { Copy-Item -LiteralPath $p -Destination (Join-Path $work $d) -Recurse }
    }
    $box = Join-Path $work 'box.txt'
    $sent = Join-Path $work 'sent.txt'
    $stand = @"

# ---- stood in by test-4211-restart-checked.ps1: the box ----
function Invoke-ThornswoodSecretRemote { param(`$Target, `$SshArgs, `$Secret, `$Script)
  [IO.File]::AppendAllText('$sent', [string]`$Script + "``n==== SENT ====``n")
  if (Test-Path -LiteralPath '$box') { @([IO.File]::ReadAllLines('$box')) } }
function Invoke-ThornswoodRemote { param(`$Target, `$SshArgs, `$Script)
  [IO.File]::AppendAllText('$sent', [string]`$Script + "``n==== SENT ====``n")
  if (Test-Path -LiteralPath '$box') { @([IO.File]::ReadAllLines('$box')) } }
function Get-ThornswoodVpsUser { 'tester' }
function Get-ThornswoodVpsAddress { 'box.invalid' }
"@
    $secretFile = Join-Path $work ('scripts' + $S + 'vps' + $S + 'Send-Secret.ps1')
    [IO.File]::AppendAllText($secretFile, $stand)
    # A child pwsh runs the real script from the copy. What is typed comes on
    # its standard input, which Read-ThornswoodSecret reads with no keyboard
    # (#4346).
    function Run([string]$rel, [string[]]$lines, [string]$typed, [string]$argText) {
        Remove-Item -LiteralPath $sent -Force -EA SilentlyContinue
        [IO.File]::WriteAllLines($box, [string[]]@($lines))
        $target = Join-Path $work ($rel.Replace('/', $S))
        $runner = Join-Path $work 'run.ps1'
        [IO.File]::WriteAllText($runner, @"
`$ErrorActionPreference = 'Stop'
`$global:LASTEXITCODE = 0
& '$target' $argText
exit `$LASTEXITCODE
"@)
        $out = @($typed | & pwsh -NoProfile -File $runner 2>&1 | ForEach-Object { "$_" })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($out -join "`n"); Lines = $out }
    }
    function Failed($r, [string]$step) { @($r.Lines | Where-Object { $_ -match ('FAILED\s+' + [regex]::Escape($step)) }).Count -ge 1 }
    function NoFailed($r) { @($r.Lines | Where-Object { $_ -match 'FAILED\s' }).Count -eq 0 }

    $botOk = @('bot reconnected', '  [thornswood-bot] up as Thornswood#0001', '  [thornswood-bot] watching 1 server(s)')
    $botNot = @('BOT NOT RESTARTED: the service ThornswoodBot would not restart (Cannot open ThornswoodBot service). Install-Bot.ps1 puts it on the box.')
    $botQuiet = @('BOT HAS NOT SAID IT IS CONNECTED, read its lines below', '  nothing from the bot yet')
    $siteOk = @('site restarted, answering on 3001', '  [site] discord bot can read the server, 41 roles visible')
    $siteNot = @('SITE DID NOT COME BACK on 3001', '  the site has not said anything about Discord yet')
    $wroteToken = @(
        'C:\Thornswood-Bot\bot.env.json  DISCORD_TOKEN     written and read back, application ' + $app,
        'C:\Thornswood-Docs\config.json  discord.botToken  written and read back, application ' + $app)
    $state = @(
        'C:\Thornswood-Bot\bot.env.json  parses; DISCORD_TOKEN is present, application ' + $app,
        'C:\Thornswood-Docs\config.json  parses; discord.botToken is present, application ' + $app)

    # ---------------------------------------------------- Rotate-BotToken
    Write-Host ''
    Write-Host 'Rotate-BotToken.ps1'
    $rot = 'scripts/deploy/Rotate-BotToken.ps1'
    $rargs = '-NoPause'
    $r = Run $rot ($wroteToken + '--- the bot ---' + $botOk + '--- the site ---' + $siteOk + '--- on the disk now ---' + $state) $token $rargs
    Yes "1. both restarts said they worked: ends 0, no FAILED line (exit $($r.Code))" ($r.Code -eq 0 -and (NoFailed $r))
    Yes '   and the token is in nothing printed' (-not $r.Text.Contains($token))

    $r = Run $rot ($wroteToken + '--- the bot ---' + $botNot + '--- the site ---' + $siteOk + '--- on the disk now ---' + $state) $token $rargs
    Yes "2. the bot was not restarted: ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   with a FAILED line naming the bot''s restart and what the box said' (Failed $r 'restarting the bot' -and $r.Text -match 'FAILED\s+restarting the bot[^\n]*BOT NOT RESTARTED')
    Yes '   and no green "Consumers updated" after it' ($r.Text -notmatch 'Consumers updated')

    $r = Run $rot ($wroteToken + '--- the bot ---' + $botQuiet + '--- the site ---' + $siteOk + '--- on the disk now ---' + $state) $token $rargs
    Yes "3. the bot never said it connected: ends 1 with a FAILED line naming it (exit $($r.Code))" ($r.Code -eq 1 -and (Failed $r 'restarting the bot'))

    $r = Run $rot ($wroteToken + '--- the bot ---' + $botOk + '--- the site ---' + '--- on the disk now ---' + $state) $token $rargs
    Yes "4. the site said nothing about its restart: ends 1 with a FAILED line naming it (exit $($r.Code))" ($r.Code -eq 1 -and (Failed $r 'starting the site again'))

    # --------------------------------------------------- Set-DiscordLogin
    Write-Host ''
    Write-Host 'Set-DiscordLogin.ps1'
    $login = 'scripts/deploy/Set-DiscordLogin.ps1'
    $largs = '-NoSecrets -Invite https://discord.gg/Tq7bR2kWx'
    $r = Run $login (@('on the disk now, 812 bytes:') + $siteOk) '' $largs
    Yes "5. the site said it came back: ends 0, no FAILED line (exit $($r.Code))" ($r.Code -eq 0 -and (NoFailed $r))

    $r = Run $login (@('on the disk now, 812 bytes:') + $siteNot) '' $largs
    Yes "6. the site did not come back: ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   with a FAILED line naming the site''s restart and what the box said' ($r.Text -match 'FAILED\s+starting the site again[^\n]*SITE DID NOT COME BACK')

    $r = Run $login (@('on the disk now, 812 bytes:')) '' $largs
    Yes "7. the box never said the site restarted: ends 1 with a FAILED line naming it (exit $($r.Code))" ($r.Code -eq 1 -and (Failed $r 'starting the site again'))

    $r = Run $login ($wroteToken + 'on the disk now, 812 bytes:' + $siteOk + $botNot) '' $largs
    Yes "8. a new token and the bot not restarted: ends 1 with a FAILED line naming the bot (exit $($r.Code))" ($r.Code -eq 1 -and $r.Text -match 'FAILED\s+restarting the bot[^\n]*BOT NOT RESTARTED')

    $r = Run $login ($wroteToken + 'on the disk now, 812 bytes:' + $siteOk) '' $largs
    Yes "9. a new token and nothing from the bot's restart: ends 1 with a FAILED line naming it (exit $($r.Code))" ($r.Code -eq 1 -and (Failed $r 'restarting the bot'))

    $r = Run $login ($wroteToken + 'on the disk now, 812 bytes:' + $siteOk + $botOk) '' $largs
    Yes "10. a new token, both restarts worked: ends 0 (exit $($r.Code))" ($r.Code -eq 0 -and (NoFailed $r))

    # ------------------------------------------------ Install-Bot -SetPing
    Write-Host ''
    Write-Host 'Install-Bot.ps1 -SetPing'
    $inst = 'scripts/deploy/Install-Bot.ps1'
    $pargs = '-SetPing -NoPause'
    $ping = 'https://hc-ping.example/0f3e9a71c2d84b5e'
    $wrotePing = 'ping address written to C:\Thornswood-Bot\bot.env.json and read back'
    $r = Run $inst (@($wrotePing) + $botOk + 'bot: uptime ping reached the outside monitor') $ping $pargs
    Yes "11. the bot said it reconnected: ends 0, no FAILED line (exit $($r.Code))" ($r.Code -eq 0 -and (NoFailed $r))

    $r = Run $inst (@($wrotePing) + $botNot) $ping $pargs
    Yes "12. the bot was not restarted: ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   with a FAILED line naming the bot''s restart and what the box said' ($r.Text -match 'FAILED\s+restarting the bot[^\n]*BOT NOT RESTARTED')

    $r = Run $inst (@($wrotePing) + $botQuiet) $ping $pargs
    Yes "13. the bot never said it connected: ends 1 with a FAILED line naming it (exit $($r.Code))" ($r.Code -eq 1 -and (Failed $r 'restarting the bot'))

    $r = Run $inst (@($wrotePing)) $ping $pargs
    Yes "14. nothing back after the write: ends 1 with a FAILED line naming the bot's restart (exit $($r.Code))" ($r.Code -eq 1 -and (Failed $r 'restarting the bot'))

    $r = Run $inst @('PING UNCHANGED: bot.env.json already holds that ping address. Nothing changed.') $ping $pargs
    Yes "15. nothing to change: no restart is looked for, ends 0 (exit $($r.Code))" ($r.Code -eq 0 -and (NoFailed $r))

    # -------------------------------------------- Install-Bot, a full run
    Write-Host ''
    Write-Host 'Install-Bot.ps1, the end of a full run'
    $file = Join-Path $Repo ('scripts' + $S + 'deploy' + $S + 'Install-Bot.ps1')
    $text = [IO.File]::ReadAllText($file)
    $from = $text.IndexOf('if (-not (Confirm-BotFiles @($send.Keys))) {')
    Yes 'the end of a full run is found, from its file check' ($from -gt 0)
    if ($from -le 0) { throw 'the end of a full run was not found' }
    $tail = $text.Substring($from)
    $ast = [Management.Automation.Language.Parser]::ParseFile($file, [ref]$null, [ref]$null)
    $defs = @($ast.FindAll({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -in 'Say', 'Head', 'Die' }, $false) | ForEach-Object { $_.Extent.Text }) -join "`n"
    $writer = Join-Path $Repo ('scripts' + $S + 'vps' + $S + 'Write-BotToken.ps1')
    function Full([string[]]$settings) {
        $f = Join-Path $work 'full.ps1'
        $quoted = (@($settings) | ForEach-Object { "'" + $_.Replace("'", "''") + "'" }) -join ', '
        [IO.File]::WriteAllText($f, @"
`$ErrorActionPreference = 'Stop'
`$NoPause = `$true
`$Here = '$((Join-Path $Repo ('scripts' + $S + 'deploy')).Replace("'", "''"))'
. '$($writer.Replace("'", "''"))'
$defs
function Confirm-BotFiles { `$true }
`$send = @{}
`$settings = @($quoted)
$tail
exit 0
"@)
        $out = @(& pwsh -NoProfile -File $f 2>&1 | ForEach-Object { "$_" })
        return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($out -join "`n"); Lines = $out }
    }
    $r = Full (@('site told about a NEW key') + $siteOk)
    Yes "16. the settings step's site restart worked: ends 0 (exit $($r.Code))" ($r.Code -eq 0 -and (NoFailed $r))
    $r = Full (@('site told about a NEW key') + $siteNot)
    Yes "17. the site did not come back: ends 1 (exit $($r.Code))" ($r.Code -eq 1)
    Yes '   with a FAILED line naming the site''s restart and what the box said' ($r.Text -match 'FAILED\s+starting the site again[^\n]*SITE DID NOT COME BACK')
    $r = Full @('site told about a NEW key')
    Yes "18. a new key and nothing from the site's restart: ends 1 with a FAILED line naming it (exit $($r.Code))" ($r.Code -eq 1 -and (Failed $r 'starting the site again'))
    $r = Full @('key and token unchanged, the site does not need restarting')
    Yes "19. nothing changed, so no restart: ends 0 (exit $($r.Code))" ($r.Code -eq 0 -and (NoFailed $r))

    # ------------------------------------------------- one list, not three
    Write-Host ''
    Write-Host 'One list'
    . $writer
    Yes '20. Write-BotToken.ps1 holds the restart lines, beside the restarts that print them' ([bool](Get-Command Get-ThornswoodRestartFailed -EA SilentlyContinue) -and [bool](Get-Command Test-ThornswoodRestartLine -EA SilentlyContinue))
    foreach ($rel in 'scripts/deploy/Rotate-BotToken.ps1', 'scripts/deploy/Set-DiscordLogin.ps1', 'scripts/deploy/Install-Bot.ps1') {
        $t = [IO.File]::ReadAllText((Join-Path $Repo $rel.Replace('/', $S)))
        Yes "    $(Split-Path -Leaf $rel) reads it, and keeps no list of its own" ($t -match 'Get-ThornswoodRestartFailed' -and $t -notmatch "BOT HAS NOT\|" -and $t -notmatch "NOT RESTARTED\|")
    }
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
