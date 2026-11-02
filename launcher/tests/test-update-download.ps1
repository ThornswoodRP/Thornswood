<#
  test-update-download.ps1

      pwsh -NoProfile -File .\launcher\tests\test-update-download.ps1

  The Launcher's update path between the feed and the files: the parts no
  harness ran. From launcher\app\Updater.cs:

      Download / Fetch      checksum is mandatory, a wrong, short or broken
                            download is rejected and its part file deleted,
                            an answer that is not 2xx is refused, the url is
                            checked before a byte is asked for
      ApplyPack             a pack already in is not fetched twice, a release
                            record syncs instead of downloading, the zip is
                            deleted whether Install worked or threw
      WriteCache/ReadCache  the feed cache round-trips, and a copy from an
                            older shape, cut short, or with a body that does
                            not parse is not believed
      WrapFeedFail          what a failed feed check says
      Applied/Skip/MarkApplied/Unapply/IsInstalled/PackListFile/Requeue
                            the applied.txt bookkeeping the rollback leans on

  and from launcher\app\VeloUpdate.cs, read rather than run, since the
  launcher's own update is Velopack's (#4825) and needs an install of it:

      FetchLauncher         the package and the Update.exe that applies it are
                            checked against the signer before the update is
                            marked checked, and a refusal deletes the package
      ApplyLauncher         only a checked update is applied

  Each method is lifted out of the real Updater.cs (the brace-matched body,
  the way test-play-stuck-game.ps1 does it), with Http.CopyBody out of the
  real Http.cs, and built by the .NET 10 SDK the way the launcher project
  builds (Build-LauncherCode in tests\Launcher-Csc.ps1), beside stand-ins for
  Paths, PlayProgress, Swallow, VersionDoc, Install and SyncRecord.
  Http.Send is a stand-in that hands back scripted answers and bytes, so
  nothing touches the network, and the temp folder points at a scratch
  folder so what a download leaves behind can be counted.

  No process is started apart from the built driver. Writes only to its own
  temp folder and the harness builds under out\harness.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the launcher's own build, by the .NET 10 SDK (#4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$AppDir = Join-Path $Repo 'launcher\app'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host "$script:pass passed, $script:fail failed"
    exit $(if ($script:fail) { 1 } else { 0 })
}
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

$upPath = Join-Path $AppDir 'Updater.cs'
$httpPath = Join-Path $AppDir 'Http.cs'
$veloPath = Join-Path $AppDir 'VeloUpdate.cs'
Yes 'Updater.cs, Http.cs and VeloUpdate.cs are in the launcher source' ((Test-Path -LiteralPath $upPath) -and (Test-Path -LiteralPath $httpPath) -and (Test-Path -LiteralPath $veloPath))
if (-not ((Test-Path -LiteralPath $upPath) -and (Test-Path -LiteralPath $httpPath) -and (Test-Path -LiteralPath $veloPath))) { Done }
$up = [IO.File]::ReadAllText($upPath, [Text.Encoding]::UTF8)
$http = [IO.File]::ReadAllText($httpPath, [Text.Encoding]::UTF8)
$velo = [IO.File]::ReadAllText($veloPath, [Text.Encoding]::UTF8)

