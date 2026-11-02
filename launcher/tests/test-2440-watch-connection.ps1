<#
  test-2440-watch-connection.ps1

      pwsh -NoProfile -File .\launcher\tests\test-2440-watch-connection.ps1

  The launcher's feed watch keeps its socket out of the two connections the
  rest of the launcher shares with thornswood.net.

  WHY THIS EXISTS. The .NET Framework, which the launcher ran on until
  #4823, let a program keep two connections to
  a host at a time (ServicePointManager.DefaultConnectionLimit), and a request
  waits for a free one inside its own timeout. From #2440 on, an open launcher
  keeps one long-poll to the site's /feed/watch open all the time, fifty
  seconds a wait, and it sat in the same connection group as everything else,
  so the Play page's gallery list, its pictures (up to 5.7 MB each), the voice
  token and the news took turns on the one connection left. A picture held the
  rest back, and a request whose timeout ran out while it waited failed:
  Patrick's launcher.log on 30 Oct, 7:08 PM, says "Voice: could not get a join
  token (The operation has timed out)", and the gallery list read the same way
  leaves Play's card hidden. Patrick's report the same evening: the Play
  gallery goes blank or loads its pictures slowly, where it used to turn
  through them steadily. Updater.Tip then put the watch in a connection group
  of its own (Updater.WatchGroup), which counts its connections apart.

  Since the move to .NET 10 (#4823) the launcher's requests go through
  HttpClient (Http.cs, and Gallery's own), whose SocketsHttpHandler sets no
  limit on the connections to a host unless told to, so the group went with
  the .NET Framework. What has to stay true is the same: the watch's open
  request holds none of the others back.

  What it proves, against a server of its own on 127.0.0.1:
    - with the feed watch held open through Updater.Tip and another request
      held in the same shared client, a third through Http.Send still
      answers at once
    - with the watch held and one picture downloading, the gallery's own
      GetBytes still answers at once
    - no launcher file puts a limit on the connections to a host back

  HOW. Builds the launcher project with the .NET 10 SDK and loads it
  (Add-LauncherAssembly in Launcher-Csc.ps1), as
  test-2636-feed-watch-quiet.ps1 does, and calls Updater.Tip, Http.Send and
  Gallery.GetBytes by reflection. Nothing under C:\Thornswood is read or
  written and nothing leaves 127.0.0.1.

  Runs in pwsh 7 on any system the .NET 10 SDK is on.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the launcher's own build, by the .NET 10 SDK (#4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Here = Split-Path -Parent (Split-Path -Parent $Here)
$Src = Join-Path $Here 'launcher\app'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts2440c-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Force -Path $tmp

# ---- a site of its own, on 127.0.0.1 ------------------------------------------
#
# /feed/watch and /hold are held for HoldMs and then answered (204 and a body
# of 200 bytes); /quick is answered at once. Every answer closes its socket.
# TsRun runs a launcher method on a thread of its own: the watch, a request
# held in the shared client, and a gallery picture that is still downloading.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;

public class TsSite2440
{
    TcpListener listener;
    public int Port;
    public volatile int HoldMs = 4000;

    public void Start()
    {
        listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        Port = ((IPEndPoint)listener.LocalEndpoint).Port;
        var t = new Thread(Loop);
        t.IsBackground = true;
        t.Start();
    }

    public void Stop() { listener.Stop(); }

    // How many requests the site is holding open right now, so the harness
    // knows the held ones really reached it before it asks the others.
    int holding;
    public int Holding { get { return Volatile.Read(ref holding); } }
    void Hold()
    {
        Interlocked.Increment(ref holding);
        try { Thread.Sleep(HoldMs); }
        finally { Interlocked.Decrement(ref holding); }
    }

    void Loop()
    {
        while (true)
        {
            TcpClient c;
            try { c = listener.AcceptTcpClient(); }
            catch (SocketException) { return; }
            catch (ObjectDisposedException) { return; }
            var t = new Thread(() => Serve(c));
            t.IsBackground = true;
            t.Start();
        }
    }

    void Serve(TcpClient c)
    {
        using (c)
        {
            try
            {
                var s = c.GetStream();
                var sb = new StringBuilder();
                int b;
                while ((b = s.ReadByte()) >= 0)
                {
                    sb.Append((char)b);
                    if (sb.Length >= 4 && sb.ToString(sb.Length - 4, 4) == "\r\n\r\n") break;
                }
                string first = sb.ToString().Split(new[] { "\r\n" }, StringSplitOptions.None)[0];
                string head;
                byte[] body = new byte[0];
                if (first.Contains("/feed/watch"))
                {
                    Hold();
                    head = "HTTP/1.1 204 No Content\r\n";
                }
                else
                {
                    if (first.Contains("/hold")) Hold();
                    body = new byte[200];
                    head = "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n";
                }
                head += "Content-Length: " + body.Length + "\r\nConnection: close\r\n\r\n";
                byte[] h = Encoding.ASCII.GetBytes(head);
                s.Write(h, 0, h.Length);
                if (body.Length > 0) s.Write(body, 0, body.Length);
                s.Flush();
            }
            catch (IOException) { }
        }
    }
}

// What the call threw, if anything, is kept for the harness to print: an
// exception left to escape a thread ends the whole PowerShell.
public class TsRun
{
    public Thread Thread;
    public volatile string Error = "";

    public static TsRun Start(MethodInfo m, object[] args)
    {
        var r = new TsRun();
        r.Thread = new Thread(() =>
        {
            try { m.Invoke(null, args); }
            catch (Exception e)
            {
                Exception x = e is TargetInvocationException && e.InnerException != null ? e.InnerException : e;
                r.Error = x.GetType().Name + ": " + x.Message;
            }
        });
        r.Thread.IsBackground = true;
        r.Thread.Start();
        return r;
    }

    public bool Join(int ms) { return Thread.Join(ms); }
}
'@

function Run {
    Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
    if (-not (Test-Path -LiteralPath $LauncherDotnet)) { return }

    # The launcher project itself, built as the build builds it, and loaded
    # into this PowerShell, which runs on .NET 10 as the launcher does.
    $asm = $null
    try { $asm = Add-LauncherAssembly }
    catch {
        Yes 'the launcher project builds' $false
        foreach ($l in @(($_.Exception.Message -split "`r?`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20)) { Write-Host "      $l" }
        return
    }
    Yes 'the launcher project builds' ($null -ne $asm)
    if ($null -eq $asm) { return }
    $U = $asm.GetType('Thornswood.Updater')
    $G = $asm.GetType('Thornswood.Gallery')
    $H = $asm.GetType('Thornswood.Http')
    $C = $asm.GetType('Thornswood.Config')
    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    $tipM = $U.GetMethod('Tip', $flags)
    $getM = $G.GetMethod('GetBytes', $flags)
    $sendM = if ($null -ne $H) { $H.GetMethod('Send', $flags) } else { $null }
    Yes 'Updater.Tip, Gallery.GetBytes and Http.Send are in the build' ($null -ne $tipM -and $null -ne $getM -and $null -ne $sendM)
    if ($null -eq $tipM -or $null -eq $getM -or $null -eq $sendM) { return }
    $cfg = [Activator]::CreateInstance($C)

    $srv = New-Object TsSite2440
    $srv.HoldMs = 4000
    $srv.Start()
    try {
        $base = "http://127.0.0.1:$($srv.Port)"

        # The gallery's own read, the way the Play page asks for its list.
        function Quick([string]$path) {
            $sw = [Diagnostics.Stopwatch]::StartNew()
            $got = $getM.Invoke($null, [object[]]@("$base$path", 2000))
            $sw.Stop()
            return @{ Got = $got; Seconds = $sw.Elapsed.TotalSeconds }
        }
        # A request through Http.Send, the shared client the watch goes
        # through too, the way the voice token and the news are asked for.
        function Shared([string]$path) {
            $sw = [Diagnostics.Stopwatch]::StartNew()
            $code = 0
            try {
                # ::new, not New-Object: New-Object hands back the request
                # wrapped in a PSObject, which reflection cannot pass to Send.
                $req = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, "$base$path")
                $res = $sendM.Invoke($null, [object[]]@($req.psobject.BaseObject, 2000))
                $code = [int]$res.StatusCode
                $res.Dispose()
            } catch { $code = -1 }
            $sw.Stop()
            return @{ Code = $code; Seconds = $sw.Elapsed.TotalSeconds }
        }

        # ---- the watch takes nothing the rest needs ------------------------------
        # The feed watch held open through Updater.Tip, a request held in the
        # same shared client beside it, and a gallery picture still
        # downloading: on the .NET Framework that was the two connections a
        # host got, and the next request waited and timed out.
        $w = [TsRun]::Start($tipM, [object[]]@($cfg, "$base/feed/watch", '', 10000))
        $heldReq = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Get, "$base/hold?shared")
        $s = [TsRun]::Start($sendM, [object[]]@($heldReq.psobject.BaseObject, 10000))
        $p = [TsRun]::Start($getM, [object[]]@("$base/hold?picture", 10000))
        # Until the site holds all three, for two seconds at most.
        $until = [DateTime]::UtcNow.AddSeconds(2)
        while ($srv.Holding -lt 3 -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 50 }
        Yes ("the site is holding the watch, the shared request and the picture before the others ask ($($srv.Holding) held)") ($srv.Holding -eq 3)
        $q = Shared '/quick?voice'
        Yes ('with the feed watch and another request held in the shared client, a third through it answers in {0:N1} s' -f $q.Seconds) (
            $q.Code -eq 200 -and $q.Seconds -lt 1.5)
        $q = Quick '/quick?gallery'
        Yes ('with the feed watch held and a picture downloading, the gallery''s request answers in {0:N1} s' -f $q.Seconds) (
            $null -ne $q.Got -and $q.Got.Length -eq 200 -and $q.Seconds -lt 1.5)
        [void]$w.Join(10000); [void]$s.Join(10000); [void]$p.Join(10000)
        if ($w.Error) { Write-Host ('      the watch ended with ' + $w.Error) }
        if ($s.Error) { Write-Host ('      the shared request ended with ' + $s.Error) }
        if ($p.Error) { Write-Host ('      the picture ended with ' + $p.Error) }
    }
    finally { $srv.Stop() }

    # Nothing in the launcher puts a limit back on the connections to a host
    # (SocketsHttpHandler's MaxConnectionsPerServer is unlimited unless set).
    $set = @(Get-ChildItem (Join-Path $Src '*.cs') -File | Where-Object {
        [IO.File]::ReadAllText($_.FullName) -match 'MaxConnectionsPerServer\s*=|ServicePointManager\.|ConnectionLimit\s*='
    } | ForEach-Object { $_.Name })
    Yes ('no launcher file sets a limit on the connections to a host' + $(if ($set.Count) { ': ' + ($set -join ', ') } else { '' })) ($set.Count -eq 0)
}

try { Run }
catch { $script:fail++; Write-Host "FAIL  the harness itself threw: $($_.Exception.Message)" }
finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$($script:pass) passed, $($script:fail) failed"
if ($script:fail) { exit 1 }
exit 0
