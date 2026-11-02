<#
  test-bot-ping.ps1

      pwsh -NoProfile -File .\tests\test-bot-ping.ps1
      powershell -NoProfile -File .\tests\test-bot-ping.ps1

  Install-Bot.ps1 -SetPing puts the outside monitor's ping address into the
  bot's bot.env.json on the VPS, on ssh's standard input, and never prints it
  (issue #449). bot\tests\test-uptime-ping.py checks the bot's half.

  WHY. The bot pings an outside monitor every minute while it is on Discord,
  so a bot or a whole VPS that stops is noticed whether or not One is on. The
  address is a secret: whoever has it can keep the monitor quiet. It lives
  only in bot.env.json on the VPS, never in the repository.

  HOW. The real Install-Bot.ps1 runs with -SetPing against fakes: Read-Host
  hands it a made up address, ssh runs the command line through cmd.exe and a
  real PowerShell 7 on this machine (what sshd on the VPS does since #5356), scp
  copies into a scratch folder standing in for C:\Windows\Temp on the box,
  and -Root points at a scratch bot folder with a fake bot.env.json. The
  service it restarts is one that does not exist, so nothing here is
  restarted. Checks: the address lands whole and read back, every other
  setting is kept, a second run changes nothing, off takes it out, a bad or
  blank answer sends nothing, a box with no bot.env.json refuses, and the
  address is in nothing printed or handed to ssh or scp.

  Never connects to anything. Writes only to its own scratch folder.
#>
[CmdletBinding()]
param()

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
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$install = Join-Path $repo 'scripts\deploy\Install-Bot.ps1'
$errs = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($install, [ref]$null, [ref]$errs)
Yes 'Install-Bot.ps1 parses' (@($errs).Count -eq 0)
$text = [IO.File]::ReadAllText($install)
Yes 'it has -SetPing' ($text -match '\[switch\]\$SetPing')
Yes '-SetPing sends the address with Invoke-ThornswoodSecretRemote -Secret' ($text -match 'Invoke-ThornswoodSecretRemote[^\r\n]*-Secret \$pingUrl')
Yes '-SetPing asks for it hidden' ($text -match "if \(\`$SetPing\) \{[\s\S]{0,600}Read-Host '  Paste it' -AsSecureString")
Yes 'a full run keeps settings it does not write, the ping address among them, and stops on a file it cannot read (#2711)' ($text -match '`\$env2 = Read-ThornswoodJsonFile `\$f' -and $text -match 'SETTINGS NOT WRITTEN: '' \+ `\$_\.Exception\.Message')

. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the rest: it runs as the VPS does, through cmd.exe, which only Windows has'
    Done
}
# The far line names pwsh, which cmd.exe finds on the path as the VPS does.
$cmdExe = Get-WindowsPath 'System32\cmd.exe'

# ---- scratch --------------------------------------------------------------
$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-bot-ping-' + [Guid]::NewGuid().ToString('N'))
$farDir = Join-Path $work 'far'
$botDir = Join-Path $work 'bot'
New-Item -ItemType Directory -Path $farDir, $botDir -Force | Out-Null
$envFile = Join-Path $botDir 'bot.env.json'
$noBom = New-Object Text.UTF8Encoding($false)
$ScFar = $farDir
$ScCalls = New-Object System.Collections.ArrayList
$ScAnswer = @{ Value = '' }

# ---- the fakes ------------------------------------------------------------
function Read-Host {
    param([Parameter(Position = 0)]$Prompt, [switch]$AsSecureString)
    $s = New-Object Security.SecureString
    foreach ($ch in $ScAnswer.Value.ToCharArray()) { $s.AppendChar($ch) }
    return $s
}

function ssh {
    $a = @($args | ForEach-Object { [string]$_ })
    [void]$ScCalls.Add([pscustomobject]@{ Tool = 'ssh'; Args = $a; Sent = '' })
    # The box's C:/Windows/Temp is the scratch folder here, quoted for cmd.exe.
    $line = [regex]::Replace($a[-1], 'C:/Windows/Temp/(\S+)', { param($m) '"' + $ScFar + '\' + $m.Groups[1].Value + '"' })
    $m = [regex]::Match($line, '-EncodedCommand (\S+)$')
    if ($m.Success) {
        # A long script's runner (Send-Script.ps1, #3059) takes its copy
        # from the scratch folder too, and sweeps that folder, not the
        # machine's own C:\Windows\Temp.
        $said = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value))
        $copy = Get-ThornswoodRemoteRunnerPath $said
        if ($copy) {
            $said = $said.Replace($copy, (Join-Path $ScFar ($copy -split '\\')[-1])).Replace("'C:\Windows\Temp'", ("'" + $ScFar + "'"))
            $line = $line.Substring(0, $m.Groups[1].Index) + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($said))
        }
    }
    $in = @($input)
    if ($in.Count) { $in | & $cmdExe /d /c $line }
    else { & $cmdExe /d /c $line }
}