$sigs = @(
    'static HttpRequestMessage FeedAsk(Config cfg, bool octet, string url, bool gzip)',
    'static HttpRequestException Refused(HttpResponseMessage res)',
    'static string CacheFile',
    'static void WriteCache(Cached c, byte[] body)',
    'static string OneLine(string s)',
    'static Cached ReadCache()',
    'static Exception WrapFeedFail(Exception ex, bool fromHost)',
    'public static HashSet<string> Applied()',
    'public static void Skip(string id)',
    'static void MarkApplied(string id)',
    'static void Unapply(string id)',
    'public static bool IsInstalled(string id)',
    'static string PackListFile(string id)',
    'static string Sha256(string file)',
    'public static string Fetch(Config cfg, string url, string expectSha, Action<string> log)',
    'static string Download(Config cfg, string url, string expectSha, Action<string> log)',
    'public static void ApplyPack(Config cfg, Pack p, Action<string> log)',
    'public static int Requeue()'
)
$bodies = @()
foreach ($sig in $sigs) {
    $b = Body $up $sig
    Yes "lifted $sig" ($b.Length -gt 0)
    $bodies += $b
}
foreach ($c in @('const string CacheMagic', 'const string ListHeader', 'const int AnswerMs')) {
    $m = [regex]::Match($up, [regex]::Escape($c) + '\s*=\s*[^;]+;')
    Yes "lifted $c" $m.Success
    $bodies += $m.Value
}
$httpBodies = @()
$b = Body $http 'public static void CopyBody(HttpResponseMessage response, Stream to, int readMs, Action<long> onBytes)'
Yes 'lifted Http.CopyBody' ($b.Length -gt 0)
$httpBodies += $b
$m = [regex]::Match($http, 'public const int DefaultReadMs\s*=\s*[^;]+;')
Yes 'lifted Http.DefaultReadMs' $m.Success
$httpBodies += $m.Value
if ($script:fail) { Done }

Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts-update-dl-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$scratchTemp = Join-Path $tmp 'temp'
$profile = Join-Path $tmp 'profile'
New-Item -ItemType Directory -Path $scratchTemp, $profile, (Join-Path $profile 'packs') | Out-Null

$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
namespace Thornswood
{
    class Config { public string UpdateToken; }
    class RecordRef { }
    class Pack { public string id, url, sha256; public RecordRef Record; public VersionDoc Doc; }
    class VersionDoc
    {
        public string said;
        public static VersionDoc Parse(byte[] b)
        {
            string s = Encoding.UTF8.GetString(b);
            if (!s.StartsWith("{") || !s.EndsWith("}")) return null;
            var d = new VersionDoc(); d.said = s; return d;
        }
    }
    static class Paths
    {
        public static string ProfileDir, AppliedFile, PacksDir;
        public static bool Collection;
    }
    static class Swallow { public static int Notes; public static void Note(string w, Exception e) { Notes++; } }
    static class PlayProgress
    {
        public static long LastGot = -9, LastLen = -9; public static int Done;
        public static void Part(long got, long len) { LastGot = got; LastLen = len; }
        public static void PartDone() { Done++; }
    }

