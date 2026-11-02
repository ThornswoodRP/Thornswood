<#
  test-3216-set-turnstile.ps1

  Set-Turnstile.ps1 puts the report form's two Turnstile keys into the site's
  config.json on the box and nothing else, keeps the secret off every command
  line, and -Off takes both out again (#3216).

  HOW. The Invoke-ThornswoodSecretRemote call is lifted out of the shipped
  Set-Turnstile.ps1 by the parser, not copied, and run here with the real
  Send-Secret.ps1, so the secret goes on standard input exactly as it would.
  ssh is a function here that runs the command line it was handed, in
  PowerShell 7 (the box's PowerShell since #5356), against a scratch folder, with the site restart's
  commands replaced by ones that only say they were called, and the site's
  answer to /api/report/form made from the config the run wrote, the way
  server.js's turnstileOn() reads it: the site key only when both are there.
  Nothing on this machine is stopped or started, and nothing connects
  anywhere. node reads the result the way server.js does. The script itself
  is never run.

    pwsh -File tests\test-3216-set-turnstile.ps1
#>
[CmdletBinding()]
param([string]$ScriptPath)
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
if (-not $ScriptPath) { $ScriptPath = Join-Path $Root 'scripts\deploy\Set-Turnstile.ps1' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

# ---- lift the call that sends the keys -----------------------------------------
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($ScriptPath, [ref]$tokens, [ref]$errors)
Yes 'Set-Turnstile.ps1 parses' (@($errors).Count -eq 0)
$calls = @($ast.FindAll({
    param($n)
    $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Invoke-ThornswoodSecretRemote'
}, $true))
Yes 'it sends the keys with Invoke-ThornswoodSecretRemote, once' ($calls.Count -eq 1)
if ($calls.Count -ne 1) { Done }
$call = $calls[0].Extent.Text
# What the box does with the secret is built once, as $farTail, for this call
# and -FromCloudflare's alike; it is lifted the same way.
$tails = @($ast.FindAll({
    param($n)
    $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$farTail'
}, $true))
Yes 'the far side''s writing and restart are built once, as $farTail' ($tails.Count -eq 1)
if ($tails.Count -ne 1) { Done }
$tail = $tails[0].Extent.Text
$text = Get-Content -LiteralPath $ScriptPath -Raw
Yes 'it loads the block Deploy-Docs -Password uses' ($text.Contains(". (Join-Path `$Here 'SiteConfigSet.ps1')"))
Yes 'its far side sets both keys through that block, the site key first' (
    $tail.IndexOf("-Key 'turnstileSiteKey'") -gt 0 -and $tail.IndexOf("-Key 'turnstileSecret'") -gt $tail.IndexOf("-Key 'turnstileSiteKey'"))
Yes 'and the call sends that far side' ($call.Contains('$farTail'))
Yes 'it asks for the secret hidden, never as a parameter' (
    $text.Contains('Read-ThornswoodSecret') -and -not ($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -match 'Secret' }))
. (Join-Path $Root 'scripts\deploy\SiteConfigSet.ps1')
. (Join-Path $Root 'scripts\vps\Send-Secret.ps1')
. (Join-Path $Root 'scripts\vps\Send-Script.ps1')

# ---- what runs it -------------------------------------------------------------
. (Join-Path $PSScriptRoot 'Windows.ps1')
$shell = Get-BoxPowerShell
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host 'SKIP  the runs need node, which is not here'
    Done
}

# The restart's commands and the site's answer, replaced. Functions win over
# cmdlets of the same name.
$stubs = @'
function Get-CimInstance { 'STUB looked for the site' }
function Stop-Process { 'STUB Stop-Process' }
function Start-ScheduledTask { 'STUB Start-ScheduledTask' }
function Start-Sleep { }
function Get-NetTCPConnection { $true }
function Invoke-RestMethod {
  $c = [IO.File]::ReadAllText($env:TW_CFG) | ConvertFrom-Json
  $on = [string]$c.turnstileSiteKey -and [string]$c.turnstileSecret
  [pscustomobject]@{ turnstile = $(if ($on) { [string]$c.turnstileSiteKey } else { '' }) }
}

'@

$script:lines = New-Object System.Collections.ArrayList
function ssh {
    $a = @($args | ForEach-Object { [string]$_ })
    [void]$script:lines.Add(($a -join ' '))
    $m = [regex]::Match($a[-1], '-EncodedCommand (\S+)$')
    if (-not $m.Success) { throw 'the fake ssh was handed no encoded command' }
    $t = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value))
    [void]$script:lines.Add($t)
    # A long script came by scp first, and this is its runner, which on the
    # box takes the copy off the disk and runs it: here, the copy kept below.
    if ($t -match 'thornswood-remote-[0-9a-f]{32}\.ps1' -and $null -ne $script:copied) { $t = $script:copied; $script:copied = $null }
    # Off Windows a backslash is no folder separator to .NET, so the scratch
    # folder's path is turned round here; on Windows the script runs as sent.
    if (-not $OnWindows) { $t = $t.Replace('\config.json', '/config.json') }
    $run = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($stubs + $t))
    @($input) | & $shell -NoProfile -NonInteractive -EncodedCommand $run
}
# Over the command line's length the far side goes by scp (Send-Script.ps1).
# Here the copy is kept in memory for the runner that follows, not sent.
$script:copied = $null
function scp {
    $a = @($args | ForEach-Object { [string]$_ })
    [void]$script:lines.Add('scp ' + ($a -join ' '))
    $script:copied = [IO.File]::ReadAllText($a[-2])
    [void]$script:lines.Add($script:copied)
    $global:LASTEXITCODE = 0
}
Yes 'ssh and scp here are the harness''s own, so nothing connects' (
    (Get-Command ssh).CommandType -eq 'Function' -and (Get-Command scp).CommandType -eq 'Function')

