<#
  test-2317-rotate-config.ps1

  Rotate-ServerPassword.ps1 changes serverPassword in the site's config.json
  and nothing else, and leaves a config.json that will not parse exactly as it
  is (issue #2317).

  WHY THIS EXISTS. The script it sends to the VPS read config.json with
  Get-Content inside try { } catch { }. A file that was there and did not
  parse left an empty table, and {"serverPassword": ...} was written over the
  whole file: the Discord client id and secret, the bot token, botKey, the
  admins and the cookie secret went with it, and with no client id the site's
  member password opens the door again. Get-Content in Windows PowerShell 5.1
  also read a file with no byte order mark in the local code page, so any
  accented role name came back changed. Deploy-Docs -Password had the same
  wipe and was fixed; this copy was not. Both now use SiteConfigSet.ps1.

  HOW. The Invoke-ThornswoodSecretRemote call is lifted out of the shipped
  Rotate-ServerPassword.ps1 by the parser, not copied, and run here with the
  real Send-Secret.ps1, so the value goes on standard input exactly as it
  would. ssh is a function here that runs the command line it was handed in
  PowerShell 7, the box's PowerShell since #5356, against a scratch folder, with
  the site restart's commands (Get-CimInstance, Stop-Process,
  Start-ScheduledTask, Get-NetTCPConnection, Start-Sleep) replaced by ones that
  only say they were called. Nothing on this machine is stopped or started,
  and nothing connects anywhere. node then reads the result the way server.js
  does. The script itself is never run.

    pwsh -File tests\test-2317-rotate-config.ps1
    pwsh -File tests\test-2317-rotate-config.ps1 -RotatePath <an older copy>   to see it catch the old one
#>
[CmdletBinding()]
param([string]$RotatePath)
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Here = Split-Path -Parent $Here
if (-not $RotatePath) { $RotatePath = Join-Path $Here 'scripts\deploy\Rotate-ServerPassword.ps1' }

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

# ---- lift the call that sends the password ------------------------------------
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($RotatePath, [ref]$tokens, [ref]$errors)
Yes 'Rotate-ServerPassword.ps1 parses' (@($errors).Count -eq 0)
$calls = @($ast.FindAll({
    param($n)
    $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -eq 'Invoke-ThornswoodSecretRemote'
}, $true))
Yes 'it sends the password with Invoke-ThornswoodSecretRemote, once' ($calls.Count -eq 1)
if ($calls.Count -ne 1) { Done }
$call = $calls[0].Extent.Text
$rotateText = Get-Content -LiteralPath $RotatePath -Raw

Yes 'it loads the block Deploy-Docs -Password uses' ($rotateText.Contains(". (Join-Path `$Here 'SiteConfigSet.ps1')"))
Yes 'its far side sets serverPassword through that block' (
    $call.Contains('Get-ThornswoodSiteConfigSet -ConfigPath "$docsWin\config.json" -Key ''serverPassword'''))
Yes 'its far side does not read config.json with Get-Content' (-not ($call -match 'Get-Content'))
. (Join-Path $Here 'scripts\deploy\SiteConfigSet.ps1')
. (Join-Path $Here 'scripts\vps\Send-Secret.ps1')

# ---- what runs it -------------------------------------------------------------
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host 'SKIP  the rest needs node, which is not here'
    Done
}

# The restart's commands, replaced. Functions win over cmdlets of the same
# name, so the far side calls these and says so, instead of stopping a node
# on this machine or starting a task.
$stubs = @'
function Get-CimInstance { 'STUB looked for the site' }
function Stop-Process { 'STUB Stop-Process' }
function Start-ScheduledTask { 'STUB Start-ScheduledTask' }
function Start-Sleep { }
function Get-NetTCPConnection { $true }

'@

