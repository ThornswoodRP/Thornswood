<#
  test-backup-restore.ps1

      pwsh -NoProfile -File .\tests\test-backup-restore.ps1

  Issue #401: nothing backed up the world, and the only two backups there were
  had no characters in them. This takes a backup of a scratch live server and
  a scratch dev server with the real vps-nightly-backup.ps1, puts it back into
  other scratch folders with the real Restore-Server.ps1, and checks the world
  and a character came back and the load order resolves.

  It proves:
    - website configuration, public documents, account records, gallery
      metadata, uploaded bytes and separate feed metadata are backed up and
      recovered byte for byte after the original scratch site is deleted
    - the nightly backup takes world, private (characters.json,
      mod-settings.json, take-limit.json, door.json, allowed.json) and data
      from both the live and the dev server, encrypted, and the zip lists
      entries under game/world and is far larger than the 195 KB of the
      15 September pair
    - retention keeps seven daily and leaves a file put there by hand alone
    - Restore-Backup.ps1 -CheckOnly opens it, refuses a wrong passphrase,
      calls a backup with nothing under game/world a failure, and fails a
      world whose numbered change forms have no profile id above 0 that is
      not deleted (#1047)
    - Restore-Server.ps1 puts a character back byte for byte into a folder
      whose load order pointed at another server's plugins, points it at its
      own, and says RESTORE OK, with the original server folder deleted first
      so nothing can resolve against it
    - it counts living characters (a slot with a profile id, not deleted),
      finds -Expect by profile id, and refuses a world of deleted slots; the
      nightly NOTES.txt counts the same way (first rehearsal, 28 September)
    - a live restore into a folder holding the dev payload takes the port,
      name and server keys from the backup, so live comes back as live
    - and the join pass switch and the written role lists from the backup,
      over a payload with others, one the backup has not taken off, each
      named and no value printed (#1845)
    - a folder missing one plugin is refused and the plugin is named
    - -Which dev restores the dev character and not the live one
    - a second restore keeps what it replaced, and a running server is refused
    - -Work (default still %TEMP%) is where the decrypted zip and the unpacked
      backup sit, and nothing is left in that folder after a run or a refusal
    - Fetch-Backups.ps1 -PruneOnly keeps the last -KeepDays days and never
      fewer than the newest seven

  The scripts run under PowerShell 7, which is what runs them on the box. Touches nothing but a scratch folder under the temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Vps = Join-Path (Split-Path -Parent $Here) 'scripts\vps'
$Nightly  = Join-Path $Vps 'vps-nightly-backup.ps1'
$Unpack   = Join-Path $Vps 'Restore-Backup.ps1'
$Restore  = Join-Path $Vps 'Restore-Server.ps1'
$Fetch    = Join-Path $Vps 'Fetch-Backups.ps1'

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

foreach ($f in $Nightly, $Unpack, $Restore, $Fetch) {
    $tokens = $null; $errors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$tokens, [ref]$errors)
    Yes ((Split-Path -Leaf $f) + ' parses') ($errors.Count -eq 0)
}

. (Join-Path $PSScriptRoot 'Windows.ps1')
if (-not $OnWindows) {
    Write-Host 'SKIP  the runs: the nightly backup stages under Windows'' TEMP and builds its paths with the \ separator, so it and its restore run only on Windows'
    Done
}
$boxPs = Get-BoxPowerShell

$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text, $utf8)
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

$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
function Noise([int]$n) { $b = New-Object byte[] $n; $rng.GetBytes($b); return [Convert]::ToBase64String($b) }

