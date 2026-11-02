<#
  test-bot-login-rotation.ps1

      pwsh -NoProfile -File .\tests\test-bot-login-rotation.ps1

  The Discord bot token goes into both files on the VPS that use it, or into
  neither, and is never printed on the way (issue #466).

  WHY. The token lives in C:\Thornswood-Bot\bot.env.json (DISCORD_TOKEN, the
  bot) and C:\Thornswood-Docs\config.json (discord.botToken, the site). Each
  had its own writer, Install-Bot.ps1 and Set-DiscordLogin.ps1, and nothing
  tied them together, so a rotation done with one left the site on a dead
  token and everybody but the hand written admins was turned away.
  scripts\vps\Write-BotToken.ps1 is the one writer now, and
  scripts\deploy\Rotate-BotToken.ps1 the one command.

  HOW. Runs Write-BotToken.ps1, the same file the scripts send to the VPS,
  against fake copies of both files in a scratch folder with a made up token
  built here at run time, so no token is ever written into this file. Checks
  both files get it and still parse (with node too, the way the site reads
  it, when node is on the machine), everything else in them is kept, the
  token never appears in anything printed, and every refusal leaves both
  files byte for byte as they were. Then reads the scripts: they parse, the
  other two writers hand the token to this one, Rotate-BotToken.ps1 takes it
  at a prompt and only ever sends it base64, and no webhook file is tracked.

  Talks to nothing. Writes only to its own scratch folder, removed at the end.
#>
[CmdletBinding()]
param([string]$Scratch)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent $Here

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$writer  = Join-Path $repo 'scripts\vps\Write-BotToken.ps1'
$rotate  = Join-Path $repo 'scripts\deploy\Rotate-BotToken.ps1'
$install = Join-Path $repo 'scripts\deploy\Install-Bot.ps1'
$login   = Join-Path $repo 'scripts\deploy\Set-DiscordLogin.ps1'

# ------------------------------------------------------------ parsing ---
foreach ($f in @($writer, $rotate, $install, $login)) {
    $tokens = $null; $errors = $null
    $ok = Test-Path -LiteralPath $f
    if ($ok) { [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errors) }
    Yes ((Split-Path -Leaf $f) + ' is there and parses with no errors') ($ok -and @($errors).Count -eq 0)
}

. $writer

# ------------------------------------------------------- fake secrets ---
# Made here, never written into this file: an application id in base64, then
# two runs of random letters, the shape a bot token has.
function B64Url([string]$s) {
    return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}
function RandomRun([int]$n) {
    $abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    $b = New-Object byte[] $n
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    return -join ($b | ForEach-Object { $abc[$_ % $abc.Length] })
}
function FakeToken([string]$app) { return (B64Url $app) + '.' + (RandomRun 6) + '.' + (RandomRun 38) }

$app      = '123456789012345678'
$otherApp = '876543210987654321'
$oldToken = FakeToken $app
$newToken = FakeToken $app
$wrongApp = FakeToken $otherApp
$fakeKey    = RandomRun 32
$fakeSecret = RandomRun 32
$secrets = @($oldToken, $newToken, $wrongApp, $fakeKey, $fakeSecret)

Yes 'the made up token reads as a bot token for its application' ((Get-ThornswoodTokenApp $newToken) -eq $app)
Yes 'a client secret shape does not' (-not (Get-ThornswoodTokenApp $fakeSecret))

# ------------------------------------------------------------ scratch ---
if (-not $Scratch) { $Scratch = [IO.Path]::GetTempPath() }
$dir = Join-Path $Scratch ('bot-login-rotation-' + [Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $dir -Force)
$envFile = Join-Path $dir 'bot.env.json'
$cfgFile = Join-Path $dir 'config.json'
$noBom = New-Object Text.UTF8Encoding($false)

function Reset-Fakes {
    $e = [ordered]@{
        DISCORD_TOKEN   = $oldToken
        THORNSWOOD_SITE = 'https://thornswood.net'
        THORNSWOOD_KEY  = $fakeKey
        JOIN_CHANNEL    = 'welcome-travelers'
        STAFF_ROLES     = 'Owner,Dev,Gamemaster'
    }
    $c = [ordered]@{
        password = 'not-a-real-password'
        discord  = [ordered]@{ clientId = $app; clientSecret = $fakeSecret; botToken = $oldToken; guildId = '111111111111111111'; invite = 'https://discord.gg/abcdEFG12' }
        access   = [ordered]@{ admin = @('Owner', 'Dev'); play = @('Owner', 'Dev', 'Playtester'); banned = @('Banned') }
        botKey   = $fakeKey
        admins   = @('222222222222222222')
        secret   = $fakeSecret
    }
    foreach ($f in @($envFile, $cfgFile)) {
        if (Test-Path -LiteralPath $f) { (Get-Item -LiteralPath $f).IsReadOnly = $false; Remove-Item -LiteralPath $f -Force }
    }
    [IO.File]::WriteAllText($envFile, ($e | ConvertTo-Json -Depth 6), $noBom)
    [IO.File]::WriteAllText($cfgFile, ($c | ConvertTo-Json -Depth 6), $noBom)
}

function Bytes([string]$f) {
    if (-not (Test-Path -LiteralPath $f)) { return '' }
    return [Convert]::ToBase64String([IO.File]::ReadAllBytes($f))
}

# Every stream, so a Write-Host or a warning carrying the token would count.
$script:allSaid = New-Object Text.StringBuilder
function Run([scriptblock]$sb) {
    $r = $null
    $said = & { $script:r = & $sb } *>&1 | Out-String
    $r = $script:r
    $text = $said
    if ($r -and $r.Lines) { $text += ($r.Lines -join "`n") }
    [void]$script:allSaid.Append($text)
    return $r
}

function NoSecretIn([string]$what, [string]$text) {
    $leaked = @($secrets | Where-Object { $text.Contains($_) })
    Yes $what ($leaked.Count -eq 0)
}

try {
    # ------------------------------------------------------ the rotation ---
    Reset-Fakes
    $r = Run { Write-ThornswoodBotToken -Token $newToken -BotEnv $envFile -SiteConfig $cfgFile }
    Yes 'a rotation says it worked and changed something' ($r.Ok -and $r.Changed)
    Yes 'it names both files and says each was written and read back' (
        @($r.Lines | Where-Object { $_ -like ($envFile + '*DISCORD_TOKEN*written and read back*') }).Count -eq 1 -and
        @($r.Lines | Where-Object { $_ -like ($cfgFile + '*discord.botToken*written and read back*') }).Count -eq 1)

    $e = [IO.File]::ReadAllText($envFile) | ConvertFrom-Json
    $c = [IO.File]::ReadAllText($cfgFile) | ConvertFrom-Json
    Yes 'bot.env.json parses and DISCORD_TOKEN is the new token' ($e.DISCORD_TOKEN -ceq $newToken)
    Yes 'config.json parses and discord.botToken is the new token' ($c.discord.botToken -ceq $newToken)
    Yes 'bot.env.json kept its other settings' ($e.THORNSWOOD_KEY -ceq $fakeKey -and $e.JOIN_CHANNEL -eq 'welcome-travelers' -and $e.STAFF_ROLES -eq 'Owner,Dev,Gamemaster')
    Yes 'config.json kept the client secret, the client id, the guild and the key' (
        $c.discord.clientSecret -ceq $fakeSecret -and $c.discord.clientId -eq $app -and
        $c.discord.guildId -eq '111111111111111111' -and $c.botKey -ceq $fakeKey -and $c.secret -ceq $fakeSecret)
    Yes 'config.json kept its role lists and admins as lists' (
        @($c.access.play).Count -eq 3 -and @($c.access.admin).Count -eq 2 -and @($c.admins).Count -eq 1)
    Yes 'neither file starts with a byte order mark' (-not (Test-ThornswoodBom $envFile) -and -not (Test-ThornswoodBom $cfgFile))

    $node = Get-Command node -EA SilentlyContinue
    if ($node) {
        # The site's own read: JSON.parse of the file as UTF-8. Says only yes or no.
        $js = "const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(c.discord&&typeof c.discord.botToken==='string'&&c.discord.botToken.length>50?'present':'absent')"
        $said = & $node.Source -e $js $cfgFile 2>&1 | Out-String
        Yes 'node parses config.json the way the site does and finds the token present' ($said.Trim() -eq 'present')
    } else { Write-Host 'SKIP  node is not on this machine, so the site''s own parse was not tried' }

    $state = Run { $o = Get-ThornswoodBotTokenState -BotEnv $envFile -SiteConfig $cfgFile; New-Object PSObject -Property @{ Lines = @($o) } }
    Yes 'the read only check says both parse and hold a token for the application' (
        @($state.Lines | Where-Object { $_ -like '*parses; * is present, application 123456789012345678' }).Count -eq 2)

    $r = Run { Write-ThornswoodBotToken -Token $newToken -BotEnv $envFile -SiteConfig $cfgFile }
    Yes 'the same token again is fine and changes nothing' ($r.Ok -and -not $r.Changed)

    # ------------------------------------------------------- refusals ---
    Reset-Fakes
    $before = (Bytes $envFile) + '|' + (Bytes $cfgFile)
    $r = Run { Write-ThornswoodBotToken -Token $wrongApp -BotEnv $envFile -SiteConfig $cfgFile }
    Yes 'a token for another application is refused' (-not $r.Ok -and (($r.Lines -join ' ') -match 'NOT WRITTEN.*application 876543210987654321'))
    Yes '  and both files are exactly as they were' (((Bytes $envFile) + '|' + (Bytes $cfgFile)) -eq $before)

    $r = Run { Write-ThornswoodBotToken -Token $wrongApp -BotEnv $envFile -SiteConfig $cfgFile -AnyApplication }
    Yes 'with -AnyApplication it goes into both' ($r.Ok -and
        (([IO.File]::ReadAllText($envFile) | ConvertFrom-Json).DISCORD_TOKEN -ceq $wrongApp) -and
        (([IO.File]::ReadAllText($cfgFile) | ConvertFrom-Json).discord.botToken -ceq $wrongApp))

    Reset-Fakes
    $before = (Bytes $envFile) + '|' + (Bytes $cfgFile)
    $r = Run { Write-ThornswoodBotToken -Token $fakeSecret -BotEnv $envFile -SiteConfig $cfgFile }
    Yes 'a client secret given as the token is refused' (-not $r.Ok -and (($r.Lines -join ' ') -match 'not a bot token'))
    Yes '  and both files are exactly as they were' (((Bytes $envFile) + '|' + (Bytes $cfgFile)) -eq $before)

    Reset-Fakes
    # A config.json that does not parse, holding a secret, which must not be
    # quoted back in the refusal.
    [IO.File]::WriteAllText($cfgFile, '{ "discord": { "clientSecret": "' + $fakeSecret + '", ', $noBom)
    $before = (Bytes $envFile) + '|' + (Bytes $cfgFile)
    $r = Run { Write-ThornswoodBotToken -Token $newToken -BotEnv $envFile -SiteConfig $cfgFile }
    Yes 'a config.json that does not parse stops it' (-not $r.Ok -and (($r.Lines -join ' ') -match 'does not parse'))
    Yes '  and bot.env.json did not get the token either' (((Bytes $envFile) + '|' + (Bytes $cfgFile)) -eq $before)

    Reset-Fakes
    Remove-Item -LiteralPath $envFile -Force
    $before = Bytes $cfgFile
    $r = Run { Write-ThornswoodBotToken -Token $newToken -BotEnv $envFile -SiteConfig $cfgFile }
    Yes 'no bot.env.json stops it and points at Install-Bot.ps1' (-not $r.Ok -and (($r.Lines -join ' ') -match 'Install-Bot'))
    Yes '  and config.json did not get the token either' ((Bytes $cfgFile) -eq $before -and -not (Test-Path -LiteralPath $envFile))

    Reset-Fakes
    # The second write fails: bot.env.json has already been written by then,
    # and has to be put back. A read-only file is what stops it, which holds on
    # Windows and for any account but root; root writes through it (a cloud
    # session runs as root), so the probe asks first (#2989).
    $probe = Join-Path $Scratch ('ro-probe-' + [Guid]::NewGuid().ToString('N') + '.txt')
    [IO.File]::WriteAllText($probe, 'probe')
    (Get-Item -LiteralPath $probe).IsReadOnly = $true
    $roStops = $false
    try { [IO.File]::WriteAllText($probe, 'written through') } catch { $roStops = $true }
    (Get-Item -LiteralPath $probe).IsReadOnly = $false
    Remove-Item -LiteralPath $probe -Force
    if ($roStops) {
        $before = (Bytes $envFile) + '|' + (Bytes $cfgFile)
        (Get-Item -LiteralPath $cfgFile).IsReadOnly = $true
        $r = Run { Write-ThornswoodBotToken -Token $newToken -BotEnv $envFile -SiteConfig $cfgFile }
        (Get-Item -LiteralPath $cfgFile).IsReadOnly = $false
        Yes 'a write that fails half way says so' (-not $r.Ok -and (($r.Lines -join ' ') -match 'NOT WRITTEN: stopped while writing'))
        Yes '  and bot.env.json is put back as it was' (((Bytes $envFile) + '|' + (Bytes $cfgFile)) -eq $before)
    } else {
        Write-Host 'SKIP  a write that fails half way: this account writes through a read-only file (root does), so the second write cannot be made to fail that way here'
    }

    NoSecretIn 'nothing printed or returned in any of the above carries a token, the key or a secret' $script:allSaid.ToString()
}
finally {
    foreach ($f in @($envFile, $cfgFile)) {
        if (Test-Path -LiteralPath $f) { (Get-Item -LiteralPath $f).IsReadOnly = $false }
    }
    Remove-Item -LiteralPath $dir -Recurse -Force -EA SilentlyContinue
}

# ------------------------------------------------------- the scripts ---
function CodeOf([string]$f) {
    # The script without its comments, so an explanation does not count.
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errors)
    $text = [IO.File]::ReadAllText($f)
    $sb = New-Object Text.StringBuilder
    $at = 0
    foreach ($t in $tokens) {
        if ($t.Kind -ne 'Comment') { continue }
        [void]$sb.Append($text.Substring($at, $t.Extent.StartOffset - $at))
        $at = $t.Extent.EndOffset
    }
    [void]$sb.Append($text.Substring($at))
    return $sb.ToString()
}

$rot = CodeOf $rotate
$ast = [System.Management.Automation.Language.Parser]::ParseFile($rotate, [ref]$null, [ref]$null)
$params = @($ast.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
Yes 'Rotate-BotToken.ps1 takes no token as a parameter' (@($params | Where-Object { $_ -match '(?i)token|secret' }).Count -eq 0)
Yes 'Rotate-BotToken.ps1 asks for it with Read-Host -AsSecureString' ($rot -match "Read-Host\s+'[^']*'\s+-AsSecureString")
$uses = @(($rot -split "`n") | Where-Object { $_ -match '\$token\b' } | ForEach-Object { $_.Trim() })
$allowed = @(
    '^try \{ \$token = \[Runtime\.InteropServices\.Marshal\]::PtrToStringAuto\(\$bstr\)\.Trim\(\) \}$',
    '^\$app = Get-ThornswoodTokenApp \$token$',
    '^\$token = \$null$',
    # Issue #451: the token goes on ssh's standard input, as -Secret, and
    # nowhere else. It used to be base64'd into the script sent as a command.
    # The writer's text goes in front of the script since #3035.
    '^\$out = Invoke-ThornswoodSecretRemote -Target "\$User@\$Vps" -SshArgs \$ssh -Secret \$token -Script \(\$writerText \+ "`n" \+ @"$'
)
$odd = @($uses | Where-Object { $u = $_; -not @($allowed | Where-Object { $u -match $_ }).Count })
Yes ('every use of $token in Rotate-BotToken.ps1 is the prompt, the shape check, the standard input it is sent on or clearing it' +
     $(if ($odd.Count) { ': ' + ($odd -join ' | ') } else { '' })) ($uses.Count -ge 4 -and $odd.Count -eq 0)
Yes 'no ssh or scp line in Rotate-BotToken.ps1 names $token, except as the -Secret sent on standard input' (@(($rot -split "`n") | ForEach-Object { $_ -replace '-Secret \$token\b', '' } | Where-Object { $_ -match '\b(ssh|scp)\b' -and $_ -match '\$token\b' }).Count -eq 0)
Yes 'no base64 of the token is made in Rotate-BotToken.ps1 (#451)' ($rot -notmatch 'GetBytes\(\$token\)')
# Issue #3035: the writer went up as a file of its own in C:\Windows\Temp, and
# a run cut before the next call left it there. Now its text goes in front of
# each script that calls it, as Install-Bot.ps1 and Set-DiscordLogin.ps1 send it.
Yes 'Rotate-BotToken.ps1 copies nothing to the box: no scp, and no file of its own under C:\Windows\Temp' ($rot -notmatch '\bscp\b' -and $rot -notmatch '(?i)Windows[\\/]Temp')
Yes '  it sends the writer''s text in front of the script for the check and for the write' (([regex]::Matches($rot, '\(\$writerText \+ "`n" \+ @"')).Count -eq 2)
Yes 'Rotate-BotToken.ps1 writes through Write-ThornswoodBotToken' ($rot -match 'Write-ThornswoodBotToken -Token')
Yes 'Rotate-BotToken.ps1 restarts the bot and the site' ($rot -match 'Restart-ThornswoodBot ' -and $rot -match 'Restart-ThornswoodSite ')

foreach ($f in @($install, $login)) {
    $code = CodeOf $f
    $n = Split-Path -Leaf $f
    Yes "$n hands the token to Write-ThornswoodBotToken" ($code -match 'Write-BotToken\.ps1' -and $code -match 'Write-ThornswoodBotToken -Token')
    Yes "$n no longer writes DISCORD_TOKEN or botToken itself" (
        $code -notmatch "\['DISCORD_TOKEN'\]\s*=" -and $code -notmatch '\.botToken\s*=' -and $code -notmatch "\['botToken'\]\s*=")
}

# ------------------------------------------------------ webhook files ---
$git = Get-Command git -EA SilentlyContinue
if ($git -and (Test-Path -LiteralPath (Join-Path $repo '.git'))) {
    $tracked = @(& $git.Source -C $repo ls-files 2>$null | Where-Object { $_ -match '(?i)webhook[^/]*\.txt$' })
    Yes ('no webhook file is tracked by git' + $(if ($tracked.Count) { ': ' + ($tracked -join ', ') } else { '' })) ($tracked.Count -eq 0)
} else { Write-Host 'SKIP  no git here, so what is tracked was not checked' }
$ignore = [IO.File]::ReadAllText((Join-Path $repo '.gitignore'))
Yes '.gitignore keeps out both webhook files' ($ignore -match '(?m)^bot/news-webhook\.txt\s*$' -and $ignore -match '(?m)^bot/dev-webhook\.txt\s*$')

# #2711: the head of what Set-DiscordLogin.ps1 runs on the box, from what
# arrived on standard input to the read of the site's config.json. Both sat
# in a try with an empty catch, so a config.json that did not read became an
# empty table and was written over: the bot token, botKey and the cookie
# secret with it, the #2317 shape.
$ll = @(Get-Content -LiteralPath $login)
$hs = [Array]::IndexOf($ll, '`$patch = `$null')
$he = [Array]::IndexOf($ll, '`$d = @{}')
Yes 'found the head of what Set-DiscordLogin.ps1 runs on the box' ($hs -ge 0 -and $he -gt $hs)
if ($hs -ge 0 -and $he -gt $hs) {
    $headDir = Join-Path $Scratch ('login-head-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $headDir | Out-Null
    try {
        $rootWin = $headDir
        $head = $ExecutionContext.InvokeCommand.ExpandString(($ll[$hs..($he - 1)] -join "`r`n") + "`r`n'READ ON'")
        $cfgFile = Join-Path $headDir 'config.json'
        $held = '{"botKey":"not-a-real-key","cookieSecret":"x"'
        [IO.File]::WriteAllText($cfgFile, $held)
        $ThornswoodSecret = '{"discord":{"clientId":"1"},"token":"","patreon":"","admins":[]}'
        $said = @(& ([scriptblock]::Create($head)) | ForEach-Object { "$_" })
        Yes 'a config.json that does not read stops it, naming the file, and it is left as it was' (
            (($said -join ' ') -match '^NOT WRITTEN: .*config\.json does not parse as JSON') -and ($said -notcontains 'READ ON') -and [IO.File]::ReadAllText($cfgFile) -ceq $held)
        $ThornswoodSecret = '{"discord": not json'
        $said = @(& ([scriptblock]::Create($head)) | ForEach-Object { "$_" })
        Yes 'what arrived that is not the JSON sent stops it, without repeating it' ((($said -join ' ') -match '^NOT WRITTEN: what arrived on standard input') -and -not (($said -join ' ') -match 'not json') -and ($said -notcontains 'READ ON'))
        [IO.File]::WriteAllText($cfgFile, '{"botKey":"not-a-real-key"}')
        $ThornswoodSecret = '{"discord":{"clientId":"1"},"token":"","patreon":"","admins":[]}'
        $said = @(& ([scriptblock]::Create($head)) | ForEach-Object { "$_" })
        Yes 'a config.json that reads goes on' ($said -contains 'READ ON')
    } finally { Remove-Item -LiteralPath $headDir -Recurse -Force -ErrorAction SilentlyContinue }
}
$lt = [IO.File]::ReadAllText($login)
Yes '  and Set-DiscordLogin.ps1 exits 1 on those lines, before its closing advice' ($lt.IndexOf("-like 'NOT WRITTEN:*'") -gt $lt.IndexOf('$wrote | ForEach-Object') -and $lt.IndexOf('The redirect in the Discord application') -gt $lt.IndexOf("-like 'NOT WRITTEN:*'"))
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
