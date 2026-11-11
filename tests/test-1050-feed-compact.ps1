<#
  test-1050-feed-compact.ps1

      pwsh -NoProfile -File .\tests\test-1050-feed-compact.ps1

  version.json is written compact, by every script that writes it, and the
  launcher's own reader reads that the same as before (#1050).

  WHY THIS EXISTS. #1050 asks for a version.json of a few hundred bytes, read
  by every launcher on every check. Measured 12 Oct over https after main's
  1.2.4 Ship: main 7,789 bytes, of which about 960 was the indentation
  ConvertTo-Json writes without -Compress, and 2,569 the release record's
  "uiAssets", read by no launcher. Nine scripts wrote the file, each with its
  own ConvertTo-Json line, so one forgotten writer would put the indentation
  back on the next feed edit. Since #1050 they all go through one function,
  Write-FeedVersionFile in scripts\release\Feed-Json.ps1, which Feed-Store.ps1
  dot-sources. This proves:
    - no script under scripts\ writes a version.json any other way, and each
      of the ten known writers calls Write-FeedVersionFile
    - what it writes is one line of JSON with no byte order mark and no
      indentation, that reads back to the same feed, and keeps a release note
      with a line break, quotes, a backslash and letters outside ASCII
    - the release record New-ReleaseRecord makes carries no uiAssets
  The launcher read the file with VersionDoc.Parse until #5608, when it
  stopped reading the update feed: it updates from GitHub's Releases. The
  feed itself goes with the site side of #5608 (#5783). Nothing is sent
  anywhere; everything it writes is in its own temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's SDK and settings (#4823)
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

# The note the fixture's record pointer carries, and what the parse must give
# back: two lines, quotes, a backslash, an apostrophe and accented letters.
$Note = "Keys and deeds that name their house`n- A key looks like a key, ""not a mold"", in C:\Thornswood`n- Caf" + [char]0x00E9 + " owner" + [char]0x2019 + "s sign"
$NoteSha = ('97b1f3f31cc50e80c735c50ab80f7ac91086cfe4aa10e604d8ee41ed50c83362')
$NewsSha = ('0326733ddbbd921d59a0506d00cdf313cfb422de3263b9958133a37e09984b63')

# ============================================================================
# The PowerShell 7 half: every writer, the file it writes, the release record.
# ============================================================================
. (Join-Path $Repo 'scripts\release\Feed-Store.ps1')
. (Join-Path $Repo 'scripts\release\Release-Name.ps1')
Yes 'Feed-Store.ps1 brings the writer with it, from Feed-Json.ps1' (
    [bool](Get-Command Write-FeedVersionFile -ErrorAction SilentlyContinue) -and
    [IO.File]::ReadAllText((Join-Path $Repo 'scripts\release\Feed-Store.ps1')) -match "\. \(Join-Path \`$PSScriptRoot 'Feed-Json\.ps1'\)")