    // Scripted answers: the status, the bytes to hand back, a Content-Length
    // to claim, and a point at which the stream breaks.
    static class Net
    {
        public static int Status = 200;
        public static byte[] Body = new byte[0];
        public static long Claim = -1;
        public static int BreakAt = -1;
        public static int Opens;
        public static List<string> UrlsChecked = new List<string>();
        public static string RefuseUrl, Accept, Auth;
    }
    // Not seekable, as a network stream is not, so no length is worked out
    // from it: only a claimed Content-Length gives one.
    class BreakingStream : Stream
    {
        readonly byte[] data; int pos; int left;
        public BreakingStream(byte[] b, int breakAt) { data = b; left = breakAt; }
        public override bool CanRead { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return false; } }
        public override long Length { get { throw new NotSupportedException(); } }
        public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override void Flush() { }
        public override long Seek(long o, SeekOrigin s) { throw new NotSupportedException(); }
        public override void SetLength(long v) { throw new NotSupportedException(); }
        public override void Write(byte[] b, int o, int c) { throw new NotSupportedException(); }
        public override int Read(byte[] buf, int off, int count)
        {
            if (left == 0) throw new IOException("connection reset");
            if (left > 0) count = Math.Min(count, left);
            int n = Math.Min(count, data.Length - pos);
            Buffer.BlockCopy(data, pos, buf, off, n);
            pos += n;
            if (left > 0) left -= n;
            return n;
        }
        public override Task<int> ReadAsync(byte[] buf, int off, int count, CancellationToken t)
        {
            try { return Task.FromResult(Read(buf, off, count)); }
            catch (Exception e) { return Task.FromException<int>(e); }
        }
    }

    // Http.cs's CopyBody as it is, with Send standing in for the network.
    static class Http
    {
        public static HttpResponseMessage Send(HttpRequestMessage request, int waitMs)
        {
            Net.Opens++;
            IEnumerable<string> v;
            Net.Accept = request.Headers.TryGetValues("Accept", out v) ? string.Join(",", v) : "";
            Net.Auth = request.Headers.TryGetValues("Authorization", out v) ? string.Join(",", v) : "";
            var res = new HttpResponseMessage((HttpStatusCode)Net.Status);
            res.ReasonPhrase = Net.Status == 200 ? "OK" : "Not Found";
            res.Content = new StreamContent(new BreakingStream(Net.Body, Net.BreakAt));
            if (Net.Claim >= 0) res.Content.Headers.ContentLength = Net.Claim;
            return res;
        }

/*HTTP*/
    }

    static partial class Updater
    {
        public static readonly string Version = "0.0.0";
        class Cached { public string Url, Etag, LastModified; public VersionDoc Doc; }

        static void CheckUrl(string url)
        {
            Net.UrlsChecked.Add(url);
            if (url == Net.RefuseUrl) throw new Exception("The update feed pointed at elsewhere. Refused.");
        }

        public static int Installs, Syncs; public static string InstalledFrom; public static bool InstallThrows, ZipThereDuringInstall;
        public static void Install(string zip, Pack p, Action<string> log)
        {
            Installs++; InstalledFrom = zip; ZipThereDuringInstall = File.Exists(zip);
            if (InstallThrows) throw new InvalidDataException("not a zip");
            MarkApplied(p.id);
        }
        public static void SyncRecord(Config cfg, RecordRef r, VersionDoc v, Action<string> log) { Syncs++; }
        // The feed read whole (FeedSettings.cs, #1050); this harness's feeds name no settings file.
        static VersionDoc ReadFeed(byte[] body, string feedUrl, Config fetchWith) { return VersionDoc.Parse(body); }

/*BODIES*/
    }

    static class Drive
    {
        static int pass, fail;
        static void Yes(string what, bool c) { Console.WriteLine((c ? "PASS  " : "FAIL  ") + what); if (c) pass++; else fail++; }
        static List<string> logged = new List<string>();
        static void Log(string s) { logged.Add(s); }
        static Config cfg = new Config();

        static string Hex(byte[] b)
        {
            using (var h = SHA256.Create())
            {
                var sb = new StringBuilder();
                foreach (byte x in h.ComputeHash(b)) sb.Append(x.ToString("x2"));
                return sb.ToString();
            }
        }
        static int Parts() { return Directory.GetFiles(Path.GetTempPath(), "thornswood-*.bin").Length; }
        static void Clear()
        {
            foreach (string f in Directory.GetFiles(Path.GetTempPath(), "thornswood-*")) File.Delete(f);
            Net.Status = 200; Net.Body = new byte[0]; Net.Claim = -1; Net.BreakAt = -1; Net.Opens = 0; Net.UrlsChecked.Clear(); Net.RefuseUrl = null;
            Net.Accept = null; Net.Auth = null; cfg.UpdateToken = null;
            PlayProgress.LastGot = -9; PlayProgress.LastLen = -9; PlayProgress.Done = 0;
            logged.Clear();
            Installs = 0; Syncs = 0; InstalledFrom = null; InstallThrows = false; ZipThereDuringInstall = false;
            if (File.Exists(Paths.AppliedFile)) File.Delete(Paths.AppliedFile);
        }
        static int Installs { get { return Updater.Installs; } set { Updater.Installs = value; } }
        static int Syncs { get { return Updater.Syncs; } set { Updater.Syncs = value; } }
        static string InstalledFrom { get { return Updater.InstalledFrom; } set { Updater.InstalledFrom = value; } }
        static bool InstallThrows { get { return Updater.InstallThrows; } set { Updater.InstallThrows = value; } }
        static bool ZipThereDuringInstall { get { return Updater.ZipThereDuringInstall; } set { Updater.ZipThereDuringInstall = value; } }

        static Exception Try(Action a) { try { a(); return null; } catch (Exception e) { return e; } }

        static int Main(string[] args)
        {
            Paths.ProfileDir = args[0];
            Paths.AppliedFile = Path.Combine(args[0], "applied.txt");
            Paths.PacksDir = Path.Combine(args[0], "packs");
            byte[] body = new byte[200000];
            new Random(7).NextBytes(body);
            string sha = Hex(body);
            const string url = "https://github.com/EvilPatrick06/Thornswood-Releases/releases/download/x/pack.zip";

            // ---------- Download ----------
            Clear(); Net.Body = body; Net.Claim = body.Length; cfg.UpdateToken = "a token";
            string got = null;
            Exception e = Try(() => got = Updater.Fetch(cfg, url, sha, Log));
            Yes("download: right checksum hands back the file", e == null && got != null && File.Exists(got));
            Yes("download: the file holds exactly the bytes sent", got != null && File.Exists(got) && Hex(File.ReadAllBytes(got)) == sha);
            Yes("download: the url is checked before the fetch", Net.UrlsChecked.Count == 1 && Net.UrlsChecked[0] == url);
            Yes("download: asks for the bytes as they are, and sends the token to no host but GitHub's API", Net.Accept == "application/octet-stream" && Net.Auth == "");
            Yes("download: says the checksum was verified", logged.Contains("Checksum verified."));
            Yes("download: progress ends at the full length and is closed", PlayProgress.LastGot == body.Length && PlayProgress.LastLen == body.Length && PlayProgress.Done == 1);

            Clear(); Net.Body = body;
            e = Try(() => got = Updater.Fetch(cfg, url, sha.ToUpperInvariant(), Log));
            Yes("download: an upper-case checksum still matches", e == null);
            Yes("download: no Content-Length reads as unknown length (-1)", PlayProgress.LastLen == -1);

            Clear(); Net.Body = body; Net.Claim = body.Length;
            string wrong = sha.Substring(0, 63) + (sha[63] == '0' ? "1" : "0");
            e = Try(() => Updater.Fetch(cfg, url, wrong, Log));
            Yes("download: wrong checksum is rejected", e != null && e.Message.Contains("Checksum did not match"));
            Yes("download: the rejected file is deleted", Parts() == 0);
            Yes("download: a rejected file never says verified", !logged.Contains("Checksum verified."));

            Clear(); Net.Body = body;
            e = Try(() => Updater.Fetch(cfg, url, "", Log));
            Yes("download: no checksum refuses before asking for a byte", e != null && e.Message.Contains("without a checksum") && Net.Opens == 0);
            Clear();
            e = Try(() => Updater.Fetch(cfg, url, null, Log));
            Yes("download: a null checksum is refused the same way", e != null && Net.Opens == 0 && Parts() == 0);

            Clear(); Net.Body = body; Net.RefuseUrl = url;
            e = Try(() => Updater.Fetch(cfg, url, sha, Log));
            Yes("download: an address the url check refuses fetches nothing", e != null && e.Message.Contains("Refused") && Net.Opens == 0 && Parts() == 0);

            Clear(); Net.Body = body; Net.Status = 404;
            e = Try(() => Updater.Fetch(cfg, url, sha, Log));
            Yes("download: an answer that is not 2xx is refused, saying the status, and leaves nothing", e is HttpRequestException && e.Message.Contains("404") && Parts() == 0 && PlayProgress.Done == 0);

            Clear(); Net.Body = body; Net.Claim = body.Length; Net.BreakAt = 100000;
            e = Try(() => Updater.Fetch(cfg, url, sha, Log));
            Yes("download: a connection that breaks mid-file throws", e is IOException);
            Yes("download: the part file is deleted after the break", Parts() == 0);
            Yes("download: progress is not closed as done after a break", PlayProgress.Done == 0);

            Clear(); Net.Body = new byte[150000]; Buffer.BlockCopy(body, 0, Net.Body, 0, 150000); Net.Claim = body.Length;
            e = Try(() => Updater.Fetch(cfg, url, sha, Log));
            Yes("download: a file cut short with no error fails its checksum", e != null && e.Message.Contains("Checksum did not match"));
            Yes("download: and the short file is deleted", Parts() == 0);

            Clear(); Net.Body = (byte[])body.Clone(); Net.Body[1234] ^= 0xFF;
            e = Try(() => Updater.Fetch(cfg, url, sha, Log));
            Yes("download: one flipped byte is rejected and deleted", e != null && Parts() == 0);

            Clear(); Net.Body = new byte[0];
            e = Try(() => Updater.Fetch(cfg, url, sha, Log));
            Yes("download: an empty answer is rejected and deleted", e != null && Parts() == 0);

            // ---------- ApplyPack ----------
            var p = new Pack(); p.id = "pack-a"; p.url = url; p.sha256 = sha;
            Clear(); Net.Body = body; File.WriteAllText(Paths.AppliedFile, "PACK-A\r\n");
            e = Try(() => Updater.ApplyPack(cfg, p, Log));
            Yes("apply: a pack already in (any case) is not fetched again", e == null && Net.Opens == 0 && Installs == 0 && logged.Contains("pack-a is already in."));

            Clear(); Net.Body = body;
            e = Try(() => Updater.ApplyPack(cfg, p, Log));
            Yes("apply: a new pack is downloaded and installed", e == null && Installs == 1 && ZipThereDuringInstall);
            Yes("apply: the zip is deleted after a good install", InstalledFrom != null && !File.Exists(InstalledFrom) && Parts() == 0);
            Yes("apply: and the pack reads as installed", Updater.IsInstalled("pack-a"));

            Clear(); Net.Body = body; InstallThrows = true;
            e = Try(() => Updater.ApplyPack(cfg, p, Log));
            Yes("apply: an install that throws passes the error up", e is InvalidDataException);
            Yes("apply: the zip is deleted after a failed install", InstalledFrom != null && !File.Exists(InstalledFrom) && Parts() == 0);
            Yes("apply: a failed install is not written as applied", !Updater.IsInstalled("pack-a"));

            Clear(); Net.Body = body;
            e = Try(() => Updater.ApplyPack(cfg, new Pack { id = "pack-b", url = url, sha256 = wrong }, Log));
            Yes("apply: a pack failing its checksum is not installed or applied", e != null && Installs == 0 && !Updater.IsInstalled("pack-b"));

            Clear();
            e = Try(() => Updater.ApplyPack(cfg, new Pack { id = "release-9", Record = new RecordRef() }, Log));
            Yes("apply: a release record syncs and downloads nothing", e == null && Syncs == 1 && Net.Opens == 0 && Installs == 0);

            // ---------- Feed cache ----------
            string cacheFile = Path.Combine(Paths.ProfileDir, "feed-cache.txt");
            byte[] doc = Encoding.UTF8.GetBytes("{\"version\":\"1.2.1\",\"packs\":[]}");
            Updater_Cache.Write("https://thornswood.net/feed/version.json", "W/\"abc\"\r\nX-Evil: 1", "Sat, 10 Oct 2026 00:00:00 GMT", doc);
            Yes("cache: the copy is written to Profile\\feed-cache.txt", File.Exists(cacheFile));
            Yes("cache: no .tmp is left beside it", Directory.GetFiles(Paths.ProfileDir, "feed-cache.txt.*.tmp").Length == 0);
            string[] r = Updater_Cache.Read();
            Yes("cache: reads back the url", r != null && r[0] == "https://thornswood.net/feed/version.json");
            Yes("cache: a tag with a line break in it is kept on one line", r != null && r[1] == "W/\"abc\"X-Evil: 1");
            Yes("cache: reads back Last-Modified and the document", r != null && r[2] == "Sat, 10 Oct 2026 00:00:00 GMT" && r[3] == Encoding.UTF8.GetString(doc));

            File.WriteAllText(cacheFile, "Thornswood feed cache 0\nu\ne\nl\n{}");
            Yes("cache: an older shape is not believed", Updater_Cache.Read() == null);
            File.WriteAllText(cacheFile, "Thornswood feed cache 1\nu\ne");
            Yes("cache: a header cut short is not believed", Updater_Cache.Read() == null);
            File.WriteAllText(cacheFile, "Thornswood feed cache 1\nu\ne\nl\n");
            Yes("cache: a header with no document is not believed", Updater_Cache.Read() == null);
            File.WriteAllText(cacheFile, "Thornswood feed cache 1\nu\ne\nl\n{\"version\":\"1.2");
            Yes("cache: a document cut short is not believed", Updater_Cache.Read() == null);
            File.WriteAllText(cacheFile, "Thornswood feed cache 1\r\nu\r\ne\r\nl\r\n{}");
            r = Updater_Cache.Read();
            Yes("cache: CRLF line ends still read", r != null && r[0] == "u" && r[1] == "e" && r[2] == "l");
            File.Delete(cacheFile);
            Yes("cache: no file reads as no cache", Updater_Cache.Read() == null);
            string keep = Paths.ProfileDir; Paths.ProfileDir = null;
            Updater_Cache.Write("u", "e", "l", doc);
            Yes("cache: no Profile folder writes nothing and reads null", Updater_Cache.Read() == null && !File.Exists(cacheFile));
            Paths.ProfileDir = keep;

            // ---------- WrapFeedFail ----------
            // Http.Send throws TimeoutException when the answer did not start
            // in time, and HttpRequestException when there was none at all.
            Exception w = Updater_Wrap.Wrap(new TimeoutException("t"), true);
            Yes("feed fail: a timeout says the site feed did not answer in time", w.Message.StartsWith("the site update feed did not answer in time"));
            w = Updater_Wrap.Wrap(new TimeoutException("t"), false);
            Yes("feed fail: a GitHub timeout names GitHub", w.Message.StartsWith("GitHub did not answer in time"));
            var own = new Exception("The update feed gave an address that is not an address.");
            Yes("feed fail: the launcher's own message passes through untouched", Object.ReferenceEquals(Updater_Wrap.Wrap(own, true), own));
            w = Updater_Wrap.Wrap(new HttpRequestException("Name or service not known (thornswood.net:443)"), true);
            Yes("feed fail: anything else says could not reach the site feed", w.Message == "could not reach the site update feed");

            // ---------- applied.txt bookkeeping ----------
            Clear();
            Updater.Skip(""); Updater.Skip(null);
            Yes("bookkeeping: skipping no id writes nothing", !File.Exists(Paths.AppliedFile));
            Updater.Skip("dead-pack");
            Yes("bookkeeping: a skipped pack reads as applied", Updater.IsInstalled("dead-pack") && Updater.IsInstalled("DEAD-PACK"));
            Yes("bookkeeping: an empty id is never installed", !Updater.IsInstalled("") && !Updater.IsInstalled(null));
            File.WriteAllText(Paths.AppliedFile, "a\r\n  Pack-X  \r\n\r\nb\r\npack-x\r\n");
            Updater_Book.Unapply("PACK-X");
            var left = Updater.Applied();
            Yes("bookkeeping: Unapply takes out every copy of the id, any case", !left.Contains("pack-x") && left.Contains("a") && left.Contains("b") && left.Count == 2);
            Updater_Book.Unapply("not-there");
            Yes("bookkeeping: Unapply of an id that is not there keeps the rest", Updater.Applied().Count == 2);
            // What the system refuses in a name: on Windows / : * ?, which is
            // where the launcher runs; elsewhere only /.
            string listName = OperatingSystem.IsWindows() ? "a_b_c_d_.files" : "a_b:c*d?.files";
            Yes("bookkeeping: a pack list name has no characters the system refuses in a name", Path.GetFileName(Updater_Book.ListOf("a/b:c*d?")) == listName);

            // Requeue
            Clear();
            Directory.CreateDirectory(Paths.PacksDir);
            File.WriteAllText(Paths.AppliedFile, "headed\r\nbare\r\nseeded\r\n");
            File.WriteAllText(Updater_Book.ListOf("headed"), "\r\n# fence=game\r\nN|game\\x.esp\r\n");
            File.WriteAllText(Updater_Book.ListOf("bare"), "N|profile\\x.ini\r\n");
            Paths.Collection = false;
            Yes("requeue: does nothing off a collection install", Updater.Requeue() == 0 && Updater.Applied().Count == 3);
            Paths.Collection = true;
            int n = Updater.Requeue();
            var after = Updater.Applied();
            Yes("requeue: a list without the fence header is applied again", n == 1 && !after.Contains("bare") && !File.Exists(Updater_Book.ListOf("bare")));
            Yes("requeue: a headed list and a seeded pack with no list are kept", after.Contains("headed") && after.Contains("seeded") && File.Exists(Updater_Book.ListOf("headed")));
            Yes("requeue: a second run finds nothing", Updater.Requeue() == 0);
            Paths.Collection = false;

            Console.WriteLine("DRIVER " + pass + " " + fail);
            return fail == 0 ? 0 : 1;
        }
    }

    // Windows into the private members, so the cases above read plainly.
    static partial class Updater
    {
        internal static void CacheWrite(string u, string e, string l, byte[] b) { var c = new Cached(); c.Url = u; c.Etag = e; c.LastModified = l; WriteCache(c, b); }
        internal static string[] CacheRead() { var c = ReadCache(); return c == null ? null : new[] { c.Url, c.Etag, c.LastModified, c.Doc.said }; }
        internal static Exception WrapX(Exception e, bool h) { return WrapFeedFail(e, h); }
        internal static void UnapplyX(string id) { Unapply(id); }
        internal static string ListOfX(string id) { return PackListFile(id); }
    }
    static class Updater_Cache
    {
        public static void Write(string u, string e, string l, byte[] b) { Updater.CacheWrite(u, e, l, b); }
        public static string[] Read() { return Updater.CacheRead(); }
    }
    static class Updater_Wrap
    {
        public static Exception Wrap(Exception e, bool h) { return Updater.WrapX(e, h); }
    }
    static class Updater_Book
    {
        public static void Unapply(string id) { Updater.UnapplyX(id); }
        public static string ListOf(string id) { return Updater.ListOfX(id); }
    }
}
'@

