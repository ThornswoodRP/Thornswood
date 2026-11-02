<#
  test-2434-main-version-live.ps1

      pwsh -NoProfile -File .\launcher\tests\test-2434-main-version-live.ps1

  The dev News tab names what main is on from main's own feed, read when the
  tab is shown, and the dev feed's copy only when main's feed cannot be read
  (#2434).

  WHY THIS EXISTS. Patrick, 12 Oct: "dev says main is on 1.2.3 even tho it's
  on 1.2.4 is there not a way to make this dynamic". Measured that day: main's
  feed said launcherVersion 1.2.4 and the dev feed said mainVersion 1.2.4 from
  11:55 AM, and the tab still said 1.2.3, because it read mainVersion out of
  the dev feed as the launcher last checked it (pendingDoc), and a launcher
  left open never checks again by itself. What this proves, against a server
  of its own on 127.0.0.1:
    - Updater.MainVersionAt reads launcherVersion out of a feed, trimmed, with
      or without a byte order mark, and leaves the update check's own cache
      alone
    - a feed that names no launcher version, a body that is not a feed, an
      error from the server and a port nobody answers on each throw with a
      reason, never an empty answer
    - MainLauncherVersion asks Updater.MainFeed, through CheckUrl, the way every
      feed read goes
    - the header reads "Main is on" with main's answer, "Main was on ... when
      the launcher last checked for updates" with the dev feed's copy until
      main has answered or when main's feed failed, and says why once in
      launcher.log
    - BuildNews asks only while the News page is the one shown, and keeps the
      header line so an answer lands without rebuilding the list

  HOW. Builds launcher\app\Thornswood.csproj as it is, with the .NET 10 SDK
  the launcher builds with (Add-LauncherAssembly, tests\Launcher-Csc.ps1,
  #4823), loads it into this PowerShell, which runs on .NET 10 as the
  launcher does, and calls the methods by reflection. So it runs on any
  machine with the SDK. Paths points at a temp folder. Nothing under
  C:\Thornswood is read or written, and nothing leaves 127.0.0.1.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's SDK (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Here = Split-Path -Parent (Split-Path -Parent $Here)
$Src = Join-Path (Join-Path $Here 'launcher') 'app'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tsmainver-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Force -Path $tmp

# ---- a server of its own, on 127.0.0.1 ---------------------------------------
# Answers every request with Status and Body, and counts what it was asked.
Add-Type -TypeDefinition @'
using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public class TsMainFeedServer
{
    TcpListener listener;
    public int Port;
    public volatile string Status = "200 OK";
    public volatile byte[] Body = new byte[0];
    int asked;

    public void Start()
    {
        listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var t = new Thread(Loop);
        t.IsBackground = true;
        t.Start();
    }

    public void Stop()
    {
        try { listener.Stop(); } catch (Exception) { }
    }

    public int Asked() { return Interlocked.CompareExchange(ref asked, 0, 0); }

    void Loop()
    {
        while (true)
        {
            TcpClient c;
            try { c = listener.AcceptTcpClient(); } catch (Exception) { return; }
            try { Serve(c); } catch (Exception) { }
            finally { c.Close(); }
        }
    }

    void Serve(TcpClient c)
    {
        var s = c.GetStream();
        var sb = new StringBuilder();
        int b;
        while ((b = s.ReadByte()) >= 0)
        {
            sb.Append((char)b);
            if (sb.Length >= 4 && sb.ToString(sb.Length - 4, 4) == "\r\n\r\n") break;
        }
        byte[] body = Body;
        byte[] h = Encoding.ASCII.GetBytes("HTTP/1.1 " + Status + "\r\nContent-Type: application/json\r\nContent-Length: " + body.Length + "\r\nConnection: close\r\n\r\n");
        s.Write(h, 0, h.Length);
        if (body.Length > 0) s.Write(body, 0, body.Length);
        s.Flush();
        Interlocked.Increment(ref asked);
    }
}
'@

function Utf8([string]$s) { return ,([byte[]][Text.Encoding]::UTF8.GetBytes($s)) }

function Run {
    Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
    if (-not (Test-Path -LiteralPath $LauncherDotnet)) { return }
    $asm = $null
    try { $asm = Add-LauncherAssembly } catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes 'the launcher builds from its project, the way the build makes it' ($null -ne $asm)
    if ($null -eq $asm) { return }

    $U = $asm.GetType('Thornswood.Updater')
    $S = $asm.GetType('Thornswood.Shell')
    $P = $asm.GetType('Thornswood.Paths')
    $C = $asm.GetType('Thornswood.Config')
    $V = $asm.GetType('Thornswood.VersionDoc')
    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    $mAt = $U.GetMethod('MainVersionAt', $flags)
    $mLive = $U.GetMethod('MainLauncherVersion', $flags)
    $fCached = $U.GetField('cached', $flags)
    $mHead = $S.GetMethod('DevHeadText', $flags)
    $mRead = $S.GetMethod('MainVersionRead', $flags)
    $fPending = $S.GetField('pendingDoc', $flags)
    $fLive = $S.GetField('mainLive', $flags)
    $fReading = $S.GetField('mainReading', $flags)
    Yes 'Updater.MainLauncherVersion and MainVersionAt, and Shell.DevHeadText and MainVersionRead, are in the build' (
        $null -ne $mAt -and $null -ne $mLive -and $null -ne $mHead -and $null -ne $mRead -and $null -ne $fPending -and $null -ne $fLive)
    if ($null -eq $mAt -or $null -eq $mHead) { return }

    $profile = Join-Path $tmp 'Profile'
    $null = New-Item -ItemType Directory -Force -Path $profile
    $logFile = Join-Path $profile 'launcher.log'
    $P.GetField('ProfileDir').SetValue($null, $profile)
    $P.GetField('LogFile').SetValue($null, $logFile)
    $cfg = [Activator]::CreateInstance($C)
    function Ask([string]$url) {
        try { return @{ v = [string]$mAt.Invoke($null, @($cfg, $url)); why = '' } }
        catch { return @{ v = $null; why = [string]$_.Exception.InnerException.Message } }
    }

    # ---- 1. reading main's feed ---------------------------------------------------
    $srv = New-Object TsMainFeedServer
    $srv.Start()
    try {
        $url = "http://127.0.0.1:$($srv.Port)/feed/version.json"
        $srv.Body = Utf8 '{"launcherVersion":" 1.2.4 ","launcherUrl":"https://thornswood.net/feed/assets/x","packs":[],"news":[],"mainVersion":"9.9.9"}'
        $a = Ask $url
        Yes ('main''s launcherVersion comes back, trimmed, and not some other field: ' + $a.v + $a.why) ($a.v -eq '1.2.4' -and $srv.Asked() -eq 1)
        Yes '  and the update check''s own cache is left alone' ($null -eq $fCached.GetValue($null))
        $plain = Utf8 '{"launcherVersion":"1.2.5"}'
        $srv.Body = [byte[]](@(0xEF, 0xBB, 0xBF) + @($plain))
        $a = Ask $url
        Yes 'a feed with a byte order mark reads the same' ($a.v -eq '1.2.5')
        $a = Ask $url
        Yes 'each read asks the feed again, so a main Ship since the last one is seen' ($a.v -eq '1.2.5' -and $srv.Asked() -eq 3)

        $srv.Body = Utf8 '{"packs":[],"news":[]}'
        $a = Ask $url
        Yes ('a feed that names no launcher version throws with a reason: ' + $a.why) ($null -eq $a.v -and $a.why -match 'names no launcher version')
        $srv.Body = Utf8 '{"launcherVersion":"   "}'
        $a = Ask $url
        Yes '  and so does one that names a blank one' ($null -eq $a.v -and $a.why -match 'names no launcher version')
        $srv.Body = Utf8 '<html>not a feed</html>'
        $a = Ask $url
        Yes ('a body that is not a feed throws: ' + $a.why) ($null -eq $a.v -and $a.why.Length -gt 0)
        $srv.Status = '503 Service Unavailable'
        $srv.Body = Utf8 '{"launcherVersion":"1.2.4"}'
        $a = Ask $url
        Yes ('an error from the server throws, even with a feed in the body: ' + $a.why) ($null -eq $a.v -and $a.why -match '503')
    } finally { $srv.Stop() }
    $a = Ask $url
    Yes ('a port nobody answers on throws: ' + $a.why) ($null -eq $a.v -and $a.why.Length -gt 0)

    # ---- 2. the header ---------------------------------------------------------------
    $doc = [Activator]::CreateInstance($V)
    $doc.launcherVersion = '1.2.4.7'
    $doc.mainVersion = '1.2.3'
    $fPending.SetValue($null, $doc)
    $fLive.SetValue($null, '')
    $h = [string]$mHead.Invoke($null, @())
    Yes ('before main''s feed answers, the dev feed''s copy, worded as what it is: ' + $h) ($h -eq 'This is the dev build, on 1.2.4.7. Main was on 1.2.3 when the launcher last checked for updates.')
    [void]$mRead.Invoke($null, @('1.2.4', $null))
    $h = [string]$mHead.Invoke($null, @())
    Yes ('main''s feed answered 1.2.4, and that is what the header says: ' + $h) ($h -eq 'This is the dev build, on 1.2.4.7. Main is on 1.2.4.' -and -not [bool]$fReading.GetValue($null))
    $logBefore = if (Test-Path -LiteralPath $logFile) { [IO.File]::ReadAllText($logFile) } else { '' }
    Yes '  and a read that worked writes nothing in launcher.log' ($logBefore -notmatch 'News tab')
    [void]$mRead.Invoke($null, @($null, 'could not reach the site'))
    $h = [string]$mHead.Invoke($null, @())
    $log = if (Test-Path -LiteralPath $logFile) { [IO.File]::ReadAllText($logFile) } else { '' }
    Yes ('a read that failed goes back to the dev feed''s copy: ' + $h) ($h -eq 'This is the dev build, on 1.2.4.7. Main was on 1.2.3 when the launcher last checked for updates.')
    Yes '  and says why in launcher.log, naming main''s feed' ($log -match 'The News tab could not read what main is on from https://thornswood\.net/feed/version\.json \(could not reach the site\)')
    [void]$mRead.Invoke($null, @($null, 'a second failure'))
    $log = [IO.File]::ReadAllText($logFile)
    Yes '  once a session, not at every opening of the tab' (([regex]::Matches($log, 'The News tab could not read')).Count -eq 1)
    $doc.mainVersion = ''
    $h = [string]$mHead.Invoke($null, @())
    Yes ('with neither main''s answer nor the dev feed''s copy, it names only the dev build: ' + $h) ($h -eq 'This is the dev build, on 1.2.4.7.')
    $fLive.SetValue($null, '1.2.4')
    $fPending.SetValue($null, $null)
    $h = [string]$mHead.Invoke($null, @())
    Yes ('with no dev feed read yet, main''s answer still shows: ' + $h) ($h -eq 'This is the dev build. Main is on 1.2.4.')
    $fLive.SetValue($null, '')

    # ---- 3. where it is asked, and the fence -------------------------------------------
    $mv = Get-Content -LiteralPath (Join-Path $Src 'MainVersion.cs') -Raw
    Yes 'MainLauncherVersion asks Updater.MainFeed through CheckUrl, then reads it' ($mv -match '(?s)public static string MainLauncherVersion\(Config cfg\).*?CheckUrl\(MainFeed\);\s*return MainVersionAt\(cfg, MainFeed\);')
    Yes '  and MainFeed is main''s feed' ([string]$U.GetField('MainFeed', $flags).GetValue($null) -eq 'https://thornswood.net/feed/version.json')
    $thrown = ''
    try { [void]$U.GetMethod('CheckUrl', $flags).Invoke($null, @('http://thornswood.net/feed/version.json')) } catch { $thrown = $_.Exception.InnerException.Message }
    Yes '  the fence it goes through refuses plain http' ($thrown -match 'plain http')
    $sn = Get-Content -LiteralPath (Join-Path $Src 'ShellNews.cs') -Raw
    Yes 'BuildNews asks main''s feed only on a dev build, and only while the News page is the one shown' ($sn -match '(?s)if \(cfg\.IsDev\)\s*\{.*?if \(pages != null && pages\[PageNews\]\.IsVisible\) ReadMainVersion\(\);')
    Yes 'BuildNews keeps the header line, so an answer is put in without rebuilding the list' ($sn -match 'newsHead = ht;' -and $sn -match '(?s)static void MainVersionRead\(string got, string why\).*?if \(newsHead != null\) newsHead\.Text = DevHeadText\(\);')
    Yes 'the read is on a pool thread and the answer comes back on the window''s' ($sn -match '(?s)static void ReadMainVersion\(\).*?ThreadPool\.QueueUserWorkItem.*?Updater\.MainLauncherVersion\(cfg\).*?Dispatcher\.UIThread\.Post\(delegate \{ MainVersionRead\(got, why\); \}\);')
    Yes 'one read at a time' ($sn -match '(?s)static void ReadMainVersion\(\)\s*\{\s*if \(mainReading\) return;\s*mainReading = true;')
    Yes 'the DEV marks are the notes'' own (ReleaseNews.cs marks them from main''s Deployment)' ($sn -match 'if \(items\[i\]\.IsDev\) ahead\+\+;')
}

try {
    try { Run }
    catch { Yes ('the harness ran to the end, and stopped on: ' + $_.Exception.Message) $false }
}
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