Write-Host 'every script that writes version.json goes through Write-FeedVersionFile'
# A version.json path is a variable set from Join-Path ... 'version.json'. Any
# write to one that is not Write-FeedVersionFile is a writer that would put
# the indentation (or a byte order mark) back.
$writers = @{}
$bad = @()
foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $Repo 'scripts') -Recurse -File -Filter '*.ps1')) {
    $text = [IO.File]::ReadAllText($f.FullName)
    # Named with \ whatever the machine, the way $known names them.
    $rel = $f.FullName.Substring($Repo.Length + 1).Replace([IO.Path]::DirectorySeparatorChar, '\')
    $vars = @([regex]::Matches($text, '\$(\w+)\s*=\s*Join-Path\s+[^\r\n]*?[''"]version\.json[''"]') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
    foreach ($n in $vars) {
        $e = [regex]::Escape($n)
        foreach ($pat in @(
                ('WriteAllText\(\s*\$' + $e + '\s*,'),
                ('WriteAllBytes\(\s*\$' + $e + '\s*,'),
                ('(Set-Content|Out-File|Add-Content)\s+(-LiteralPath\s+|-Path\s+|-FilePath\s+)?\$' + $e + '\b'),
                ('\bWriteJson\s+\$' + $e + '\b'))) {
            foreach ($m in [regex]::Matches($text, $pat)) {
                $line = ($text.Substring(0, $m.Index) -split "`n").Count
                $bad += ('{0}:{1}' -f $rel, $line)
            }
        }
        if ($text -match ('Write-FeedVersionFile\s+\$' + $e + '\b')) { $writers[$rel] = $true }
    }
}
Yes ('no script writes a version.json any other way' + $(if ($bad.Count) { ': ' + ($bad -join ', ') } else { '' })) ($bad.Count -eq 0)
$known = @(
    'scripts\release\Publish-Update.ps1', 'scripts\release\Rollback-Feed.ps1', 'scripts\release\Scrub-Feed.ps1',
    'scripts\release\Repair-Manifest.ps1', 'scripts\release\Publish-Server.ps1', 'scripts\release\Publish-Pack.ps1',
    'scripts\release\Dev-News.ps1', 'scripts\ops\Set-Server.ps1', 'scripts\ops\Set-Collection.ps1')
$notThrough = @($known | Where-Object { -not $writers.ContainsKey($_) })
Yes ('each of the {0} known writers calls it' -f $known.Count + $(if ($notThrough.Count) { ', not: ' + ($notThrough -join ', ') } else { '' })) ($notThrough.Count -eq 0)
# The detector itself, on a planted writer, so a pattern that matches nothing
# cannot pass by accident.
$planted = "`$vf = Join-Path `$d 'version.json'`n[IO.File]::WriteAllText(`$vf, (`$doc | ConvertTo-Json -Depth 6))"
$pv = [regex]::Match($planted, '\$(\w+)\s*=\s*Join-Path\s+[^\r\n]*?[''"]version\.json[''"]').Groups[1].Value
Yes '  and the check finds a planted indented writer' ($pv -eq 'vf' -and $planted -match ('WriteAllText\(\s*\$' + [regex]::Escape($pv) + '\s*,'))

Write-Host ''
Write-Host 'what it writes'
# The main feed of 12 Oct after 1.2.4, as the old writers read it back, with
# the release note made harder to keep, and a documentation address in place
# of the box's, which only vps.json may carry (test-vps-defaults.ps1).
$doc = @'
{
  "launcherVersion": "1.2.4",
  "launcherUrl": "https://thornswood.net/feed/assets/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "launcherSha256": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  "serverAddress": "203.0.113.7",
  "serverPort": "7777",
  "message": "",
  "packs": [],
  "news": [],
  "voicePort": "7778",
  "collectionUrl": "https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf",
  "maxOnline": 25,
  "mainVersion": "",
  "voiceUrl": "https://thornswood.net/voice",
  "discordAppId": "1549251507361292418",
  "siteUrl": "https://thornswood.net",
  "presenceImage": "https://thornswood.net/presence.png",
  "collectionRevision": 2,
  "clientRuntime": {
    "url": "https://thornswood.net/feed/assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bytes": 6598716,
    "forkCommit": "cdd84651",
    "notice": 1
  },
  "updateFeedUrl": "https://thornswood.net/feed/version.json",
  "expectedExeBytes": 37157144,
  "newerExeBytes": 37910440,
  "depots": [
    { "id": "489831", "manifest": "8442952117333549665" },
    { "id": "489832", "manifest": "8042843504692938467" },
    { "id": "489833", "manifest": "1914580699073641964" }
  ],
  "baseline": {
    "id": "20261012-115531",
    "sha256": "97b1f3f31cc50e80c735c50ab80f7ac91086cfe4aa10e604d8ee41ed50c83362",
    "url": "https://thornswood.net/feed/assets/97b1f3f31cc50e80c735c50ab80f7ac91086cfe4aa10e604d8ee41ed50c83362",
    "entries": 734,
    "notes": ""
  },
  "launcherInputs": "59f0feab87e971bd682644466acbf2d0aac80eb817a7b911bebbe8f257dab285",
  "minLauncher": "1.2.4",
  "release": {},
  "newsFile": {
    "url": "https://thornswood.net/feed/assets/0326733ddbbd921d59a0506d00cdf313cfb422de3263b9958133a37e09984b63",
    "sha256": "0326733ddbbd921d59a0506d00cdf313cfb422de3263b9958133a37e09984b63",
    "count": 40
  }
}
'@ | ConvertFrom-Json
$doc.baseline.notes = $Note
$doc.release = New-ReleaseRecord '20261012-115531' 'main' '1.2.4' @() '20261012-115531' ('e34bf423' + ('0' * 32)) 'hotfix/1.2.4' 0
Yes 'the release record New-ReleaseRecord makes carries no uiAssets' (-not $doc.release.PSObject.Properties['uiAssets'])

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-feed-compact-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
New-Item -ItemType Directory -Force -Path $T | Out-Null
try {
    $vf = Join-Path $T 'version.json'
    Write-FeedVersionFile $vf $doc
    $bytes = [IO.File]::ReadAllBytes($vf)
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    Yes 'no byte order mark' (-not ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF))
    Yes 'one line: no line break anywhere in the file' ($text -notmatch '[\r\n]')
    Yes 'no indentation: no white space at all outside the strings' (($text -replace '"(\\.|[^"\\])*"', '""') -notmatch '\s')
    $back = $text | ConvertFrom-Json
    Yes 'it reads back to the same feed' ((ConvertTo-Json $back -Depth 8 -Compress) -ceq (ConvertTo-Json $doc -Depth 8 -Compress))
    Yes '  and keeps the note exactly' ($back.baseline.notes -ceq $Note)
    $indented = [Text.Encoding]::UTF8.GetByteCount(($doc | ConvertTo-Json -Depth 8))
    Yes ('smaller than the indented file ({0:n0} bytes, was {1:n0})' -f $bytes.Length, $indented) ($bytes.Length -lt $indented)
    $nested = [pscustomobject]@{ a = [pscustomobject]@{ b = [pscustomobject]@{ c = [pscustomobject]@{ d = @(@{ e = 'deep' }) } } } }
    Write-FeedVersionFile (Join-Path $T 'deep.json') $nested
    Yes 'a list five levels down is written whole, not cut to its type name' ([IO.File]::ReadAllText((Join-Path $T 'deep.json')) -match '"e":"deep"')
    $threw = ''
    try { Write-FeedVersionFile (Join-Path $T 'none.json') $null } catch { $threw = $_.Exception.Message }
    Yes 'no feed is refused, with nothing written' ($threw -match 'no feed' -and -not (Test-Path -LiteralPath (Join-Path $T 'none.json')))

} finally {
    Remove-Item -LiteralPath $T -Recurse -Force -ErrorAction SilentlyContinue
}
Done
