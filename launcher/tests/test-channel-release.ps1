<#
  test-channel-release.ps1

      pwsh -NoProfile -File .\launcher\tests\test-channel-release.ps1

  A launcher goes to the release its channel's newest Release carries, up
  or down, and its game files come from that package on both channels.

  WHY THIS EXISTS. Patrick, 8 Nov 2026: the launcher's numbers go back from
  the date numbers (2026.1108.2) to 1.3.x. Velopack on its own takes only
  the highest version anywhere in its feed, and only when it is higher than
  the one running, so a 1.3.0 package would never reach an install on
  2026.1108.2, and neither would a promotion of an older build to main (the
  plan: "which release a channel gets comes from its Dev or Main
  Deployment"). The same day main's game files were found still coming from
  the site feed's last record (release/main/20261102-121621), not from main's
  packages, because Velo.GameFromPackage was dev only (#4825).

  WHAT IT DOES. Builds the whole launcher the way the project builds
  (tests\Launcher-Csc.ps1) with a driver beside it, and runs the driver:
    - Updater.ChannelRelease, on planted feeds: the newest Release's full
      package is the highest left whatever the Releases before it are
      numbered, the deltas at or below it stay, a newest Release with no full
      package leaves nothing, and an empty feed is empty.
    - Velopack's own UpdateManager over that feed, with downgrades allowed as
      CheckLauncher asks: an install on 2026.1108.2 is offered 1.3.0 as a
      downgrade; one on 1.3.0 is offered 1.3.1 with its delta; one already
      on the channel's release is offered nothing. Without downgrades allowed
      the first finds nothing, which is why CheckLauncher allows them.
    - VeloRecord.TagOf: 1.3.0 is the Release build-1.3.0, and a date
      number, a 1.2.x number (the launchers before Velopack), a prerelease and a 0.x number are refused.
    - Velo.ReleaseFile and Velo.SiteReleaseFile (#5608): every file of a
      Release is fetched through the site's Release route, and an address
      the site's list gives is taken only when it is that route.
  And from the source: CheckLauncher allows downgrades, ChannelSource cuts
  the feed with ChannelRelease, reads the Releases from the site and fetches
  every file through its Release route, the signed record is fetched the
  same way, nothing in the update asks GitHub or github.com itself, and
  Velo.GameFromPackage is every launcher Velopack installed, not dev alone.

  Writes only under out\harness (the build). Nothing touches the network.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's SDK and settings
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$App = Join-Path (Join-Path $Repo 'launcher') 'app'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host "$($script:pass) passed, $($script:fail) failed"
    if ($script:fail) { exit 1 }
    exit 0
}

# ---- from the source ---------------------------------------------------------------
Write-Host 'the update check and the game files line (launcher\app\VeloUpdate.cs, Velo.cs)'
$velo = [IO.File]::ReadAllText((Join-Path $App 'VeloUpdate.cs')).Replace("`r`n", "`n")
$checkAt = $velo.IndexOf('public static LauncherUpdate CheckLauncher(Config cfg)')
$check = if ($checkAt -ge 0) { $velo.Substring($checkAt, $velo.IndexOf('public static void FetchLauncher(', $checkAt) - $checkAt) } else { '' }
Yes 'CheckLauncher allows a lower number than the running one, before it asks' (
    $check -match '(?s)opts\.AllowVersionDowngrade = true;.*new CheckedUpdates\(new ChannelSource\(channel, 11\), opts\);.*CheckForUpdatesAsync\(\)')
Yes 'ChannelSource cuts the feed Velopack reads with ChannelRelease, by when each Release was published' (
    $velo -match '(?s)sealed class ChannelSource : GithubSource.*public override async Task<VelopackAssetFeed> GetReleaseFeed\(.*await base\.GetReleaseFeed\(.*Assets = ChannelRelease\(all\.Assets, a => a is GitBaseAsset g && g\.Release != null \? g\.Release\.PublishedAt : null\)')
# #5608, Patrick's B of 9 Nov 2026: GitHub answered every anonymous request
# to github.com with 504 that day, Release downloads included.
Yes 'ChannelSource reads the Releases from the site, not GitHub''s API' (
    $velo -match '(?s)sealed class ChannelSource : GithubSource.*GetReleases\(bool includePrereleases\)\s*\{\s*string json = await Downloader\.DownloadString\(Velo\.ReleaseList,')
Yes '  and fetches every feed and package through the site''s Release route, never Velopack''s github.com address' (
    $velo -match '(?s)protected override string GetAssetUrlFromName\(GithubRelease release, string assetName\).*return Velo\.SiteReleaseFile\(asset\.BrowserDownloadUrl\);')
$recordCs = [IO.File]::ReadAllText((Join-Path $App 'VeloRecord.cs')).Replace("`r`n", "`n")
Yes 'the signed release record and its lists come through the site''s Release route too' (
    $recordCs -match '(?s)static string Download\(string tag, string name\)\s*\{\s*return Velo\.ReleaseFile\(tag, name\);\s*\}')
Yes '  and neither file asks api.github.com or a github.com download address' (
    ($velo + $recordCs) -notmatch 'api\.github\.com|/releases/download/')
$veloCs = [IO.File]::ReadAllText((Join-Path $App 'Velo.cs')).Replace("`r`n", "`n")
Yes 'the game files come from the package for every launcher Velopack installed, main as well as dev' (
    $veloCs -match '(?s)public static bool GameFromPackage\(Config cfg\)\s*\{\s*return Installed;\s*\}')

# ---- the driver -------------------------------------------------------------------
Write-Host ''
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$driver = @'
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Velopack;
using Velopack.Locators;
using Velopack.Logging;
using Velopack.Sources;

namespace Thornswood
{
    static class ChannelReleaseTest
    {
        static int pass, fail;
        static void Yes(string what, bool ok)
        {
            if (ok) { pass++; Console.WriteLine("PASS  " + what); }
            else { fail++; Console.WriteLine("FAIL  " + what); }
        }

        // By the object, not its value: VelopackAsset is a record, and a build
        // promoted again is the same package by value on a later Release.
        static readonly Dictionary<object, DateTime> when = new Dictionary<object, DateTime>(ReferenceEqualityComparer.Instance);
        static VelopackAsset Asset(string version, VelopackAssetType type, int day)
        {
            var a = new VelopackAsset();
            a.PackageId = "Thornswood";
            a.Version = SemanticVersion.Parse(version);
            a.Type = type;
            a.FileName = "Thornswood-" + version + "-main-" + (type == VelopackAssetType.Full ? "full" : "delta") + ".nupkg";
            a.SHA256 = new string('0', 64);
            a.Size = 100;
            when[a] = new DateTime(2026, 11, day, 12, 0, 0, DateTimeKind.Utc);
            return a;
        }
        static DateTime? Published(VelopackAsset a) { DateTime d; return when.TryGetValue(a, out d) ? d : (DateTime?)null; }
        static string Names(VelopackAsset[] list)
        {
            return string.Join(",", list.Select(a => a.Version + (a.Type == VelopackAssetType.Full ? "F" : "D")).OrderBy(n => n, StringComparer.Ordinal));
        }

        sealed class Feed : IUpdateSource
        {
            readonly VelopackAsset[] assets;
            public Feed(VelopackAsset[] a) { assets = a; }
            public Task<VelopackAssetFeed> GetReleaseFeed(IVelopackLogger logger, string appId, string channel, Guid? stagingId = null, VelopackAsset latestLocalRelease = null)
            {
                return Task.FromResult(new VelopackAssetFeed { Assets = Updater.ChannelRelease(assets, Published) });
            }
            public Task DownloadReleaseEntry(IVelopackLogger logger, VelopackAsset releaseEntry, string localFile, Action<int> progress, CancellationToken cancelToken = default(CancellationToken))
            {
                throw new Exception("nothing is downloaded here");
            }
        }

        static UpdateInfo Ask(VelopackAsset[] feed, string installed, bool downgrade)
        {
            var opts = new UpdateOptions();
            opts.ExplicitChannel = "main";
            opts.AllowVersionDowngrade = downgrade;
            var at = new TestVelopackLocator("Thornswood", installed, System.IO.Path.GetTempPath(), null, null, null, "main");
            var mgr = new UpdateManager(new Feed(feed), opts, at);
            return mgr.CheckForUpdatesAsync().GetAwaiter().GetResult();
        }

        static int Main(string[] args)
        {
            Console.WriteLine("Updater.ChannelRelease: the newest Release's package is the channel's");
            // The move back to 1.3.x: two date numbered Releases, then 1.3.0.
            var d1 = Asset("2026.1108.1", VelopackAssetType.Full, 8);
            var d2 = Asset("2026.1108.2", VelopackAssetType.Full, 9);
            var d2d = Asset("2026.1108.2", VelopackAssetType.Delta, 9);
            var v17 = Asset("1.3.0", VelopackAssetType.Full, 10);
            var move = new[] { d1, d2, d2d, v17 };
            Yes("1.3.0, published after 2026.1108.2, is the highest left, and nothing above it: " + Names(Updater.ChannelRelease(move, Published)),
                Names(Updater.ChannelRelease(move, Published)) == "1.3.0F");
            // Ordinary releases after it: each newer and higher, deltas kept.
            var v18 = Asset("1.3.1", VelopackAssetType.Full, 11);
            var v18d = Asset("1.3.1", VelopackAssetType.Delta, 11);
            var on = new[] { d1, d2, d2d, v17, v18, v18d };
            Yes("with 1.3.1 published next, it and its delta are the top, 1.3.0 below it stays: " + Names(Updater.ChannelRelease(on, Published)),
                Names(Updater.ChannelRelease(on, Published)) == "1.3.0F,1.3.1D,1.3.1F");
            // A Release's feed lists the full package its delta was made from,
            // under the same Release (vpk writes it so), before or after its own.
            var p18 = Asset("1.3.1", VelopackAssetType.Full, 11);
            var p18d = Asset("1.3.1", VelopackAssetType.Delta, 11);
            var p17 = Asset("1.3.0", VelopackAssetType.Full, 11);
            Yes("the newest Release's own package is its highest full one, whichever order its feed lists them in",
                Names(Updater.ChannelRelease(new[] { v17, p17, p18, p18d }, Published)) == "1.3.0F,1.3.0F,1.3.1D,1.3.1F" &&
                Ask(new[] { v17, p17, p18, p18d }, "1.3.0", true).TargetFullRelease.Version.ToString() == "1.3.1" &&
                Ask(new[] { v17, p18, p18d, p17 }, "1.3.0", true).TargetFullRelease.Version.ToString() == "1.3.1");
            // Main promoted back to an older build: published last, numbered lower.
            var back = Asset("1.3.0", VelopackAssetType.Full, 12);
            var promoted = new[] { v17, v18, v18d, back };
            Yes("an older build promoted again is the channel's, and the higher one before it is dropped: " + Names(Updater.ChannelRelease(promoted, Published)),
                Names(Updater.ChannelRelease(promoted, Published)) == "1.3.0F,1.3.0F");
            var deltaOnly = Asset("1.3.19", VelopackAssetType.Delta, 13);
            Yes("a newest Release with no full package (a delta alone) is not taken; the newest full one is",
                Names(Updater.ChannelRelease(new[] { v17, v18, v18d, deltaOnly }, Published)) == "1.3.0F,1.3.1D,1.3.1F");
            var unknown = new VelopackAsset { PackageId = "Thornswood", Version = SemanticVersion.Parse("1.3.20"), Type = VelopackAssetType.Full, FileName = "x" };
            Yes("a package whose Release has no publish time is never the target, and nothing above the target stays",
                Names(Updater.ChannelRelease(new[] { v17, unknown }, Published)) == "1.3.0F");
            Yes("no full package with a publish time leaves nothing to take", Updater.ChannelRelease(new[] { deltaOnly }, Published).Length == 0);
            Yes("an empty feed is empty", Updater.ChannelRelease(new VelopackAsset[0], Published).Length == 0 && Updater.ChannelRelease(null, Published).Length == 0);

            Console.WriteLine();
            Console.WriteLine("Velopack's UpdateManager over that feed, as CheckLauncher asks it");
            UpdateInfo u = Ask(move, "2026.1108.2", true);
            Yes("an install on 2026.1108.2 is offered 1.3.0, as a downgrade, the whole package",
                u != null && u.TargetFullRelease.Version.ToString() == "1.3.0" && u.IsDowngrade && u.DeltasToTarget.Length == 0);
            Yes("  and without downgrades allowed it is offered nothing, which is why CheckLauncher allows them", Ask(move, "2026.1108.2", false) == null);
            u = Ask(on, "1.3.0", true);
            Yes("an install on 1.3.0 is offered 1.3.1, not as a downgrade",
                u != null && u.TargetFullRelease.Version.ToString() == "1.3.1" && !u.IsDowngrade);
            Yes("an install already on the channel's release is offered nothing", Ask(on, "1.3.1", true) == null);
            u = Ask(promoted, "1.3.1", true);
            Yes("main promoted back to 1.3.0 takes an install on 1.3.1 back to it", u != null && u.TargetFullRelease.Version.ToString() == "1.3.0" && u.IsDowngrade);

            Console.WriteLine();
            Console.WriteLine("VeloRecord.TagOf: which Release's signed record holds a package");
            Yes("1.3.0 is the Release build-1.3.0", VeloRecord.TagOf(SemanticVersion.Parse("1.3.0")) == "build-1.3.0");
            string why = "";
            try { VeloRecord.TagOf(SemanticVersion.Parse("2026.1108.2")); } catch (Exception ex) { why = ex.Message; }
            Yes("a date number from before 1.3.x is no longer read: " + why, why.Contains("is not one a Thornswood release makes"));
            why = "";
            try { VeloRecord.TagOf(SemanticVersion.Parse("1.2.17")); } catch (Exception ex) { why = ex.Message; }
            Yes("nor is a 1.2.x number, the launchers from before Velopack", why.Contains("is not one a Thornswood release makes"));
            why = "";
            try { VeloRecord.TagOf(SemanticVersion.Parse("1.3.0-beta")); } catch (Exception ex) { why = ex.Message; }
            Yes("a prerelease number is no release's, and is refused: " + why, why.Contains("is not one a Thornswood release makes"));
            why = "";
            try { VeloRecord.TagOf(SemanticVersion.Parse("0.1.2")); } catch (Exception ex) { why = ex.Message; }
            Yes("nor is a 0.x number", why.Contains("is not one a Thornswood release makes"));

            Console.WriteLine();
            Console.WriteLine("Velo.ReleaseFile and Velo.SiteReleaseFile: every file through the site (#5608)");
            Yes("a Release's file is the site's Release route", Velo.ReleaseFile("build-1.3.5", "manifest.json") == "https://thornswood.net/release/build-1.3.5/manifest.json");
            Yes("  the list's own address for one is made whole against the site",
                Velo.SiteReleaseFile("/release/build-1.3.5/Thornswood-1.3.5-full.nupkg") == "https://thornswood.net/release/build-1.3.5/Thornswood-1.3.5-full.nupkg");
            Yes("  and one already whole on the site is kept", Velo.SiteReleaseFile("https://thornswood.net/release/main-build-1.3.4/releases.main.json") ==
                "https://thornswood.net/release/main-build-1.3.4/releases.main.json");
            foreach (string bad in new[] {
                "https://github.com/ThornswoodRP/Thornswood/releases/download/build-1.3.5/x.nupkg",
                "https://thornswood.net.example.com/release/build-1.3.5/x.nupkg",
                "//example.com/release/build-1.3.5/x.nupkg",
                "http://thornswood.net/release/build-1.3.5/x.nupkg",
                "https://thornswood.net:8443/release/build-1.3.5/x.nupkg",
                "https://user@thornswood.net/release/build-1.3.5/x.nupkg",
                "/feed/assets/" + new string('a', 64),
                "/release/../feed/assets/x",
                "", null })
            {
                string refused = "";
                try { Velo.SiteReleaseFile(bad); } catch (ArgumentException ex) { refused = ex.Message; }
                Yes("  anything else the list says is refused: " + (bad ?? "null"), refused.Contains("not the site's own Release route"));
            }

            Console.WriteLine("driver: " + pass + " passed, " + fail + " failed");
            return fail > 0 ? 1 : 0;
        }
    }
}
'@

$dll = $null
try { $dll = Build-LauncherCode -Launcher -Source $driver -Exe -Main 'Thornswood.ChannelReleaseTest' }
catch { ($_.Exception.Message -split "`r?`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
Yes 'the whole launcher and the driver build the way the project does' ($null -ne $dll)
if ($null -eq $dll) { Done }

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-channel-release-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
$out = @(Invoke-LauncherExe $dll (Join-Path $T 'work') 2>&1 | ForEach-Object { "$_" })
$code = $LASTEXITCODE

Write-Host ''
foreach ($l in $out) {
    if ($l -match '^PASS  ') { $script:pass++; Write-Host $l }
    elseif ($l -match '^FAIL  ') { $script:fail++; Write-Host $l }
    elseif ($l -match '^driver: ') { }
    else { Write-Host $l }
}
Yes ('the driver ran to the end and reported (exit ' + $code + ')') (@($out | Where-Object { $_ -match '^driver: ' }).Count -eq 1)

try { if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force } } catch { Write-Host "      (scratch left at $T)" }
Done
