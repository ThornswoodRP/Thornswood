<#
  test-481-voice-most.ps1

  The voice service's number goes from records\most-online.json to the
  service's command line (issue #481, step 4).

  voice\tests\test-most.js drives the service itself with THORNSWOOD_VOICE_MOST
  set. A setting only counts if the install hands it over, so this proves the
  path to it:

    1. MaxOnline.ps1 gives the record's voice number as Voice, 0 when the
       record has none, and refuses one under the seats (people plus staff
       seats), because somebody seated would then be kept out of voice.
       The real record has one, and it is not under its own seats.
    2. RecordShape.ps1 refuses a voice that is not a whole number above zero.
    3. Install-Voice.ps1 reads the record through MaxOnline.ps1 and puts the
       number on the line that starts the service, before node, as
       THORNSWOOD_VOICE_MOST; with no number nothing is added, so the line is
       the one every install sent before. The name it sets is the name the
       service reads.
    4. Each voice service its own number (Patrick, 12 Oct: dev voice at most
       5). Install-Voice.ps1 into C:\Thornswood-Voice-Dev takes the record's
       dev voice, held to dev's own seats; any other folder takes main's.

  Read only apart from files under its own temp folder. Never connects to
  anything.
#>
[CmdletBinding()]
param([string]$RepoDir)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Here = Split-Path -Parent $Here
if (-not $RepoDir) { $RepoDir = $Here }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-voicemost-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

. (Join-Path $RepoDir 'scripts\deploy\MaxOnline.ps1')

function Record([string]$json) {
    $p = Join-Path $tmp ('most-' + [Guid]::NewGuid().ToString('N').Substring(0, 6) + '.json')
    [IO.File]::WriteAllText($p, $json)
    return $p
}
function Refusal([scriptblock]$b) {
    try { & $b | Out-Null; return '' } catch { return $_.Exception.Message }
}

# ---- 1. MaxOnline.ps1 -----------------------------------------------------
$got = Get-MostOnline (Record '{ "people": 25, "staffSeats": 5, "voice": 60 }')
Yes 'a record with voice 60 gives Voice 60 beside the seats' ($got.Voice -eq 60 -and $got.Value -eq 25 -and $got.Seats -eq 30)
$got = Get-MostOnline (Record '{ "people": 25, "staffSeats": 5 }')
Yes 'a record with no voice gives Voice 0, and the seats as before' ($got.Voice -eq 0 -and $got.Seats -eq 30)
$got = Get-MostOnline (Record '{ "people": 25, "staffSeats": 5, "voice": 30 }')
Yes 'voice exactly the seats is taken' ($got.Voice -eq 30)
$why = Refusal { Get-MostOnline (Record '{ "people": 25, "staffSeats": 5, "voice": 29 }') }
Yes 'voice under the seats stops, naming both numbers' ($why -match 'voice 29, fewer than the 30 seats' -and $why -match 'Nothing was written')
$got = Get-MostOnline (Join-Path $tmp 'not-there.json')
Yes 'no record at all still gives Voice 0, not an error' ($got.Voice -eq 0 -and $got.Value -eq 0)

$real = Get-MostOnline
Yes ('the real record has a voice number ({0}) and it is not under its own seats ({1})' -f $real.Voice, $real.Seats) ($real.Voice -gt 0 -and $real.Voice -ge $real.Seats)
$realDev = Get-MostOnline -Channel dev
Yes ('dev voice is 5, its own seats 5 (got {0} and {1})' -f $realDev.Voice, $realDev.Seats) ($realDev.Voice -eq 5 -and $realDev.Seats -eq 5)
$got = Get-MostOnline (Record '{ "dev": { "people": 5, "staffSeats": 0, "voice": 5 }, "people": 25, "staffSeats": 5, "voice": 60 }') -Channel dev
Yes 'dev voice comes from the dev object, beside dev''s seats' ($got.Voice -eq 5 -and $got.Seats -eq 5)
$got = Get-MostOnline (Record '{ "dev": { "people": 5 }, "people": 25, "staffSeats": 5, "voice": 60 }') -Channel dev
Yes 'a dev object with no voice leaves dev voice uncapped, never main''s 60' ($got.Voice -eq 0 -and $got.Seats -eq 5)
$why = Refusal { Get-MostOnline (Record '{ "dev": { "people": 5, "staffSeats": 1, "voice": 5 }, "people": 25 }') -Channel dev }
Yes 'dev voice under dev''s seats stops, naming both numbers' ($why -match 'voice 5, fewer than the 6 seats' -and $why -match 'its dev numbers')

# ---- 2. RecordShape.ps1 ---------------------------------------------------
. (Join-Path $RepoDir 'scripts\release\RecordShape.ps1')
function Problems([string]$json) { return @(Get-ThornswoodRecordProblems -Doc ($json | ConvertFrom-Json) -Kind most-online) }
Yes 'record shape: a whole voice number reads clean' ((Problems '{ "people": 25, "voice": 60 }').Count -eq 0)
Yes 'record shape: no voice reads clean' ((Problems '{ "people": 25 }').Count -eq 0)
Yes 'record shape: voice 0 is refused' ((Problems '{ "people": 25, "voice": 0 }') -match 'voice is there and not a whole number above zero')
Yes 'record shape: voice "60", a string, is refused' ((Problems '{ "people": 25, "voice": "60" }') -match 'voice is there')
Yes 'record shape: voice 60.5 is refused' ((Problems '{ "people": 25, "voice": 60.5 }') -match 'voice is there')
Yes 'record shape: a whole dev voice reads clean' ((Problems '{ "dev": { "people": 5, "voice": 5 }, "people": 25 }').Count -eq 0)
Yes 'record shape: dev voice 0 is refused, named as dev''s' ((Problems '{ "dev": { "people": 5, "voice": 0 }, "people": 25 }') -match 'dev\.voice is there and not a whole number above zero')