$plugins = @('Skyrim.esm', 'Update.esm', "Bob's Armour.esp", 'Thornswood.esp')
function Plugins([string]$root, [string[]]$names) {
    foreach ($n in $names) { Put (Join-Path $root "plugins\$n") ("plugin " + $n) }
}
function Settings([string]$root, [string]$pluginRoot, [int]$port) {
    $far = ($pluginRoot -replace '\\', '/') + '/plugins/'
    Put (Join-Path $root 'server-settings.json') (
        ([ordered]@{ port = $port; name = 'Thornswood Test'; loadOrder = @($plugins | ForEach-Object { $far + $_ }) } |
         ConvertTo-Json -Depth 5))
}
# A server as the box has it: plugins, settings, a world of change forms,
# private and data. Characters are shaped as the real world has them (seen in
# the first rehearsal, 28 September): slots named 0.json, 1.json, ... with the
# profile id inside, and a deleted character's slot left behind with
# profileId -1 and isDeleted true. $who is in slot 0, another person in slot 4,
# and slots 1 to 3 are deleted, so a world holds two characters.
$otherWho = '2000001'
function Server([string]$root, [int]$port, [string]$who, [int]$worldFiles, [int]$fileBytes, [switch]$DeadOnly) {
    Plugins $root $plugins
    Settings $root $root $port
    Put (Join-Path $root 'gamemode.js') '// gamemode'
    Put (Join-Path $root 'data\keep.txt') 'the online count'
    Put (Join-Path $root 'private\characters.json') ('{"at":1,"who":{"' + $who + '":{"name":"Brynja","race":"Nord"}}}')
    Put (Join-Path $root 'private\mod-settings.json') '{"menus":{}}'
    Put (Join-Path $root 'private\take-limit.json') '{"counts":{}}'
    Put (Join-Path $root 'private\door.json') '{"key":"not-a-real-key"}'
    Put (Join-Path $root 'private\allowed.json') '{"allowed":[]}'
    $forms = Join-Path $root 'world\changeForms'
    $gone = '{"profileId":-1,"isDeleted":true,"isDisabled":false,"x":"' + (Noise 300) + '"}'
    if ($DeadOnly) {
        foreach ($i in 0..4) { Put (Join-Path $forms "$i.json") $gone }
    } else {
        Put (Join-Path $forms '0.json') ('{"profileId":' + $who + ',"isDeleted":false,"marker":"' + [Guid]::NewGuid().ToString('N') + '","inv":"' + (Noise 900) + '"}')
        foreach ($i in 1..3) { Put (Join-Path $forms "$i.json") $gone }
        Put (Join-Path $forms '4.json') ('{"profileId":' + $otherWho + ',"isDeleted":false,"isDisabled":true,"x":"' + (Noise 600) + '"}')
    }
    foreach ($i in 1..$worldFiles) { Put (Join-Path $forms ("ff{0:x6}.json" -f $i)) ('{"ref":' + $i + ',"x":"' + (Noise $fileBytes) + '"}') }
}

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-backup-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$live = Join-Path $work 'live'
$dev  = Join-Path $work 'dev'
$site = Join-Path $work 'site'
$out  = Join-Path $work 'box-backups'
$key  = Join-Path $work 'key.txt'
$liveWho = '1234567'
$devWho  = '7654321'

