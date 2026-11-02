<#
  test-1046-restore-rehearse.ps1

      pwsh -NoProfile -File .\tests\test-1046-restore-rehearse.ps1

  RESTORE-SERVER.PS1 -REHEARSE (issue #1046). A restore makes a folder be the
  server it came from: its ports, its name and private\door.json, which names
  the live site and holds the site key and the join pass key. Starting a
  restored folder safely was four hand steps in RESTORING.md in the ops repo that nobody
  had done. -Rehearse does them.

  It proves:
    1. The pieces, lifted from Restore-Server.ps1 by the parser: a server
       folder (C:\Thornswood-Server, C:\Thornswood-Server-Dev, any case,
       either slash) is refused and a throwaway one is not; the resources
       port is port+1 and 3000 for 7777; the reserved ports are the fixed
       live and dev ones plus each settings' game, resources and voice
       ports; the ports chosen skip reserved and busy ones from 7800 up, and
       -Port and -VoicePort are refused when reserved, busy, out of range or
       on top of each other.
    2. On Windows, the real script, run whole under PowerShell 7 (what runs
       it on the VPS since #5356) on a backup the real vps-nightly-backup.ps1 made:
       -Rehearse puts the world back, says RESTORE OK and REHEARSAL READY,
       gives the folder free ports that are not the backup's, puts
       " (restore rehearsal)" on the name once, turns the join pass hold off,
       deletes private\door.json and nothing else in private, writes
       rehearsal.json, and prints the start line and the launcher settings.
       -Port and -VoicePort are taken, a busy -Port is refused before the
       folder is called a rehearsal, -Port without -Rehearse is refused
       before anything is put back, and a restore without -Rehearse is what
       it was: the backup's port, the hold on and door.json there.

  Touches nothing but a scratch folder under the temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Vps = Join-Path (Split-Path -Parent $Here) 'scripts\vps'
$Nightly = Join-Path $Vps 'vps-nightly-backup.ps1'
$Restore = Join-Path $Vps 'Restore-Server.ps1'

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

$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Restore, [ref]$tokens, [ref]$errors)
Yes 'Restore-Server.ps1 parses' ($errors.Count -eq 0)
$names = 'Get-RehearsalRootRefusal', 'Get-ResourcesPort', 'Get-ReservedPorts', 'Get-GamePortRefusal', 'Get-VoicePortRefusal', 'Get-RehearsalPorts'
foreach ($n in $names) {
    $fn = @($ast.FindAll({ param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n }, $true))
    Yes "Restore-Server.ps1 has $n" ($fn.Count -eq 1)
    if ($fn.Count -eq 1) { . ([scriptblock]::Create($fn[0].Extent.Text)) }
}
$text = [IO.File]::ReadAllText($Restore)
Yes 'the server folders it never rehearses in are the two on the box' ($text -match "\`$ServerRoots = @\('C:\\Thornswood-Server', 'C:\\Thornswood-Server-Dev'\)")
Yes 'and it refuses one before anything is put back' ($text.IndexOf('Get-RehearsalRootRefusal $Root $ServerRoots') -gt 0 -and
    $text.IndexOf('Get-RehearsalRootRefusal $Root $ServerRoots') -lt $text.IndexOf("Head 'Putting it back'"))
Yes 'the rehearsal step runs after the character check and before RESTORE OK' (
    $text.IndexOf("Head 'Making it a rehearsal'") -gt $text.IndexOf("Head 'Are the characters there'") -and
    $text.IndexOf("Head 'Making it a rehearsal'") -lt $text.IndexOf('RESTORE OK: {0} character'))
# CI's runner account on the VPS may not read C:\Thornswood-Server: that is said, not a stop.
Yes 'a server folder this account may not read is said, and its usual ports are still kept off' (
    $text -match 'try \{ \$there = Test-Path -LiteralPath \$sp -EA Stop \} catch \{' -and
    $text -match 'could not be read \(\{1\}\); only the usual live and dev ports are kept off for it')

# ---- 1. the pieces ---------------------------------------------------------
$roots = @('C:\Thornswood-Server', 'C:\Thornswood-Server-Dev')
Yes 'C:\Thornswood-Server is refused' ([bool](Get-RehearsalRootRefusal 'C:\Thornswood-Server' $roots))
Yes '  and c:\thornswood-server-dev\ in another case with a trailing slash' ([bool](Get-RehearsalRootRefusal 'c:\thornswood-server-dev\' $roots))
Yes '  naming the throwaway way to do it' ((Get-RehearsalRootRefusal 'C:\Thornswood-Server' $roots) -match 'Install-ThornswoodServer\.ps1 -Zip <payload> -Root <throwaway> -NoTask')
Yes 'a throwaway folder is not refused' ((Get-RehearsalRootRefusal 'C:\Thornswood-RestoreTest' $roots) -eq '')
Yes '  nor one whose name only starts like a server folder' ((Get-RehearsalRootRefusal 'C:\Thornswood-Server-Rehearsal' $roots) -eq '')
Yes 'the resources port is port+1, and 3000 for 7777' ((Get-ResourcesPort 7787) -eq 7788 -and (Get-ResourcesPort 7777) -eq 3000 -and (Get-ResourcesPort 7800) -eq 7801)

$live = [pscustomobject]@{ port = 7777; thornswoodVoicePort = 7790 }
$dev = [pscustomobject]@{ port = 7787; thornswoodVoicePort = 7791 }
$odd = [pscustomobject]@{ port = 7800; thornswoodVoicePort = 7805 }
$noVoice = [pscustomobject]@{ port = 7810 }
$res = @(Get-ReservedPorts @($live, $dev, $null, $odd, $noVoice))
foreach ($n in 7777, 7778, 3000, 7787, 7788, 7790, 7791, 7800, 7801, 7805, 7810, 7811) { Yes "  $n is reserved" ($res -contains $n) }
Yes '  and nothing else' ($res.Count -eq 12)
Yes 'with no settings at all the fixed five are reserved' ((@(Get-ReservedPorts @())).Count -eq 5)

$none = [pscustomobject]@{ Udp = @(); Tcp = @() }
$r = Get-RehearsalPorts 0 0 @(Get-ReservedPorts @()) $none
Yes 'nothing busy: 7800, resources 7801, voice 7802' ($r.Why -eq '' -and $r.Port -eq 7800 -and $r.Resources -eq 7801 -and $r.VoicePort -eq 7802)
$r = Get-RehearsalPorts 0 0 $res $none
Yes ('7800 and 7810 reserved: the game port skips both and their resources ports ({0}/{1})' -f $r.Port, $r.VoicePort) (
    $r.Why -eq '' -and $r.Port -eq 7802 -and $r.Resources -eq 7803 -and $r.VoicePort -eq 7804)
$busy = [pscustomobject]@{ Udp = @(7800); Tcp = @(7803, 7804) }
$r = Get-RehearsalPorts 0 0 @(Get-ReservedPorts @()) $busy
Yes ('busy UDP 7800 and TCP 7803, 7804: game 7801, voice 7805 ({0}/{1})' -f $r.Port, $r.VoicePort) (
    $r.Why -eq '' -and $r.Port -eq 7801 -and $r.VoicePort -eq 7805)
$r = Get-RehearsalPorts 7900 7950 @(Get-ReservedPorts @()) $none
Yes '-Port 7900 -VoicePort 7950 are taken' ($r.Why -eq '' -and $r.Port -eq 7900 -and $r.Resources -eq 7901 -and $r.VoicePort -eq 7950)
$r = Get-RehearsalPorts 7900 0 @(Get-ReservedPorts @()) $none
Yes '-Port alone: voice is the first free one above its resources port' ($r.Why -eq '' -and $r.VoicePort -eq 7902)
foreach ($case in @(
    @(7777, 0, 'live or dev server''s port', 'the live port'),
    @(7786, 0, 'resources port 7787', 'a port whose resources port is dev''s'),
    @(80, 0, 'not a port a rehearsal can use', 'a port under 1024'),
    @(7900, 7901, 'game port or its resources port', 'a voice port on the resources port'),
    @(7900, 7900, 'game port or its resources port', 'a voice port on the game port'),
    @(7900, 7790, 'live or dev server''s port', 'the live voice port'))) {
    $r = Get-RehearsalPorts $case[0] $case[1] @(Get-ReservedPorts @($live, $dev)) $none
    Yes ("refused: $($case[3]) ($($r.Why))") ($r.Why -match [regex]::Escape($case[2]))
}
$r = Get-RehearsalPorts 7900 0 @(Get-ReservedPorts @()) ([pscustomobject]@{ Udp = @(); Tcp = @(7901) })
Yes 'refused: -Port whose resources port is busy' ($r.Why -match '^-Port: 7900''s resources port 7901 is already in use')
$r = Get-RehearsalPorts 7900 7950 @(Get-ReservedPorts @()) ([pscustomobject]@{ Udp = @(); Tcp = @(7950) })
Yes 'refused: a busy -VoicePort' ($r.Why -match '^-VoicePort: voice port 7950 is already in use')
$all = [pscustomobject]@{ Udp = @(7800..7998); Tcp = @() }
$r = Get-RehearsalPorts 0 0 @(Get-ReservedPorts @()) $all
Yes 'every game port busy: refused, saying name one with -Port' ($r.Why -match 'Name one with -Port')

# ---- 2. the real script, run whole -------------------------------------------
. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the whole runs: they restore a backup the nightly backup makes, and it stages under Windows'' TEMP and builds its paths with the \ separator, so it runs only on Windows'
    Done
}
$boxPs = Get-BoxPowerShell
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$body) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $body, $utf8)
}
$script:last = @()
function Run([string]$file, [string[]]$argv) {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $script:last = @(& $boxPs -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $file @argv 2>&1 | ForEach-Object { "$_" }) }
    finally { $ErrorActionPreference = $eap }
    return $LASTEXITCODE
}
function Show { foreach ($l in $script:last | Select-Object -Last 40) { Write-Host ('        ' + $l) } }
function Said([string]$pattern) { return (($script:last -join "`n") -match $pattern) }
function ReadJson([string]$path) { return ([IO.File]::ReadAllText($path) -replace '^\uFEFF', '' | ConvertFrom-Json) }