# ---- 3. Install-Voice.ps1 -------------------------------------------------
$install = Join-Path $RepoDir 'scripts\deploy\Install-Voice.ps1'
$src = Get-Content -LiteralPath $install -Raw
$svc = Get-Content -LiteralPath (Join-Path $RepoDir 'voice\voice-server.js') -Raw
$tokens = $null; $errors = $null
[void][System.Management.Automation.Language.Parser]::ParseFile($install, [ref]$tokens, [ref]$errors)
Yes 'Install-Voice.ps1 parses' ($errors.Count -eq 0)
Yes 'it reads the record through MaxOnline.ps1' ($src.Contains(". (Join-Path `$Here 'MaxOnline.ps1')") -and $src.Contains('$mostGot = Get-MostOnline'))
Yes 'a record it cannot take stops the install before anything is sent' ($src.Contains('try { $mostGot = Get-MostOnline -Channel $voiceChannel } catch { Die $_.Exception.Message }') -and
    $src.IndexOf('$mostGot = Get-MostOnline') -lt $src.IndexOf('Send-ThornswoodArtifact'))

# ---- 4. which voice takes which numbers -----------------------------------
$pick = [regex]::Match($src, '(?m)^\$voiceChannel = .*$')
Yes 'Install-Voice.ps1 picks the channel from the folder it installs into' ($pick.Success -and $pick.Index -lt $src.IndexOf('$mostGot = Get-MostOnline'))
if ($pick.Success) {
    function ChannelFor([string]$Root) { . ([scriptblock]::Create($pick.Value)); return $voiceChannel }
    Yes 'C:\Thornswood-Voice-Dev is dev' ((ChannelFor 'C:\Thornswood-Voice-Dev') -eq 'dev')
    Yes 'with a trailing slash too, in any case' ((ChannelFor 'c:\thornswood-voice-dev\') -eq 'dev')
    Yes 'C:\Thornswood-Voice, the default, is main' ((ChannelFor 'C:\Thornswood-Voice') -eq 'main')
    Yes 'and the default -Root is the live folder' ($src -match "\[string\]\`$Root\s*=\s*'C:\\Thornswood-Voice',")
    $devVoice = Get-MostOnline -Channel (ChannelFor 'C:\Thornswood-Voice-Dev')
    $liveVoice = Get-MostOnline -Channel (ChannelFor 'C:\Thornswood-Voice')
    Yes ('so dev voice is started with 5 ({0}) and live with main''s ({1}, unchanged)' -f $devVoice.Voice, $liveVoice.Voice) ($devVoice.Voice -eq 5 -and $liveVoice.Voice -eq $real.Voice)
}
Yes 'the number becomes THORNSWOOD_VOICE_MOST, as a whole number' ($src.Contains('$mostSet = "set THORNSWOOD_VOICE_MOST=$([int]$mostGot.Voice)&& "'))

$remote = [regex]::Match($src, '(?s)\$remote = @"\r?\n(.*?)\r?\n"@')
Yes 'the install here-string is there' $remote.Success
# The here-string calls Get-ThornswoodServiceAccountScript (#2578) to paste
# ServiceAccount.ps1's functions in. Only the task line is read here, so it
# stands in as nothing. Without it the expansion threw before any check after
# it ran (found while checking the voice line for #2166).
function Get-ThornswoodServiceAccountScript { return '' }
# It also pastes in scripts\vps\BoxFirewall.ps1's Sync-ThornswoodFirewall
# (#3896), loaded here the way Install-Voice.ps1 loads it.
. (Join-Path $RepoDir 'scripts\vps\BoxFirewall.ps1')
function StartLine([string]$most) {
    $Root = 'C:\Thornswood-Voice'; $Port = 7778; $TaskName = 'Thornswood Voice'; $Site = 'https://thornswood.net'
    $Bind = '127.0.0.1'; $ChatRange = 'on'; $expectBuild = 'most-1'; $turnSet = ''
    $mostSet = $most
    foreach ($l in ($ExecutionContext.InvokeCommand.ExpandString($remote.Groups[1].Value) -split "`n")) {
        if ($l -match 'set THORNSWOOD_VOICE_PORT=') { return $l.Trim() }
    }
    return ''
}
if ($remote.Success) {
    $with = StartLine 'set THORNSWOOD_VOICE_MOST=60&& '
    Yes 'with a number, the line that starts the service sets it' ($with.Contains('set THORNSWOOD_VOICE_MOST=60&& '))
    $at = $with.IndexOf('THORNSWOOD_VOICE_MOST'); $node = $with.IndexOf('voice-server.js')
    Yes 'before node starts, so the service is there to read it' ($at -ge 0 -and $node -gt $at)
    $without = StartLine ''
    Yes 'with none, nothing is added and the line is the one before this' (-not $without.Contains('THORNSWOOD_VOICE_MOST') -and
        $without.Contains('set THORNSWOOD_CHAT_RANGE=on&&  start "" /b /wait /high "'))
    Yes 'no setting on that line is handed nothing' (-not ([regex]::IsMatch($with, 'set\s+[A-Z_]+=(?=&&|")')))
}
Yes 'the name the install sets is the name the service reads' ($svc.Contains('process.env.THORNSWOOD_VOICE_MOST'))
Yes 'and the service reports it on /health' ($svc -match 'most: MOST')

Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
