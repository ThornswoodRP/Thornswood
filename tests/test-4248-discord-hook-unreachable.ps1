<#
  test-4248-discord-hook-unreachable.ps1

  The real webhook reader and publisher distinguish a failed VPS read from
  an unset webhook. Replace the transport and HTTP request in the fixtures.
  Nothing is sent to Discord or the VPS.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pwshExe = (Get-Process -Id $PID).Path
$work = Join-Path ([IO.Path]::GetTempPath()) ('tw-test-4248-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$ops = Join-Path $work 'scripts/ops'
$hookScript = Join-Path $ops 'Discord-Hook.ps1'
$publish = Join-Path $ops 'Publish-Discord.ps1'
$setDev = Join-Path $ops 'Set-DevNews.ps1'
$remote = Join-Path $work 'scripts/vps/Remote.ps1'
$fixtureSecret = 'fixture-secret-in-diagnostic'
$script:passed = 0
$script:failed = 0

function Yes([string]$what, [bool]$condition) {
    if ($condition) { $script:passed++; Write-Host "PASS  $what" }
    else { $script:failed++; Write-Host "FAIL  $what" }
}

function Child([string]$script, [string[]]$arguments) {
    $ErrorActionPreference = 'Continue'
    $out = @(& $pwshExe -NoProfile -NonInteractive -File $script @arguments 2>&1)
    return @{ Code = $LASTEXITCODE; Text = ($out -join [Environment]::NewLine) }
}

try {
    foreach ($rel in @(
        'scripts/ops/Discord-Hook.ps1', 'scripts/ops/Publish-Discord.ps1', 'scripts/ops/Set-DevNews.ps1',
        'scripts/vps/Send-Secret.ps1', 'scripts/vps/Send-Script.ps1', 'scripts/vps/Vps.ps1',
        'scripts/release/Read-JsonFile.ps1', 'scripts/release/Note-Repeats.ps1',
        'scripts/release/Feed-Store.ps1', 'scripts/release/Feed-News.ps1',
        'scripts/release/Feed-Json.ps1', 'scripts/release/RecordShape.ps1', 'scripts/release/Where.ps1',
        'scripts/release/Release-Baseline.ps1', 'scripts/release/Feed-Rules.ps1', 'scripts/release/Release-Name.ps1'
    )) {
        $dest = Join-Path $work $rel
        [void][IO.Directory]::CreateDirectory((Split-Path -Parent $dest))
        [IO.File]::Copy((Join-Path $repo $rel), $dest)
    }

    $runner = Join-Path $work 'publish.ps1'
    [IO.File]::WriteAllText($runner, @'
param([switch]$Dev, [switch]$Record, [switch]$MockPost)
$ErrorActionPreference = 'Stop'
function Invoke-RestMethod {
    param($Uri)
    if (-not $MockPost) { throw 'The offline test must not send a webhook' }
    Write-Host 'The offline HTTP mock was called.'
    throw "Simulated failure for $Uri"
}
$global:ThornswoodDiscordResult = ''
$LASTEXITCODE = 31
if ($MockPost) {
    $env:LOCALAPPDATA = Join-Path $PSScriptRoot 'localappdata'
    $env:THORNSWOOD_TEST_SITE_DIR = Join-Path $PSScriptRoot 'site'
    [void][IO.Directory]::CreateDirectory((Join-Path $env:THORNSWOOD_TEST_SITE_DIR 'feed-dev'))
    & (Join-Path $PSScriptRoot 'scripts/ops/Publish-Discord.ps1') -Dev -GamemodeDeploy -Note 'Fixture release note' -ReleaseDir (Join-Path $PSScriptRoot 'empty-feed')
    Write-Output ('RESULT:' + $global:ThornswoodDiscordResult)
    exit
}

& (Join-Path $PSScriptRoot 'scripts/ops/Publish-Discord.ps1') -Dev:$Dev -Record:$Record `
    -ReleaseDir (Join-Path $PSScriptRoot 'empty-feed')
$publishOk = $?
Write-Output ('RESULT:' + $global:ThornswoodDiscordResult)
if (-not $publishOk) { exit 1 }
'@)

    [IO.File]::WriteAllText($remote, "param([string]`$Body, `$Secret)`n'NOHOOK'`nexit 0")
    $r = Child $hookScript @('-Name', 'news')
    Yes 'An unset VPS webhook gives no output and exits successfully' ($r.Code -eq 0 -and -not $r.Text)
    $r = Child $runner @()
    Yes 'An unset webhook is skipped without marking the release failed' (
        $r.Text -match 'no Discord webhook set up, skipping' -and $r.Text -match 'RESULT:\s*$'
    )

    [IO.File]::WriteAllText($remote, "param([string]`$Body, `$Secret)`n'NOHOOK'`nWrite-Error '$fixtureSecret'`nexit 7")
    $r = Child $hookScript @('-Name', 'news')
    Yes 'A failed transport cannot claim the webhook is unset' (
        $r.Code -ne 0 -and $r.Text -match 'the VPS could not be asked'
    )
    Yes 'The webhook reader does not forward private transport diagnostics' ($r.Text -notmatch $fixtureSecret)
    $r = Child $hookScript @('-Name', 'news', '-Check')
    Yes 'A failed read reports failure in Check mode too' ($r.Code -ne 0 -and $r.Text -match 'the VPS could not be asked')
    $r = Child $runner @()
    Yes 'Main release records failed delivery without printing the transport output' (
        $r.Text -match 'could not reach the server for the Discord webhook' -and $r.Text -match 'RESULT:failed' -and
        $r.Text -notmatch ('no Discord webhook set up|' + $fixtureSecret)
    )
    $r = Child $runner @('-Dev')
    Yes 'Dev release records failed delivery for staff news' (
        $r.Text -match '#staff-news was not told' -and $r.Text -match 'RESULT:failed' -and $r.Text -notmatch $fixtureSecret
    )
    $r = Child $runner @('-Record')
    Yes 'A failed read is an unsuccessful Record invocation' ($r.Code -ne 0 -and $r.Text -notmatch $fixtureSecret)
    $r = Child $setDev @('-Check', '-NoPause')
    Yes 'The dev setup check distinguishes a failed read and hides transport output' (
        $r.Code -ne 0 -and $r.Text -match 'could not reach the server' -and
        $r.Text -notmatch ('No dev webhook set|' + $fixtureSecret)
    )

    $fakeHook = 'https://discord.com' + '/api/webhooks/' + '1/fixture-only'
    [IO.File]::WriteAllText($remote, ('param([string]$Body, $Secret)' + [char]10 + "'HOOK $fakeHook'"))
    $r = Child $hookScript @('-Name', 'news')
    Yes 'A valid hook is returned to the caller after a successful read' ($r.Code -eq 0 -and $r.Text -eq $fakeHook)
    $r = Child $hookScript @('-Name', 'news', '-Check')
    Yes 'Check confirms the hook without revealing it' (
        $r.Code -eq 0 -and $r.Text -match 'read from the VPS' -and -not $r.Text.Contains($fakeHook)
    )

    $saveRunner = Join-Path $work 'save.ps1'
    [IO.File]::WriteAllText($saveRunner, @"
& '$hookScript' -Name news -Save -Url (ConvertTo-SecureString '$fakeHook' -AsPlainText -Force)
exit `$LASTEXITCODE
"@)
    [IO.File]::WriteAllText($remote, 'param([string]$Body, [securestring]$Secret); if (-not $Secret) { exit 9 }; "SAVED"')
    $r = Child $saveRunner @()
    Yes 'Save passes a SecureString to the transport without revealing it' (
        $r.Code -eq 0 -and $r.Text -match 'saved on the VPS' -and -not $r.Text.Contains($fakeHook)
    )

    [IO.File]::WriteAllText($hookScript, "param([string]`$Name)`n'http://127.0.0.1:1/hook'")
    $r = Child $runner @()
    Yes 'An ordinary successful hook lookup ignores a stale shell exit code' (
        $r.Text -match 'no version.json' -and $r.Text -match 'RESULT:\s*$'
    )

    [IO.File]::WriteAllText($remote, ('param([string]$Body, $Secret)' + [char]10 + "'HOOK $fakeHook'"))
    [IO.File]::Copy((Join-Path $repo 'scripts/ops/Discord-Hook.ps1'), $hookScript, $true)
    $r = Child $runner @('-MockPost')
    Yes 'A failed HTTP post is reported without logging its webhook address' (
        $r.Text -match 'The offline HTTP mock was called' -and
        $r.Text -match 'COULD NOT POST TO DISCORD' -and $r.Text -match 'RESULT:failed' -and
        -not $r.Text.Contains($fakeHook)
    )

    $ship = Get-Content -LiteralPath (Join-Path $repo 'scripts/release/Ship.ps1') -Raw
    $done = [regex]::Match($ship, '(?m)^if \(\$global:ThornswoodDiscordResult -eq ''failed''\) \{[\s\S]*?^}')
    if (-not $done.Success) { throw 'Ship no longer has a failed-announcement section' }
    $global:ThornswoodDiscordResult = 'failed'
    function Say($message, $color) { Write-Output $message }
    foreach ($Dev in @($false, $true)) {
        $channel = if ($Dev) { '#staff-news' } else { '#news' }
        $result = (& ([scriptblock]::Create($done.Value)) | Out-String)
        Yes "Ship's Done screen reports failed delivery to $channel" ($result.Contains("$channel was NOT told."))
    }
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ("{0} passed, {1} failed" -f $script:passed, $script:failed)
if ($script:failed) { exit 1 }
exit 0
