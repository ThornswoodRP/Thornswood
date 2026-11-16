<#
  test-5608-github-direct.ps1

      pwsh -NoProfile -File .\launcher\tests\test-5608-github-direct.ps1

  The launcher reads its updates from GitHub's API itself, and keeps to
  GitHub's sixty calls an hour.

  WHY THIS EXISTS. Patrick, 11 Nov 2026 (#5608): "the updates should not be
  held on thornswood.net or the VPS but on GitHub, this should block play but
  not updates", and the old update feed on the site goes. On 9 Nov GitHub
  answered every anonymous request to github.com with 504 for hours while
  its API kept answering, so the launcher asks api.github.com and nothing
  else for an update, and a launcher without a token has sixty calls an hour
  from its address, shared with every launcher behind it.

  WHAT IT DOES. Builds the whole launcher the way the project builds
  (tests\Launcher-Csc.ps1) with a driver beside it. The driver points
  GitHub.Api at a stand-in for GitHub's API on 127.0.0.1 that counts every
  call, and checks:
    - the Release list is read once for every reader within a minute,
      published Releases only, newest first by when they were published;
    - a file of a Release is downloaded through its API address with
      Accept: application/octet-stream, following GitHub's 302 to its
      storage, held to GitHub's sha256, kept on disk, and never asked for
      again, even after the list is forgotten;
    - a file whose bytes are not GitHub's sha256 is refused;
    - an asset address that is not this repository's Release file is
      refused without a call;
    - a Release not on the list is asked for by its tag, once;
    - when GitHub says the hour's calls are spent (403 with no calls left),
      nothing more is asked until the reset it gave, and the reason names
      the time;
    - main's launcher number (MainVersion.cs) comes through the same
      ChannelSource the update check reads, from the stand-in alone.
  And from the source: nothing in the update path names thornswood.net or a
  github.com download address, the update check no longer holds Play when
  GitHub does not answer, and no file of the old update feed is left.

  Writes only under out\harness (the build) and a scratch folder in TEMP.
  Nothing leaves this machine: the stand-in is on 127.0.0.1.
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
function Src([string]$name) { [IO.File]::ReadAllText((Join-Path $App $name)).Replace("`r`n", "`n") }

# ---- from the source ---------------------------------------------------------------
Write-Host 'the update path asks GitHub''s API alone (launcher\app)'
$path = @('GitHub.cs', 'VeloUpdate.cs', 'VeloRecord.cs', 'VeloPackage.cs', 'SyncPackage.cs', 'Sync.cs', 'UpdateStages.cs', 'MainVersion.cs', 'ReleaseNews.cs', 'ShellUpdate.cs')
foreach ($f in $path) {
    $code = ((Src $f) -split "`n" | Where-Object { $_ -notmatch '^\s*//' }) -join "`n"
    Yes ("  " + $f + " names no address on thornswood.net and no github.com download") ($code -notmatch 'thornswood\.net|/releases/download/|"https://github\.com')
}
$gh = Src 'GitHub.cs'
Yes 'GitHub.cs asks api.github.com for this repository' ($gh -match 'internal static string Api = "https://api\.github\.com/repos/" \+ Velo\.Repo;')
$vu = Src 'VeloUpdate.cs'
Yes 'ChannelSource reads the Release list and every feed through GitHub.cs' (
    $vu -match 'GitHub\.Releases\(' -and $vu -match 'GitHub\.File\(g\.TagName, feedName\)' -and $vu -match 'return GitHub\.AssetUrl\(')
Yes '  and holds Velopack to MaxDeltas deltas, so a climb costs few calls' ($vu -match 'opts\.MaximumDeltasBeforeFallback = MaxDeltas;' -and $vu -match 'new ChannelSource\(channel, MaxDeltas \+ 1\)')
$vr = Src 'VeloRecord.cs'
Yes 'the signed release record comes from GitHub.File' ($vr -match 'return GitHub\.File\(tag, name\);')
$su = Src 'ShellUpdate.cs'
Yes 'a launcher check GitHub did not answer says so and does not hold Play' (
    $su -match 'Play is not held for it' -and $su -notmatch 'NO ANSWER FROM THE UPDATE SOURCE')
Yes '  and the update check is not run while the game runs' ($su -match 'if \(playing\) continue;' -and (Src 'Shell.cs') -notmatch 'CheckUpdatesInPlay')
foreach ($gone in @('FeedNotice.cs', 'FeedSettings.cs', 'FeedManifest.cs', 'ShellPacks.cs')) {
    Yes ("  the old update feed's " + $gone + " is gone") (-not (Test-Path -LiteralPath (Join-Path $App $gone)))
}
$cfgCs = Src 'Config.cs'
Yes 'config.json carries no feed address, repository or token' ($cfgCs -notmatch 'UpdateFeedUrl|UpdateRepo|UpdateToken')

# The launcher's own update (VeloUpdate.cs), moved here from
# test-update-download.ps1 when the feed's half of that went (#5608). What
# SelfUpdate made sure of before #4825, in the update Velopack applies: the
# package and Velopack's Update.exe are checked against the signer before the
# update is marked checked, a refusal deletes the package and says nothing was
# replaced, and only a checked update is applied.
function Body([string]$src, [string]$start) {
    $at = $src.IndexOf($start)
    if ($at -lt 0) { return '' }
    $open = $src.IndexOf('{', $at)
    $depth = 0
    for ($i = $open; $i -lt $src.Length; $i++) {
        if ($src[$i] -eq '{') { $depth++ }
        elseif ($src[$i] -eq '}') { $depth--; if ($depth -eq 0) { return $src.Substring($at, $i - $at + 1) } }
    }
    return ''
}
$fetch = Body $vu 'public static void FetchLauncher(LauncherUpdate u, Action<string> log)'
$apply = Body $vu 'public static void ApplyLauncher(LauncherUpdate u)'
Yes 'FetchLauncher and ApplyLauncher are in VeloUpdate.cs' ($fetch.Length -gt 0 -and $apply.Length -gt 0)
$iDown = $fetch.IndexOf('DownloadUpdatesAsync(')
$iPkg = $fetch.IndexOf('VeloPackage.Refusal(pkg, list, setup, ExpectedSigner,')
$iExe = $fetch.IndexOf('Signature.Refusal(updateExe, ExpectedSigner,')
$iCatch = $fetch.IndexOf('catch (Exception ex)')
$iDel = $fetch.IndexOf('File.Delete(pkg)')
$iChecked = $fetch.IndexOf('u.Checked = true;')
Yes 'FetchLauncher checks the package, every file and program in it, against the signer once it is down' ($iDown -ge 0 -and $iPkg -gt $iDown)
Yes '  and Velopack''s Update.exe, which applies it, against the signer after that' ($iExe -gt $iPkg)
Yes '  a refusal deletes the package and says nothing was replaced' (
    $iCatch -gt $iExe -and $iDel -gt $iCatch -and $fetch.IndexOf('Nothing has been replaced', $iCatch) -gt $iCatch)
Yes '  and the update is marked checked only after every check, outside the refusal' ($iChecked -gt $iDel)
Yes 'ApplyLauncher applies only an update FetchLauncher checked' ($apply -match '^public static void ApplyLauncher\(LauncherUpdate u\)\s*\{\s*if \(u == null \|\| !u\.Checked\) throw')
$sp = Src 'SyncPackage.cs'
$seed = Body $sp 'public static void SeedFromChannel(Config cfg, string channel, Action<string> log)'
Yes 'a new ship root takes the channel''s package from GitHub with the checks an update makes (SeedFromChannel)' (
    $seed.IndexOf('VeloRecord.Vouches(top)') -ge 0 -and $seed.IndexOf('VeloRecord.Vouches(top)') -lt $seed.IndexOf('GitHub.Download(asset)') -and
    $seed -match 'VeloRecord\.Sha256\(b\), top\.SHA256' -and
    $seed.IndexOf('VeloPackage.Refusal(pkg, game, setup, ExpectedSigner,') -lt $seed.IndexOf('WriteSync(cfg, plan, log)'))

# ---- the driver -------------------------------------------------------------------
Write-Host ''
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace Thornswood
{
    static class GitHubDirectTest
    {
        static int pass, fail;
        static void Yes(string what, bool ok)
        {
            if (ok) { pass++; Console.WriteLine("PASS  " + what); }
            else { fail++; Console.WriteLine("FAIL  " + what); }
        }

        // ---- the stand-in for GitHub's API -----------------------------------------
        static readonly object gate = new object();
        static readonly Dictionary<string, int> calls = new Dictionary<string, int>(StringComparer.Ordinal);
        static readonly Dictionary<long, byte[]> files = new Dictionary<long, byte[]>();
        static readonly List<string> accepts = new List<string>();
        static string releasesJson = "[]";
        static readonly Dictionary<string, string> byTag = new Dictionary<string, string>(StringComparer.Ordinal);
        static long spentReset;   // when set, every call is answered 403 with no calls left
        static string api;

        static int Calls(string prefix)
        {
            lock (gate) return calls.Where(kv => kv.Key.StartsWith(prefix, StringComparison.Ordinal)).Sum(kv => kv.Value);
        }
        static int AllCalls() { lock (gate) return calls.Values.Sum(); }

        static void Serve(HttpListener l)
        {
            while (l.IsListening)
            {
                HttpListenerContext c;
                try { c = l.GetContext(); } catch { return; }
                try { Answer(c); } catch (Exception ex) { Console.WriteLine("stand-in: " + ex.Message); }
            }
        }

        static void Answer(HttpListenerContext c)
        {
            string p = c.Request.Url.PathAndQuery;
            var res = c.Response;
            if (!p.StartsWith("/storage/", StringComparison.Ordinal))
            {
                lock (gate) { int n; calls.TryGetValue(p, out n); calls[p] = n + 1; }
                res.Headers["X-RateLimit-Limit"] = "60";
            }
            byte[] body = null;
            if (spentReset > 0 && !p.StartsWith("/storage/", StringComparison.Ordinal))
            {
                res.StatusCode = 403;
                res.Headers["X-RateLimit-Remaining"] = "0";
                res.Headers["X-RateLimit-Reset"] = spentReset.ToString();
                body = Encoding.UTF8.GetBytes("{\"message\":\"API rate limit exceeded\"}");
            }
            else if (p.StartsWith("/repos/x/y/releases?", StringComparison.Ordinal))
            {
                res.Headers["X-RateLimit-Remaining"] = "50";
                body = Encoding.UTF8.GetBytes(p.Contains("page=1") ? releasesJson : "[]");
            }
            else if (p.StartsWith("/repos/x/y/releases/tags/", StringComparison.Ordinal))
            {
                string tag = Uri.UnescapeDataString(p.Substring("/repos/x/y/releases/tags/".Length));
                string json;
                if (byTag.TryGetValue(tag, out json)) body = Encoding.UTF8.GetBytes(json);
                else { res.StatusCode = 404; body = Encoding.UTF8.GetBytes("{\"message\":\"Not Found\"}"); }
            }
            else if (p.StartsWith("/repos/x/y/releases/assets/", StringComparison.Ordinal))
            {
                lock (gate) accepts.Add(c.Request.Headers["Accept"] ?? "");
                // GitHub answers a file's API address with 302 to its storage.
                res.StatusCode = 302;
                res.RedirectLocation = "http://" + c.Request.Url.Authority + "/storage/" + p.Substring("/repos/x/y/releases/assets/".Length);
            }
            else if (p.StartsWith("/storage/", StringComparison.Ordinal))
            {
                long id = long.Parse(p.Substring("/storage/".Length));
                byte[] b;
                if (files.TryGetValue(id, out b)) body = b; else res.StatusCode = 404;
            }
            else if (p.StartsWith("/repos/x/y/deployments", StringComparison.Ordinal))
            {
                body = Encoding.UTF8.GetBytes("[]");
            }
            else res.StatusCode = 404;
            if (body != null) res.OutputStream.Write(body, 0, body.Length);
            res.Close();
        }

        static string Sha(byte[] b) { return Convert.ToHexString(SHA256.HashData(b)).ToLowerInvariant(); }

        static string Asset(long id, string name, byte[] bytes, string digestOverride = null)
        {
            files[id] = bytes;
            return "{\"id\":" + id + ",\"name\":\"" + name + "\",\"size\":" + bytes.Length + ",\"state\":\"uploaded\"," +
                   "\"digest\":\"sha256:" + (digestOverride ?? Sha(bytes)) + "\",\"url\":\"" + api + "/releases/assets/" + id + "\"," +
                   "\"browser_download_url\":\"https://github.com/x/y/releases/download/t/" + name + "\"}";
        }

        static string Release(string tag, string published, bool draft, params string[] assets)
        {
            return "{\"tag_name\":\"" + tag + "\",\"name\":\"Release " + tag + "\",\"body\":\"\",\"draft\":" + (draft ? "true" : "false") +
                   ",\"prerelease\":false,\"published_at\":" + (published == null ? "null" : "\"" + published + "\"") +
                   ",\"assets\":[" + string.Join(",", assets) + "]}";
        }

        static string MainFeed(string version)
        {
            return "{\"Assets\":[{\"PackageId\":\"Thornswood\",\"Version\":\"" + version + "\",\"Type\":\"Full\",\"FileName\":\"Thornswood-" + version +
                   "-main-full.nupkg\",\"SHA1\":\"\",\"SHA256\":\"" + new string('0', 64) + "\",\"Size\":100,\"NotesMarkdown\":\"\",\"NotesHTML\":\"\"}]}";
        }

        public static int Main(string[] args)
        {
            int port;
            var probe = new TcpListener(IPAddress.Loopback, 0);
            probe.Start(); port = ((IPEndPoint)probe.LocalEndpoint).Port; probe.Stop();
            var l = new HttpListener();
            l.Prefixes.Add("http://127.0.0.1:" + port + "/");
            l.Start();
            new Thread(() => Serve(l)) { IsBackground = true }.Start();
            api = "http://127.0.0.1:" + port + "/repos/x/y";

            string scratch = args.Length > 0 ? args[0] : Path.Combine(Path.GetTempPath(), "ts-5608-" + Guid.NewGuid().ToString("N"));
            Paths.ProfileDir = Path.Combine(scratch, "Profile");
            Directory.CreateDirectory(Paths.ProfileDir);
            GitHub.Api = api;
            GitHub.Forget();

            byte[] manifest = Encoding.UTF8.GetBytes("{\"tag\":\"build-1.3.21\"}");
            byte[] feed21 = Encoding.UTF8.GetBytes("﻿" + MainFeed("1.3.21"));
            byte[] feed20 = Encoding.UTF8.GetBytes(MainFeed("1.3.20"));
            byte[] bad = Encoding.UTF8.GetBytes("these are not the bytes GitHub listed");
            string r20 = Release("main-build-1.3.20", "2026-11-09T10:00:00Z", false, Asset(20, "releases.main.json", feed20));
            string r21 = Release("build-1.3.21", "2026-11-11T10:00:00Z", false, Asset(1, "manifest.json", manifest), Asset(2, "bad.json", bad, new string('a', 64)));
            string m21 = Release("main-build-1.3.21", "2026-11-11T12:00:00Z", false, Asset(21, "releases.main.json", feed21));
            // GitHub's own order is not by publishing: the older Release first.
            releasesJson = "[" + string.Join(",", r20, r21, m21, Release("build-1.3.22", null, true, Asset(3, "manifest.json", manifest))) + "]";
            byTag["main-build-1.3.20"] = r20; byTag["build-1.3.21"] = r21; byTag["main-build-1.3.21"] = m21;
            byTag["build-1.3.1"] = Release("build-1.3.1", "2026-11-01T10:00:00Z", false, Asset(9, "manifest.json", Encoding.UTF8.GetBytes("old")));

            Console.WriteLine("the Release list (GitHub.Releases)");
            List<GitHub.Release> list = GitHub.Releases(r => true, 1);
            Yes("published Releases only, newest first by when they were published: " + string.Join(", ", list.Select(r => r.TagName)),
                string.Join(",", list.Select(r => r.TagName)) == "main-build-1.3.21,build-1.3.21,main-build-1.3.20");
            GitHub.Releases(r => r.TagName.StartsWith("main-"), 2);
            GitHub.Tag("build-1.3.21");
            Yes("  one call serves every reader within the minute (" + Calls("/repos/x/y/releases?") + ")", Calls("/repos/x/y/releases?") == 1);

            Console.WriteLine("a file of a Release (GitHub.File)");
            byte[] got = GitHub.File("build-1.3.21", "manifest.json");
            Yes("the bytes arrive through the asset's API address and GitHub's 302", got.SequenceEqual(manifest));
            Yes("  asked with Accept: application/octet-stream", accepts.Count == 1 && accepts[0].Contains("application/octet-stream"));
            Yes("  and kept on disk under Profile\\GitHub", File.Exists(Path.Combine(Paths.ProfileDir, "GitHub", "build-1.3.21", "manifest.json")));
            int before = AllCalls();
            GitHub.Forget();
            byte[] again = GitHub.File("build-1.3.21", "manifest.json");
            Yes("  asked again, even with the list forgotten, it is read from disk with no call (" + (AllCalls() - before) + ")", again.SequenceEqual(manifest) && AllCalls() == before);

            string why = "";
            try { GitHub.File("build-1.3.21", "bad.json"); } catch (Exception ex) { why = ex.Message; }
            Yes("a file that is not GitHub's sha256 is refused: " + why, why.Contains("GitHub lists it as"));
            Yes("  and not kept", !File.Exists(Path.Combine(Paths.ProfileDir, "GitHub", "build-1.3.21", "bad.json")));

            why = "";
            try { GitHub.File("build-1.3.21", "nothing.json"); } catch (Exception ex) { why = ex.Message; }
            Yes("a file the Release does not carry is said so: " + why, why.Contains("has no nothing.json"));
            why = "";
            try { GitHub.File("build-1.3.21", "../x.json"); } catch (Exception ex) { why = ex.Message; }
            Yes("a name that is not a plain file name is refused", why.Contains("is not a file name"));

            Console.WriteLine("asset addresses (GitHub.AssetUrl)");
            before = AllCalls();
            foreach (string u in new[] {
                "https://github.com/x/y/releases/download/t/a.nupkg",
                api + "/releases/assets/12/../../../evil",
                api + "/releases/assets/",
                "https://thornswood.net/release/t/a.nupkg",
                api.Replace("/x/y", "/x/z") + "/releases/assets/12",
                null })
            {
                why = "";
                try { GitHub.AssetUrl(new GitHub.Asset { Url = u, Name = "a" }); } catch (Exception ex) { why = ex.Message; }
                Yes("  refused: " + (u ?? "null"), why.Contains("is not one of this repository's Release files"));
            }
            Yes("  one of this repository's is taken", GitHub.AssetUrl(new GitHub.Asset { Url = api + "/releases/assets/12", Name = "a" }) == api + "/releases/assets/12");
            Yes("  and none of that called GitHub", AllCalls() == before);

            Console.WriteLine("a Release not on the list (GitHub.Tag)");
            byte[] old = GitHub.File("build-1.3.1", "manifest.json");
            GitHub.Tag("build-1.3.1");
            Yes("asked for by its tag, once (" + Calls("/repos/x/y/releases/tags/build-1.3.1") + ")", old.Length == 3 && Calls("/repos/x/y/releases/tags/build-1.3.1") == 1);
            why = "";
            try { GitHub.Tag("build-9.9.9"); } catch (Exception ex) { why = ex.Message; }
            Yes("  and one GitHub has not is said so: " + why, why.Contains("GitHub has no Release build-9.9.9"));

            Console.WriteLine("main's launcher number through ChannelSource (MainVersion.cs)");
            GitHub.Forget();
            string mainOn = "";
            try { mainOn = Updater.MainLauncherVersion(null); } catch (Exception ex) { mainOn = "threw: " + ex.Message; }
            Yes("main's newest Release by publishing is the one named: " + mainOn, mainOn == "1.3.21");

            Console.WriteLine("the hour's sixty (GitHub.Refusal)");
            GitHub.Forget();
            long reset = DateTimeOffset.UtcNow.AddMinutes(37).ToUnixTimeSeconds();
            spentReset = reset;
            why = "";
            try { GitHub.Releases(r => true, 1); } catch (Exception ex) { why = ex.Message; }
            string at = DateTimeOffset.FromUnixTimeSeconds(reset).LocalDateTime.ToString("h:mm tt", System.Globalization.CultureInfo.InvariantCulture);
            Yes("a 403 with no calls left says they are used up until the reset (" + at + "): " + why, why.Contains("used up until " + at));
            before = AllCalls();
            spentReset = 0;
            why = "";
            try { GitHub.Releases(r => true, 1); } catch (Exception ex) { why = ex.Message; }
            Yes("  and nothing more is asked until then (" + (AllCalls() - before) + " calls)", AllCalls() == before && why.Contains("used up until"));
            Yes("  GitHub.Refusal says the same to every caller", GitHub.Refusal().Contains("used up until " + at));
            GitHub.Forget();
            why = "";
            try { GitHub.Json("/nothing"); } catch (Exception ex) { why = ex.Message; }
            Yes("  a 404 says GitHub has nothing there: " + why, why.Contains("GitHub has nothing at"));

            l.Stop();
            Console.WriteLine("driver: " + pass + " passed, " + fail + " failed");
            return fail > 0 ? 1 : 0;
        }
    }
}
'@

$dll = $null
try { $dll = Build-LauncherCode -Launcher -Source $driver -Exe -Main 'Thornswood.GitHubDirectTest' }
catch { ($_.Exception.Message -split "`r?`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
Yes 'the whole launcher and the driver build the way the project does' ($null -ne $dll)
if ($null -eq $dll) { Done }

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-5608-' + [Guid]::NewGuid().ToString('N').Substring(0, 12))
New-Item -ItemType Directory -Path $T -Force | Out-Null
$out = @(Invoke-LauncherExe $dll (Join-Path $T 'work') $T 2>&1 | ForEach-Object { "$_" })
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
