<#
  test-docs-password.ps1

  Deploy-Docs.ps1 -Password changes the site's password and nothing else in
  its config.json.

  WHY THIS EXISTS. -Password used to write {"password": ...} over the whole of
  config.json on the VPS. That file also holds the Discord client id and
  secret, the bot token, the bot key, the admins, the server password and the
  cookie secret, and all of them went. It is worse than an inconvenience:
  discordReady() in server.js is clientId and clientSecret both set, isMember
  and /api/login only take the password while it is false, so a wiped config
  turned the password door back on. Getting the rest back meant re-running
  Install-Bot and Set-DiscordLogin. It is "Deploy-Docs -Password wipes the
  whole site config" on the To Do List.

  HOW. The body of the -Password branch is lifted out of Deploy-Docs.ps1 by
  the parser, not copied here, so this tests what ships. Remote is swapped for
  one that runs the same encoded command in PowerShell 7 on this machine
  instead of on the box over ssh. PowerShell 7 on purpose: it is what the box
  runs, and its ConvertFrom-Json and ConvertTo-Json decide what gets written.
  Off Windows the far side's \config.json is turned to /config.json, the one
  thing about the box's paths this machine does not share.
  Then node reads the result the way server.js does, with JSON.parse, and
  without stripping a byte order mark first, so a mark is a failure here.

  Read only apart from its own temp folder. Never connects to anything.
#>
[CmdletBinding()]
param([string]$DeployPath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $DeployPath) { $DeployPath = Join-Path $Here 'scripts\deploy\Deploy-Docs.ps1' }

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

# ---- lift the -Password branch out of the shipped script ---------------------
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($DeployPath, [ref]$tokens, [ref]$errors)
Yes 'Deploy-Docs.ps1 parses' (@($errors).Count -eq 0)
$ifs = @($ast.FindAll({
    param($n)
    $n -is [System.Management.Automation.Language.IfStatementAst] -and
    $n.Clauses[0].Item1.Extent.Text -eq '$Password' -and
    $n.Clauses[0].Item2.Extent.Text -match 'Invoke-ThornswoodSecretRemote'
}, $true))
# The other if ($Password) is the hidden prompt near the top (#1069), which
# asks before anything is sent; this is the branch that sends it.
Yes 'the -Password branch is in Deploy-Docs.ps1' ($ifs.Count -eq 1)
if ($ifs.Count -ne 1) { Done }
$t = $ifs[0].Clauses[0].Item2.Extent.Text
$branch = $t.Substring(1, $t.Length - 2)

# The shape of the old mistake, for anybody reading the source rather than the
# results: the file is read before it is written, and nothing is written whole
# from a value made on this machine. The read and the write are the one block
# Rotate-ServerPassword shares (SiteConfigSet.ps1, #2317), which the branch
# takes for its config.json and the password key.
. (Join-Path $Here 'scripts\deploy\SiteConfigSet.ps1')
Yes 'the branch writes config.json through the shared block, for the password key' (
    $branch.Contains('Get-ThornswoodSiteConfigSet -ConfigPath "$rootWin\config.json" -Key ''password'''))
Yes 'Deploy-Docs.ps1 loads the shared block' ((Get-Content -LiteralPath $DeployPath -Raw).Contains(". (Join-Path `$Here 'SiteConfigSet.ps1')"))
$block = Get-ThornswoodSiteConfigSet -ConfigPath 'C:\x\config.json' -Key 'password' -What 'password'
$read  = $block.IndexOf('ReadAllText')
$write = $block.IndexOf('WriteAllText')
Yes 'the shared block reads config.json before it writes it' ($read -ge 0 -and $write -gt $read)
Yes 'no WriteAllBytes is left in Deploy-Docs.ps1' (-not ((Get-Content -LiteralPath $DeployPath -Raw) -match 'WriteAllBytes'))
# -Password asks, hidden, before anything is sent, and is never a typed value
# (#1069): typed, the password would stay in the shell's history file.
$deployText = Get-Content -LiteralPath $DeployPath -Raw
Yes '-Password is a switch, not a typed value' ($deployText -match '\[switch\]\$Password\b')
Yes 'the branch sends the password the hidden prompt gave' ($branch -match '-Secret \$newPassword\b' -and $deployText -match '\$newPassword = Read-ThornswoodSecret ')

