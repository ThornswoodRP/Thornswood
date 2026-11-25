<#
  test-6244-nexus.ps1

      pwsh -NoProfile -File .\tests\test-6244-nexus.ps1

  launcher\app\Nexus.cs (#6244): the launcher's Nexus sign in and the
  downloads a Nexus Premium account gets through Nexus's API, for the modlist
  install's Nexus files.

  WHY. The launcher is taking the mods' downloads over from Vortex, so it has
  to sign a person in to Nexus itself. The sign in is the account's, so it has
  to be one only this launcher could have started, its tokens are worth
  stealing, and a file Nexus sends is used only when it is the modlist's.

  WHAT IT HOLDS, against a stand-in for Nexus (its sign in, its API and its
  file server) on 127.0.0.1, with a stand-in browser:
    N  SignIn sends the browser to Nexus's sign in page with the client id,
       the address to come back to, a state and an S256 code challenge;
       trades the code with the verifier that challenge was made from; reads
       who signed in and whether the account is Premium; keeps it, sealed;
       and every request names the launcher and its version;
    G  an answer to the address that does not carry this sign in's state is
       answered and ignored, and the sign in goes on to the real one; a
       refusal from Nexus stops it, saying what Nexus said; a launcher with no
       client id says it is not registered, without opening anything;
    T  a token that ends within a minute is renewed with the refresh token
       and kept; one Nexus will not renew asks for a sign in again; sign out
       forgets it;
    D  Download asks Nexus for the file's link and puts the file in downloads
       under its name, so the install finds it; a file that is not the
       modlist's is not kept; a free account is told to use Manual Download
       without asking Nexus; nobody signed in is told to sign in;
    R  ModlistSetup.Run installs a modlist whole: 7-Zip and Mod Organizer 2
       from GitHub (the stand-in answers GitHub's API too), a Nexus file
       already in Vortex's folder taken from there, and the rest from Nexus
       for a Premium account, which is asked only for those; a run again asks
       nothing; a free account's run stopped before its files land keeps what
       it got and says how to go on, and pressed again opens each file's page
       in turn and puts every file in place; a whole install leaves the
       record of what goes into the game folder (ModlistSetup.Deployment),
       naming the modlist, which a run again leaves as it was, a record for
       another modlist is written again, and a run that stops writes none; a
       mod's settings file changed since the last whole install is kept,
       while one still as that install wrote it takes the modlist's copy, the
       last install's record set aside for that and gone once the new one is
       written;
    M  VeloRecord.Modlist writes the modlist a Release's signed record names,
       from that Release through GitHub's API, only when it is the sha256 and
       size the record gives; a record with no modlist says so.

  Builds the launcher from launcher\app\Thornswood.csproj with the modlist
  writer beside it (tests\Launcher-Csc.ps1) and calls these by reflection, with
  Nexus.Users, Nexus.Api and GitHub.OtherApi at the stand-in, a stand-in 7-Zip
  that unpacks zips, and the tokens sealed as plain
  text (Secrets.cs is Windows only). Nothing leaves 127.0.0.1. Writes only
  under a folder of its own in the temp folder, removed at the end.
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')
$Repo = Split-Path -Parent $PSScriptRoot
$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond, [string]$detail = '') {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" -ForegroundColor Green }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red; if ($detail) { Write-Host "      $detail" } }
}

# A stand-in for Nexus: the token and userinfo addresses of its sign in, the
# download_link address of its API, and its file server, all on one port.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

public class TsNexusStandIn
{
    HttpListener listener;
    public int Port;
    public string ClientId = "", Back = "", Challenge = "", Code = "";
    public string Access = "", Refresh = "";
    public long ExpiresIn = 21600;
    public bool Premium = true;
    public string RefuseToken = "";
    public int Issued;
    public readonly Dictionary<string, byte[]> Files = new Dictionary<string, byte[]>();
    // GitHub's API, for the whole install: each path answers with its bytes.
    public readonly Dictionary<string, byte[]> Answers = new Dictionary<string, byte[]>();
    public readonly List<string> Seen = new List<string>();

    public string[] Asked() { lock (Seen) return Seen.ToArray(); }
    public void Clear() { lock (Seen) Seen.Clear(); }

    public void Start()
    {
        var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start(); Port = ((IPEndPoint)probe.LocalEndpoint).Port; probe.Stop();
        listener = new HttpListener();
        listener.Prefixes.Add("http://127.0.0.1:" + Port + "/");
        listener.Start();
        var t = new Thread(Loop); t.IsBackground = true; t.Start();
    }

    public void Stop() { try { listener.Stop(); } catch (Exception e) { Console.Error.WriteLine("stand-in stop: " + e.Message); } }

    void Loop()
    {
        while (true)
        {
            HttpListenerContext c;
            try { c = listener.GetContext(); } catch (Exception) { return; }
            try { Serve(c); } catch (Exception e) { Console.Error.WriteLine("stand-in: " + e.Message); try { c.Response.Abort(); } catch (Exception) { return; } }
        }
    }

    static string Url64(byte[] b) { return Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_'); }

    void Send(HttpListenerContext c, int status, string type, byte[] body)
    {
        c.Response.StatusCode = status; c.Response.ContentType = type; c.Response.ContentLength64 = body.Length;
        c.Response.OutputStream.Write(body, 0, body.Length); c.Response.Close();
    }
    void Json(HttpListenerContext c, int status, string json) { Send(c, status, "application/json", Encoding.UTF8.GetBytes(json)); }

    string Token()
    {
        Issued++;
        Access = "access-" + Issued; Refresh = "refresh-" + Issued;
        return "{\"access_token\":\"" + Access + "\",\"refresh_token\":\"" + Refresh + "\",\"expires_in\":" + ExpiresIn + ",\"token_type\":\"Bearer\"}";
    }

    void Serve(HttpListenerContext c)
    {
        string path = c.Request.Url.AbsolutePath;
        string body = new StreamReader(c.Request.InputStream).ReadToEnd();
        lock (Seen) Seen.Add(c.Request.HttpMethod + " " + path + " name=" + c.Request.Headers["Application-Name"] + " version=" + c.Request.Headers["Application-Version"] + (body.Length > 0 ? " " + body : ""));
        string bearer = c.Request.Headers["Authorization"] ?? "";
        if (path == "/oauth/token" && c.Request.HttpMethod == "POST")
        {
            var f = new Dictionary<string, string>();
            foreach (string kv in body.Split('&')) { int i = kv.IndexOf('='); if (i > 0) f[Uri.UnescapeDataString(kv.Substring(0, i))] = Uri.UnescapeDataString(kv.Substring(i + 1).Replace('+', ' ')); }
            string v;
            if (!f.TryGetValue("client_id", out v) || v != ClientId) { Json(c, 401, "{\"error\":\"invalid_client\"}"); return; }
            if (f.TryGetValue("grant_type", out v) && v == "authorization_code")
            {
                string verifier;
                bool ok = f.TryGetValue("code", out v) && v == Code && f.TryGetValue("redirect_uri", out v) && v == Back
                          && f.TryGetValue("code_verifier", out verifier) && Url64(SHA256.HashData(Encoding.ASCII.GetBytes(verifier))) == Challenge;
                if (!ok) { Json(c, 400, "{\"error\":\"invalid_grant\",\"error_description\":\"The code or its verifier is not this sign in's.\"}"); return; }
                Json(c, 200, Token()); return;
            }
            if (f.TryGetValue("grant_type", out v) && v == "refresh_token")
            {
                if (!f.TryGetValue("refresh_token", out v) || v != Refresh || RefuseToken == v) { Json(c, 400, "{\"error\":\"invalid_grant\",\"error_description\":\"The refresh token is not good.\"}"); return; }
                Json(c, 200, Token()); return;
            }
            Json(c, 400, "{\"error\":\"unsupported_grant_type\"}"); return;
        }
        if (path.StartsWith("/repos/"))
        {
            byte[] g;
            if (Answers.TryGetValue(path, out g)) { Send(c, 200, path.Contains("/assets/") ? "application/octet-stream" : "application/json", g); return; }
            Json(c, 404, "{\"message\":\"Not Found\"}"); return;
        }
        if (path.StartsWith("/cdn/"))
        {
            byte[] b;
            if (Files.TryGetValue(path.Substring(5), out b)) { Send(c, 200, "application/octet-stream", b); return; }
            Json(c, 404, "{\"message\":\"No such file.\"}"); return;
        }
        if (bearer != "Bearer " + Access) { Json(c, 401, "{\"message\":\"Token is not valid.\"}"); return; }
        if (path == "/oauth/userinfo") { Json(c, 200, "{\"sub\":\"7\",\"name\":\"Ada\",\"membership_roles\":[\"member\"" + (Premium ? ",\"premium\"" : "") + "]}"); return; }
        if (path.StartsWith("/v1/games/skyrimspecialedition/mods/") && path.EndsWith("/download_link.json"))
        {
            if (!Premium) { Json(c, 403, "{\"message\":\"You don't have permission to get download links from the API without visting nexusmods.com\"}"); return; }
            string[] p = path.Split('/');
            Json(c, 200, "[{\"name\":\"Nexus CDN\",\"short_name\":\"Nexus CDN\",\"URI\":\"http://127.0.0.1:" + Port + "/cdn/" + p[7] + "\"}]"); return;
        }
        Json(c, 404, "{\"message\":\"No such thing.\"}");
    }
}

// The person's browser, going where the launcher sent it without the launcher
// waiting on it: one address, or a stray one first and then the real one.
public static class TsNexusBrowser
{
    static readonly System.Net.Http.HttpClient Client = new System.Net.Http.HttpClient();
    public static void Go(string url) { System.Threading.Tasks.Task.Run(() => Client.GetAsync(url)); }
    public static void StrayThen(string stray, string url)
    {
        System.Threading.Tasks.Task.Run(async () => { await Client.GetAsync(stray); await Client.GetAsync(url); });
    }
}
'@

$T = Join-Path ([IO.Path]::GetTempPath()) ('ts-6244n-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
New-Item -ItemType Directory -Path $T -Force | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)
function Bytes([string]$s) { return ,([byte[]]$utf8.GetBytes($s)) }
# The message a call stopped with (a ModlistStop), or '' when it did not stop.
function Stop-Of([scriptblock]$run) {
    try { & $run | Out-Null; return '' }
    catch {
        $e = $_.Exception
        while ($e -and $e.GetType().FullName -ne 'Thornswood.ModlistStop') { $e = $e.InnerException }
        if ($e) { return $e.Message }
        return 'not a ModlistStop: ' + $_.Exception.Message
    }
}
function Query([string]$url) {
    $q = @{}
    foreach ($kv in ([Uri]$url).Query.TrimStart('?').Split('&')) { $i = $kv.IndexOf('='); if ($i -gt 0) { $q[[Uri]::UnescapeDataString($kv.Substring(0, $i))] = [Uri]::UnescapeDataString($kv.Substring($i + 1)) } }
    return $q
}

$srv = New-Object TsNexusStandIn
$srv.Start()
try {
    $asm = $null
    try { $asm = Add-LauncherType -Launcher -File (Join-Path $Repo 'scripts/release/WabbajackModlist.cs') } catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes 'the launcher builds from its project, the way the build makes it, with the modlist writer' ($null -ne $asm)
    if ($null -eq $asm) { throw 'no launcher to hold' }

    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    $N = $asm.GetType('Thornswood.Nexus')
    $version = [string]$asm.GetType('Thornswood.Updater').GetField('Version', $flags).GetValue($null)
    $base = "http://127.0.0.1:$($srv.Port)"
    $N.GetField('Users', $flags).SetValue($null, $base)
    $N.GetField('Api', $flags).SetValue($null, $base + '/v1')
    $N.GetField('ClientId', $flags).SetValue($null, 'thornswood-test')
    $profile = Join-Path $T 'Profile'
    $N.GetField('Folder', $flags).SetValue($null, $profile)
    $plain = [Func[string, string]] { param($s) 'sealed:' + $s }
    $unplain = [Func[string, string]] { param($s) if ($s.StartsWith('sealed:')) { $s.Substring(7) } else { '' } }
    $N.GetField('Seal', $flags).SetValue($null, $plain)
    $N.GetField('Unseal', $flags).SetValue($null, $unplain)
    $srv.ClientId = 'thornswood-test'
    $registered = [string]$N.GetProperty('Back', $flags).GetValue($null)
    Yes 'N0 the launcher uses the registered loopback address in production' ($registered -ceq 'http://127.0.0.1:53150/nexus') $registered
    # A separate callback prefix can share the stand-in's already-bound port.
    # Keep the real loopback callback without competing for the production port.
    $callback = $base + '/nexus'
    $srv.Back = $callback
    $kept = Join-Path $profile 'nexus.txt'
    $signIn = $N.GetMethod('SignInOnLoopbackPort', $flags)
    $who = $N.GetProperty('Who', $flags)

    # The browser: what it was sent to, and how it answers.
    $script:sentTo = @()
    $script:browse = 'good'
    $open = [Action[string]] {
        param($url)
        $script:sentTo += $url
        $q = Query $url
        $srv.Challenge = $q['code_challenge']
        $srv.Code = 'code-' + [Guid]::NewGuid().ToString('N').Substring(0, 6)
        $to = $q['redirect_uri']
        # Not awaited: the launcher only reads the answer once open returns.
        $real = $to + '?code=' + $srv.Code + '&state=' + [Uri]::EscapeDataString($q['state'])
        switch ($script:browse) {
            'good' { [TsNexusBrowser]::Go($real) }
            'stray' { [TsNexusBrowser]::StrayThen($to + '?code=stolen&state=not-this-one', $real) }
            'refused' { [TsNexusBrowser]::Go($to + '?error=access_denied&error_description=' + [Uri]::EscapeDataString('The person said no') + '&state=' + [Uri]::EscapeDataString($q['state'])) }
        }
    }
    function Sign-In { return $signIn.Invoke($null, [object[]]@($open, [TimeSpan]::FromSeconds(20), $srv.Port)) }

    # ------------------------------------------------------------------ N ----
    $acct = Sign-In
    $q = Query $script:sentTo[0]
    Yes 'N1 the browser goes to Nexus''s sign in page with the client id, the address back, a state and an S256 challenge' (
        $script:sentTo[0].StartsWith($base + '/oauth/authorize?') -and $q['response_type'] -eq 'code' -and $q['client_id'] -eq 'thornswood-test' -and
        $q['redirect_uri'] -ceq $callback -and $q['code_challenge_method'] -eq 'S256' -and $q['state'].Length -ge 32 -and $q['code_challenge'].Length -eq 43) $script:sentTo[0]
    $token = @($srv.Asked() | Where-Object { $_.StartsWith('POST /oauth/token') })
    Yes 'N2 the code is traded with the verifier the challenge was made from' ($token.Count -eq 1 -and $token[0].Contains('grant_type=authorization_code') -and $srv.Issued -eq 1) ($srv.Asked() -join ' | ')
    Yes 'N3 who signed in, and that the account is Premium' ($acct.Name -eq 'Ada' -and $acct.Premium)
    $text = [IO.File]::ReadAllText($kept)
    Yes 'N4 the tokens are kept sealed, and read back' ($text.StartsWith('sealed:') -and $text.Contains('"access":"access-1"') -and $text.Contains('"refresh":"refresh-1"') -and $who.GetValue($null).Name -eq 'Ada')
    $named = @($srv.Asked() | Where-Object { -not $_.Contains("name=Thornswood version=$version") })
    Yes 'N5 every request to Nexus names the launcher and its version' ($srv.Asked().Count -ge 2 -and $named.Count -eq 0) ($named -join ' | ')

    # ------------------------------------------------------------------ G ----
    $srv.Clear(); $script:browse = 'stray'
    $acct = Sign-In
    Yes 'G1 an answer without this sign in''s state is ignored, and the real one still signs in' ($acct.Name -eq 'Ada' -and $srv.Issued -eq 2)
    $script:browse = 'refused'
    $why = Stop-Of { Sign-In }
    Yes 'G2 a refusal from Nexus stops it, saying what Nexus said' ($why.Contains('Nexus did not sign you in: The person said no')) $why
    $N.GetField('ClientId', $flags).SetValue($null, '')
    $script:sentTo = @()
    $why = Stop-Of { Sign-In }
    Yes 'G3 with no client id it says the launcher is not registered, and opens nothing' ($why.Contains('not registered with Nexus') -and $script:sentTo.Count -eq 0) $why
    $N.GetField('ClientId', $flags).SetValue($null, 'thornswood-test')

    # ------------------------------------------------------------------ T ----
    $tokenM = $N.GetMethod('Token', $flags)
    $srv.ExpiresIn = 30
    $script:browse = 'good'
    [void](Sign-In)
    $before = $srv.Access
    $renewed = $tokenM.Invoke($null, @())
    Yes 'T1 a token that ends within a minute is renewed with the refresh token, and the new one kept' ($renewed -ne $before -and $renewed -eq $srv.Access -and [IO.File]::ReadAllText($kept).Contains('"access":"' + $renewed + '"') -and $who.GetValue($null).Premium)
    $srv.RefuseToken = $srv.Refresh
    $why = Stop-Of { $tokenM.Invoke($null, @()) }
    Yes 'T2 one Nexus will not renew asks for a sign in again' ($why.Contains('press Sign in to Nexus again') -and $why.Contains('The refresh token is not good')) $why
    $srv.RefuseToken = ''; $srv.ExpiresIn = 21600
    [void]$N.GetMethod('SignOut', $flags).Invoke($null, @())
    Yes 'T3 sign out forgets it' (-not (Test-Path -LiteralPath $kept) -and $null -eq $who.GetValue($null))

    # ------------------------------------------------------------------ D ----
    $download = $N.GetMethod('Download', $flags)
    $fileB = [byte[]](1..120 | ForEach-Object { [byte]($_ * 11 % 256) })
    $a = New-Object Thornswood.ModlistArchive
    $a.Name = 'Thing-400-4-0.7z'; $a.Size = $fileB.Length; $a.Hash = [Thornswood.XxHash64]::OfBytes($fileB); $a.Kind = 'nexus'; $a.Game = 'SkyrimSpecialEdition'; $a.ModId = 400; $a.FileId = 4000; $a.ModName = 'Thing'
    $dl = Join-Path $T 'downloads'
    function Down { [void]$download.Invoke($null, [object[]]@($a.psobject.BaseObject, [string]$dl, $null)) }
    $why = Stop-Of { Down }
    Yes 'D1 nobody signed in is told to sign in, or to use Manual Download' ($why.Contains('Nobody is signed in to Nexus here')) $why
    [void](Sign-In)
    $srv.Clear()
    $srv.Files['4000'] = $fileB
    $why = Stop-Of { Down }
    $mine = Join-Path $dl 'Thing-400-4-0.7z'
    Yes 'D2 a Premium account''s file comes through the link Nexus gives, into downloads under its name' ($why -eq '' -and (Test-Path -LiteralPath $mine) -and [Linq.Enumerable]::SequenceEqual([byte[]][IO.File]::ReadAllBytes($mine), $fileB) -and @(Get-ChildItem -LiteralPath $dl).Count -eq 1) ($why + ' | ' + ($srv.Asked() -join ' | '))
    Yes 'D3 asking Nexus for the link with the account''s token' (@($srv.Asked() | Where-Object { $_.StartsWith('GET /v1/games/skyrimspecialedition/mods/400/files/4000/download_link.json') }).Count -eq 1)
    $wm = New-Object Thornswood.Layout.Modlist
    $wm.AddNexusArchive($a.Name, $fileB.Length, $a.Hash, 'skyrimspecialedition', 400, 4000, 'Thing', '4.0')
    $wm.Inline((Bytes 'x'), 'portable.txt', $false)
    $wmf = Join-Path $T 'nexus.wabbajack'; $wm.Save($wmf)
    Yes 'D4 so the install finds it there' ([Thornswood.ModlistInstall]::Missing([Thornswood.CollectionModlist]::Read($wmf), $dl).Count -eq 0)
    Remove-Item -LiteralPath $mine
    $other = [byte[]]$fileB.Clone(); $other[3] = 0
    $srv.Files['4000'] = $other
    $why = Stop-Of { Down }
    Yes 'D5 a file that is not the modlist''s is not kept' ($why.Contains('is not the file the modlist names') -and @(Get-ChildItem -LiteralPath $dl).Count -eq 0) $why
    $srv.Premium = $false; [void](Sign-In); $srv.Clear()
    $why = Stop-Of { Down }
    Yes 'D6 a free account is told to use Manual Download, without asking Nexus' ($why.Contains('Premium account only') -and $srv.Asked().Count -eq 0) $why

    # ------------------------------------------------------------------ R ----
    # The whole install, ModlistSetup.Run: 7-Zip and Mod Organizer 2 from
    # GitHub (this stand-in answers GitHub's API too), one Nexus file already
    # in Vortex's folder, the rest from Nexus for a Premium account, then by
    # hand for a free one. Every archive is a zip, and the stand-in 7-Zip
    # unpacks zips.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $G = $asm.GetType('Thornswood.GitHub')
    $SZ = $asm.GetType('Thornswood.SevenZip')
    $PinT = $asm.GetType('Thornswood.SevenZip+Pin')
    $Setup = $asm.GetType('Thornswood.ModlistSetup')
    $StepsT = $asm.GetType('Thornswood.ModlistSetup+Steps')
    $PlaceT = $asm.GetType('Thornswood.ModlistFetch+Place')
    $G.GetField('OtherApi', $flags).SetValue($null, $base + '/repos/')
    [void]$G.GetMethod('Forget', $flags).Invoke($null, @())
    function Sha([byte[]]$b) { return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($b)).ToLowerInvariant() }
    function Zip([hashtable]$files) {
        $ms = New-Object IO.MemoryStream
        $za = New-Object IO.Compression.ZipArchive($ms, [IO.Compression.ZipArchiveMode]::Create, $true)
        try { foreach ($k in ($files.Keys | Sort-Object)) { $st = $za.CreateEntry($k).Open(); try { $b = [byte[]]$files[$k]; $st.Write($b, 0, $b.Length) } finally { $st.Dispose() } } } finally { $za.Dispose() }
        return ,($ms.ToArray())
    }
    function New-Pin([string]$name, [byte[]]$b) {
        $p = [Activator]::CreateInstance($PinT)
        $PinT.GetField('Name').SetValue($p, $name); $PinT.GetField('Size').SetValue($p, [long]$b.Length); $PinT.GetField('Sha256').SetValue($p, (Sha $b))
        return $p
    }
    function Release([string]$repo, [string]$tag, $assets) {
        $list = @(foreach ($x in $assets) {
            $srv.Answers['/repos/' + $repo + '/releases/assets/' + $x.id] = [byte[]]$x.bytes
            '{"id":' + $x.id + ',"url":"' + $base + '/repos/' + $repo + '/releases/assets/' + $x.id + '","name":"' + $x.name + '","size":' + $x.bytes.Length + ',"state":"uploaded","digest":"sha256:' + (Sha $x.bytes) + '"}'
        })
        $srv.Answers['/repos/' + $repo + '/releases/tags/' + $tag] = (Bytes ('{"tag_name":"' + $tag + '","name":"' + $tag + '","draft":false,"prerelease":false,"published_at":"2025-08-03T00:00:00Z","assets":[' + ($list -join ',') + ']}'))
    }
    $unpacker = Bytes 'a stand-in for 7zr.exe'
    $exeB = Bytes 'a stand-in for 7z.exe'; $dllB = Bytes 'a stand-in for 7z.dll'
    $installer = Zip @{ '7z.exe' = $exeB; '7z.dll' = $dllB }
    $SZ.GetField('Unpacker', $flags).SetValue($null, (New-Pin '7zr.exe' $unpacker))
    $SZ.GetField('Installer', $flags).SetValue($null, (New-Pin '7z2501-x64.exe' $installer))
    $keptPins = [Array]::CreateInstance($PinT, 2)
    $keptPins.SetValue((New-Pin '7z.exe' $exeB), 0); $keptPins.SetValue((New-Pin '7z.dll' $dllB), 1)
    $SZ.GetField('Kept', $flags).SetValue($null, $keptPins)
    Release 'ip7z/7zip' '25.01' @(@{ id = 11; name = '7zr.exe'; bytes = $unpacker }, @{ id = 12; name = '7z2501-x64.exe'; bytes = $installer })
    # The stand-in 7-Zip: x -o<into> [--] <archive> [names], for zips.
    $SZ.GetField('Run', $flags).SetValue($null, [Func[string, Collections.Generic.IList[string], Tuple[int, string]]] {
        param($exe, $argv)
        $out = (@($argv) | Where-Object { $_.StartsWith('-o') } | Select-Object -First 1).Substring(2)
        $rest = @(@($argv) | Where-Object { -not $_.StartsWith('-') -and $_ -ne 'x' })
        New-Item -ItemType Directory -Path $out -Force | Out-Null
        $za = [IO.Compression.ZipFile]::OpenRead($rest[0])
        try {
            foreach ($e in $za.Entries) {
                if ($rest.Count -gt 1 -and $rest[1..($rest.Count - 1)] -notcontains $e.FullName) { continue }
                $to = Join-Path $out $e.FullName
                New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
                [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $to, $true)
            }
        } finally { $za.Dispose() }
        return [Tuple]::Create(0, '')
    })

    $mo2Exe = Bytes 'a stand-in for ModOrganizer.exe'
    $mo2Zip = Zip @{ 'ModOrganizer.exe' = $mo2Exe }
    Release 'ModOrganizer2/modorganizer' 'v2.5.2' @(@{ id = 21; name = 'Mod.Organizer-2.5.2.7z'; bytes = $mo2Zip })
    $espA = Bytes 'plugin A'; $espB = Bytes 'plugin B'; $espC = Bytes 'plugin C'
    $zipA = Zip @{ 'A.esp' = $espA }; $zipB = Zip @{ 'B.esp' = $espB }; $zipC = Zip @{ 'C.esp' = $espC }
    $hx = { param($b) [Thornswood.XxHash64]::OfBytes([byte[]]$b) }
    $wr = New-Object Thornswood.Layout.Modlist
    $wr.AddHttpArchive('Mod.Organizer-2.5.2.7z', $mo2Zip.Length, (& $hx $mo2Zip), 'https://github.com/ModOrganizer2/modorganizer/releases/download/v2.5.2/Mod.Organizer-2.5.2.7z')
    $wr.AddNexusArchive('A-501-1-0.zip', $zipA.Length, (& $hx $zipA), 'skyrimspecialedition', 501, 5001, 'A', '1.0')
    $wr.AddNexusArchive('B-502-1-0.zip', $zipB.Length, (& $hx $zipB), 'skyrimspecialedition', 502, 5002, 'B', '1.0')
    $wr.AddNexusArchive('C-503-1-0.zip', $zipC.Length, (& $hx $zipC), 'skyrimspecialedition', 503, 5003, 'C', '1.0')
    $wr.FromArchive((& $hx $mo2Zip), 'ModOrganizer.exe', (& $hx $mo2Exe), $mo2Exe.Length, 'ModOrganizer.exe')
    $wr.FromArchive((& $hx $zipA), 'A.esp', (& $hx $espA), $espA.Length, 'mods\A\A.esp')
    $wr.FromArchive((& $hx $zipB), 'B.esp', (& $hx $espB), $espB.Length, 'mods\B\B.esp')
    $wr.FromArchive((& $hx $zipC), 'C.esp', (& $hx $espC), $espC.Length, 'mods\C\C.esp')
    $wr.Inline((Bytes '[General]'), 'ModOrganizer.ini', $false)
    $iniA = Bytes "[A]`r`nx=1`r`n"
    $wr.Inline($iniA, 'mods\A\A.ini', $false)
    $wr.Inline((Bytes "+C`r`n+B`r`n+A`r`n"), 'profiles\Thornswood\modlist.txt', $false)
    $modlist = Join-Path $T 'collection-modlist.wabbajack'; $wr.Save($modlist)
    $modlistSha = (Get-FileHash -Algorithm SHA256 -LiteralPath $modlist).Hash.ToLowerInvariant()
    $wrVersion = [string]([Thornswood.CollectionModlist]::Read($modlist).Version)
    $modlistHead = 'modlist=' + $modlistSha + ' revision=' + $(if ($wrVersion -match '^(\d+)') { [int]$Matches[1] } else { 0 })
    function Record-Of([string]$mods) { $f = Join-Path $mods 'thornswood-deployment.txt'; if (Test-Path -LiteralPath $f) { return @([IO.File]::ReadAllLines($f)) } return @() }
    $srv.Files['5002'] = $zipB; $srv.Files['5003'] = $zipC

    $vortexR = Join-Path $T 'vortex-r'; $handR = Join-Path $T 'hand-r'
    New-Item -ItemType Directory -Path $vortexR, $handR -Force | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $vortexR 'A renamed.zip'), $zipA)
    function New-Steps($open, $stop) {
        $st = [Activator]::CreateInstance($StepsT)
        $places = [Activator]::CreateInstance([Collections.Generic.List`1].MakeGenericType($PlaceT))
        $p = [Activator]::CreateInstance($PlaceT); $PlaceT.GetField('Folder').SetValue($p, [string]$vortexR); $PlaceT.GetField('Move').SetValue($p, $false); $places.Add($p)
        $listT = [Collections.Generic.IList`1].MakeGenericType($PlaceT)
        $StepsT.GetField('Places').SetValue($st, [Linq.Expressions.Expression]::Lambda([Func`1].MakeGenericType($listT), [Linq.Expressions.Expression]::Constant($places, $listT)).Compile())
        $StepsT.GetField('HandFolder').SetValue($st, [Func[string]] ([Linq.Expressions.Expression]::Lambda([Func[string]], [Linq.Expressions.Expression]::Constant([string]$handR)).Compile()))
        $StepsT.GetField('Open').SetValue($st, $open)
        if ($stop) { $StepsT.GetField('Stop').SetValue($st, $stop) }
        $StepsT.GetField('EveryMs').SetValue($st, 10)
        return $st
    }
    $setupRun = $Setup.GetMethod('Run', $flags)
    function Run-Setup([string]$mods, $steps) { return $setupRun.Invoke($null, [object[]]@([string]$modlist, [string]$mods, [string](Join-Path $mods 'tools'), [string](Join-Path $T 'Game'), $steps.psobject.BaseObject)) }

    $srv.Premium = $true; [void](Sign-In); $srv.Clear()
    $modsR = Join-Path $T 'Mods-premium'
    $script:pages = @()
    $noPages = [Action[string]] { param($page) $script:pages += $page }
    $why = Stop-Of { Run-Setup $modsR (New-Steps $noPages $null) }
    $all = @('ModOrganizer.exe', 'ModOrganizer.ini', 'mods/A/A.esp', 'mods/B/B.esp', 'mods/C/C.esp') | ForEach-Object { Join-Path $modsR $_ }
    $have = @($all | Where-Object { Test-Path -LiteralPath $_ })
    Yes 'R1 a Premium account''s install: 7-Zip and Mod Organizer 2 from GitHub, one file from Vortex''s folder, the rest from Nexus, then every file in place' ($why -eq '' -and $have.Count -eq 5 -and $script:pages.Count -eq 0 -and (Test-Path -LiteralPath (Join-Path $vortexR 'A renamed.zip'))) ($why + ' | ' + ($all | Where-Object { $have -notcontains $_ }) -join ', ')
    $links = @($srv.Asked() | Where-Object { $_.Contains('/download_link.json') })
    Yes 'R2 Nexus is asked only for the files not already on this PC' ($links.Count -eq 2 -and -not ($links -join ' ').Contains('/mods/501/'))
    $rec = Record-Of $modsR
    Yes 'R6 the whole install leaves the record of what goes into the game folder, naming the modlist by its sha256 and its revision' ($rec.Count -eq 5 -and $rec[0] -eq $modlistHead -and $rec[1].StartsWith('Data\A.esp|A|A.esp|') -and $rec[2].StartsWith('Data\A.ini|A|A.ini|') -and $rec[4].StartsWith('Data\C.esp|C|C.esp|')) ($rec -join ' / ')
    $recFile = Join-Path $modsR 'thornswood-deployment.txt'
    [IO.File]::SetLastWriteTimeUtc($recFile, [DateTime]::UtcNow.AddHours(-1))
    $stamp = [IO.File]::GetLastWriteTimeUtc($recFile)
    $srv.Clear()
    $why = Stop-Of { Run-Setup $modsR (New-Steps $noPages $null) }
    Yes 'R3 a run again asks Nexus nothing and takes nothing' ($why -eq '' -and @($srv.Asked() | Where-Object { $_.Contains('/download_link.json') }).Count -eq 0) $why
    Yes 'R7 and leaves the record as it was, so the game folder is not brought up to date for nothing' ([IO.File]::GetLastWriteTimeUtc($recFile) -eq $stamp)
    [IO.File]::WriteAllLines($recFile, [string[]]@('modlist=an older one', 'Data\Old.esp|Old|Old.esp|0000000000000001|1'))
    $why = Stop-Of { Run-Setup $modsR (New-Steps $noPages $null) }
    $rec = Record-Of $modsR
    Yes 'R8 a record for another modlist is written again for this one' ($why -eq '' -and $rec.Count -eq 5 -and $rec[0] -eq $modlistHead -and -not (Test-Path -LiteralPath ($recFile + '.part'))) ($rec -join ' / ')

    # The person changes A.ini after the install. A run again keeps it; after
    # another modlist's install that left A.ini as it is now, the person has
    # not changed it, and the modlist's copy goes in.
    $iniAt = Join-Path $modsR 'mods/A/A.ini'
    $mine = Bytes "[A]`r`nx=1`r`nmine=1`r`n"
    [IO.File]::WriteAllBytes($iniAt, $mine)
    $why = Stop-Of { Run-Setup $modsR (New-Steps $noPages $null) }
    Yes 'R10 a mod''s settings file the person changed since the whole install is kept on a run again' ($why -eq '' -and [Linq.Enumerable]::SequenceEqual([byte[]][IO.File]::ReadAllBytes($iniAt), [byte[]]$mine)) $why
    $other = @('modlist=an older one', ('Data\A.ini|A|A.ini|' + [Thornswood.XxHash64]::OfBytes([byte[]]$mine).ToString('x16') + '|' + $mine.Length))
    [IO.File]::WriteAllLines($recFile, [string[]]$other)
    $why = Stop-Of { Run-Setup $modsR (New-Steps $noPages $null) }
    Yes 'R11 one still as another modlist''s whole install left it takes this modlist''s copy, and the record is this modlist''s' ($why -eq '' -and [Linq.Enumerable]::SequenceEqual([byte[]][IO.File]::ReadAllBytes($iniAt), [byte[]]$iniA) -and (Record-Of $modsR)[0] -eq $modlistHead) $why
    [IO.File]::WriteAllBytes($iniAt, $mine)
    [IO.File]::WriteAllLines($recFile, [string[]]@('modlist=an older one', ('Data\A.ini|A|A.ini|' + [Thornswood.XxHash64]::OfBytes([byte[]]$iniA).ToString('x16') + '|' + $iniA.Length)))
    $why = Stop-Of { Run-Setup $modsR (New-Steps $noPages $null) }
    Yes 'R12 one changed since another modlist''s whole install is kept through this one' ($why -eq '' -and [Linq.Enumerable]::SequenceEqual([byte[]][IO.File]::ReadAllBytes($iniAt), [byte[]]$mine)) $why
    Yes 'R13 and the last install''s record, set aside while it went in, is gone' (-not (Test-Path -LiteralPath (Join-Path $modsR 'thornswood-deployment-last.txt')))

    $srv.Premium = $false; [void](Sign-In)
    $modsF = Join-Path $T 'Mods-free'
    $script:pages = @()
    $script:looks = 0
    $soon = [Func[bool]] { $script:looks++; return $script:looks -gt 5 }
    $why = Stop-Of { Run-Setup $modsF (New-Steps $noPages $soon) }
    Yes 'R4 a free account''s run that stops before the files land keeps what it got and says how to go on' ($why.Contains('2 of the modlist''s Nexus files are not downloaded yet') -and $why.Contains('press Install again') -and $script:pages.Count -eq 1 -and (Test-Path -LiteralPath (Join-Path $modsF 'downloads/A-501-1-0.zip')) -and (Test-Path -LiteralPath (Join-Path $modsF 'downloads/Mod.Organizer-2.5.2.7z'))) $why
    Yes 'R9 and writes no record, so no game folder is made from a part install' ((Record-Of $modsF).Count -eq 0)
    $hand = [Action[string]] {
        param($page) $script:pages += $page
        $id = ([Uri]$page).Query -replace '.*file_id=', ''
        [IO.File]::WriteAllBytes((Join-Path $handR ('download ' + $id + '.zip')), [byte[]]$srv.Files[$id])
    }
    $script:pages = @()
    $why = Stop-Of { Run-Setup $modsF (New-Steps $hand $null) }
    $have = @(@('ModOrganizer.exe', 'mods/A/A.esp', 'mods/B/B.esp', 'mods/C/C.esp') | Where-Object { Test-Path -LiteralPath (Join-Path $modsF $_) })
    Yes 'R5 pressed again, each file''s Nexus page opens in turn, each is taken as it lands, and every file is in place' ($why -eq '' -and $script:pages.Count -eq 2 -and $have.Count -eq 4 -and @(Get-ChildItem -LiteralPath $handR).Count -eq 0) ($why + ' | ' + ($script:pages -join ' '))

    # ------------------------------------------------------------------ M ----
    # The modlist the Release's signed record names, VeloRecord.Modlist, from
    # this repository's Release through GitHub's API.
    $G.GetField('Api', $flags).SetValue($null, $base + '/repos/ThornswoodRP/Thornswood')
    $mlB = [IO.File]::ReadAllBytes($modlist)
    Release 'ThornswoodRP/Thornswood' 'build-1.3.99' @(@{ id = 31; name = 'collection-modlist.wabbajack'; bytes = $mlB })
    $VR = $asm.GetType('Thornswood.VeloRecord')
    $ManT = $asm.GetType('Thornswood.VeloRecord+Manifest'); $PartT = $asm.GetType('Thornswood.VeloRecord+PartFile')
    function New-Record([string]$sha, [long]$size, [bool]$withPart) {
        $mm = [Activator]::CreateInstance($ManT); $ManT.GetProperty('Tag').SetValue($mm, 'build-1.3.99')
        $parts = [Activator]::CreateInstance([Collections.Generic.Dictionary`2].MakeGenericType([string], $PartT.MakeArrayType()))
        if ($withPart) {
            $pf = [Activator]::CreateInstance($PartT); $PartT.GetProperty('Name').SetValue($pf, 'collection-modlist.wabbajack'); $PartT.GetProperty('Sha256').SetValue($pf, $sha); $PartT.GetProperty('Size').SetValue($pf, $size)
            $arr = [Array]::CreateInstance($PartT, 1); $arr.SetValue($pf, 0); $parts.Add('modlist', $arr)
        }
        $ManT.GetProperty('Parts').SetValue($mm, $parts)
        return $mm
    }
    function Get-Modlist($record, [string]$file) {
        try { [void]$VR.GetMethod('Modlist').Invoke($null, [object[]]@($record.psobject.BaseObject, $file)); return '' }
        catch { $e = $_.Exception; while ($e.InnerException) { $e = $e.InnerException }; return $e.Message }
    }
    $mlTo = Join-Path $T 'Mods-record/collection-modlist.wabbajack'
    $why = Get-Modlist (New-Record (Sha $mlB) $mlB.Length $true) $mlTo
    Yes 'M1 the modlist the signed record names comes from the Release, held to its sha256 and size' ($why -eq '' -and (Test-Path -LiteralPath $mlTo) -and [Linq.Enumerable]::SequenceEqual([byte[]][IO.File]::ReadAllBytes($mlTo), $mlB)) $why
    Remove-Item -LiteralPath $mlTo
    $why = Get-Modlist (New-Record (Sha (Bytes 'another modlist')) $mlB.Length $true) $mlTo
    Yes 'M2 a modlist that is not the one the record lists is refused, and nothing is written' ($why.Contains('is not the one its signed release record lists') -and @(Get-ChildItem -LiteralPath (Split-Path -Parent $mlTo)).Count -eq 0) $why
    $why = Get-Modlist (New-Record '' 0 $false) $mlTo
    Yes 'M3 a record with no modlist says this Release has none' ($why.Contains('lists no collection-modlist.wabbajack')) $why
}
finally {
    $srv.Stop()
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
