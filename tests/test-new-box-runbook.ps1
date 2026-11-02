<#
  test-new-box-runbook.ps1

      pwsh -NoProfile -File .\tests\test-new-box-runbook.ps1

  Issue #454: the new-box runbook did not survive being followed. Measured on
  29 September, before this harness: it named Backup-Server.ps1, whose zip
  Restore-Server.ps1 cannot read; restored by hand into folders that did not
  exist yet; and the box-side scripts it leaned on had never been run against
  anything. None of it failed anything, because nothing ran them.

  The runbook itself ("If it is a new machine, new address" in
  MOVING-THE-SERVER.md and "The box is gone" in RESTORING.md) is in the
  private ops repo since #3693, and that repo's tests\test-new-box-runbook.ps1
  reads it against the scripts here: every command parses and passes only
  parameters its script takes, the steps are in the order the scripts need,
  every scp carries what the installer loads, no command carries a secret,
  and the Ship note passes Ship's rules.

  This holds the scripts the runbook runs:

    1. what can run here does: Where.ps1 knows the payload the runbook sends,
       and Restore-Box.ps1 refuses a backup it cannot use before it reaches
       for ssh.
    2. the box-side half, under PowerShell 7 as on the box: the real
       vps-nightly-backup.ps1 takes every site upload even over its advisory
       threshold, and the feed store (not its downloads)
       from a scratch site, and the real vps-restore-services.ps1
       puts every piece back into scratch folders, keeps what was there
       aside, locks the bot's settings, compares the gamemode, refuses a
       backup without the essentials and refuses while the site runs.

  Touches nothing but a scratch folder under the temp folder. Never reaches
  the VPS.
#>
[CmdletBinding()]
param()
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent $Here

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

# ------------------------------------------------------------ the scripts --
$scriptsDir = Join-Path $Repo 'scripts'
$byLeaf = @{}
foreach ($f in @(Get-ChildItem -LiteralPath $scriptsDir -Recurse -File -Filter *.ps1)) {
    if (-not $byLeaf.ContainsKey($f.Name)) { $byLeaf[$f.Name] = @() }
    $byLeaf[$f.Name] += $f.FullName
}
$common = @('Verbose', 'Debug', 'ErrorAction', 'WarningAction', 'InformationAction', 'ErrorVariable',
            'WarningVariable', 'InformationVariable', 'OutVariable', 'OutBuffer', 'PipelineVariable', 'WhatIf', 'Confirm')
$paramCache = @{}
function ParamsOf([string]$path) {
    if ($paramCache.ContainsKey($path)) { return $paramCache[$path] }
    $errs = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$errs)
    $info = @{ Errors = @($errs).Count; Names = @{} }
    if ($ast.ParamBlock) {
        foreach ($p in $ast.ParamBlock.Parameters) {
            $set = $null
            foreach ($a in $p.Attributes) {
                if ($a.TypeName.Name -eq 'ValidateSet') { $set = @($a.PositionalArguments | ForEach-Object { $_.Value }) }
            }
            $info.Names[$p.Name.VariablePath.UserPath] = $set
        }
    }
    $paramCache[$path] = $info
    return $info
}

# --------------------------------------------------------- what runs here --
$whereOut = $null
try { $whereOut = & (Join-Path $scriptsDir 'release\Where.ps1') ServerZip } catch { $whereOut = $null }
Yes "Where.ps1 knows ServerZip, the payload step 6 sends ($whereOut)" ([bool]$whereOut -and "$whereOut".EndsWith('.zip'))

$work = Join-Path ([IO.Path]::GetTempPath()) ('ts-newbox-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
[void](New-Item -ItemType Directory -Path $work -Force)
$utf8 = New-Object Text.UTF8Encoding($false)
function Put([string]$path, [string]$text) {
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllText($path, $text, $utf8)
}
$script:last = @()
function Run([string]$exe, [string]$file, [string[]]$argv) {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $script:last = @(& $exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $file @argv 2>&1 | ForEach-Object { "$_" }) }
    finally { $ErrorActionPreference = $eap }
    return $LASTEXITCODE
}
function Show { foreach ($l in $script:last | Select-Object -Last 30) { Write-Host ('        ' + $l) } }
function Said([string]$pattern) { return (($script:last -join "`n") -match $pattern) }