# ---- what runs it -------------------------------------------------------------
. (Join-Path $PSScriptRoot 'Windows.ps1')
$boxPs = Get-BoxPowerShell
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host 'SKIP  the rest needs node, which is not here'
    Done
}

# The password goes through the real Send-Secret.ps1 (issue #451): on ssh's
# standard input, the script alone on the command line. ssh is swapped for
# one that runs that command line in PowerShell 7 here, with the
# same standard input, and keeps every command line it was handed so the
# password can be looked for in them afterwards.
. (Join-Path $Here 'scripts\vps\Send-Secret.ps1')
$script:lines = New-Object System.Collections.ArrayList
function ssh {
    $a = @($args | ForEach-Object { [string]$_ })
    [void]$script:lines.Add(($a -join ' '))
    $m = [regex]::Match($a[-1], '-EncodedCommand (\S+)$')
    if (-not $m.Success) { throw 'the fake ssh was handed no encoded command' }
    [void]$script:lines.Add([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value)))
    $run = $m.Groups[1].Value
    if (-not $OnWindows) {
        $text = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($run)).Replace('\config.json', '/config.json')
        $run = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($text))
    }
    @($input) | & $boxPs -NoProfile -NonInteractive -EncodedCommand $run
}

# Runs the branch with the two things it takes from the rest of Deploy-Docs:
# the site's folder and the password, which the script asked for with a
# hidden prompt before it sent anything (#1069). Its own Write-Host lines are
# kept out of the results; what the far side printed is handed back.
function Run-Branch([string]$rootWin, [string]$pw) {
    $newPassword = $pw
    function Write-Host { }
    return @(. ([ScriptBlock]::Create($branch)) | ForEach-Object { [string]$_ })
}