$plugins = @('Skyrim.esm', 'Update.esm', 'Thornswood.esp')
function Server([string]$root, [string]$pluginRoot, [int]$port, [int]$voice) {
    foreach ($n in $plugins) { Put (Join-Path $root "plugins\$n") ("plugin " + $n) }
    $far = ($pluginRoot -replace '\\', '/') + '/plugins/'
    Put (Join-Path $root 'server-settings.json') (([ordered]@{
        port = $port; name = 'Thornswood Test'; thornswoodVoicePort = $voice; thornswoodRequirePass = $true
        loadOrder = @($plugins | ForEach-Object { $far + $_ }) } | ConvertTo-Json -Depth 5))
}
$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-1046-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
$udp = $null
try {
    $live = Join-Path $work 'live'
    Server $live $live 45777 45779
    Put (Join-Path $live 'gamemode.js') '// gamemode'
    Put (Join-Path $live 'private\characters.json') '{"at":1,"who":{"1234567":{"name":"Brynja","race":"Nord"}}}'
    Put (Join-Path $live 'private\door.json') '{"site":"https://example.invalid","key":"fixture-only","passKey":"fixture-only"}'
    Put (Join-Path $live 'private\allowed.json') '{"allowed":[]}'
    Put (Join-Path $live 'private\take-limit.json') '{"counts":{}}'
    Put (Join-Path $live 'world\changeForms\0.json') '{"profileId":1234567,"isDeleted":false}'
    Put (Join-Path $live 'world\changeForms\ff000001.json') '{"ref":1}'
    $key = Join-Path $work 'key.txt'
    Put $key ([Convert]::ToBase64String([Guid]::NewGuid().ToByteArray() + [Guid]::NewGuid().ToByteArray()))
    $out = Join-Path $work 'backups'
    $code = Run $Nightly @('-GameRoot', $live, '-DevGameRoot', (Join-Path $work 'no-dev'), '-SiteRoot', (Join-Path $work 'no-site'),
                           '-BotRoot', (Join-Path $work 'no-bot'), '-CaddyRoot', (Join-Path $work 'no-caddy'),
                           '-VoiceRoot', (Join-Path $work 'no-voice'), '-DeletionRoot', (Join-Path $work 'no-del'), '-Out', $out, '-KeyFile', $key)
    $enc = @(Get-ChildItem -LiteralPath $out -Filter 'thornswood-*.zip.enc' -File -EA SilentlyContinue)
    Yes "the nightly backup of a stand-in live server is made (exit $code)" ($code -eq 0 -and $enc.Count -eq 1)
    if ($enc.Count -ne 1) { Show; Done }
    $encPath = $enc[0].FullName

    # -Port without -Rehearse: refused before anything is put back.
    $plain = Join-Path $work 'plain'
    Server $plain $live 45797 45798
    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $plain, '-Port', '7900', '-NoPause')
    Yes "-Port without -Rehearse is refused (exit $code)" ($code -ne 0 -and (Said '-Port and -VoicePort go with -Rehearse'))
    Yes '  and nothing was put back' (-not (Test-Path -LiteralPath (Join-Path $plain 'world')))

    # A restore without -Rehearse is what it was.
    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $plain, '-NoPause')
    $s = ReadJson (Join-Path $plain 'server-settings.json')
    Yes "a restore without -Rehearse says RESTORE OK and no REHEARSAL (exit $code)" ($code -eq 0 -and (Said 'RESTORE OK') -and -not (Said 'REHEARSAL'))
    if ($code -ne 0) { Show }
    Yes '  and it is the live server again: the backup''s ports and name, the hold on, door.json there, no rehearsal.json' (
        $s.port -eq 45777 -and $s.thornswoodVoicePort -eq 45779 -and $s.name -eq 'Thornswood Test' -and $s.thornswoodRequirePass -eq $true -and
        (Test-Path -LiteralPath (Join-Path $plain 'private\door.json')) -and -not (Test-Path -LiteralPath (Join-Path $plain 'rehearsal.json')))
    Yes '  and still says to start it with its scheduled task' (Said 'Start-ScheduledTask')

    # -Rehearse.
    $reh = Join-Path $work 'rehearsal'
    Server $reh $live 45807 45808
    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $reh, '-Rehearse', '-NoPause')
    Yes "-Rehearse puts it back and says RESTORE OK and REHEARSAL READY (exit $code)" ($code -eq 0 -and (Said 'RESTORE OK: 1 character') -and (Said 'REHEARSAL READY: game port \d+'))
    if ($code -ne 0) { Show }
    $s = ReadJson (Join-Path $reh 'server-settings.json')
    Yes ("  the ports are free ones from 7800 up, not the backup's ({0}, voice {1})" -f $s.port, $s.thornswoodVoicePort) (
        [int]$s.port -ge 7800 -and [int]$s.port -le 7998 -and [int]$s.thornswoodVoicePort -gt [int]$s.port + 1 -and
        $s.port -ne 45777 -and $s.thornswoodVoicePort -ne 45779)
    Yes '  the name says it is a rehearsal' ($s.name -eq 'Thornswood Test (restore rehearsal)')
    Yes '  the join pass hold is off' ($s.thornswoodRequirePass -eq $false)
    Yes '  said by name, its value never printed' (Said 'thornswoodRequirePass off' -and @($script:last | Where-Object { $_ -match 'thornswoodRequirePass.*(true|false)' }).Count -eq 0)
    Yes '  the load order still names this folder' (@($s.loadOrder | Where-Object { -not $_.StartsWith(($reh -replace '\\', '/') + '/plugins/') }).Count -eq 0)
    Yes '  door.json is gone from private' (-not (Test-Path -LiteralPath (Join-Path $reh 'private\door.json')))
    Yes '  and nothing else in private was touched' (
        (Test-Path -LiteralPath (Join-Path $reh 'private\characters.json')) -and (Test-Path -LiteralPath (Join-Path $reh 'private\allowed.json')) -and
        (Test-Path -LiteralPath (Join-Path $reh 'private\take-limit.json')))
    Yes '  the character is back' (Test-Path -LiteralPath (Join-Path $reh 'world\changeForms\0.json'))
    $rec = $(if (Test-Path -LiteralPath (Join-Path $reh 'rehearsal.json')) { ReadJson (Join-Path $reh 'rehearsal.json') } else { $null })
    Yes '  rehearsal.json says the ports, the backup and what was taken out' (
        $rec -and $rec.port -eq $s.port -and $rec.voicePort -eq $s.thornswoodVoicePort -and $rec.resources -eq ([int]$s.port + 1) -and
        $rec.backup -eq (Split-Path -Leaf $encPath) -and (@($rec.removed) -join ',') -eq 'private\door.json' -and $rec.requirePass -eq $false)
    Yes '  it prints the start line, the launcher settings and how to end it' (
        (Said 'node dist_back/skymp5-server\.js') -and (Said ('ServerPort "' + $s.port + '"')) -and (Said 'Remove-Item -LiteralPath') -and -not (Said 'Start-ScheduledTask'))
    Yes '  and no secret from door.json is printed' (-not (Said 'fixture-only'))

    # Again, with -Port and -VoicePort: a whole new restore, and the name once.
    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $reh, '-Rehearse', '-Port', '7950', '-VoicePort', '7960', '-NoPause')
    $s = ReadJson (Join-Path $reh 'server-settings.json')
    Yes "-Rehearse -Port 7950 -VoicePort 7960 again takes them (exit $code)" ($code -eq 0 -and $s.port -eq 7950 -and $s.thornswoodVoicePort -eq 7960)
    if ($code -ne 0) { Show }
    Yes '  and the name is said once' ($s.name -eq 'Thornswood Test (restore rehearsal)')
    Yes '  and what was here before is kept aside, as any restore keeps it' (@(Get-ChildItem -LiteralPath $reh -Directory -Filter 'world-before-restore-*').Count -ge 1)

    # A busy -Port: refused, and the folder is not called a rehearsal.
    $udp = New-Object Net.Sockets.UdpClient 0
    $held = ([Net.IPEndPoint]$udp.Client.LocalEndPoint).Port
    $busyRoot = Join-Path $work 'busy'
    Server $busyRoot $live 45817 45818
    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $busyRoot, '-Rehearse', '-Port', [string]$held, '-NoPause')
    Yes ("-Rehearse -Port $held, which this test holds on UDP, is refused (exit $code)") ($code -ne 0 -and (Said "-Port: $held is already in use"))
    Yes '  saying the folder must not be started, and no REHEARSAL READY or rehearsal.json' (
        (Said 'must not be started') -and -not (Said 'REHEARSAL READY') -and -not (Test-Path -LiteralPath (Join-Path $busyRoot 'rehearsal.json')))
}
catch {
    Yes ('the runs finished without an error: ' + $_.Exception.Message) $false
    Show
}
finally {
    if ($udp) { $udp.Dispose() }
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}
Done