try {
    # The live world is big enough to be far past the 195 KB of the 15
    # September pair, in 40 files of 39 KB of noise. It was 1420 files of
    # 1.1 KB, the same bytes, and every restore below wrote all 1420 again
    # under Windows PowerShell 5.1: the most processor of any gate harness on
    # the box (68 s in PR #3190's build, #3168), and on a full box on 21 Oct
    # past its 300 s clock. Nothing here counts the files.
    Server $live 45777 $liveWho 40 39000
    Server $dev  45787 $devWho 30 1100
    # The live server's own join pass switch and role list (#1845). No
    # playtester list, so a payload's is taken off.
    $ls = [IO.File]::ReadAllText((Join-Path $live 'server-settings.json')) | ConvertFrom-Json
    $ls | Add-Member -NotePropertyName thornswoodRequirePass -NotePropertyValue $true
    $ls | Add-Member -NotePropertyName thornswoodDevs -NotePropertyValue @(4401, 4402)
    Put (Join-Path $live 'server-settings.json') ($ls | ConvertTo-Json -Depth 5)
    # A site's records and uploaded bytes have no other copy after a loss.
    # These are invented fixture values, never a deployed configuration.
    Put (Join-Path $site 'config.json') '{"secret":"fixture-only","discord":{"clientId":"fixture-id"}}'
    Put (Join-Path $site 'data\site\privacy.md') '# Fixture privacy page'
    Put (Join-Path $site 'data\board.json') '{"roadmap":{"intro":"Fixture roadmap","sections":[]}}'
    Put (Join-Path $site 'data\gallery.json') '[{"name":"fixture-shot.png","by":"Fixture author","note":"Fixture caption"}]'
    Put (Join-Path $site 'data\linked.json') '{"fixture-account":{"profiles":[1234567]}}'
    Put (Join-Path $site 'uploads\uploads.json') '{"fixture-shot.png":{"orig":"original.png","note":"Fixture caption"}}'
    Put (Join-Path $site 'uploads\fixture-log.txt') 'Fixture diagnostic log'
    [IO.File]::WriteAllBytes((Join-Path $site 'uploads\fixture-shot.png'), [byte[]](0..255))
    foreach ($channel in 'feed', 'feed-dev') {
        Put (Join-Path $site "$channel\version\00000001.json") ('{"version":"fixture-' + $channel + '"}')
        Put (Join-Path $site "$channel\history\fixture.json") ('{"channel":"' + $channel + '"}')
    }
    $sitePrefix = [IO.Path]::GetFullPath($site).TrimEnd('\') + '\'
    $siteExpected = @{}
    foreach ($file in @(Get-ChildItem -LiteralPath $site -Recurse -File)) {
        $relative = $file.FullName.Substring($sitePrefix.Length)
        $siteExpected[$relative] = [Convert]::ToBase64String([IO.File]::ReadAllBytes($file.FullName))
    }
    Put $key (Noise 48)
    Put (Join-Path $work 'wrong-key.txt') (Noise 48)
    $keep = [IO.File]::ReadAllBytes((Join-Path $live 'world\changeForms\0.json'))
    $keepBook = [IO.File]::ReadAllText((Join-Path $live 'private\characters.json'))
    $worldCount = @(Get-ChildItem -LiteralPath (Join-Path $live 'world') -Recurse -File).Count

    # Ten old nightlies, none on a Sunday, and one file a person put there.
    [void](New-Item -ItemType Directory -Path $out -Force)
    $d = [datetime]'2025-03-03'; $seeded = @()
    while ($seeded.Count -lt 10) {
        if ($d.DayOfWeek -ne 'Sunday') {
            $n = 'thornswood-' + $d.ToString('yyyyMMdd') + '-031500.zip.enc'
            Put (Join-Path $out $n) 'old'
            $seeded += $n
        }
        $d = $d.AddDays(1)
    }
    Put (Join-Path $out 'put-here-by-hand.zip') 'mine'

    # ---- the nightly backup --------------------------------------------------
    $common = @('-GameRoot', $live, '-DevGameRoot', $dev,
                '-SiteRoot', $site, '-BotRoot', (Join-Path $work 'no-bot'),
                '-CaddyRoot', (Join-Path $work 'no-caddy'), '-VoiceRoot', (Join-Path $work 'no-voice'), '-DeletionRoot', (Join-Path $work 'no-del'))
    $code = Run $Nightly ($common + @('-Out', $out, '-KeyFile', $key))
    Yes "vps-nightly-backup.ps1 runs (exit $code)" ($code -eq 0)
    if ($code -ne 0) { Show }
    $enc = @(Get-ChildItem -LiteralPath $out -File | Where-Object { $_.Name -match '^thornswood-\d{8}-\d{6}\.zip\.enc$' -and $seeded -notcontains $_.Name })
    Yes 'and leaves one new encrypted backup' ($enc.Count -eq 1)
    Yes '  with no zip left in the clear beside it' (@(Get-ChildItem -LiteralPath $out -Filter 'thornswood-*.zip').Count -eq 0)
    $encPath = if ($enc.Count) { $enc[0].FullName } else { '' }
    $encKB = if ($enc.Count) { [math]::Round($enc[0].Length / 1KB) } else { 0 }
    Yes "  far larger than the 195 KB of the 15 September pair ($encKB KB)" ($encKB -gt 5 * 195)
    Yes '  and the log counts the living characters in each world, not the deleted slots' (
        (Said 'game\\world\s+2 character') -and (Said 'game-dev\\world\s+2 character'))

    $daily = @(Get-ChildItem -LiteralPath $out -File | Where-Object { $_.Name -match '^thornswood-(\d{8})-\d{6}\.zip(\.enc)?$' } |
               Where-Object { ([datetime]::ParseExact($_.Name.Substring(11, 8), 'yyyyMMdd', $null)).DayOfWeek -ne 'Sunday' })
    Yes "retention keeps seven daily ($($daily.Count))" ($daily.Count -eq 7)
    Yes '  dropping the oldest' (-not (Test-Path -LiteralPath (Join-Path $out $seeded[0])))
    Yes '  and leaves the file put there by hand' (Test-Path -LiteralPath (Join-Path $out 'put-here-by-hand.zip'))

    # The same run in the clear, to read the zip itself.
    $plainOut = Join-Path $work 'plain'
    $code = Run $Nightly ($common + @('-Out', $plainOut, '-KeyFile', $key, '-Plain'))
    $zip = @(Get-ChildItem -LiteralPath $plainOut -Filter 'thornswood-*.zip' -File -EA SilentlyContinue)
    Yes "-Plain makes a zip to read (exit $code)" ($code -eq 0 -and $zip.Count -eq 1)
    if ($zip.Count) {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $z = [IO.Compression.ZipFile]::OpenRead($zip[0].FullName)
        $names = @($z.Entries | ForEach-Object { $_.FullName -replace '\\', '/' })
        $z.Dispose()
        $gw = @($names | Where-Object { $_ -like 'game/world/*' })
        Yes ("the zip lists entries under game/world ({0} of {1})" -f $gw.Count, $worldCount) ($gw.Count -eq $worldCount)
        Yes '  including the character' ($names -contains 'game/world/changeForms/0.json')
        $want = 'characters.json', 'mod-settings.json', 'take-limit.json', 'door.json', 'allowed.json'
        Yes '  and every private file of the live server' (@($want | Where-Object { $names -notcontains "game/private/$_" }).Count -eq 0)
        Yes '  and of the dev server, with its world' (
            @($want | Where-Object { $names -notcontains "game-dev/private/$_" }).Count -eq 0 -and
            $names -contains 'game-dev/world/changeForms/0.json')
        Yes '  and data and the settings from both' (
            $names -contains 'game/data/keep.txt' -and $names -contains 'game-dev/server-settings.json')
        Yes '  and every website record, upload and separate feed fixture' (
            @($siteExpected.Keys | Where-Object { $names -notcontains ('site/' + ($_ -replace '\\', '/')) }).Count -eq 0)
        Yes ("  and the zip is far larger than 195 KB ({0} KB)" -f [math]::Round($zip[0].Length / 1KB)) ($zip[0].Length -gt 5 * 195KB)
    }

    # ---- opening it ----------------------------------------------------------
    $code = Run $Unpack @('-Backup', $encPath, '-KeyFile', $key, '-CheckOnly', '-NoPause')
    Yes "Restore-Backup.ps1 -CheckOnly opens it (exit $code)" ($code -eq 0 -and (Said 'signature matches'))
    Yes '  and prints what the box wrote in NOTES.txt' (Said 'game\s+2 character\(s\), 0 torn')
    $code = Run $Unpack @('-Backup', $encPath, '-KeyFile', (Join-Path $work 'wrong-key.txt'), '-CheckOnly', '-NoPause')
    Yes '  and refuses the wrong passphrase before decrypting anything' ($code -ne 0 -and (Said 'Nothing was decrypted'))

    $emptyOut = Join-Path $work 'empty'
    Put (Join-Path $work 'bot-only\bot.env.json') '{}'
    $code = Run $Nightly @('-GameRoot', (Join-Path $work 'gone'), '-DevGameRoot', (Join-Path $work 'gone-dev'),
                           '-SiteRoot', (Join-Path $work 'no-site'), '-BotRoot', (Join-Path $work 'bot-only'),
                           '-CaddyRoot', (Join-Path $work 'no-caddy'), '-VoiceRoot', (Join-Path $work 'no-voice'), '-DeletionRoot', (Join-Path $work 'no-del'),
                           '-Out', $emptyOut, '-KeyFile', $key, '-Plain')
    $empty = @(Get-ChildItem -LiteralPath $emptyOut -Filter 'thornswood-*.zip' -File -EA SilentlyContinue)
    if ($empty.Count) {
        $code = Run $Unpack @('-Backup', $empty[0].FullName, '-CheckOnly', '-NoPause')
        Yes 'a backup with nothing under game/world fails -CheckOnly, as the 15 September pair would have' (
            $code -ne 0 -and (Said 'nothing under game/world'))
    } else { Yes 'a backup of a box with no world is still made, to be refused' $false }

    # ---- putting it back -----------------------------------------------------
    # As Install-ThornswoodServer leaves a new folder: the plugins, and settings
    # that name the live server's folder. The live folder is then deleted, so
    # nothing can resolve against it.
    $restored = Join-Path $work 'restore-test'
    Plugins $restored $plugins
    Settings $restored $live 45797
    # And, as on the box on 28 September, the payload unpacked there was the
    # dev channel's: the dev name and a thornswoodServer the live backup has not.
    $rsPath = Join-Path $restored 'server-settings.json'
    $rs = [IO.File]::ReadAllText($rsPath) | ConvertFrom-Json
    $rs.name = 'Thornswood Dev'
    $rs | Add-Member -NotePropertyName thornswoodServer -NotePropertyValue 'dev'
    # With another join pass switch and other role lists than the backup's (#1845).
    $rs | Add-Member -NotePropertyName thornswoodRequirePass -NotePropertyValue $false
    $rs | Add-Member -NotePropertyName thornswoodDevs -NotePropertyValue @(4409)
    $rs | Add-Member -NotePropertyName thornswoodPlaytesters -NotePropertyValue @(4405, 4406)
    Put $rsPath ($rs | ConvertTo-Json -Depth 5)
    Remove-Item -LiteralPath $live -Recurse -Force
    Yes 'the original server folder is gone before the restore' (-not (Test-Path -LiteralPath $live))

    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $restored, '-Expect', $liveWho, '-NoPause')
    Yes "Restore-Server.ps1 puts it back (exit $code)" ($code -eq 0 -and (Said 'RESTORE OK: 2 character'))
    if ($code -ne 0) { Show }
    Yes '  counting the two living characters and not the three deleted slots' (Said '3 slot\(s\) a deleted character left behind')
    Yes '  and -Expect finds the character by its profile id, in slot 0' (Said "character $liveWho is there, in 0\.json")
    $back = Join-Path $restored 'world\changeForms\0.json'
    Yes '  the character is there, byte for byte' (
        (Test-Path -LiteralPath $back) -and ([Convert]::ToBase64String([IO.File]::ReadAllBytes($back)) -eq [Convert]::ToBase64String($keep)))
    Yes ("  and the whole world ({0} files)" -f $worldCount) (
        @(Get-ChildItem -LiteralPath (Join-Path $restored 'world') -Recurse -File).Count -eq $worldCount)
    Yes '  and characters.json, the take limits and the door' (
        ([IO.File]::ReadAllText((Join-Path $restored 'private\characters.json')) -eq $keepBook) -and
        (Test-Path -LiteralPath (Join-Path $restored 'private\take-limit.json')) -and
        (Test-Path -LiteralPath (Join-Path $restored 'private\door.json')))
    Yes '  and data' (Test-Path -LiteralPath (Join-Path $restored 'data\keep.txt'))
    # Red on the build runner only (issue #1120): what the restore said, and
    # what is under data, so the log says why.
    if (-not (Test-Path -LiteralPath (Join-Path $restored 'data\keep.txt'))) {
        Show
        foreach ($f in @(Get-ChildItem -LiteralPath $restored -Recurse -File -Force -EA SilentlyContinue | Where-Object { $_.FullName -match '\\data\\|keep\.txt' })) { Write-Host ('        under the restore: ' + $f.FullName) }
    }
    $s = Get-Content -LiteralPath (Join-Path $restored 'server-settings.json') -Raw | ConvertFrom-Json
    $mine = ($restored -replace '\\', '/') + '/plugins/'
    Yes '  and the load order names this folder, not the one the backup came from' (
        @($s.loadOrder).Count -eq $plugins.Count -and @($s.loadOrder | Where-Object { -not $_.StartsWith($mine) }).Count -eq 0)
    Yes '  in the same order' ((@($s.loadOrder | ForEach-Object { Split-Path -Leaf $_ }) -join '|') -eq ($plugins -join '|'))
    Yes '  and it is the live server again: the port and name from the backup, not the dev payload' (
        $s.port -eq 45777 -and $s.name -eq 'Thornswood Test' -and -not ($s.PSObject.Properties.Name -contains 'thornswoodServer'))
    Yes '  and the join pass switch is the backup''s, not the payload''s (#1845)' ($s.thornswoodRequirePass -eq $true)
    Yes '  and the dev list is the backup''s' ((@($s.thornswoodDevs) -join ',') -eq '4401,4402')
    Yes '  and the playtester list the backup has not is taken off' (-not ($s.PSObject.Properties.Name -contains 'thornswoodPlaytesters'))
    Yes '  each said by name' (
        (Said 'thornswoodRequirePass from the backup, the folder''s was different') -and
        (Said 'thornswoodDevs from the backup, the folder''s was different') -and
        (Said 'thornswoodPlaytesters taken off: the backup''s settings do not have it'))
    $passLines = @($script:last | Where-Object { $_ -match 'thornswoodRequirePass|thornswoodDevs|thornswoodPlaytesters' })
    Yes '  with no value printed' (
        $passLines.Count -eq 3 -and @($passLines | Where-Object { $_ -match 'true|false|440[0-9]' }).Count -eq 0)
    Yes '  and the decrypted copy is not left in the temp folder' (
        @(Get-ChildItem -LiteralPath ([IO.Path]::GetTempPath()) -Directory -Filter 'thornswood-restore-*' -EA SilentlyContinue |
          Where-Object { $_.LastWriteTime -gt (Get-Date).AddMinutes(-2) }).Count -eq 0)

    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $restored, '-NoPause')
    $aside = @(Get-ChildItem -LiteralPath $restored -Directory -Filter 'world-before-restore-*')
    Yes 'a second restore keeps the world it replaced' (
        $code -eq 0 -and $aside.Count -eq 1 -and (Test-Path -LiteralPath (Join-Path $aside[0].FullName 'world\changeForms\0.json')))

    $broken = Join-Path $work 'restore-broken'
    Plugins $broken ($plugins | Where-Object { $_ -ne 'Thornswood.esp' })
    Settings $broken $broken 45807
    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $broken, '-NoPause')
    Yes 'a folder missing a plugin is refused' ($code -ne 0 -and (Said 'load order does not resolve'))
    Yes '  and the missing plugin is named' (Said 'not on disk:[\s\S]*Thornswood\.esp')

    $devBack = Join-Path $work 'restore-dev'
    Plugins $devBack $plugins
    Settings $devBack $dev 45817
    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $devBack, '-Which', 'dev', '-Expect', $devWho, '-NoPause')
    $slot0 = Join-Path $devBack 'world\changeForms\0.json'
    $slot0Text = if (Test-Path -LiteralPath $slot0) { [IO.File]::ReadAllText($slot0) } else { '' }
    Yes "-Which dev puts the dev world back (exit $code)" ($code -eq 0 -and $slot0Text -match ('"profileId":' + $devWho))
    Yes '  and not the live one' ($slot0Text -notmatch ('"profileId":' + $liveWho))

    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $devBack, '-Expect', '999', '-NoPause')
    Yes '-Expect names a character that is not there and refuses' ($code -ne 0 -and (Said 'Character 999 is not in the restored world'))
    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $devBack, '-Which', 'dev', '-Expect', '0', '-NoPause')
    Yes '-Expect takes a profile id, not a slot file name (0 refuses)' ($code -ne 0 -and (Said 'Character 0 is not in the restored world'))

    # A world whose every slot is a deleted character holds nobody, and a
    # restore of it is refused rather than reported as characters.
    $dead = Join-Path $work 'dead'
    Server $dead 45827 '0' 3 1100 -DeadOnly
    $deadOut = Join-Path $work 'dead-out'
    $code = Run $Nightly @('-GameRoot', $dead, '-DevGameRoot', $dev,
                           '-SiteRoot', (Join-Path $work 'no-site'), '-BotRoot', (Join-Path $work 'no-bot'),
                           '-CaddyRoot', (Join-Path $work 'no-caddy'), '-VoiceRoot', (Join-Path $work 'no-voice'), '-DeletionRoot', (Join-Path $work 'no-del'),
                           '-Out', $deadOut, '-KeyFile', $key, '-Plain')
    Yes '  the nightly log counts 0 characters in a world of deleted slots' ($code -eq 0 -and (Said 'game\\world\s+0 character'))
    $deadZip = @(Get-ChildItem -LiteralPath $deadOut -Filter 'thornswood-*.zip' -File -EA SilentlyContinue)
    $deadBack = Join-Path $work 'restore-dead'
    Plugins $deadBack $plugins
    Settings $deadBack $deadBack 45837
    $code = if ($deadZip.Count) { Run $Restore @('-Backup', $deadZip[0].FullName, '-Root', $deadBack, '-NoPause') } else { 0 }
    Yes 'a backup whose world holds only deleted characters is refused' ($code -ne 0 -and (Said 'holds no characters'))
    $code = if ($deadZip.Count) { Run $Unpack @('-Backup', $deadZip[0].FullName, '-CheckOnly', '-NoPause') } else { 0 }
    Yes '-CheckOnly fails a backup whose numbered change forms are only deleted characters' (
        $code -ne 0 -and (Said 'numbered change form') -and (Said 'profile id above 0'))

    $node = Get-Command node -EA SilentlyContinue
    if ($node) {
        $p = Start-Process -FilePath $node.Source -WindowStyle Hidden -PassThru -ArgumentList @('-e', '"setTimeout(function(){},60000)"', ('"' + $devBack + '"'))
        try {
            Start-Sleep -Milliseconds 500
            $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $devBack, '-Which', 'dev', '-NoPause')
            Yes 'a folder whose server is running is refused' ($code -ne 0 -and (Said 'is running'))
        } finally { Stop-Process -Id $p.Id -Force -EA SilentlyContinue }
    } else { Write-Host 'SKIP  no node here to stand in for a running server' }

    # ---- where the decrypted backup sits (#1048) -----------------------------
    # -Work defaults to %TEMP%. A folder named here must be empty again after
    # a run and after a refusal: the zip and the unpacked backup hold the bot
    # token and the site keys.
    $scratch = Join-Path $work 'decrypt-scratch'
    [void](New-Item -ItemType Directory -Path $scratch -Force)
    function Scratch-Clear { return (@(Get-ChildItem -LiteralPath $scratch -Force -EA SilentlyContinue).Count -eq 0) }

    $code = Run $Unpack @('-Backup', $encPath, '-KeyFile', $key, '-CheckOnly', '-Work', $scratch, '-NoPause')
    Yes "Restore-Backup.ps1 -Work -CheckOnly leaves nothing in that folder (exit $code)" ($code -eq 0 -and (Scratch-Clear))
    if (-not (Scratch-Clear)) { foreach ($f in @(Get-ChildItem -LiteralPath $scratch -Force)) { Write-Host ('        left: ' + $f.FullName) } }

    $code = Run $Unpack @('-Backup', $encPath, '-KeyFile', (Join-Path $work 'wrong-key.txt'), '-CheckOnly', '-Work', $scratch, '-NoPause')
    Yes '  a refused passphrase leaves nothing in -Work' ($code -ne 0 -and (Said 'Nothing was decrypted') -and (Scratch-Clear))

    $busy = Join-Path $work 'busy-to'
    [void](New-Item -ItemType Directory -Path $busy -Force)
    Put (Join-Path $busy 'already.txt') 'x'
    $code = Run $Unpack @('-Backup', $encPath, '-KeyFile', $key, '-To', $busy, '-Work', $scratch, '-NoPause')
    Yes '  a refusal to write over a folder leaves nothing in -Work' (
        $code -ne 0 -and (Said 'already has things') -and (Scratch-Clear) -and
        ([IO.File]::ReadAllText((Join-Path $busy 'already.txt')) -eq 'x'))
    if ($code -eq 0 -or -not (Scratch-Clear)) { Show }

    $unpackedTo = Join-Path $work 'unpacked-work'
    # Prove this is recovery from a lost site rather than comparison with a
    # live source folder. Check the resolved target before deleting scratch.
    $workPrefix = [IO.Path]::GetFullPath($work).TrimEnd('\') + '\'
    if (-not $sitePrefix.StartsWith($workPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The scratch website is outside the test workspace.'
    }
    Remove-Item -LiteralPath $site -Recurse -Force
    Yes 'the original website is gone before recovering its backup' (-not (Test-Path -LiteralPath $site))
    $code = Run $Unpack @('-Backup', $encPath, '-KeyFile', $key, '-To', $unpackedTo, '-Work', $scratch, '-NoPause')
    Yes '  an unpack through -Work leaves the backup in -To and nothing in -Work' (
        $code -eq 0 -and (Test-Path -LiteralPath (Join-Path $unpackedTo 'game\world')) -and (Scratch-Clear))
    if ($code -ne 0) { Show }
    $siteRecovered = Join-Path $unpackedTo 'site'
    Yes 'website recovery returns exactly the original fixture files' (
        @(Get-ChildItem -LiteralPath $siteRecovered -Recurse -File -EA SilentlyContinue).Count -eq $siteExpected.Count)
    foreach ($relative in @($siteExpected.Keys | Sort-Object)) {
        $recovered = Join-Path $siteRecovered $relative
        Yes ("  website $relative returns byte for byte") (
            (Test-Path -LiteralPath $recovered) -and
            ([Convert]::ToBase64String([IO.File]::ReadAllBytes($recovered)) -eq $siteExpected[$relative]))
    }

    $srv = Join-Path $work 'restore-work-root'
    Plugins $srv $plugins
    Settings $srv $srv 45847
    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $srv, '-Work', $scratch, '-NoPause')
    Yes "Restore-Server.ps1 -Work puts the world back and leaves nothing in -Work (exit $code)" (
        $code -eq 0 -and (Said 'RESTORE OK') -and (Scratch-Clear) -and
        (Test-Path -LiteralPath (Join-Path $srv 'world\changeForms\0.json')))
    if ($code -ne 0 -or -not (Scratch-Clear)) { Show; foreach ($f in @(Get-ChildItem -LiteralPath $scratch -Force -EA SilentlyContinue)) { Write-Host ('        left: ' + $f.FullName) } }

    $code = Run $Restore @('-Backup', $encPath, '-KeyFile', $key, '-Root', $broken, '-Work', $scratch, '-NoPause')
    Yes '  a refused restore leaves nothing in -Work' ($code -ne 0 -and (Said 'load order does not resolve') -and (Scratch-Clear))
    if (-not (Scratch-Clear)) { foreach ($f in @(Get-ChildItem -LiteralPath $scratch -Force)) { Write-Host ('        left: ' + $f.FullName) } }

    # ---- the copy on this machine --------------------------------------------
    $here = Join-Path $work 'fetched'
    $today = Get-Date
    $names = @()
    foreach ($i in 0..2) { $names += 'thornswood-' + $today.AddDays(-$i).ToString('yyyyMMdd') + '-031500.zip.enc' }
    foreach ($i in 0..8) { $names += 'thornswood-' + $today.AddDays(-60 - $i).ToString('yyyyMMdd') + '-031500.zip.enc' }
    foreach ($n in $names) { Put (Join-Path $here $n) 'x' }
    Put (Join-Path $here 'mine.zip.enc') 'mine'
    $code = Run $Fetch @('-To', $here, '-KeepDays', '30', '-PruneOnly', '-NoPause')
    $left = @(Get-ChildItem -LiteralPath $here -Filter 'thornswood-*' -File | ForEach-Object { $_.Name } | Sort-Object -Descending)
    Yes "Fetch-Backups.ps1 -PruneOnly keeps the newest seven when only three are recent (exit $code, $($left.Count) left)" (
        $code -eq 0 -and $left.Count -eq 7 -and (($left -join '|') -eq ((@($names | Sort-Object -Descending) | Select-Object -First 7) -join '|')))
    Yes '  and leaves a file put there by hand' (Test-Path -LiteralPath (Join-Path $here 'mine.zip.enc'))
    Yes '  and says what it did in fetch.log' (
        (Test-Path -LiteralPath (Join-Path $here 'fetch.log')) -and
        ([IO.File]::ReadAllText((Join-Path $here 'fetch.log')) -match 'dropped thornswood-'))
}
catch {
    Yes ('the runs finished without an error: ' + $_.Exception.Message) $false
    Show
}
finally {
    $rng.Dispose()
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}

Done