$script:lines = New-Object System.Collections.ArrayList
function ssh {
    $a = @($args | ForEach-Object { [string]$_ })
    [void]$script:lines.Add(($a -join ' '))
    $m = [regex]::Match($a[-1], '-EncodedCommand (\S+)$')
    if (-not $m.Success) { throw 'the fake ssh was handed no encoded command' }
    $text = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value))
    [void]$script:lines.Add($text)
    # Off Windows a backslash is no folder separator to .NET, so the scratch
    # folder's path is turned round here, as test-3216-set-turnstile.ps1 does;
    # on Windows the script runs as sent.
    if (-not $OnWindows) { $text = $text.Replace('\config.json', '/config.json') }
    $run = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($stubs + $text))
    @($input) | & $boxPs -NoProfile -NonInteractive -EncodedCommand $run
}
# Over the length limit the script would go by file with scp; that is not this
# path, and nothing here may copy anything anywhere.
function scp { throw 'the far side went by file (scp), which this harness does not run' }
Yes 'ssh and scp here are the harness''s own, so nothing connects' (
    (Get-Command ssh).CommandType -eq 'Function' -and (Get-Command scp).CommandType -eq 'Function')

# Runs the lifted call with what it takes from the rest of the script: the
# site's folder, the target, ssh's options and the password.
function Run-Call([string]$docsWin, [string]$pw) {
    $User = 'nobody'; $Vps = 'nowhere.invalid'
    $ssh = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
    $newPassword = $pw
    return @(. ([ScriptBlock]::Create($call)) | ForEach-Object { [string]$_ })
}

$reader = @'
const fs = require('fs'), assert = require('assert');
const after = process.argv[2], before = process.argv[3];
const out = { parses: false };
let b = null;
try { b = JSON.parse(fs.readFileSync(after, 'utf8')); out.parses = true; }
catch (e) { out.error = e.message; }
if (b) {
  out.password = b.serverPassword === process.env.TW_WANT_PASSWORD;
  out.keys = Object.keys(b).length;
  if (before) {
    const a = JSON.parse(fs.readFileSync(before, 'utf8').replace(/^\uFEFF/, ''));
    out.order = JSON.stringify(Object.keys(b)) === JSON.stringify(Object.keys(a));
    delete a.serverPassword; delete b.serverPassword;
    try { assert.deepStrictEqual(b, a); out.kept = true; }
    catch (e) { out.kept = false; out.diff = e.message.split('\n').slice(0, 20).join('\n'); }
  }
}
console.log(JSON.stringify(out));
'@