function scp {
    $a = @($args | ForEach-Object { [string]$_ })
    $src = $a[-2]; $dst = $a[-1]
    $far = $dst.Substring($dst.IndexOf(':') + 1).Replace('C:/Windows/Temp/', ($ScFar + '\'))
    $sent = [IO.File]::ReadAllText($src)
    Copy-Item -LiteralPath $src -Destination $far -Force
    [void]$ScCalls.Add([pscustomobject]@{ Tool = 'scp'; Args = $a; Sent = $sent })
    $global:LASTEXITCODE = 0
}

function AllSent {
    $sb = New-Object Text.StringBuilder
    foreach ($c in $ScCalls) {
        foreach ($x in $c.Args) {
            [void]$sb.AppendLine($x)
            $m = [regex]::Match($x, '-EncodedCommand (\S+)')
            if ($m.Success) { [void]$sb.AppendLine([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($m.Groups[1].Value))) }
        }
        [void]$sb.AppendLine($c.Sent)
    }
    return $sb.ToString()
}

function Reset-Env {
    $e = [ordered]@{
        DISCORD_TOKEN   = 'not-a-real-token'
        THORNSWOOD_SITE = 'https://thornswood.net'
        THORNSWOOD_KEY  = 'not-a-real-key'
        JOIN_CHANNEL    = 'welcome-travelers'
        STAFF_ROLES     = 'Owner,Dev,Gamemaster'
    }
    [IO.File]::WriteAllText($envFile, ($e | ConvertTo-Json), $noBom)
}
function EnvNow { return ([IO.File]::ReadAllText($envFile) | ConvertFrom-Json) }

$service = 'ThornswoodBotTest' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
function SetPing([string]$answer) {
    $ScAnswer.Value = $answer
    $ScCalls.Clear()
    $out = @(& $install -SetPing -Vps 'box.invalid' -User 'tester' -Root ($botDir.Replace('\', '/')) -Service $service -NoPause *>&1 | ForEach-Object { "$_" })
    return [pscustomobject]@{ Out = $out; Code = $LASTEXITCODE; Text = ($out -join "`n") }
}

# Made here, the shape a monitor's address has. Never printed.
$key = [Guid]::NewGuid().ToString('N')
$url = 'https://hc-ping.example/' + $key
$wire = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($url))

try {
    # ---- 1. set it
    Reset-Env
    $r = SetPing $url
    $e = EnvNow
    Yes 'set: exit 0' ($r.Code -eq 0)
    Yes 'set: bot.env.json holds the address, whole' ($e.PING_URL -ceq $url)
    Yes 'set: every other setting is kept' ($e.DISCORD_TOKEN -eq 'not-a-real-token' -and $e.THORNSWOOD_KEY -eq 'not-a-real-key' -and $e.JOIN_CHANNEL -eq 'welcome-travelers' -and $e.STAFF_ROLES -eq 'Owner,Dev,Gamemaster' -and $e.THORNSWOOD_SITE -eq 'https://thornswood.net')
    Yes 'set: it says the address was written and read back' ($r.Text -match 'ping address written to .*bot\.env\.json and read back')
    Yes 'set: it names only the host' ($r.Text -match 'a ping address on hc-ping\.example')
    Yes 'set: then restarts the bot by the service''s name (not here: no such service)' ($r.Text -match ('BOT NOT RESTARTED: the service ' + $service))
    Yes 'set: the address is in nothing printed' (-not $r.Text.Contains($key) -and -not $r.Text.Contains($wire))
    $all = AllSent
    Yes 'set: the address is in nothing handed to ssh or scp, plain or base64' (-not $all.Contains($key) -and -not $all.Contains($wire))
    $copied = @($ScCalls | Where-Object { $_.Tool -eq 'scp' })
    Yes 'set: the script went by scp under Send-Script.ps1''s runner, and nothing else was copied up (#3059)' ($copied.Count -eq 1 -and $copied[0].Args[-1] -match ':C:/Windows/Temp/thornswood-remote-[0-9a-f]{32}\.ps1$' -and @($ScCalls | Where-Object { $_.Tool -eq 'ssh' -and $_.Args[-1] -match '^pwsh -NoProfile -ExecutionPolicy Bypass -EncodedCommand \S+$' }).Count -eq 1)
    Yes 'set: with host key checking on' (@($ScCalls | Where-Object { $_.Tool -eq 'ssh' -and ($_.Args -join ' ') -match 'StrictHostKeyChecking=yes' }).Count -ge 1)
    Yes 'set: nothing is left in the box''s temp folder' (@(Get-ChildItem -LiteralPath $farDir -File).Count -eq 0)
    Yes 'set: bot.env.json has no byte order mark' ([IO.File]::ReadAllBytes($envFile)[0] -eq 123)

    # ---- 2. the same again
    $before = [IO.File]::ReadAllText($envFile)
    $r = SetPing $url
    Yes 'again: says there is nothing to change, exit 0' ($r.Code -eq 0 -and $r.Text -match 'PING UNCHANGED')
    Yes 'again: the file is as it was' ([IO.File]::ReadAllText($envFile) -ceq $before)
    Yes 'again: and does not restart the bot' ($r.Text -notmatch 'NOT RESTARTED')

    # ---- 3. off
    $r = SetPing 'off'
    $e = EnvNow
    Yes 'off: exit 0 and the address is gone' ($r.Code -eq 0 -and -not ($e.PSObject.Properties.Name -contains 'PING_URL'))
    Yes 'off: every other setting is kept' ($e.DISCORD_TOKEN -eq 'not-a-real-token' -and $e.STAFF_ROLES -eq 'Owner,Dev,Gamemaster')
    Yes 'off: it says so, and to pause the check on the monitor' ($r.Text -match 'taken out of .*read back' -and $r.Text -match 'Pause or delete the check')
    $r = SetPing 'OFF'
    Yes 'off again: nothing to change' ($r.Code -eq 0 -and $r.Text -match 'PING UNCHANGED')

    # ---- 4. refused before anything is sent
    foreach ($bad in @(('http://hc-ping.example/' + $key), 'not an address', ('https://hc-ping.example/' + $key + ' x'), 'https://nohost/abc')) {
        $before = [IO.File]::ReadAllText($envFile)
        $r = SetPing $bad
        Yes ('refused: "' + ($bad -replace [regex]::Escape($key), '<key>') + '" exits 1 and sends nothing') ($r.Code -eq 1 -and $ScCalls.Count -eq 0 -and [IO.File]::ReadAllText($envFile) -ceq $before -and -not $r.Text.Contains($key))
    }
    $r = SetPing ''
    Yes 'refused: a blank answer exits 1 and sends nothing' ($r.Code -eq 1 -and $ScCalls.Count -eq 0 -and $r.Text -match 'Nothing pasted')

    # ---- 5. a box with no bot.env.json
    Remove-Item -LiteralPath $envFile -Force
    $r = SetPing $url
    Yes 'no bot.env.json: exit 1, says to run Install-Bot.ps1 first' ($r.Code -eq 1 -and $r.Text -match 'NOT WRITTEN: .*is not there\. Run Install-Bot\.ps1 once first')
    Yes 'no bot.env.json: and makes none' (-not (Test-Path -LiteralPath $envFile))
    Yes 'no bot.env.json: the address is in nothing printed' (-not $r.Text.Contains($key))
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
