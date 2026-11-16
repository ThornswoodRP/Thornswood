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
       without asking Nexus; nobody signed in is told to sign in.

  Builds the launcher from launcher\app\Thornswood.csproj with the modlist
  writer beside it (tests\Launcher-Csc.ps1) and calls these by reflection, with
  Nexus.Users and Nexus.Api at the stand-in and the tokens sealed as plain
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
    $back = [string]$N.GetProperty('Back', $flags).GetValue($null)
    $srv.Back = $back
    $kept = Join-Path $profile 'nexus.txt'
    $signIn = $N.GetMethod('SignIn', $flags)
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
    function Sign-In { return $signIn.Invoke($null, [object[]]@($open, [TimeSpan]::FromSeconds(20))) }

    # ------------------------------------------------------------------ N ----
    $acct = Sign-In
    $q = Query $script:sentTo[0]
    Yes 'N1 the browser goes to Nexus''s sign in page with the client id, the address back, a state and an S256 challenge' (
        $script:sentTo[0].StartsWith($base + '/oauth/authorize?') -and $q['response_type'] -eq 'code' -and $q['client_id'] -eq 'thornswood-test' -and
        $q['redirect_uri'] -eq 'http://127.0.0.1:53150/nexus' -and $q['code_challenge_method'] -eq 'S256' -and $q['state'].Length -ge 32 -and $q['code_challenge'].Length -eq 43) $script:sentTo[0]
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
}
finally {
    $srv.Stop()
    if (Test-Path -LiteralPath $T) { Remove-Item -LiteralPath $T -Recurse -Force }
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
