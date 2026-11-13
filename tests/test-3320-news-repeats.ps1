<#
  test-3320-news-repeats.ps1

      pwsh -NoProfile -File .\tests\test-3320-news-repeats.ps1

  Each post says only what is new on its channel (#3320). Offline: a folder
  stands in for the site and the VPS store ($env:THORNSWOOD_TEST_SITE_DIR),
  so nothing connects anywhere.

    - Note-Repeats.ps1 finds a title or "- " line a channel's feed or its
      Discord posts already had, says where, and leaves alone the lines the
      publisher writes itself and a release shipped again with its own note.
    - Get-ChannelPosts reads both records, and Add-AnnouncedPost keeps forty.
    - Ship.ps1 and Deploy-DevGamemode.ps1 run the check before anything is
      built or sent, and -ShipFollows posts nothing.
    - Publish-Discord.ps1 remembers the lines of every post, gamemode
      deploys included.
    - Clean-NewsRepeats.ps1 takes the 22 Oct repeats out of a feed, keeps
      each note's title and the publisher's own lines, and -Check sends
      nothing.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pwshExe = (Get-Process -Id $PID).Path
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Put([string]$path, [string]$text) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $path) | Out-Null
    [IO.File]::WriteAllText($path, $text, (New-Object Text.UTF8Encoding($false)))
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-3320-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$site = Join-Path $tmp 'site'
New-Item -ItemType Directory -Force -Path (Join-Path $site 'feed'), (Join-Path $site 'feed-dev') | Out-Null
$env:THORNSWOOD_TEST_SITE_DIR = $site
try {
    . (Join-Path $repo 'scripts\release\Note-Repeats.ps1')

    # ---- the 22 Oct dev feed, as measured
    $axe = [pscustomobject]@{ date = '10-22-2026 6:32 AM'; title = 'Clearer launcher messages and a visible axe'; body = ''; channel = 'dev'
        details = @('The Ready card now says what is wrong when something stops Play.', 'An Open Steam button appears when Steam needs to be running.', 'An axe that went invisible in the hand shows again.', '7 files to download, 28.9 MB') }
    $launcher = [pscustomobject]@{ date = '10-22-2026 7:08 AM'; title = 'A new launcher'; body = ''; channel = 'dev'
        details = @('The Ready card now says what is wrong when something stops Play.', 'An Open Steam button appears when Steam needs to be running.', 'The launcher''s shortcut no longer turns into a second copy with (2) after its name.', 'Launcher 1.2.6.5') }
    $gallery = [pscustomobject]@{ date = '10-22-2026 9:42 AM'; title = 'Lighter gallery pictures'; body = ''; channel = 'dev'
        details = @('Pictures sent from the launcher''s Gallery get smaller copies, so they load faster on the site.', '7 files to download, 28.9 MB', 'Launcher 1.2.6.6') }
    $feedDoc = [pscustomobject]@{ launcherVersion = '1.2.3'; minLauncher = '1.2.3'; news = @($gallery, $launcher, $axe) }
    Put (Join-Path $site 'feed-dev\version\00000001.json') ($feedDoc | ConvertTo-Json -Depth 6)
    # The deploy's post, remembered in the dev store the way Publish-Discord now writes it.
    $said = @{}
    Add-AnnouncedPost $said 'dev' 'Immersive Armors recipes ask for the right things' @('Immersive Armors pieces at a forge now cost the same ingredients as the same kind of piece at its rank and metal, and no gold coins.') 'gamemode'
    Put (Join-Path $site 'feed-dev\announced.json') ($said | ConvertTo-Json -Depth 6)

    # ---- what a note's lines are
    $lines = @(Get-NoteRepeatLines "A new launcher`n- The Ready card says what is wrong.`nWhy it changed.`n* The shortcut stays one.")
    Yes 'a note''s lines are its title and its - and * lines, not its body' (($lines -join '|') -eq 'A new launcher|The Ready card says what is wrong.|The shortcut stays one.')
    Yes 'a one-line note''s title is its first sentence' ((@(Get-NoteRepeatLines 'Saves keep. Nothing else moved.') -join '|') -eq 'Saves keep')
    Yes 'case, spaces, the bullet and a full stop are not counted' ((ConvertTo-NoteRepeatKey '-  The Ready  card says.') -eq (ConvertTo-NoteRepeatKey 'the ready card says'))
    Yes 'the publisher''s own lines are not compared' ((Test-NoteRepeatNoise (ConvertTo-NoteRepeatKey 'Launcher 1.2.6.6')) -and (Test-NoteRepeatNoise (ConvertTo-NoteRepeatKey '1 file to download, 0.2 MB')) -and (Test-NoteRepeatNoise (ConvertTo-NoteRepeatKey 'The load order moved, so start a new character or expect the old save to complain')))

    # ---- what the channel has been told
    $told = Get-ChannelPosts 'dev'
    Yes 'the dev channel''s posts are its feed''s notes and its Discord posts' (@($told.Posts).Count -eq 4)
    Yes 'and its feed''s newest note is the newest release' ($told.Newest.title -eq 'Lighter gallery pictures')
    Yes 'a Discord post is named as one' (@($told.Posts | Where-Object { $_.where -eq 'the dev updates channel' -and $_.title -like 'Immersive*' }).Count -eq 1)
    Yes 'the main channel has had nothing here' (@((Get-ChannelPosts 'main').Posts).Count -eq 0)

    # ---- the check
    $r = @(Get-NoteRepeats "A new launcher build`n- The Ready card now says what is wrong when something stops Play.`n- An axe in the hand stays seen." $told.Posts $told.Newest)
    Yes 'the 7:08 AM repeat is found, and named with the note that said it first' ($r.Count -eq 1 -and $r[0] -like '*Ready card*' -and $r[0] -like '*"A new launcher"*7:08 AM*')
    $r = @(Get-NoteRepeats "Immersive Armors recipes ask for the right things`n- Immersive Armors pieces at a forge now cost the same ingredients as the same kind of piece at its rank and metal, and no gold coins." $told.Posts $told.Newest)
    Yes 'the Ship after a deploy with the deploy''s note is refused, title and line' ($r.Count -eq 2 -and @($r | Where-Object { $_ -like '*the dev updates channel*' }).Count -eq 2)
    Yes 'a title said before is a repeat too' (@(Get-NoteRepeats "A new launcher`n- The shortcut no longer doubles." $told.Posts $null).Count -eq 1)
    Yes 'a note that is all new repeats nothing' (@(Get-NoteRepeats "Kilns stand by the forge`n- Charcoal kilns stand beside each forge now." $told.Posts $told.Newest).Count -eq 0)
    Yes 'a note whose only match is the publisher''s own line repeats nothing' (@(Get-NoteRepeats "The gallery opens faster`n- Launcher 1.2.6.6`n- The gallery opens on the newest picture." $told.Posts $told.Newest).Count -eq 0)
    Yes 'the newest release shipped again with its own note is not news, so not a repeat' (@(Get-NoteRepeats "Lighter gallery pictures`n- Pictures sent from the launcher's Gallery get smaller copies, so they load faster on the site." $told.Posts $told.Newest).Count -eq 0)
    Yes 'but the same title with a new line is checked' (@(Get-NoteRepeats "Lighter gallery pictures`n- Thumbnails come first." $told.Posts $told.Newest).Count -eq 1)

    # ---- the record keeps forty
    $many = @{}
    foreach ($i in 1..45) { Add-AnnouncedPost $many 'main' "Post number $i" @("Line $i of many") 'release' }
    Yes 'announced.json keeps the newest forty posts, newest first' (@($many['posts-main']).Count -eq 40 -and $many['posts-main'][0].title -eq 'Post number 45')

    # ---- the scripts run the check where nothing has been sent
    $ship = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Ship.ps1'))
    Yes 'Ship.ps1 checks for repeats after the note rules and before anything is built' ($ship.IndexOf('Get-NoteRepeats $Notes') -gt $ship.IndexOf('[Thornswood.ReleaseNotes.NoteRules]::Problems($Notes)') -and $ship.IndexOf('Get-NoteRepeats $Notes') -lt $ship.IndexOf("Check-Words.ps1'"))
    Yes 'and stops when the channel cannot be read' ($ship -match 'could not be read, so these notes cannot be checked for repeats')
    $dg = [IO.File]::ReadAllText((Join-Path $repo 'scripts\deploy\Deploy-DevGamemode.ps1'))
    Yes 'Deploy-DevGamemode.ps1 checks the note against the dev channel before anything is sent' ($dg.IndexOf('Get-NoteRepeats $Note') -gt 0 -and $dg.IndexOf('Get-NoteRepeats $Note') -lt $dg.IndexOf('$Gamemode = Join-Path'))
    Yes 'and -ShipFollows posts nothing' ($dg -match "elseif \(\`$deployed -and -not \`$PutBack\)" -and $dg -match "if \(\`$deployed -and \`$ShipFollows\)")
    $pd = [IO.File]::ReadAllText((Join-Path $repo 'scripts\ops\Publish-Discord.ps1'))
    Yes 'Publish-Discord.ps1 remembers a release''s lines and a gamemode deploy''s' ($pd -match "Add-AnnouncedPost \`$said \`$stateKey \`$saidTitle @\(\`$detailLines\) 'release'" -and $pd -match "Add-AnnouncedPost \`$said \`$stateKey \`$saidTitle @\(\`$detailLines\) 'gamemode'")

    # ---- the cleanup
    $clean = Join-Path $repo 'scripts\release\Clean-NewsRepeats.ps1'
    function Get-SiteDevFeed { [IO.File]::ReadAllText((Get-FeedVersionFile (Join-Path $site 'feed-dev'))) }
    $before = Get-SiteDevFeed
    $out = & $pwshExe -NoProfile -File $clean -Channel dev -Check -Dir (Join-Path $tmp 'work-dev') -NoPause 2>&1 | Out-String
    Yes '-Check names the two repeated lines and sends nothing' ($LASTEXITCODE -eq 0 -and ([regex]::Matches($out, 'would take out')).Count -eq 2 -and (Get-SiteDevFeed) -eq $before)
    $out = & $pwshExe -NoProfile -File $clean -Channel dev -Dir (Join-Path $tmp 'work-dev') -NoPause 2>&1 | Out-String
    $after = Get-SiteDevFeed | ConvertFrom-Json
    $l = @($after.news | Where-Object { $_.title -eq 'A new launcher' })[0]
    Yes 'the cleanup takes them out of the newer note' ($LASTEXITCODE -eq 0 -and @($l.details).Count -eq 2 -and @($l.details)[0] -like '*shortcut*')
    Yes 'and keeps its title, its launcher line, and the older note whole' (@($l.details)[1] -eq 'Launcher 1.2.6.5' -and @(@($after.news | Where-Object { $_.title -like 'Clearer*' })[0].details).Count -eq 4)
    Yes 'and the size line two notes share stays in both' (@(@($after.news | Where-Object { $_.title -eq 'Lighter gallery pictures' })[0].details) -contains '7 files to download, 28.9 MB')
    $out = & $pwshExe -NoProfile -File $clean -Channel dev -Dir (Join-Path $tmp 'work-dev') -NoPause 2>&1 | Out-String
    Yes 'a second run finds nothing' ($LASTEXITCODE -eq 0 -and $out -match 'repeats an older one, so nothing was sent')
} finally {
    Remove-Item Env:\THORNSWOOD_TEST_SITE_DIR -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host ''
Write-Host "$pass passed, $fail failed"
exit $(if ($fail) { 1 } else { 0 })
