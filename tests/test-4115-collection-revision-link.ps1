<#
  test-4115-collection-revision-link.ps1

  Every collection button opens the revision the server was built against,
  and a copy ahead of the server is told it has nothing to install (#4115).

  WHY THIS EXISTS. On 30 October Nexus was on collection revision 5 and both
  feeds named revision 2. Every button to the collection opened the feed's
  collectionUrl, the collection's own page with no revision in it, so Nexus
  showed revision 5 and Vortex installed it. Following the "your mods need
  updating" card, or installing fresh, took a copy straight past the server,
  and Play shut again on the ahead card, under INSTALL THE MODS FIRST and a
  tooltip saying to open the collection, which cannot help. The update log
  said "The collection is not installed yet" for all three cases.

  What it checks:
    - Checks.CollectionRevisionUrl makes .../collections/<slug>/revisions/<N>
      from the configured address and the feed's revision, and leaves the
      address as it is with no revision or no collection in it (built the
      way the project builds, with the .NET 10 SDK, and run, on any system);
    - no button, card or box in the launcher opens cfg.CollectionUrl as it
      stands: each goes through OpenCollection, whose page is CollectionLink;
    - the ahead state has its own Play label and tooltip, saying nothing
      needs installing, and no install button on the bar or the Diagnostics
      card, and a press that slips in opens nothing;
    - the stale and not-installed labels and the button name the revision;
    - the update log and Play's own refusal say which case holds updates;
    - the join guide says to install the revision the launcher opens (the
      installer's READ ME FIRST.txt said it until #4824);
    - the site's News page links the feed's revision for the Downloads page
      (#5187: the site writes it from the feed itself), the
      site's public answer carries the number, and the Downloads button,
      join.md and help.md name it, help.md with a section for a copy ahead.

  Prints PASS or FAIL per check and exits 1 when any check fails.
#>
param([string]$Scratch)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')
$repo = Split-Path -Parent $PSScriptRoot
# The site is server.js over its modules in site\lib since #5357.
. (Join-Path $PSScriptRoot 'SiteFiles.ps1')
$app = Join-Path $repo 'launcher\app'
function Src([string]$name) { [IO.File]::ReadAllText((Join-Path $app $name)).Replace("`r", '') }

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host ('PASS  ' + $what) }
    else { $script:fail++; Write-Host ('FAIL  ' + $what) }
}
function Method([string]$text, [string]$signature) {
    $start = $text.IndexOf($signature)
    if ($start -lt 0) { return '' }
    $at = $text.IndexOf('{', $start); $depth = 1; $end = $at + 1
    while ($depth -gt 0 -and $end -lt $text.Length) {
        if ($text[$end] -eq '{') { $depth++ }
        if ($text[$end] -eq '}') { $depth-- }
        $end++
    }
    return $text.Substring($start, $end - $start)
}

$checks = Src 'Checks.cs'
$shell = Src 'Shell.cs'
$packs = Src 'ShellPacks.cs'
$play = Src 'ShellPlay.cs'
$update = Src 'ShellUpdate.cs'
$all = $shell + $packs + $play + $update

# ---- where the buttons go ---------------------------------------------------
$urlMethod = Method $checks 'public static string CollectionRevisionUrl(Config cfg, int revision)'
Yes 'Checks.CollectionRevisionUrl exists' ($urlMethod.Length -gt 0)
Yes 'it builds the revision page from the slug' ($urlMethod.Contains('"/revisions/" + revision') -and $urlMethod.Contains('CollectionSlug(cfg)'))
$link = Method $shell 'static string CollectionLink()'
Yes 'Shell.CollectionLink opens the feed''s revision' ($link.Contains('Checks.CollectionRevisionUrl(cfg, Updater.FeedCollectionRevision)'))
Yes 'nothing opens the bare collection address any more' (-not ([regex]::IsMatch($all, 'ProcessStartInfo\(cfg\.CollectionUrl\)')))
# Since #5200 each button is OpenCollection, which opens Vortex at the same
# revision where Vortex answers Nexus links, and CollectionLink otherwise
# (test-5200-collection-in-vortex.ps1).
$open = Method $shell 'static void OpenCollection()'
Yes 'the bar''s button, the missing-mods box and the cards open the revision, through OpenCollection' (
    ([regex]::Matches($update, 'OpenCollection\(\);')).Count -eq 1 -and
    ([regex]::Matches($play, 'OpenCollection\(\);')).Count -eq 1 -and
    $packs.Contains('b.Click += delegate { OpenCollection(); };') -and
    $open.Contains('string page = CollectionLink();') -and
    -not ([regex]::IsMatch($update + $play + $packs, 'ProcessStartInfo\((CollectionLink\(\)|url)\)')))
$buttonText = Method $shell 'static string CollectionButtonText()'
Yes 'the button names the revision it opens' ($buttonText.Contains('"Open revision " + wants'))

# ---- ahead ------------------------------------------------------------------
$bar = Method $shell 'static void ShowCollectionBar(int revision = -1)'
Yes 'the ahead card says nothing needs installing' ($bar.Contains('nothing needs installing'))
# Since #3201 the card's button above Play and Settings' are one handler with
# one label and one visibility, in ShellUpdate.cs (InstallNowPressed, InstallShown).
Yes 'the ahead card has no install button' ($bar.Contains('InstallShown(problem != "ahead");') -and
    $update -match '(?s)static void InstallShown\(bool shown\)\s*\{\s*if \(btnInstallNow != null\) btnInstallNow\.IsVisible = shown;\s*if \(btnUpdate != null\) btnUpdate\.IsVisible = shown;')
$click = Method $update 'static void InstallNowPressed()'
Yes 'a press on the bar''s button while ahead opens nothing' ($click.Contains('if (collectionBarUp && CollectionProblem() == "ahead") return;'))
$draw = Method $shell 'static bool DrawStatus()'
$aheadAt = $draw.IndexOf('CollectionProblem(collectionRevision) == "ahead"')
$installAt = $draw.IndexOf('"INSTALL THE MODS FIRST"')
Yes 'Play has its own label for ahead, ahead of the install label' ($aheadAt -gt 0 -and $installAt -gt $aheadAt -and $draw.Contains('btnPlay.Content = "WAITING FOR THE SERVER";'))
Yes 'its tooltip says nothing needs installing' ($draw.Substring([Math]::Max(0, $aheadAt), 700).Contains('Nothing needs installing.'))
Yes 'a copy behind reads UPDATE THE MODS FIRST' ($draw.Contains('== "stale" ? "UPDATE THE MODS FIRST" : "INSTALL THE MODS FIRST"'))
Yes 'Play is still enabled by the same test' ($draw.Contains('btnPlay.IsEnabled = all && !playing && !updatePending && !collectionBarUp && !ownGameBusy && !working && feedNotice.Hold == null;'))
$status = Method $packs 'static Control CollectionStatusCard()'
Yes 'the Diagnostics ahead card has no button' ($status.Contains('installing; Play opens once the server is rebuilt on your revision.", false);'))
Yes 'CollectionCard leaves the button out when asked' ((Method $packs 'static Control CollectionCard(string title, string body, bool button = true)').Contains('if (button)'))

# ---- why updates wait -------------------------------------------------------
$wait = Method $shell 'static string[] CollectionWait()'
Yes 'CollectionWait names behind, ahead and not installed' ($wait.Contains('problem == "stale"') -and $wait.Contains('problem == "ahead"') -and $wait.Contains('"The collection is not installed yet."'))
Yes 'the update log no longer says not installed for every case' (-not $update.Contains('Log("The collection is not installed yet'))
Yes 'all three update log lines ask CollectionWait' (([regex]::Matches($update, '= CollectionWait\(\);')).Count -eq 3)
Yes 'Play''s own refusal asks it too' ($play.Contains('if (collectionBarUp) { Log(CollectionHeldLine()); return; }') -and (Method $shell 'static string CollectionHeldLine()').Contains('CollectionWait()[0]') -and -not $play.Contains('Log("The collection is not installed yet. Open it'))

# ---- what the guide tells people before they install ------------------------
# The installer carried READ ME FIRST.txt until #4824; the join guide on the
# site is what a person reads now (installer\README.md).
$joinFirst = [IO.File]::ReadAllText((Join-Path $repo 'site\data\site\join.md')) -replace '\s+', ' '
Yes 'the join guide says to install the revision the launcher opens, not a newer one' ($joinFirst.Contains('opens the revision of the collection the server was built against') -and $joinFirst.Contains('not a newer one Nexus may show first'))

# ---- the site ---------------------------------------------------------------
# The site writes its News page from the feed (#5187): its publicNews, lifted
# out of server.js by its markers, run over two small feeds with node.
$env:THORNSWOOD_HARNESS = '1'
$tmp = if ($Scratch) { $Scratch } else { Join-Path ([IO.Path]::GetTempPath()) ('thornswood-4115-' + [guid]::NewGuid().ToString('N')) }
New-Item -ItemType Directory -Path $tmp -Force | Out-Null
$lift = Join-Path $tmp 'news.js'
# The whole site as one text, for the lift to read (#5357).
$siteSource = Join-Path $tmp 'site-source.js'
[IO.File]::WriteAllText($siteSource, (Get-SiteSource (Join-Path $repo 'site')), (New-Object Text.UTF8Encoding $false))
[IO.File]::WriteAllText($lift, @'
const fs = require('fs');
const s = fs.readFileSync(process.argv[2], 'utf8');
const block = s.slice(s.indexOf('/* ---- news from the Release (#5187) ----'), s.indexOf('/* ---- end news from the Release ---- */'));
const api = new Function(block + '\nreturn { publicNews };')();
console.log(JSON.stringify(api.publicNews(JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), [], new Date())));
'@)
function News([string]$name, $feed) {
    $f = Join-Path $tmp ($name + '.json')
    [IO.File]::WriteAllText($f, ($feed | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding $false))
    $out = & node $lift $siteSource $f 2>&1
    if ($LASTEXITCODE -ne 0) { Write-Host ('      the site''s news did not run: ' + ($out -join ' ')); return $null }
    return ($out -join '') | ConvertFrom-Json
}
$c = 'https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf'
$pinned = News 'pinned' ([ordered]@{ launcherVersion = '9.9.9'; collectionUrl = $c; collectionRevision = 2; news = @() })
Yes 'the site''s News page links the feed''s revision on the Downloads page' ($null -ne $pinned -and [string]$pinned.collection -eq ($c + '/revisions/2') -and [int]$pinned.collectionRevision -eq 2)
$bare = News 'bare' ([ordered]@{ launcherVersion = '9.9.9'; collectionUrl = $c; news = @() })
Yes 'with no revision in the feed it links the collection as it is, revision 0' ($null -ne $bare -and [string]$bare.collection -eq $c -and [int]$bare.collectionRevision -eq 0)
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
$server = Get-SiteSource (Join-Path $repo 'site')
Yes 'the site''s public answer carries the revision' ($server.Contains('collectionRevision: Number(feed.collectionRevision) > 0 ? Number(feed.collectionRevision) : 0,'))
$homeJs = [IO.File]::ReadAllText((Join-Path $repo 'site\public\home.js'))
Yes 'the Downloads button names the revision and says not to take a newer one' ($homeJs.Contains("'Open revision ' + esc(String(d.collectionRevision))") -and $homeJs.Contains('Nexus may show first.'))
$join = [IO.File]::ReadAllText((Join-Path $repo 'site\data\site\join.md')) -replace '\s+', ' '
Yes 'join.md step 3 names the server''s revision' ($join.Contains('opens the revision of the collection the server was built against'))
$help = [IO.File]::ReadAllText((Join-Path $repo 'site\data\help.md')) -replace '\s+', ' '
Yes 'help.md says to install the revision the link opens' ($help.Contains('it opens the revision the server was built against'))
Yes 'help.md tells a copy ahead of the server nothing needs installing' ($help.Contains('## When your mods are ahead of the server') -and $help.Contains('nothing needs installing'))

# ---- the real method, compiled ----------------------------------------------
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (Test-Path -LiteralPath $LauncherDotnet) {
    $slug = Method $checks 'public static string CollectionSlug(Config cfg)'
    $fixture = @'
using System;
namespace Thornswood {
 public class Config { public string CollectionUrl; }
 public static class CollectionLinkFixture {
  __METHODS__
  static string At(string url, int revision) { return CollectionRevisionUrl(new Config { CollectionUrl = url }, revision); }
  public static string Run() {
   string c = "https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf";
   string[,] want = {
    { At(c, 2), c + "/revisions/2" },
    { At(c + "/", 5), c + "/revisions/5" },
    { At(c + "/revisions/5", 2), c + "/revisions/2" },
    { At(c + "?tab=mods", 3), c + "/revisions/3" },
    { At(c, 0), c },
    { At(c, -1), c },
    { At("https://example/not-a-collection", 2), "https://example/not-a-collection" },
    { At(null, 2), "" },
    { CollectionRevisionUrl(null, 2), "" },
   };
   for (int i = 0; i < want.GetLength(0); i++) if (want[i, 0] != want[i, 1]) return "case " + i + ": " + want[i, 0];
   return "";
  }
 }
}
'@
    $asm = Add-LauncherType -Source ($fixture.Replace('__METHODS__', $slug + "`n" + $urlMethod))
    $said = [string]$asm.GetType('Thornswood.CollectionLinkFixture').GetMethod('Run').Invoke($null, @())
    Yes ('the real CollectionRevisionUrl pins the revision, replaces one already there, and leaves no revision or no collection as it is' + $(if ($said) { ' (' + $said + ')' } else { '' })) ($said -eq '')
}

Write-Host ''
Write-Host ($script:pass.ToString() + ' passed, ' + $script:fail + ' failed')
if ($script:fail) { exit 1 }
exit 0