$text = $driver.Replace('/*BODIES*/', ($bodies -join "`r`n`r`n")).Replace('/*HTTP*/', ($httpBodies -join "`r`n`r`n"))
$dll = $null
try { $dll = Build-LauncherCode -Source $text -Exe }
catch {
    Yes 'the lifted methods build with the launcher''s settings beside the stand-ins' $false
    foreach ($l in @(($_.Exception.Message -split "`r?`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20)) { Write-Host "    $l" }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Done
}
Yes 'the lifted methods build with the launcher''s settings beside the stand-ins' ($null -ne $dll)

# Path.GetTempPath reads TMP and TEMP on Windows and TMPDIR elsewhere.
$oldTmp = $env:TMP; $oldTemp = $env:TEMP; $oldTmpDir = $env:TMPDIR
try {
    $env:TMP = $scratchTemp; $env:TEMP = $scratchTemp; $env:TMPDIR = $scratchTemp
    $lines = @(Invoke-LauncherExe $dll $profile)
    $code = $LASTEXITCODE
} finally { $env:TMP = $oldTmp; $env:TEMP = $oldTemp; $env:TMPDIR = $oldTmpDir }
foreach ($l in $lines) {
    if ($l -match '^PASS  (.*)$') { Yes $Matches[1] $true }
    elseif ($l -match '^FAIL  (.*)$') { Yes $Matches[1] $false }
}
Yes ('the driver ran to the end (exit ' + $code + ')') (($lines | Where-Object { $_ -like 'DRIVER *' }).Count -eq 1)

# ---- the launcher's own update (VeloUpdate.cs) ----------------------------------
# What SelfUpdate made sure of before #4825, in the update Velopack applies: the
# package and Velopack's Update.exe are checked against the signer before the
# update is marked checked, a refusal deletes the package and says nothing was
# replaced, and only a checked update is applied.
$fetch = Body $velo 'public static void FetchLauncher(LauncherUpdate u, Action<string> log)'
$apply = Body $velo 'public static void ApplyLauncher(LauncherUpdate u)'
Yes 'lifted FetchLauncher and ApplyLauncher out of VeloUpdate.cs' ($fetch.Length -gt 0 -and $apply.Length -gt 0)
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

Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
Done