function Read-Node([string]$after, [string]$before, [string]$want) {
    $env:TW_WANT_PASSWORD = $want
    try { $o = & $node.Source $script:readerJs $after $before }
    finally { Remove-Item Env:\TW_WANT_PASSWORD -ErrorAction SilentlyContinue }
    return ($o | Select-Object -Last 1 | ConvertFrom-Json)
}
function First3([string]$f) { return ((([IO.File]::ReadAllBytes($f)) | Select-Object -First 3) -join ' ') }
function Restarted($said) { return (($said -join ' ') -match 'STUB Start-ScheduledTask') }

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-2317-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    $script:readerJs = Join-Path $work 'read.js'
    $noMark = New-Object Text.UTF8Encoding($false)
    $mark   = New-Object Text.UTF8Encoding($true)
    [IO.File]::WriteAllText($script:readerJs, $reader, $noMark)
    function Case([string]$name) {
        $d = Join-Path $work $name
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        return $d
    }

    # Shaped like the live one, with serverPassword in the middle so a change
    # of key order shows, and a role name that is not ASCII, which Get-Content
    # in 5.1 turned into something else. The values are made up.
    $o = [string][char]0x00F6
    $full = @'
{
  "password": "not-a-real-member-password",
  "discord": { "clientId": "111111111111111111", "clientSecret": "not-a-real-secret",
               "botToken": "not-a-real-token", "guildId": "222222222222222222",
               "invite": "https://discord.gg/example" },
  "patreon": "",
  "gamePort": 7777,
  "gameCheckPort": 3000,
  "serverPassword": "not-a-real-server-password",
  "onlineFile": "C:/Thornswood-Server/data/online.json",
  "access": {
    "admin": ["Owner", "Dev"],
    "play": ["Owner", "Dev", "Moderator", "Gamemaster", "Loremaster", "Content Creator", "Playtester"],
    "banned": ["Banned"],
    "dev": [],
    "slots3": ["Thalmor Boot-Licker", "Milk Drinker", "SkjOld"]
  },
  "botKey": "not-a-real-key",
  "admins": ["333333333333333333"],
  "secret": "not-a-real-cookie-secret",
  "quiet": true,
  "nothing": null,
  "ratio": 1.5
}
'@
    $full = $full.Replace('SkjOld', 'Skj' + $o + 'ld')
    $newPw = 'n3w ''pa$s'' "q" \ `x ' + [string][char]0x00E9

    # ---- a whole config
    $d = Case 'whole'
    $f = Join-Path $d 'config.json'
    [IO.File]::WriteAllText($f, $full, $noMark)
    [IO.File]::WriteAllText((Join-Path $d 'before.json'), $full, $noMark)
    $said = Run-Call $d $newPw
    $r = Read-Node $f (Join-Path $d 'before.json') $newPw
    Yes 'a whole config: node parses what was written' ($r.parses -eq $true)
    Yes 'a whole config: serverPassword is the new one' ($r.password -eq $true)
    Yes 'a whole config: every other key is exactly as it was, the accented role name too' ($r.kept -eq $true)
    if ($r.kept -ne $true) {
        if ($r.diff) { Write-Host ('      ' + ($r.diff -replace "`n", "`n      ")) }
        if ($r.error) { Write-Host ('      ' + $r.error) }
        Write-Host ('      the far side said: ' + ($said -join ' | '))
    }
    Yes 'a whole config: the settings keep their order' ($r.order -eq $true)
    Yes 'a whole config: no byte order mark on it' ((First3 $f) -ne '239 187 191')
    Yes 'a whole config: it says it kept the rest' (($said -join ' ') -match 'set serverPassword, 13 other setting')
    Yes 'a whole config: the site is restarted after the write' (Restarted $said)
    Yes 'the far side went on the command line, not by file' ($script:lines.Count -ge 2)
    $wire = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($newPw))
    $sent = $script:lines -join "`n"
    Yes 'the password is on no command line handed to ssh, nor in the script, plain or base64 (#451)' (
        -not $sent.Contains($newPw) -and -not $sent.Contains($wire))

    # ---- a config with a byte order mark
    $d = Case 'marked'
    $f = Join-Path $d 'config.json'
    [IO.File]::WriteAllText($f, $full, $mark)
    [IO.File]::WriteAllText((Join-Path $d 'before.json'), $full, $noMark)
    $said = Run-Call $d 'second-password'
    $r = Read-Node $f (Join-Path $d 'before.json') 'second-password'
    Yes 'a marked config: read through the mark and every other key kept' ($r.kept -eq $true -and $r.password -eq $true)
    Yes 'a marked config: the mark is gone' ((First3 $f) -ne '239 187 191')

    # ---- the wipe itself: there, and will not parse. Left byte for byte, and
    # the site is not restarted for a change that did not happen.
    $broken = @(
        @{ Name = 'cut off';  Text = '{ "discord": { "clientId": "111111111111111111", "clientSecret": "not-a-real-secret",' },
        @{ Name = 'empty';    Text = '' },
        @{ Name = 'an array'; Text = '[ "not", "an", "object" ]' },
        @{ Name = 'a string'; Text = '"just a string"' }
    )
    $i = 0
    foreach ($b in $broken) {
        $i++
        $d = Case ('broken' + $i)
        $f = Join-Path $d 'config.json'
        [IO.File]::WriteAllText($f, $b.Text, $noMark)
        $was = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f))
        $said = Run-Call $d 'third-password'
        Yes ('a config that is ' + $b.Name + ': not touched, byte for byte') ([Convert]::ToBase64String([IO.File]::ReadAllBytes($f)) -eq $was)
        Yes ('a config that is ' + $b.Name + ': it says so') (($said -join ' ') -match 'WILL NOT READ AS JSON\. Nothing written, the server password is unchanged')
        Yes ('a config that is ' + $b.Name + ': the site is not restarted') (-not (Restarted $said))
        Yes ('a config that is ' + $b.Name + ': the parse error, which quotes the file, is not printed') (
            -not (($said -join ' ') -match 'not-a-real-secret|Invalid JSON|Unexpected'))
    }

    # ---- no config at all: written with the one key
    $d = Case 'none'
    $f = Join-Path $d 'config.json'
    $said = Run-Call $d 'fifth-password'
    Yes 'no config: one is written' (Test-Path -LiteralPath $f)
    if (Test-Path -LiteralPath $f) {
        $r = Read-Node $f '' 'fifth-password'
        Yes 'no config: it holds serverPassword and nothing else' ($r.parses -eq $true -and $r.password -eq $true -and $r.keys -eq 1)
    }
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
