<#
  Note-Repeats.ps1

      . (Join-Path $PSScriptRoot 'Note-Repeats.ps1')

  Whether a note tells a channel something it has already been told (#3320).

  WHY IT EXISTS. Patrick, 22 Oct 2026, 10:24 AM: "the news keeps adding
  duplicate lines from previous launcher and server build updates and not
  only what is new". Measured that morning:

    - The #staff-news was told "Immersive Armors recipes ask for the
      right things" and its two lines twice: at 9:45 AM by
      Deploy-DevGamemode -Note, and at 9:50 AM by the dev Ship that carried
      the same change to the launcher, with the same note. The run notes in
      the ops repo's ops\claude-queue had asked for exactly that (one $note for both).
    - The dev feed's 7:08 AM "A new launcher" said again two lines of the
      6:32 AM "Clearer launcher messages and a visible axe" (the Ready card,
      the Open Steam button), because the launcher those lines describe went
      out in the second release and its notes were written from the first.

  Nothing compared a note with what the channel had already said, so a
  repeat went out whenever a person wrote one. So the posts a channel has
  had are the record: the notes its feed carries (the launcher's News tab
  and the site), and every post Publish-Discord.ps1 has made to its Discord
  channel, gamemode deploys included (announced.json in the channel's VPS
  store, "posts-main" and "posts-dev"). A Ship or a dev gamemode deploy
  whose title or one of whose "- " lines is already there stops before
  anything is built or sent, and says where it was said.

  Lines the publisher writes itself are facts about each release (a launcher
  number, the download size, the load order warning) and are never compared.

      Get-NoteRepeatLines $Notes            the title and "- " lines of a note
      Get-NoteRepeats $Notes $Posts $Newest each line already said, and where
      Get-ChannelPosts $Channel             what the channel has been told
      Add-AnnouncedPost $said $key ...      records one Discord post
#>

. (Join-Path $PSScriptRoot 'Feed-Store.ps1')
. (Join-Path $PSScriptRoot 'Feed-News.ps1')

# The lines Publish-Update.ps1 and Publish-Server.ps1 add to an entry
# themselves. The same words recur on every release they are true of.
$NoteRepeatNoise = @(
    '^launcher \d+\.\d+',
    '^launcher rebuilt\s*:',
    '\bfiles? to download\b',
    '^nothing to download\b',
    '^the load order moved\b',
    '^mods added or updated\s*:',
    '^mods removed\s*:',
    '^under the hood\s*:',
    '^load order\s*:',
    '^the world was thrown away\b'
)

# One line as it is compared: no bullet, spaces and case not counted, and no
# full stop at the end, so "Saves keep." and "- saves keep" are one line.
function ConvertTo-NoteRepeatKey([string]$Line) {
    $t = ([string]$Line).Trim() -replace '^[-*•]\s*', ''
    $t = ($t -replace '\s+', ' ').Trim().ToLowerInvariant()
    return $t.TrimEnd('.', '!', ' ')
}

function Test-NoteRepeatNoise([string]$Key) {
    foreach ($p in $NoteRepeatNoise) { if ($Key -match $p) { return $true } }
    return $false
}

# The title and the "- " lines of a note, the way Publish-Update.ps1 reads
# them. A one-line note's title is its first sentence, as there.
function Get-NoteRepeatLines([string]$Notes) {
    $lines = @(([string]$Notes) -split "`r?`n")
    $title = (@($lines | Where-Object { $_.Trim() }) + @(''))[0].Trim()
    if (@($lines | Where-Object { $_.Trim() }).Count -eq 1) {
        $split = [regex]::Match($title, '^(.{1,70}?)(?:\.\s+)(.+)$', 'Singleline')
        if ($split.Success) { $title = $split.Groups[1].Value.Trim() }
    }
    $out = @()
    if ($title) { $out += $title }
    $seenTitle = $false
    foreach ($l in $lines) {
        if (-not $l.Trim()) { continue }
        if (-not $seenTitle) { $seenTitle = $true; continue }
        if ($l -match '^\s*[-*•]\s*(.+)$') { $out += $Matches[1].Trim() }
    }
    return $out
}

function Get-NoteRepeatField($o, [string]$k) {
    if ($null -eq $o) { return $null }
    if ($o -is [hashtable]) { return $o[$k] }
    $p = $o.PSObject.Properties[$k]
    if ($null -eq $p) { return $null }
    return $p.Value
}

# Each line of $Notes that a post in $Posts already has, as a sentence that
# names the post. $Posts is newest first; each has title, details and date,
# and "where" says where it was read. $Newest is the feed's newest note: a
# note whose title is its title and whose lines are all in it is that release
# shipped again (Publish-Update.ps1 adds no entry for it, Publish-Discord.ps1
# posts nothing for it), not news, so it repeats nothing.
function Get-NoteRepeats([string]$Notes, $Posts, $Newest) {
    $mine = @(Get-NoteRepeatLines $Notes | ForEach-Object { [pscustomobject]@{ Line = $_; Key = (ConvertTo-NoteRepeatKey $_) } } |
              Where-Object { $_.Key.Length -ge 8 -and -not (Test-NoteRepeatNoise $_.Key) })
    if ($null -ne $Newest -and $mine.Count) {
        $had = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
        [void]$had.Add((ConvertTo-NoteRepeatKey ([string](Get-NoteRepeatField $Newest 'title'))))
        foreach ($d in @(Get-NoteRepeatField $Newest 'details')) { [void]$had.Add((ConvertTo-NoteRepeatKey ([string]$d))) }
        if ((ConvertTo-NoteRepeatKey ([string](Get-NoteRepeatField $Newest 'title'))) -eq $mine[0].Key -and
            -not @($mine | Where-Object { -not $had.Contains($_.Key) }).Count) { return @() }
    }
    $said = @{}
    foreach ($p in @($Posts)) {
        if ($null -eq $p) { continue }
        $lines = @([string](Get-NoteRepeatField $p 'title')) + @(Get-NoteRepeatField $p 'details' | ForEach-Object { [string]$_ })
        foreach ($l in $lines) {
            $k = ConvertTo-NoteRepeatKey $l
            if ($k -and -not $said.ContainsKey($k)) { $said[$k] = $p }
        }
    }
    $out = @()
    foreach ($m in $mine) {
        if (-not $said.ContainsKey($m.Key)) { continue }
        $p = $said[$m.Key]
        $when = [string](Get-NoteRepeatField $p 'date')
        $where = [string](Get-NoteRepeatField $p 'where')
        $out += ('"{0}" was already said in "{1}"{2}{3}' -f $m.Line, [string](Get-NoteRepeatField $p 'title'),
                 $(if ($when) { ", $when" } else { '' }), $(if ($where) { ", $where" } else { '' }))
    }
    return $out
}

# Everything $Channel (main or dev) has been told, newest first, and its
# feed's newest note: @{ Posts; Newest }. The feed's notes as the site serves
# them (Read-SiteFeed, Get-FeedNewsList), then the Discord posts the channel's
# VPS store remembers. With -SiteDir (or $env:THORNSWOOD_TEST_SITE_DIR) both
# come from that folder. Throws when either cannot be read: a check that
# cannot see what was said cannot say a note is new.
function Get-ChannelPosts([string]$Channel, [string]$SiteDir, [string]$SiteUrl = 'https://thornswood.net') {
    $key = if ($Channel -eq 'dev') { 'dev' } else { 'main' }
    $posts = New-Object System.Collections.Generic.List[object]
    $newest = $null
    $doc = Read-SiteFeed $key $SiteDir $SiteUrl
    if ($null -ne $doc) {
        $first = $true
        foreach ($n in @(Get-FeedNewsList $doc (Get-FeedStoreSiteDir $SiteDir) $SiteUrl)) {
            if ($null -eq $n) { continue }
            if ($first) { $newest = $n; $first = $false }
            $posts.Add([pscustomobject]@{ title = [string](Get-NoteRepeatField $n 'title'); details = @(Get-NoteRepeatField $n 'details')
                                          date = [string](Get-NoteRepeatField $n 'date'); where = "the $key launcher's News" })
        }
    }
    $dir = & (Join-Path $PSScriptRoot 'Get-ScratchDir.ps1') ('thornswood-said-' + [Guid]::NewGuid().ToString('N'))
    try {
        $got = Receive-FeedStore $key -Dir $dir -Files @('announced.json') -SiteDir $SiteDir
        $f = Join-Path $dir 'announced.json'
        if ($got['announced.json'] -and (Test-Path -LiteralPath $f)) {
            $raw = ([IO.File]::ReadAllText($f) -replace "^$([char]0xFEFF)", '') | ConvertFrom-Json
            $p = $raw.PSObject.Properties['posts-' + $key]
            $where = if ($key -eq 'dev') { '#staff-news' } else { '#news' }
            if ($null -ne $p) {
                foreach ($x in @($p.Value)) {
                    if ($null -eq $x) { continue }
                    $posts.Add([pscustomobject]@{ title = [string](Get-NoteRepeatField $x 'title'); details = @(Get-NoteRepeatField $x 'details')
                                                  date = [string](Get-NoteRepeatField $x 'at'); where = $where })
                }
            }
        }
    } finally { Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue }
    return @{ Posts = $posts.ToArray(); Newest = $newest }
}

# The posts a channel's announced.json keeps, newest first.
$AnnouncedPostsKeep = 40

# Puts one Discord post at the top of $Said's "posts-<key>" list (the
# hashtable Publish-Discord.ps1 reads announced.json into), keeping the newest
# $AnnouncedPostsKeep. The title as it was written, without the "Dev build: "
# the post puts in front of it, and the lines the post carried.
function Add-AnnouncedPost([hashtable]$Said, [string]$Key, [string]$Title, [string[]]$Details, [string]$Kind) {
    $name = 'posts-' + $Key
    $list = @()
    if ($Said.ContainsKey($name) -and $null -ne $Said[$name]) { $list = @($Said[$name] | Where-Object { $null -ne $_ }) }
    $entry = [ordered]@{ at = (Get-Date).ToUniversalTime().ToString('s') + 'Z'; title = $Title; details = @($Details); kind = $Kind }
    $list = @($entry) + $list
    if ($list.Count -gt $AnnouncedPostsKeep) { $list = @($list[0..($AnnouncedPostsKeep - 1)]) }
    $Said[$name] = $list
}