# How server.js reads it: utf8, JSON.parse. Nothing stripped, so a byte order
# mark fails the parse here even though server.js now steps over one.
$reader = @'
const fs = require('fs'), assert = require('assert');
const after = process.argv[2], before = process.argv[3];
const out = { parses: false };
let b = null;
try { b = JSON.parse(fs.readFileSync(after, 'utf8')); out.parses = true; }
catch (e) { out.error = e.message; }
if (b) {
  out.password = b.password === process.env.TW_WANT_PASSWORD;
  out.keys = Object.keys(b).length;
  if (before) {
    const a = JSON.parse(fs.readFileSync(before, 'utf8').replace(/^\uFEFF/, ''));
    delete a.password; delete b.password;
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

function First3([string]$f) {
    $b = [IO.File]::ReadAllBytes($f)
    return (($b | Select-Object -First 3) -join ' ')
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-docs-password-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
    $script:readerJs = Join-Path $work 'read.js'
    [IO.File]::WriteAllText($script:readerJs, $reader, (New-Object Text.UTF8Encoding($false)))
    $noMark = New-Object Text.UTF8Encoding($false)
    $mark   = New-Object Text.UTF8Encoding($true)

    function Case([string]$name) {
        $d = Join-Path $work $name
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        return $d
    }

    # A config shaped like the live one: server.js's defaults filled in, the
    # key Rotate-ServerPassword adds, arrays of none, one and several, a
    # nested object, numbers, a boolean, a null, and a role name that is not
    # ASCII, which Get-Content in 5.1 would have turned into mojibake.
    $o = [string][char]0x00F6
    $full = @'
{
  "password": "the-old-one",
  "discord": { "clientId": "111111111111111111", "clientSecret": "not-a-real-secret",
               "botToken": "not-a-real-token", "guildId": "222222222222222222",
               "invite": "https://discord.gg/example" },
  "patreon": "",
  "gamePort": 7777,
  "gameCheckPort": 3000,
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
  "serverPassword": "not-a-real-server-password",
  "secret": "not-a-real-cookie-secret",
  "quiet": true,
  "nothing": null,
  "ratio": 1.5
}
'@
    $full = $full.Replace('SkjOld', 'Skj' + $o + 'ld')

    # Quotes, a dollar, a backtick, a backslash and an accent: everything the
    # trip through ssh, cmd and PowerShell could mangle.
    $newPw = 'n3w ''pa$s'' "q" \ `x ' + [string][char]0x00E9

    # ---- a whole config, the case that used to be wiped
    $d = Case 'whole'
    $f = Join-Path $d 'config.json'
    [IO.File]::WriteAllText($f, $full, $noMark)
    [IO.File]::WriteAllText((Join-Path $d 'before.json'), $full, $noMark)
    $said = Run-Branch $d $newPw
    $r = Read-Node $f (Join-Path $d 'before.json') $newPw
    Yes 'a whole config: node parses what was written' ($r.parses -eq $true)
    Yes 'a whole config: the password is the new one' ($r.password -eq $true)
    Yes 'a whole config: every other key is exactly as it was' ($r.kept -eq $true)
    if ($r.kept -ne $true) {
        if ($r.diff) { Write-Host ('      ' + ($r.diff -replace "`n", "`n      ")) }
        if ($r.error) { Write-Host ('      ' + $r.error) }
        Write-Host ('      the far side said: ' + ($said -join ' | '))
    }
    Yes 'a whole config: no byte order mark on it' ((First3 $f) -ne '239 187 191')
    Yes 'a whole config: it says it kept the rest' (($said -join ' ') -match 'set password, 13 other setting')
    $wire = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($newPw))
    $sent = $script:lines -join "`n"
    Yes 'the password went to ssh at all' ($script:lines.Count -ge 2)
    Yes 'the password is on no command line handed to ssh, nor in the script, plain or base64 (#451)' (
        -not $sent.Contains($newPw) -and -not $sent.Contains($wire))

    # ---- a config that already has a byte order mark, as anything written
    # with Set-Content -Encoding UTF8 in Windows PowerShell does
    $d = Case 'marked'
    $f = Join-Path $d 'config.json'
    [IO.File]::WriteAllText($f, $full, $mark)
    [IO.File]::WriteAllText((Join-Path $d 'before.json'), $full, $noMark)
    Yes 'the marked config really starts with a mark' ((First3 $f) -eq '239 187 191')
    $said = Run-Branch $d 'second-password'
    $r = Read-Node $f (Join-Path $d 'before.json') 'second-password'
    Yes 'a marked config: read through the mark and every other key kept' ($r.kept -eq $true)
    Yes 'a marked config: the password is the new one' ($r.password -eq $true)
    Yes 'a marked config: the mark is gone' ((First3 $f) -ne '239 187 191')

    # ---- a config that will not parse is left exactly as it is. That is
    # server.js's own rule, and the difference is somebody's client secret.
    $d = Case 'broken'
    $f = Join-Path $d 'config.json'
    $broken = '{ "discord": { "clientId": "111111111111111111", "clientSecret": "not-a-real-secret",'
    [IO.File]::WriteAllText($f, $broken, $noMark)
    $was = [Convert]::ToBase64String([IO.File]::ReadAllBytes($f))
    $said = Run-Branch $d 'third-password'
    Yes 'a config that will not parse is not touched, byte for byte' ([Convert]::ToBase64String([IO.File]::ReadAllBytes($f)) -eq $was)
    Yes 'and it says so' (($said -join ' ') -match 'WILL NOT READ AS JSON')
    Yes 'and does not claim it set anything' (-not (($said -join ' ') -match '(^|\s)set(\W|$)'))

    # ---- an empty file will not parse either. ConvertFrom-Json in 5.1 hands
    # back nothing for it rather than throwing, which is why the branch checks
    # what it got instead of trusting the try.
    $d = Case 'empty'
    $f = Join-Path $d 'config.json'
    [IO.File]::WriteAllText($f, '', $noMark)
    $said = Run-Branch $d 'fourth-password'
    Yes 'an empty config is not touched' ((Get-Item -LiteralPath $f).Length -eq 0)
    Yes 'and it says so' (($said -join ' ') -match 'WILL NOT READ AS JSON')

    # ---- no config at all: a first install. The password is all there is to
    # write, and server.js fills in the rest when it starts.
    $d = Case 'none'
    $f = Join-Path $d 'config.json'
    $said = Run-Branch $d 'fifth-password'
    Yes 'no config: one is written' (Test-Path -LiteralPath $f)
    if (Test-Path -LiteralPath $f) {
        $r = Read-Node $f '' 'fifth-password'
        Yes 'no config: node parses it' ($r.parses -eq $true)
        Yes 'no config: it holds the password and nothing else' ($r.password -eq $true -and $r.keys -eq 1)
        Yes 'no config: no byte order mark on it' ((First3 $f) -ne '239 187 191')
    }
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