# Runs the lifted call with what it takes from the rest of the script.
function Run-Call([string]$docsWin, [string]$siteKey, [string]$secretValue, [bool]$isOff) {
    $User = 'nobody'; $Vps = 'nowhere.invalid'
    $ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
    $PublicSiteKey = $siteKey; $secret = $secretValue
    $want = if ($isOff) { 'off' } else { 'on' }
    $env:TW_CFG = Join-Path $docsWin 'config.json'
    . ([ScriptBlock]::Create($tail))
    try { return @(. ([ScriptBlock]::Create($call)) | ForEach-Object { [string]$_ }) }
    finally { Remove-Item Env:\TW_CFG -ErrorAction SilentlyContinue }
}

$reader = @'
const fs = require('fs'), assert = require('assert');
const after = process.argv[2], before = process.argv[3];
const out = { parses: false };
let b = null;
try { b = JSON.parse(fs.readFileSync(after, 'utf8')); out.parses = true; }
catch (e) { out.error = e.message; }
if (b) {
  out.siteKey = b.turnstileSiteKey; out.secret = b.turnstileSecret;
  const a = JSON.parse(fs.readFileSync(before, 'utf8'));
  delete a.turnstileSiteKey; delete a.turnstileSecret; delete b.turnstileSiteKey; delete b.turnstileSecret;
  try { assert.deepStrictEqual(b, a); out.kept = true; } catch (e) { out.kept = false; }
}
console.log(JSON.stringify(out));
'@

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-3216-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    $noMark = New-Object Text.UTF8Encoding($false)
    $readerJs = Join-Path $work 'read.js'
    [IO.File]::WriteAllText($readerJs, $reader, $noMark)
    function Read-Node([string]$after, [string]$before) {
        return (& $node.Source $readerJs $after $before | Select-Object -Last 1 | ConvertFrom-Json)
    }
    $full = @'
{
  "password": "not-a-real-member-password",
  "discord": { "clientId": "111111111111111111", "clientSecret": "not-a-real-secret",
               "botToken": "not-a-real-token", "guildId": "222222222222222222", "invite": "" },
  "access": { "admin": ["Owner", "Dev"], "play": ["Playtester"], "banned": ["Banned"] },
  "botKey": "not-a-real-key",
  "secret": "not-a-real-cookie-secret",
  "passKey": "not-a-real-pass-key"
}
'@
    $d = Join-Path $work 'box'
    New-Item -ItemType Directory -Path $d -Force | Out-Null
    $f = Join-Path $d 'config.json'
    $before = Join-Path $work 'before.json'
    [IO.File]::WriteAllText($f, $full, $noMark)
    [IO.File]::WriteAllText($before, $full, $noMark)

    $key = '0x4AAAAAAAHarnessKey_01'
    $sec = '0x4AAAAAAAHarness-secret-' + [Guid]::NewGuid().ToString('N')
    $said = Run-Call $d $key $sec $false
    $r = Read-Node $f $before
    Yes 'on: node parses what was written' ($r.parses -eq $true)
    Yes 'on: both keys are the ones given' ($r.siteKey -eq $key -and $r.secret -eq $sec)
    Yes 'on: every other setting is as it was' ($r.kept -eq $true)
    Yes 'on: the site is restarted and says the check is on' (
        ($said -join ' ') -match 'STUB Start-ScheduledTask' -and ($said -join ' ') -match 'the report form is told the site key: the check is on')
    if (-not (($said -join ' ') -match 'the check is on')) { Write-Host ('      the far side said: ' + ($said -join ' | ')) }
    $wire = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sec))
    $sent = $script:lines -join "`n"
    Yes 'the secret is on no command line handed to ssh, nor in the script, plain or base64 (#451)' (
        -not $sent.Contains($sec) -and -not $sent.Contains($wire))

    $script:lines.Clear()
    $said = Run-Call $d '' '' $true
    $r = Read-Node $f $before
    Yes 'off: both keys are empty and every other setting is as it was' (
        $r.siteKey -eq '' -and $r.secret -eq '' -and $r.kept -eq $true)
    Yes 'off: it says the check is off' (($said -join ' ') -match 'the report form is told no key: the check is off')

    [IO.File]::WriteAllText($f, '{ "discord": { "clientSecret": "not-a-real-secret",', $noMark)
    $was = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f))
    $said = Run-Call $d $key $sec $false
    Yes 'a config that will not parse is left byte for byte, and the site is not restarted' (
        [Convert]::ToBase64String([IO.File]::ReadAllBytes($f)) -eq $was -and -not (($said -join ' ') -match 'STUB Start-ScheduledTask') -and
        ($said -join ' ') -match 'WILL NOT READ AS JSON')
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Done
