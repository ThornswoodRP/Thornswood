<#
  test-2636-feed-watch-quiet.ps1

      pwsh -NoProfile -File .\launcher\tests\test-2636-feed-watch-quiet.ps1

  An open launcher's feed watch reads a quiet wait as quiet (issue #2636).

  WHY THIS EXISTS. The launcher keeps one long-poll open to the site's
  /feed/watch (#2440). The site holds it for fifty seconds and answers 204 when
  the feed did not move, 200 when it did (measured 18 Oct against the live
  /feed-dev/watch: 204 after 50.7 seconds). Djinn's launcher.log on 17 Oct
  said "The update feed tip said the feed moved; checking now." every 50 to 51
  seconds for seventeen minutes with no Ship, a full update check about seventy
  times an hour for each open launcher. The cause: WebClient treats every 2xx
  as success, so DownloadData returns for the 204 (0 bytes, measured the same
  day in Windows PowerShell 5.1 against the live tip) and never throws, and
  Updater.WaitForFeedChange read any return as "moved" while it looked for the
  204 in its catch, where it never arrives. A client timeout was also read as
  "unchanged", which hid a tip that never answered.

  What it proves, against a tip of its own on 127.0.0.1:
    - a 204 after a wait is "not moved", three times in a row
    - a 200 is "moved"
    - the request carries the tag it was given and asks for it compressed,
      the way the site's proxy needs to match a compressed copy's tag, and
      carries no tag when there is none
    - a tip that answers nothing in time throws, so the watch logs it and
      backs off, instead of being read as "not moved"
    - an error answer and an unexpected 2xx (202) throw
    - WaitForFeedChange waits longer than the site holds the tip, read out of
      site\server.js, so the site's own 204 always arrives first

  HOW. Builds the launcher project with the .NET 10 SDK and loads it
  (Add-LauncherAssembly in Launcher-Csc.ps1), as test-feed-conditional.ps1
  does, and calls Updater.Tip by reflection: the request WaitForFeedChange
  makes after CheckUrl, which only lets https to thornswood.net through.
  Nothing under C:\Thornswood is read or written and nothing leaves 127.0.0.1.

  On main's code before #2636 there is no Updater.Tip and this fails.

  Runs in pwsh 7 on any system the .NET 10 SDK is on, because the launcher
  is a .NET 10 program now (#4823).
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

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('ts2636-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Force -Path $tmp

# ---- a tip of its own, on 127.0.0.1 -----------------------------------------
#
# Answers the way the site's /feed/watch does: holds the request for HoldMs,
# then answers Status. 204 has no body, 200 the small JSON the site sends.
# Status 0 never answers at all (the socket stays open until the client gives
# up). Every request's tag and Accept-Encoding are written down.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public class TsTipServer
{
    TcpListener listener;
    public int Port;
    public volatile int Status = 204;
    public volatile int HoldMs = 0;
    public readonly List<string[]> Seen = new List<string[]>();

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
        listener.Stop();
    }

    public string[] Last()
    {
        lock (Seen) { return Seen.Count == 0 ? null : Seen[Seen.Count - 1]; }
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

    static string Header(string[] lines, string name)
    {
        foreach (string l in lines)
        {
            int colon = l.IndexOf(':');
            if (colon > 0 && string.Equals(l.Substring(0, colon).Trim(), name, StringComparison.OrdinalIgnoreCase))
                return l.Substring(colon + 1).Trim();
        }
        return null;
    }

    void Serve(TcpClient c)
    {
        using (c)
        {
            var s = c.GetStream();
            var sb = new StringBuilder();
            int b;
            while ((b = s.ReadByte()) >= 0)
            {
                sb.Append((char)b);
                if (sb.Length >= 4 && sb.ToString(sb.Length - 4, 4) == "\r\n\r\n") break;
            }
            string[] lines = sb.ToString().Split(new[] { "\r\n" }, StringSplitOptions.None);
            int status = Status;
            lock (Seen) Seen.Add(new[] { Header(lines, "If-None-Match") ?? "", Header(lines, "Accept-Encoding") ?? "" });
            if (HoldMs > 0) Thread.Sleep(HoldMs);
            if (status == 0)
            {
                // Never answer: wait for the client to give up and close. A
                // client that gives up resets the socket, which is the end
                // this case waits for, so that is where it returns.
                try { while (s.ReadByte() >= 0) { } }
                catch (System.IO.IOException) { return; }
                return;
            }
            string head;
            byte[] body = new byte[0];
            if (status == 200)
            {
                body = Encoding.UTF8.GetBytes("{\"etag\":\"\\\"8c3-1a14cf64d50\\\"\"}");
                head = "HTTP/1.1 200 OK\r\nContent-Type: application/json; charset=utf-8\r\nCache-Control: no-store\r\nETag: \"8c3-1a14cf64d50\"\r\n";
            }
            else if (status == 204)
                head = "HTTP/1.1 204 No Content\r\nCache-Control: no-store\r\nETag: \"8c2-1a14cf64d4f\"\r\n";
            else
                head = "HTTP/1.1 " + status + " Other\r\n";
            head += "Content-Length: " + body.Length + "\r\nConnection: close\r\n\r\n";
            byte[] h = Encoding.ASCII.GetBytes(head);
            s.Write(h, 0, h.Length);
            if (body.Length > 0) s.Write(body, 0, body.Length);
            s.Flush();
        }
    }
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
    $C = $asm.GetType('Thornswood.Config')
    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    $tipM = $U.GetMethod('Tip', $flags)
    Yes 'Updater.Tip, the watch request apart from CheckUrl, is in the build' ($null -ne $tipM)
    if ($null -eq $tipM) { return }
    $cfg = [Activator]::CreateInstance($C)

    $srv = New-Object TsTipServer
    $srv.Start()
    try {
        $url = "http://127.0.0.1:$($srv.Port)/feed-dev/watch"
        $tag = '"8c2-1a14cf64d4f-gzip"'

        function Ask([string]$t, [int]$ms) {
            $script:threw = $null
            try { return [bool]$tipM.Invoke($null, [object[]]@($cfg, $url, $t, $ms)) }
            catch {
                $e = $_.Exception
                while ($null -ne $e.InnerException) { $e = $e.InnerException }
                $script:threw = $e.Message
                return $null
            }
        }

        # ---- a quiet wait is quiet -------------------------------------------
        $srv.Status = 204; $srv.HoldMs = 1500
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $r = Ask $tag 10000
        $sw.Stop()
        Yes ('a 204 after a {0:N1} s wait reads as not moved{1}' -f $sw.Elapsed.TotalSeconds, $(if ($script:threw) { ", threw $($script:threw)" } else { '' })) (
            $r -eq $false -and $null -eq $script:threw)
        $seen = $srv.Last()
        Yes 'the request carried the tag it was given' ($null -ne $seen -and $seen[0] -eq $tag)
        Yes 'and asked for it compressed, so the site''s proxy matches a compressed copy''s tag' ($null -ne $seen -and $seen[1] -match 'gzip')

        $srv.HoldMs = 200
        $moved = 0
        for ($i = 0; $i -lt 3; $i++) { if ((Ask $tag 10000) -ne $false) { $moved++ } }
        Yes ('three quiet waits in a row: {0} read as moved' -f $moved) ($moved -eq 0)

        # ---- a move is a move -------------------------------------------------
        $srv.Status = 200; $srv.HoldMs = 300
        $r = Ask $tag 10000
        Yes ('a 200 reads as moved' + $(if ($script:threw) { ", threw $($script:threw)" } else { '' })) ($r -eq $true)

        $srv.Status = 200; $srv.HoldMs = 0
        $r = Ask '' 10000
        $seen = $srv.Last()
        Yes 'with no tag in hand, no If-None-Match is sent' ($null -ne $seen -and $seen[0] -eq '')
        Yes 'and the 200 the site gives at once reads as moved' ($r -eq $true)

        # ---- anything else throws, so the watch logs it and backs off --------
        $srv.Status = 500; $srv.HoldMs = 0
        $r = Ask $tag 10000
        Yes ('a 500 throws: ' + $script:threw) ($null -eq $r -and $null -ne $script:threw)

        $srv.Status = 202; $srv.HoldMs = 0
        $r = Ask $tag 10000
        Yes ('a 202, a success but neither answer, throws: ' + $script:threw) (
            $null -eq $r -and $null -ne $script:threw -and $script:threw -match '202')

        $srv.Status = 0; $srv.HoldMs = 0
        $sw = [Diagnostics.Stopwatch]::StartNew()
        $r = Ask $tag 1500
        $sw.Stop()
        Yes ('a tip that never answers throws after {0:N1} s rather than reading as not moved: {1}' -f $sw.Elapsed.TotalSeconds, $script:threw) (
            $null -eq $r -and $null -ne $script:threw -and $script:threw -match 'in time')
    }
    finally { $srv.Stop() }

    # ---- the launcher waits longer than the site holds -----------------------
    $upd = [IO.File]::ReadAllText((Join-Path $Src 'Updater.cs'))
    # The site is server.js over its modules in site\lib since #5357.
    . (Join-Path $Here 'tests\SiteFiles.ps1')
    $site = Get-SiteSource (Join-Path $Here 'site')
    $mWait = [regex]::Match($upd, 'return\s+Tip\(\s*cfg\s*,\s*tip\s*,\s*tag\s*,\s*(\d+)\s*\)')
    $at = $site.IndexOf("const feedWatch = p.match(")
    $mHold = if ($at -ge 0) { [regex]::Match($site.Substring($at), 'WAIT_MS\s*=\s*(\d+)') } else { $null }
    Yes 'WaitForFeedChange asks through Tip with a wait in milliseconds' ($mWait.Success)
    Yes 'site\server.js /feed/watch names its WAIT_MS' ($null -ne $mHold -and $mHold.Success)
    if ($mWait.Success -and $null -ne $mHold -and $mHold.Success) {
        $client = [int]$mWait.Groups[1].Value
        $hold = [int]$mHold.Groups[1].Value
        Yes ('the launcher waits {0} ms, at least five seconds past the site''s {1} ms hold, so the site''s 204 arrives first' -f $client, $hold) (
            $client -ge $hold + 5000)
    }
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
