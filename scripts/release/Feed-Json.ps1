<#
  Feed-Json.ps1

  The one way a channel's version.json is written (#1050).

      . (Join-Path $PSScriptRoot 'Feed-Json.ps1')

  Feed-Store.ps1 dot-sources it, so every script that receives and sends the
  feed has it. It is a file of its own so a harness that stands a stub in for
  Feed-Store.ps1 (to send nothing) still writes the feed the real way.

  Compact: no indentation and no line breaks. ConvertTo-Json without
  -Compress indents each level, which was about 960 of main's 7,789 bytes on
  12 Oct and meant nothing to the launcher, the site or any script, all of
  which parse it. -Depth 8 is the deepest any writer used, so no nested list is
  ever cut to its type name.

  No byte order mark: the launcher's reader stops on one and reports an
  unexpected character, which takes out the update check for everybody at
  once, including their route to a fix, and node refuses it too.

      ConvertTo-FeedJson $doc            the text
      Write-FeedVersionFile $path $doc   the file
      Join-FeedSettings $doc $feedUrl    the feed the site answers, whole
                                         again (below)

  tests\test-1050-feed-compact.ps1 holds every writer to it and parses what it
  writes with the launcher's own VersionDoc.Parse.

  Keep it ASCII. It runs in PowerShell 7.
#>

function ConvertTo-FeedJson($Doc) {
    return ($Doc | ConvertTo-Json -Depth 8 -Compress)
}

function Write-FeedVersionFile([string]$Path, $Doc) {
    if (-not $Path) { throw 'Write-FeedVersionFile needs the path of version.json.' }
    if ($null -eq $Doc) { throw "Write-FeedVersionFile was given no feed for $Path; nothing was written." }
    [IO.File]::WriteAllText($Path, (ConvertTo-FeedJson $Doc), (New-Object Text.UTF8Encoding($false)))
}

# ---- the feed the site answers, whole again (#1050) ------------------------
#
# The store keeps every feed whole. Once a channel's minLauncher reads the
# split (site\server.js feedView, launcher\app\FeedSettings.cs), what
# https://thornswood.net/feed[-dev]/version.json answers is the update fields
# alone, naming the rest of the feed as "settings": { sha256 }, an asset of
# its own, and every asset by its sha256 without its address. A script that
# reads the feed off the site, rather than out of the store, reads it through
# this, so it has the same document the store holds:
#
#     Join-FeedSettings $doc $feedUrl     the settings put back in, and every
#                                         asset's address the folder beside
#                                         the feed plus its sha256
#
# A feed with no "settings" comes back as it is. Throws when the settings
# cannot be had or their bytes do not hash to the name, because a feed
# without them has no server, voice or Skyrim pin in it. $Download, for a
# harness, takes an address and gives its bytes.

function Get-FeedAssetsFolder([string]$FeedUrl) {
    $u = ([string]$FeedUrl).Trim() -replace '[?#].*$', ''
    $i = $u.LastIndexOf('/')
    if ($i -lt 0 -or $u -notmatch '^https?://[^/]+/') { throw "The feed address $FeedUrl has no folder to find its assets in." }
    return $u.Substring(0, $i + 1) + 'assets/'
}

function Join-FeedSettings($Doc, [string]$FeedUrl, [scriptblock]$Download) {
    if ($null -eq $Doc -or -not $Doc.PSObject.Properties['settings']) { return $Doc }
    $sha = ''
    if ($null -ne $Doc.settings -and $Doc.settings.PSObject.Properties['sha256']) { $sha = ([string]$Doc.settings.sha256).ToLowerInvariant() }
    if ($sha -notmatch '^[0-9a-f]{64}$') { throw "The feed at $FeedUrl names its settings without a sha256, so the rest of it cannot be read." }
    $assets = Get-FeedAssetsFolder $FeedUrl
    if (-not $Download) {
        $Download = {
            param([string]$u)
            [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
            $wc = New-Object Net.WebClient
            $wc.Headers['User-Agent'] = 'Thornswood-Publish'
            try { return , $wc.DownloadData($u) } finally { $wc.Dispose() }
        }
    }
    [byte[]]$bytes = & $Download ($assets + $sha)
    $h = [Security.Cryptography.SHA256]::Create()
    try { $got = (($h.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '') } finally { $h.Dispose() }
    if ($got -ne $sha) { throw "The settings the feed at $FeedUrl names did not hash to their name ($sha), so they were not read." }
    $rest = ([Text.Encoding]::UTF8.GetString($bytes) -replace '^\uFEFF', '') | ConvertFrom-Json
    $o = [ordered]@{}
    foreach ($p in $Doc.PSObject.Properties) { if ($p.Name -ne 'settings') { $o[$p.Name] = $p.Value } }
    foreach ($p in $rest.PSObject.Properties) { if (-not $o.Contains($p.Name)) { $o[$p.Name] = $p.Value } }
    $whole = [pscustomobject]$o
    foreach ($pair in @(@('baseline', 'url', 'sha256'), @('newsFile', 'url', 'sha256'), @('clientRuntime', 'url', 'sha256'),
                        @('signedManifest', 'url', 'sha256'), @('signedManifest', 'catalogUrl', 'catalogSha256'))) {
        if (-not $whole.PSObject.Properties[$pair[0]]) { continue }
        $a = $whole.($pair[0])
        if ($null -eq $a -or -not $a.PSObject.Properties[$pair[2]]) { continue }
        $s = ([string]$a.($pair[2])).ToLowerInvariant()
        if ($s -notmatch '^[0-9a-f]{64}$') { continue }
        if ($a.PSObject.Properties[$pair[1]] -and [string]$a.($pair[1])) { continue }
        $a | Add-Member -NotePropertyName $pair[1] -NotePropertyValue ($assets + $s) -Force
    }
    return $whole
}
