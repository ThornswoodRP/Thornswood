<#
  Publish-Discord.ps1

  Posts the newest release into the Discord #news channel.

  Uses the webhook Build-Discord.py made, which is why this needs no bot
  running and no token: a webhook is a one way address into one channel and
  nothing else.

    .\Publish-Discord.ps1
    .\Publish-Discord.ps1 -Quiet
    .\Publish-Discord.ps1 -Dev
    .\Publish-Discord.ps1 -DryRun
    .\Publish-Discord.ps1 -Dev -Note "..." -GamemodeDeploy
    .\Publish-Discord.ps1 -Dev -Record      say the current dev release WAS announced, post nothing

  -DryRun prints what it would post and sends nothing.

  -Note posts the text given, instead of reading the newest release from a
  feed. Deploy-DevGamemode.ps1 uses this after a gamemode-only change, which
  has no release for Ship to announce. -GamemodeDeploy goes with -Dev -Note:
  the footer is "dev server", the title is not prefixed, and announced.json
  is not consulted, because every deploy is its own announcement.

  IT REMEMBERS WHAT IT SAID, LINE BY LINE (#3320). Every post, a release or
  a gamemode deploy, goes into announced.json as "posts-main" or "posts-dev"
  (its title and lines, the newest forty), and Ship.ps1 and
  Deploy-DevGamemode.ps1 refuse a note that says one of them again
  (Note-Repeats.ps1). A gamemode deploy whose record cannot be read still
  posts, as it always did, and says the record was not written.

  IT REMEMBERS WHAT IT POSTED. Until 23 September this script always posted
  whatever was newest in the feed and had no idea it had posted it before, so
  running it twice, or running it days after a release to see what it does,
  announced that release again to everybody. It now writes the version and
  the title it posted into announced.json and refuses to say the same thing
  twice. -Force is how a post that really does need repeating is made, and it
  is the only way.

  WHERE THAT RECORD LIVES (#2167). Until 11 October it was bot\announced.json
  in the checkout that ran this, so a post made from a worktree Ship was
  unknown to every other checkout, and the record went when the worktree did.
  It is now announced.json in the channel's VPS store beside the feed
  (C:\Thornswood-Docs\feed\announced.json and feed-dev\announced.json, not
  served by the site), read and written through Feed-Store.ps1 like the feed
  itself: received into %LOCALAPPDATA%\Thornswood\feed\announced-<channel>,
  and sent back only if nobody else changed it meanwhile. When the store
  cannot be read, nothing is posted (the record cannot say it was not posted
  already); -Force posts anyway. While the store has no record yet, an old
  bot\announced.json in this checkout is still read, never written.
  -Record writes the current release into the store as announced and posts
  nothing: for a post that went out from a checkout whose record was lost.

  Called by Ship.ps1 at the end of every release, so it is usually not run on
  its own. If bot\news-webhook.txt is not there it does nothing and
  says so quietly, so a machine without the Discord set up still ships fine.

  -Dev is the dev build's release, and it is a different channel, a different
  feed and a different webhook. It reads this machine's working copy of the
  dev feed (%LOCALAPPDATA%\Thornswood\feed\dev, Feed-Store.ps1) rather than
  the live one, and it posts through
  bot\dev-webhook.txt, which Set-DevNews.ps1 writes and which points
  at the dev updates channel. Nothing about a dev release reaches #news, the
  website or the main launcher: the site's News page reads the main feed only
  (#5187), and a dev publish only ever writes the dev feed, which only the dev
  launcher reads.

  Two things this used to get wrong, both visible in the channel:

  A webhook post does not inherit the application's avatar. Without an
  avatar_url every release arrived under the plain blue Discord mark while the
  bot's own messages, right above it in the same channel, carried the
  Thornswood logo.

  And it posted the detail lines raw. The launcher's feed is a developer's
  changelog, so the first bullet under a release title was "Launcher 1.0.197",
  which the embed already says in its footer. The site's News page strips
  those (NEWS_NOISE in site/server.js, #5187; Publish-News.ps1 did before it).
  The same list is stripped here; tests\test-public-news.ps1 holds the two
  lists together.
#>
[CmdletBinding()]
param(
  # The dev build's release, into the dev updates channel. See the note above.
  [switch]$Dev,
  # Print the post and send nothing.
  [switch]$DryRun,
  # Post it even though this exact release has been announced already. For a
  # post that was deleted, or a channel that was cleared.
  [switch]$Force,
  # Where the LIVE version.json is. Publish-News.ps1, now retired (#5187),
  # read it from here for the same reason: releases moved into their own public repo, and the copy still sitting in
  # this repo stopped being updated the day that happened. Reading the stale
  # one would post a release nobody shipped. Since #907 it is this machine's
  # working copy of the live feed, which the Ship that runs this has just
  # received from the VPS and sent back (Feed-Store.ps1).
  [string]$ReleaseDir = (& (Join-Path $PSScriptRoot '..\release\Where.ps1') Releases),
  [string]$Site = 'https://thornswood.net',
  [switch]$Quiet,
  # Post this note instead of reading a feed. The first line is the title, "- "
  # lines are details, and the rest is the body, the same shape Ship takes.
  [string]$Note = '',
  # A gamemode-only dev deploy: footer "dev server", no "Dev build:" prefix,
  # and no announced.json check. Issue #594.
  [switch]$GamemodeDeploy,
  # Write the current release into the shared record as announced, post nothing.
  [switch]$Record
)
$ErrorActionPreference = 'Stop'   # before any file loads, so one that is missing stops here (#3006)
. (Join-Path $PSScriptRoot '..\release\Read-JsonFile.ps1')   # ConvertFrom-ThornswoodJson: a bad JSON file named

# Ship.ps1 runs under strict mode, and reaching for a property a JSON object
# simply does not have throws there rather than returning nothing. A news entry
# written without a file list has no 'files' property at all, so reading it
# straight off the object took the whole post down with "The property 'files'
# cannot be found on this object", while the same script run on its own worked.
# Publish-News.ps1, retired by #5187, had these two for the same reason. Every
# property on a news entry is read through them.
function Prop($obj, $name) {
  if ($null -eq $obj) { return '' }
  $p = $obj.PSObject.Properties[$name]
  if ($null -eq $p) { return '' }
  return [string]$p.Value
}
function PropList($obj, $name) {
  if ($null -eq $obj) { return @() }
  $p = $obj.PSObject.Properties[$name]
  if ($null -eq $p) { return @() }
  return @($p.Value)
}

function Get-ThornswoodDiscordNoise {
  return @(
    '^\s*Launcher rebuilt\s*:',
    '^\s*Launcher \d+\.\d+',
    'files? to download',
    '[\\/](SKSE|Data|tools)[\\/]',
    '^\s*Load order\s*:',
    '^\s*The gamemode was rebuilt\b'
  )
}

function Split-ThornswoodNote([string]$Notes) {
  $lines = @($Notes -split "`r?`n")
  $title = (@($lines | Where-Object { $_.Trim() }) + @(''))[0].Trim()
  $details = @($lines | Where-Object { $_ -match '^\s*-\s*\S' } | ForEach-Object { ($_ -replace '^\s*-\s*', '').Trim() })
  $bodyLines = New-Object System.Collections.Generic.List[string]
  $seenTitle = $false
  foreach ($line in $lines) {
    if (-not $line.Trim()) { continue }
    if (-not $seenTitle) { $seenTitle = $true; continue }
    if ($line -match '^\s*-\s*\S') { continue }
    $bodyLines.Add($line)
  }
  return @{
    Title   = $title
    Details = $details
    Body    = ($bodyLines -join "`n").Trim()
  }
}

function Format-ThornswoodDiscordText([string[]]$detailLines, [string]$body, [string[]]$noise) {
  $lines = @()
  foreach ($d in @($detailLines)) {
    $line = ([string]$d).TrimEnd()
    if (-not $line.Trim()) { $lines += ''; continue }
    if ($noise | Where-Object { $line -match $_ }) { continue }
    $lines += $line
  }

  $sb = New-Object Text.StringBuilder
  $prevBlank = $true
  foreach ($line in $lines) {
    if (-not $line.Trim()) {
      if (-not $prevBlank) { [void]$sb.Append("`n") }
      $prevBlank = $true
      continue
    }
    $prevBlank = $false

    if ($line -cmatch '^[A-Z][A-Z0-9 ,''&.\-]{3,}$') {
      [void]$sb.Append("`n**" + $line.TrimEnd('.') + "**`n")
      continue
    }
    $m = [regex]::Match($line, '^([A-Z][A-Z0-9 ,''&\-]{3,})\.\s+(.*)$')
    if ($m.Success) {
      [void]$sb.Append("`n**" + $m.Groups[1].Value + "**`n" + $m.Groups[2].Value + "`n")
      continue
    }
    [void]$sb.Append('- ' + $line + "`n")
  }

  $text = ($sb.ToString() -replace "`n{3,}", "`n`n").Trim()
  if (-not $text) { $text = $body.Trim() }
  return $text
}

function Split-ThornswoodDiscordDescription([string]$text) {
  $first = ''
  $second = ''
  $over = $false
  if ($text.Length -le 3900) {
    $first = $text
  } else {
    $cut = $text.Substring(0, 3900)
    $at = $cut.LastIndexOf("`n")
    if ($at -gt 500) { $cut = $cut.Substring(0, $at) }
    $first = $cut.TrimEnd()
    $rest = $text.Substring($first.Length).TrimStart()
    if ($rest.Length -le 1900) {
      $second = $rest
    } else {
      $cut2 = $rest.Substring(0, 1900)
      $at2 = $cut2.LastIndexOf("`n")
      if ($at2 -gt 300) { $cut2 = $cut2.Substring(0, $at2) }
      $second = $cut2.TrimEnd()
      $over = $true
    }
  }
  return @{ First = $first; Second = $second; Over = $over }
}

$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }

# A dev release is announced somewhere else entirely, through a webhook of its
# own, so there is no way for one to arrive in #news by accident.
# Both live on the VPS since 25 September, read through Discord-Hook.ps1, which
# falls back to bot\dev-webhook.txt or bot\news-webhook.txt on this machine. Until then this read
# only that file, and since the scripts moved into scripts\ops it looked for it
# in scripts\bot, which does not exist, so no Ship posted anything at all.
# There is no -Webhook any more (issue #1069): a webhook typed on the command
# line stays in the shell's history file, and this is the one place it is
# read from.
$hookName = if ($Dev) { 'dev' } else { 'news' }
$Webhook = ''
try { $Webhook = [string](& (Join-Path $Here 'Discord-Hook.ps1') -Name $hookName | Select-Object -First 1) } catch { $Webhook = '' }
if (-not $Webhook) {
  if (-not $Quiet) {
    if ($Dev) {
      Write-Host '  no dev webhook set up, the dev updates channel was not told' -ForegroundColor DarkGray
      Write-Host '  .\scripts\ops\Set-DevNews.ps1 points it at that channel' -ForegroundColor DarkGray
    } else {
      Write-Host '  no Discord webhook set up, skipping' -ForegroundColor DarkGray
    }
  }
  return
}

if ($GamemodeDeploy -and -not $Note) { throw '-GamemodeDeploy needs -Note.' }
if ($GamemodeDeploy -and -not $Dev) { throw '-GamemodeDeploy is only for the dev updates channel.' }

$logo = "$Site/logo.png"
# Who the post is from. Said once, used in three places.
$devName = if ($Dev) { 'Thornswood dev' } else { 'Thornswood' }
$noise = @(Get-ThornswoodDiscordNoise)
$v = $null
$n = $null
$title = ''
$body = ''
$detailLines = @()
$count = 0
$date = ''

if ($Note) {
  $parts = Split-ThornswoodNote $Note
  $title = $parts.Title
  $body = $parts.Body
  $detailLines = @($parts.Details)
} else {
  # The dev build has its own feed, in its own working folder beside the live
  # one. Reading the live one here would announce main's last release into the
  # dev channel every time a dev build went out.
  if ($Dev -and -not $PSBoundParameters.ContainsKey('ReleaseDir')) {
    $ReleaseDir = Join-Path (Split-Path -Parent $ReleaseDir) 'dev'
  }

  # The live feed only. This repository's own version.json, the stale copy this
  # used to fall back to, was deleted on 25 September.
  $vf = Join-Path $ReleaseDir 'version.json'
  if (-not (Test-Path -LiteralPath $vf)) {
    if (-not $Quiet) { Write-Host "  no version.json in $ReleaseDir, nothing posted" -ForegroundColor DarkGray }
    return
  }

  # A byte order mark is not JSON and ConvertFrom-Json stops on the first
  # character, which is the trap that has bitten every other reader of this file.
  $v = ConvertFrom-ThornswoodJson (Get-Content $vf -Raw) $vf
  # The newest note, wherever the feed keeps them: "news", or the news file it
  # names once every launcher it lets in reads one (Feed-News.ps1, #1050).
  . (Join-Path $PSScriptRoot '..\release\Feed-News.ps1')
  $n = @(Get-FeedNewsList $v $env:THORNSWOOD_TEST_SITE_DIR)[0]
  if (-not $n) { if (-not $Quiet) { Write-Host '  nothing to post' }; return }

  $title = Prop $n 'title'
  $body = (Prop $n 'body').Trim()
  $detailLines = @(PropList $n 'details')
  $count = @(PropList $n 'files').Count
  $date = Prop $n 'date'
}

$text = Format-ThornswoodDiscordText $detailLines $body $noise
$split = Split-ThornswoodDiscordDescription $text
$first = $split.First
$second = $split.Second
$over = $split.Over

# The else has to sit on the closing brace. PowerShell treats a newline in
# front of it as the end of the statement and then fails on a stray else.
# The website's news page is main's list. A dev release is not on it and never
# will be, so a dev post links to nothing rather than to somewhere wrong.
$tail = if ($Dev) {
  if ($over) { "`n`n(the rest is in the dev launcher's News tab)" } else { '' }
} elseif ($over) { "`n`n[Read the rest on the website]($Site/news)" }
  else { "`n`n[Every release]($Site/news)" }
if ($second) { $second += $tail } else { $first += $tail }

# Built from a char code rather than typed in, because a .ps1 saved without a
# byte order mark is read as ANSI by Windows PowerShell and a middle dot typed
# straight into the file comes out the other end as something else.
$dot = [string][char]0x00B7
if ($GamemodeDeploy) {
  $foot = 'dev server'
} else {
  $foot = $(if ($Dev) { 'dev build ' } else { 'launcher ' }) + (Prop $v 'launcherVersion')
  if ($date)  { $foot += "  $dot  $date" }
  if ($count) { $foot += "  $dot  $count file$(if ($count -ne 1) {'s'}) changed" }
}

# Said in the title as well as the footer. The dev channel is the one place
# the two builds' notes could ever be taken for each other. A gamemode-only
# deploy is not a dev build release, so it keeps the title as written.
$saidTitle = $title
if ($Dev -and -not $GamemodeDeploy) { $title = 'Dev build: ' + $title }
if ($title.Length -gt 250) { $title = $title.Substring(0, 247) + '...' }

# ------------------------------------------------------------- said before?
# Keyed by channel, because a dev release and a main release are different
# announcements of different versions and the dev feed is shared between both
# machines. The version alone is not enough on its own: a dev build can be
# reshipped under the same number with a different note, and that note is
# worth saying. The pair is what gets remembered. Gamemode deploys are not
# releases and are never deduped here.
if ($Record -and $GamemodeDeploy) { Write-Host '  -Record is for releases; a gamemode deploy is never remembered. Nothing done.' -ForegroundColor Yellow; return }
. (Join-Path $Here '..\release\Note-Repeats.ps1')   # Add-AnnouncedPost: every post's lines, for the repeat check (#3320)
$stateRead = $false
if ($GamemodeDeploy) {
  # Never gated on the record, as before; only remembered in it (#3320).
  . (Join-Path $Here '..\release\Feed-Store.ps1')
  $stateKey = 'dev'
  $stateDir = Join-Path (Split-Path -Parent (Get-FeedStoreDir $stateKey)) ('announced-' + $stateKey)
  $stateFile = Join-Path $stateDir 'announced.json'
  $said = @{}
  try {
    $got = Receive-FeedStore $stateKey -Dir $stateDir -Files @('announced.json')
    if ($got['announced.json'] -and (Test-Path -LiteralPath $stateFile)) {
      $raw = ([IO.File]::ReadAllText($stateFile) -replace '^\uFEFF', '') | ConvertFrom-Json
      foreach ($p in $raw.PSObject.Properties) { $said[$p.Name] = $p.Value }
    }
    $stateRead = $true
  } catch {
    if (-not $Quiet) { Write-Host ('  could not read the shared record, so this post will not be remembered in it: ' + $_.Exception.Message) -ForegroundColor Yellow }
  }
  # Writes this post into the record and sends it to the store. Returns '' or why it could not.
  function Save-ThornswoodAnnouncedPost {
    if (-not $stateRead) { return 'the shared record was never read' }
    try {
      Add-AnnouncedPost $said $stateKey $saidTitle @($detailLines) 'gamemode'
      [IO.File]::WriteAllText($stateFile, ($said | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
      $null = Send-FeedStore $stateKey -Dir $stateDir -Files @('announced.json')
      return ''
    } catch { return $_.Exception.Message }
  }
}
if (-not $GamemodeDeploy) {
  # The shared record, in the channel's VPS store (#2167). See the note above.
  . (Join-Path $Here '..\release\Feed-Store.ps1')
  $stateKey = if ($Dev) { 'dev' } else { 'main' }
  $stateDir = Join-Path (Split-Path -Parent (Get-FeedStoreDir $stateKey)) ('announced-' + $stateKey)
  $stateFile = Join-Path $stateDir 'announced.json'
  $said = @{}
  try {
    $got = Receive-FeedStore $stateKey -Dir $stateDir -Files @('announced.json')
    $stateRead = $true
  } catch {
    if (-not $Force) {
      Write-Host ('  COULD NOT READ what was already announced from the VPS store, so nothing was posted: ' + $_.Exception.Message) -ForegroundColor Red
      Write-Host '  -Force posts anyway' -ForegroundColor DarkGray
      $global:ThornswoodDiscordResult = 'failed'
      if ($Record) { exit 1 }
      return
    }
    if (-not $Quiet) { Write-Host '  could not read the shared record, -Force given, going ahead' -ForegroundColor Yellow }
  }
  $from = $stateFile
  if ($stateRead -and -not $got['announced.json']) {
    # Nothing in the store yet: an old per-checkout record still counts, read only.
    $legacy = Join-Path $Here '..\..\bot\announced.json'
    $from = if (Test-Path -LiteralPath $legacy) { $legacy } else { '' }
  }
  if ($from -and (Test-Path -LiteralPath $from)) {
    # A record that will not parse says nothing about what was posted, the
    # same as one that could not be fetched, so it stops here the same way.
    # Read as empty, it posted the release again and then wrote over the
    # record (#2645). The Ship goes on either way; only the post waits.
    try {
      $raw = ([IO.File]::ReadAllText($from) -replace '^\uFEFF', '') | ConvertFrom-Json
      foreach ($p in $raw.PSObject.Properties) { $said[$p.Name] = $p.Value }
    } catch {
      if (-not $Force) {
        Write-Host ('  COULD NOT READ what was already announced, ' + $from + ' will not parse, so nothing was posted: ' + $_.Exception.Message) -ForegroundColor Red
        Write-Host '  -Force posts anyway and writes the record again' -ForegroundColor DarkGray
        $global:ThornswoodDiscordResult = 'failed'
        if ($Record) { exit 1 }
        return
      }
      if (-not $Quiet) { Write-Host '  announced.json will not parse, -Force given, going ahead and writing it again' -ForegroundColor Yellow }
    }
  }
  # Writes this release into the record and sends it to the store. Returns ''
  # or why it could not. -Posted also remembers the post's lines (#3320);
  # -Record says a release was announced and has no lines of its own to add.
  function Save-ThornswoodAnnounced([switch]$Posted) {
    if (-not $stateRead) { return 'the shared record was never read' }
    try {
      $said[$stateKey] = @{ stamp = $stamp; version = (Prop $v 'launcherVersion')
                            title = $title; at = (Get-Date).ToUniversalTime().ToString('s') + 'Z' }
      if ($Posted) { Add-AnnouncedPost $said $stateKey $saidTitle @($detailLines) 'release' }
      [IO.File]::WriteAllText($stateFile, ($said | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
      $null = Send-FeedStore $stateKey -Dir $stateDir -Files @('announced.json')
      return ''
    } catch { return $_.Exception.Message }
  }
  $stamp = (Prop $v 'launcherVersion') + '|' + $title
  if ($said.ContainsKey($stateKey) -and (Prop $said[$stateKey] 'stamp') -eq $stamp -and -not $Force) {
    if (-not $Quiet) {
      Write-Host ('  already announced ' + (Prop $v 'launcherVersion') + ' in ' +
                  $(if ($Dev) { 'the dev updates channel' } else { '#news' }) +
                  ', nothing posted') -ForegroundColor DarkGray
      Write-Host '  -Force says it again anyway' -ForegroundColor DarkGray
    }
    $global:ThornswoodDiscordResult = 'already'
    return
  }
  if ($Record) {
    if ($DryRun) { Write-Host ('  -DryRun: would record ' + (Prop $v 'launcherVersion') + ' as announced, nothing posted') -ForegroundColor Yellow; return }
    $why = Save-ThornswoodAnnounced
    # Exit 1 when it could not (#2645): -Record is typed by a person or run by
    # a script that reads the exit code, and it used to exit 0 either way.
    if ($why) { Write-Host "  could not record it: $why" -ForegroundColor Red; $global:ThornswoodDiscordResult = 'failed'; exit 1 }
    else { Write-Host ('  recorded ' + (Prop $v 'launcherVersion') + ' as announced in the shared record, nothing posted'); $global:ThornswoodDiscordResult = 'recorded' }
    return
  }
}

$last = @{
  description = $(if ($second) { $second } else { $first })
  # Gold for the release everybody gets, a colder blue for the dev build, so
  # the two are never taken for each other at a glance.
  color       = $(if ($Dev) { 5477574 } else { 13214795 })
  footer      = @{ text = $foot; icon_url = $logo }
  timestamp   = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
}

if ($second) {
  $embeds = @(
    @{
      author      = @{ name = $devName; url = $Site; icon_url = $logo }
      title       = $title
      url         = "$Site/news"
      description = $first
      color       = $(if ($Dev) { 5477574 } else { 13214795 })
      thumbnail   = @{ url = $logo }
    },
    $last
  )
} else {
  $last['author']    = @{ name = $devName; url = $Site; icon_url = $logo }
  $last['title']     = $title
  $last['url']       = "$Site/news"
  $last['thumbnail'] = @{ url = $logo }
  $embeds = @($last)
}

$payload = @{
  username   = $devName
  # Without this a webhook posts under the plain blue Discord mark, whatever
  # avatar the application itself has.
  avatar_url = $logo
  embeds     = $embeds
} | ConvertTo-Json -Depth 8

if ($DryRun) {
  Write-Host ''
  Write-Host "  would post to $(if ($Dev) { 'the dev updates channel' } else { '#news' }): $title" -ForegroundColor Yellow
  Write-Host '  ---' -ForegroundColor DarkGray
  foreach ($e in $embeds) {
    ($e.description -split "`n") | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
  }
  Write-Host '  ---' -ForegroundColor DarkGray
  Write-Host "  $foot" -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  -DryRun, so nothing was sent.' -ForegroundColor Yellow
  return
}

try {
  Invoke-RestMethod -Uri $Webhook -Method Post -ContentType 'application/json' `
    -Body ([Text.Encoding]::UTF8.GetBytes($payload)) | Out-Null
  if (-not $Quiet) { Write-Host "  posted to Discord: $title" }
  $global:ThornswoodDiscordResult = 'posted'
  # AFTER the post returns and never before. A file written first turns a
  # failed post into a release nobody is ever told about, because the next
  # run would read it and refuse. A gamemode deploy is not a release: only
  # its lines are remembered, for the repeat check (#3320).
  if (-not $GamemodeDeploy) {
    $why = Save-ThornswoodAnnounced -Posted
    if ($why) {
      Write-Host "  posted, but could not write the shared announced record: $why" -ForegroundColor Yellow
      Write-Host ('  record it with: .\scripts\ops\Publish-Discord.ps1' + $(if ($Dev) { ' -Dev' } else { '' }) + ' -Record') -ForegroundColor Yellow
    }
  } else {
    $why = Save-ThornswoodAnnouncedPost
    if ($why) { Write-Host "  posted, but its lines are not in the shared record, so a later note may say them again unchecked: $why" -ForegroundColor Yellow }
  }
} catch {
  # Said in colour and said again by Ship at the end. A release whose
  # announcement failed is a release nobody knows about, and a grey line in
  # the middle of a long log is a line nobody reads.
  Write-Host "  COULD NOT POST TO DISCORD: $_" -ForegroundColor Red
  $global:ThornswoodDiscordResult = 'failed'
}