try {
    $pwsh = (Get-Process -Id $PID).Path
    $rbox = Join-Path $scriptsDir 'vps\Restore-Box.ps1'
    Put (Join-Path $work 'thornswood-backup-20260929-1200.zip') 'not a nightly'
    $code = Run $pwsh $rbox @('-Backup', (Join-Path $work 'thornswood-backup-20260929-1200.zip'), '-NoPause')
    Yes "Restore-Box.ps1 refuses Backup-Server.ps1's zip before reaching for ssh (exit $code)" ($code -ne 0 -and (Said 'not a nightly backup') -and -not (Said 'Is the box ready'))
    Put (Join-Path $work 'thornswood-20260929-031500.zip.enc') 'TSBK1 but not really'
    Put (Join-Path $work 'key.txt') 'a passphrase for the test'
    $code = Run $pwsh $rbox @('-Backup', (Join-Path $work 'thornswood-20260929-031500.zip.enc'), '-KeyFile', (Join-Path $work 'no-such-key.txt'), '-NoPause')
    Yes "  and a missing passphrase file (exit $code)" ($code -ne 0 -and (Said 'no passphrase file'))
    $code = Run $pwsh $rbox @('-Backup', (Join-Path $work 'thornswood-20260929-031500.zip.enc'), '-KeyFile', (Join-Path $work 'key.txt'), '-Check', '-NoPause')
    Yes "  and a backup that does not open here, sending nothing (exit $code)" ($code -ne 0 -and (Said 'did not open here, so nothing was sent') -and -not (Said 'Is the box ready'))
    $code = Run $pwsh $rbox @('-Backup', (Join-Path $work 'thornswood-20260929-031500.zip.enc'), '-KeyFile', (Join-Path $work 'key.txt'), '-Expect', 'Brynja', '-NoPause')
    Yes "  and an -Expect that is not a profile id (exit $code)" ($code -ne 0 -and (Said 'digits only'))

    foreach ($s in 'vps-freeze.ps1', 'vps-restore-services.ps1', 'Restore-Box.ps1') {
        Yes "$s parses" ((ParamsOf (Join-Path $scriptsDir "vps\$s")).Errors -eq 0)
    }

    # ---- the box-side half, under PowerShell 7 -------------------------------
    . (Join-Path $PSScriptRoot 'Windows.ps1')
    if (-not $OnWindows) {
        Write-Host 'SKIP  the box-side runs: they start with a nightly backup, which stages under Windows'' TEMP and builds its paths with the \ separator, so it runs only on Windows'
        throw 'skip'
    }
    $boxPs = Get-BoxPowerShell
    $old = Join-Path $work 'old'
    $site = Join-Path $old 'site'; $bot = Join-Path $old 'bot'; $caddy = Join-Path $old 'caddy'; $voice = Join-Path $old 'voice'
    Put (Join-Path $site 'data\board.json') '{"cards":[]}'
    Put (Join-Path $site 'data\site\about.md') '# About'
    Put (Join-Path $site 'config.json') '{"secret":"stand-in","botKey":"stand-in"}'
    Put (Join-Path $site 'uploads\uploads.json') '{"files":[]}'
    Put (Join-Path $site 'uploads\shot-1.png') 'a picture'
    [void](New-Item -ItemType Directory -Path (Join-Path $site 'uploads\rec') -Force)
    $fs = [IO.File]::Create((Join-Path $site 'uploads\rec\recording.mp4')); $fs.SetLength(11MB); $fs.Dispose()
    foreach ($feed in 'feed', 'feed-dev') {
        Put (Join-Path $site "$feed\version\00000001.json") ('{"launcherVersion":"1.1.1","which":"' + $feed + '"}')
        Put (Join-Path $site "$feed\published.json") '{"packs":[]}'
        Put (Join-Path $site "$feed\launchers.txt") '1.1.1'
        Put (Join-Path $site "$feed\releases.txt") 'r1'
        Put (Join-Path $site "$feed\history\20260928T000000Z-published.json") '{"old":true}'
        Put (Join-Path $site "$feed\assets\$('a' * 64)") 'a download, not for the backup'
    }
    Put (Join-Path $bot 'bot.env.json') '{"DISCORD_TOKEN":"stand-in"}'
    Put (Join-Path $bot 'joins.json') '{"n":28}'
    Put (Join-Path $caddy 'Caddyfile') 'thornswood.net { }'
    Put (Join-Path $voice 'choices.json') '{}'
    $game = Join-Path $old 'game'; $gameDev = Join-Path $old 'game-dev'
    foreach ($g in $game, $gameDev) {
        Put (Join-Path $g 'world\changeForms\0.json') '{"profileId":1234567,"isDeleted":false}'
        Put (Join-Path $g 'server-settings.json') '{"port":45777,"loadOrder":[]}'
        Put (Join-Path $g 'gamemode.js') ('// gamemode of ' + (Split-Path -Leaf $g))
    }
    $plain = Join-Path $work 'backups'
    $code = Run $boxPs (Join-Path $scriptsDir 'vps\vps-nightly-backup.ps1') @(
        '-GameRoot', $game, '-DevGameRoot', $gameDev, '-SiteRoot', $site, '-BotRoot', $bot,
        '-CaddyRoot', $caddy, '-VoiceRoot', $voice, '-DeletionRoot', (Join-Path $work 'no-del'), '-Out', $plain, '-KeyFile', (Join-Path $work 'no-key.txt'), '-Plain')
    $zip = @(Get-ChildItem -LiteralPath $plain -Filter 'thornswood-*.zip' -File -EA SilentlyContinue)
    Yes "the nightly backup runs against a scratch site (exit $code)" ($code -eq 0 -and $zip.Count -eq 1)
    if (-not $zip.Count) { Show; throw 'no backup' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $z = [IO.Compression.ZipFile]::OpenRead($zip[0].FullName)
    $names = @($z.Entries | ForEach-Object { $_.FullName -replace '\\', '/' })
    $z.Dispose()
    Yes '  and takes the site''s uploads' ($names -contains 'site/uploads/shot-1.png' -and $names -contains 'site/uploads/uploads.json')
    $store = foreach ($feed in 'feed', 'feed-dev') { foreach ($n in 'version/00000001.json', 'published.json', 'launchers.txt', 'releases.txt', 'history/20260928T000000Z-published.json') { "site/$feed/$n" } }
    Yes '  and both feeds'' store with its history' (@($store | Where-Object { $names -notcontains $_ }).Count -eq 0)
    Yes '  and not the feeds'' downloads' (@($names | Where-Object { $_ -like 'site/feed*/assets/*' }).Count -eq 0)
    Yes '  and a recording in uploads while the folder is under its budget' ($names -contains 'site/uploads/rec/recording.mp4')

    # The advisory threshold must not omit a recording from recovery.
    $tight = Join-Path $work 'backups-tight'
    $code = Run $boxPs (Join-Path $scriptsDir 'vps\vps-nightly-backup.ps1') @(
        '-GameRoot', $game, '-DevGameRoot', $gameDev, '-SiteRoot', $site, '-BotRoot', $bot,
        '-CaddyRoot', $caddy, '-VoiceRoot', $voice, '-DeletionRoot', (Join-Path $work 'no-del'), '-Out', $tight, '-KeyFile', (Join-Path $work 'no-key.txt'), '-Plain', '-MaxUploadsMB', '5')
    $tz = @(Get-ChildItem -LiteralPath $tight -Filter 'thornswood-*.zip' -File -EA SilentlyContinue)
    $tnames = @()
    if ($tz.Count) { $z = [IO.Compression.ZipFile]::OpenRead($tz[0].FullName); $tnames = @($z.Entries | ForEach-Object { $_.FullName -replace '\\', '/' }); $z.Dispose() }
    Yes "over its advisory threshold, uploads keeps pictures, metadata and the recording (exit $code)" (
        $code -eq 0 -and $tz.Count -eq 1 -and $tnames -contains 'site/uploads/shot-1.png' -and
        $tnames -contains 'site/uploads/uploads.json' -and $tnames -contains 'site/uploads/rec/recording.mp4' -and
        (Said 'uploads exceed the advisory threshold of 5 MB; every file will be taken'))
    if ($tz.Count) {
        $tightRestored = Join-Path $work 'tight-restored'
        $code = Run $boxPs (Join-Path $scriptsDir 'vps\Restore-Backup.ps1') @('-Backup', $tz[0].FullName, '-To', $tightRestored, '-NoPause')
        $recording = Join-Path $tightRestored 'site\uploads\rec\recording.mp4'
        Yes "the over-threshold recording restores with its original bytes (exit $code)" (
            $code -eq 0 -and (Test-Path -LiteralPath $recording) -and (Get-Item -LiteralPath $recording).Length -eq 11MB -and
            (Get-FileHash -LiteralPath $recording).Hash -eq (Get-FileHash -LiteralPath (Join-Path $site 'uploads\rec\recording.mp4')).Hash)
    }

    $unpacked = Join-Path $work 'unpacked'
    $code = Run $boxPs (Join-Path $scriptsDir 'vps\Restore-Backup.ps1') @('-Backup', $zip[0].FullName, '-To', $unpacked, '-NoPause')
    Yes "Restore-Backup.ps1 unpacks it (exit $code)" ($code -eq 0)

    $new = Join-Path $work 'new'
    $nSite = Join-Path $new 'Thornswood-Docs'; $nBot = Join-Path $new 'Thornswood-Bot'; $nCaddy = Join-Path $new 'Thornswood-Caddy'
    $nGame = Join-Path $new 'Thornswood-Server'; $nDev = Join-Path $new 'Thornswood-Server-Dev'
    # As the installers leave a new box: an empty data folder, a config the
    # site made on a first start, the downloads already mirrored, and the
    # gamemode from main in live and the backup's in dev.
    [void](New-Item -ItemType Directory -Path (Join-Path $nSite 'data') -Force)
    Put (Join-Path $nSite 'config.json') '{"secret":"made on first start"}'
    Put (Join-Path $nSite "feed\assets\$('a' * 64)") 'mirrored already'
    Put (Join-Path $nGame 'gamemode.js') '// gamemode from main'
    Put (Join-Path $nDev 'gamemode.js') '// gamemode of game-dev'
    $svc = Join-Path $scriptsDir 'vps\vps-restore-services.ps1'
    $roots = @('-SiteRoot', $nSite, '-BotRoot', $nBot, '-CaddyRoot', $nCaddy, '-GameRoot', $nGame, '-DevGameRoot', $nDev)
    $code = Run $boxPs $svc (@('-From', $unpacked) + $roots)
    Yes "vps-restore-services.ps1 puts it back (exit $code)" ($code -eq 0 -and (Said 'SERVICES OK'))
    if ($code -ne 0) { Show }
    Yes '  the site''s data' ((Test-Path -LiteralPath (Join-Path $nSite 'data\board.json')) -and (Test-Path -LiteralPath (Join-Path $nSite 'data\site\about.md')))
    Yes '  its config, keeping the one the site made on first start aside' (
        [IO.File]::ReadAllText((Join-Path $nSite 'config.json')) -match 'stand-in' -and
        @(Get-ChildItem -LiteralPath $nSite -Filter 'config.json-before-restore-*').Count -eq 1)
    Yes '  its uploads' (Test-Path -LiteralPath (Join-Path $nSite 'uploads\shot-1.png'))
    Yes '  both feeds'' store and history, beside the downloads already there' (
        [IO.File]::ReadAllText((Join-Path $nSite 'feed-dev\version\00000001.json')) -match 'feed-dev' -and
        (Test-Path -LiteralPath (Join-Path $nSite 'feed\releases.txt')) -and
        (Test-Path -LiteralPath (Join-Path $nSite 'feed\history\20260928T000000Z-published.json')) -and
        [IO.File]::ReadAllText((Join-Path $nSite "feed\assets\$('a' * 64)")) -eq 'mirrored already')
    $envFile = Join-Path $nBot 'bot.env.json'
    Yes '  the bot''s settings and join record' ((Test-Path -LiteralPath $envFile) -and (Test-Path -LiteralPath (Join-Path $nBot 'data\joins.json')))
    $acl = if (Test-Path -LiteralPath $envFile) { Get-Acl -LiteralPath $envFile } else { $null }
    $who = if ($acl) { @($acl.Access | ForEach-Object { $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value }) } else { @() }
    $me = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    Yes '  with the bot''s settings shut to all but SYSTEM, Administrators and whoever ran it' (
        $acl -and $acl.AreAccessRulesProtected -and @($who | Where-Object { @('S-1-5-18', 'S-1-5-32-544', $me) -notcontains $_ }).Count -eq 0)
    Yes '  the Caddyfile' (Test-Path -LiteralPath (Join-Path $nCaddy 'Caddyfile'))
    Yes '  and not choices.json, which the nightly backup no longer takes (#1084)' ($names -notcontains 'voice/choices.json')
    Yes '  and says the live gamemode differs from the backup''s and the dev one does not' (
        (Said ('GAMEMODE DIFFERS\s+' + [regex]::Escape($nGame))) -and (Said ('gamemode\s+' + [regex]::Escape($nDev) + '\\gamemode.js is the one')))

    $code = Run $boxPs $svc (@('-From', $unpacked) + $roots)
    Yes "a second run keeps the data folder it replaced (exit $code)" ($code -eq 0 -and @(Get-ChildItem -LiteralPath $nSite -Directory -Filter 'data-before-restore-*').Count -eq 1)

    # Two restores inside one second (#1107). What an earlier run kept under
    # this second's name is not in the way: stand-ins for it are put there for
    # the next minute, and the run keeps its own copies beside them, under
    # that second's name with a number after it.
    # Judged by what the run added, never by which number it took (#1117): on
    # a fast runner all three runs here land in one second (the VPS runner
    # takes about 0.4 s a run), the second run has already taken -2, and this
    # one rightly takes -3. So the check reads the same whichever second each
    # run lands in: exactly one new config copy and one new data copy, both
    # under a numbered name and holding what was in place, and everything
    # kept before the run left exactly as it was. The stand-ins take each
    # second's plain name and its -2 as well, so this run always meets the
    # case that went red: it has to go to -3, whatever the clock says.
    $at = Get-Date
    foreach ($s in 0..60) {
        $st = $at.AddSeconds($s).ToString('yyyyMMdd-HHmmss')
        foreach ($tail in '', '-2') {
            $cf = Join-Path $nSite ('config.json-before-restore-' + $st + $tail)
            if (-not (Test-Path -LiteralPath $cf)) { Put $cf '{"kept":"earlier"}' }
            [void](New-Item -ItemType Directory -Force -Path (Join-Path $nSite ('data-before-restore-' + $st + $tail)))
        }
    }
    function Kept {
        $h = @{}
        foreach ($i in @(Get-ChildItem -LiteralPath $nSite -Filter '*-before-restore-*' -Force)) {
            $h[$i.Name] = if ($i.PSIsContainer) { 'dir:' + ((@(Get-ChildItem -LiteralPath $i.FullName -Force -Recurse | ForEach-Object { $_.Name }) | Sort-Object) -join '|') }
                          else { 'file:' + [IO.File]::ReadAllText($i.FullName) }
        }
        return $h
    }
    $before = Kept
    $code = Run $boxPs $svc (@('-From', $unpacked) + $roots)
    $after = Kept
    $added = @($after.Keys | Where-Object { -not $before.ContainsKey($_) })
    $changed = @($before.Keys | Where-Object { $after[$_] -ne $before[$_] })
    $newFile = @($added | Where-Object { $_ -like 'config.json-before-restore-*' })
    $newDir = @($added | Where-Object { $_ -like 'data-before-restore-*' })
    $numbered = '-before-restore-\d{8}-\d{6}-\d+$'
    Yes "a run in the same second as the last keeps its copies beside that one's, not over or inside them (exit $code)" (
        $code -eq 0 -and $changed.Count -eq 0 -and $newFile.Count -eq 1 -and $newDir.Count -eq 1 -and
        $newFile[0] -match $numbered -and $newDir[0] -match $numbered -and
        $after[$newFile[0]] -match 'stand-in' -and $after[$newDir[0]] -match '(^dir:|\|)board\.json(\||$)' -and
        @(Get-ChildItem -LiteralPath $nSite -Directory -Filter 'data-before-restore-*' | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'data') }).Count -eq 0)
    if (-not ($changed.Count -eq 0 -and $newFile.Count -eq 1 -and $newDir.Count -eq 1)) {
        Write-Host ('        added: {0}; changed: {1}' -f ($added -join ', '), ($changed -join ', '))
    }

    $thin = Join-Path $work 'thin'
    Copy-Item -LiteralPath $unpacked -Destination $thin -Recurse
    Remove-Item -LiteralPath (Join-Path $thin 'bot\bot.env.json') -Force
    $code = Run $boxPs $svc (@('-From', $thin) + $roots)
    Yes "a backup without the bot's settings ends SERVICES INCOMPLETE (exit $code)" ($code -ne 0 -and (Said 'SERVICES INCOMPLETE: not in the backup: bot\\bot.env.json'))

    $code = Run $boxPs $svc (@('-From', (Join-Path $work 'nowhere')) + $roots)
    Yes "a folder that is not an unpacked backup is refused (exit $code)" ($code -ne 0 -and (Said 'no unpacked backup'))

    $node = Get-Command node -EA SilentlyContinue
    if ($node) {
        $p = Start-Process -FilePath $node.Source -WindowStyle Hidden -PassThru -ArgumentList @('-e', '"setTimeout(function(){},60000)"', ('"' + $nSite + '\server.js"'))
        try {
            Start-Sleep -Milliseconds 500
            $code = Run $boxPs $svc (@('-From', $unpacked) + $roots)
            Yes "it refuses while the site runs from the folder (exit $code)" ($code -ne 0 -and (Said 'Running from a folder this writes into'))
        } finally { Stop-Process -Id $p.Id -Force -EA SilentlyContinue }
    } else { Write-Host 'SKIP  no node here to stand in for a running site' }
}
catch {
    if ("$_" -ne 'skip') { Yes ('the runs finished without an error: ' + $_.Exception.Message) $false; Show }
}
finally {
    Remove-Item -LiteralPath $work -Recurse -Force -EA SilentlyContinue
}

Done
