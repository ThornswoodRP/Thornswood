<#
  test-voice-ticket.ps1

  The Discord ticket only goes to the voice service over https.

  WHY (To Do 144). The ticket is a thirty day credential, as good as the
  person's Discord account to the site, and the launcher keeps it under DPAPI
  on disk. Voice.FetchToken posts it to the voice service's /token route to
  get a join token, at conf.VoiceBase(). VoiceBase gives the feed's VoiceUrl
  when there is one, which is https://thornswood.net/voice on this machine
  and /voice-dev on the dev build, and falls back to http://address:7778 when
  VoiceUrl is empty. It is empty on a new install until the first update check
  fills it in, and the feed can empty it on purpose, which is the rollback
  path in Publish-Update.ps1 and Shell.cs. Every one of those posted the
  ticket in the clear. Nothing else in the launcher sends the ticket anywhere
  but Discord.Site, which is https.

  This lifts FetchToken, JsonEscape and the HttpClient FetchToken sends with
  (TokenHttp) out of the shipped Voice.cs by name and brace match, the same
  way test-ship-gate.ps1 lifts the Git gate out of Ship.ps1, compiles
  them against a stub Discord and Config with the .NET 10 SDK the launcher
  builds with (Add-LauncherType, tests\Launcher-Csc.ps1), which runs on any
  machine, and points them at a socket on loopback that records every byte
  it is sent. So the question "did the ticket cross the wire" is answered by
  the wire.

  Read only. It opens sockets on 127.0.0.1 and nothing else.
#>
[CmdletBinding()]
param([string]$VoicePath)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# The tests are in tests\, the repository is one folder up.
$Here = Split-Path -Parent $Here
if (-not $VoicePath) { $VoicePath = Join-Path $Here 'launcher\app\Voice.cs' }
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's compiler and C# version (#2821)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}

# ---- lift the two methods out of the shipped file ---------------------------
#
# The brace match skips string and character literals and comments, because
# FetchToken builds its body out of strings with braces in them. A rename
# fails here loudly rather than silently testing nothing.
function Get-MethodText([string]$text, [string]$head) {
    $at = $text.IndexOf($head)
    if ($at -lt 0) { return $null }
    $depth = 0
    $i = $at
    while ($i -lt $text.Length) {
        $c = $text[$i]
        if ($c -eq '"' -or $c -eq "'") {
            $q = $c
            $i++
            while ($i -lt $text.Length -and $text[$i] -ne $q) {
                if ($text[$i] -eq '\') { $i++ }
                $i++
            }
        }
        elseif ($c -eq '/' -and ($i + 1) -lt $text.Length -and $text[$i + 1] -eq '/') {
            while ($i -lt $text.Length -and $text[$i] -ne "`n") { $i++ }
        }
        elseif ($c -eq '/' -and ($i + 1) -lt $text.Length -and $text[$i + 1] -eq '*') {
            $end = $text.IndexOf('*/', $i + 2)
            if ($end -lt 0) { return $null }
            $i = $end + 1
        }
        elseif ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') {
            $depth--
            if ($depth -eq 0) { return $text.Substring($at, $i - $at + 1) }
        }
        $i++
    }
    return $null
}

$src = Get-Content -LiteralPath $VoicePath -Raw
$fetch = Get-MethodText $src 'static string FetchToken('
$escape = Get-MethodText $src 'static string JsonEscape('
$http = [regex]::Match($src, 'static readonly HttpClient TokenHttp = [^;]*;').Value
Yes 'FetchToken is in Voice.cs' ($null -ne $fetch)
Yes 'JsonEscape is in Voice.cs' ($null -ne $escape)
Yes 'and the HttpClient FetchToken sends with, TokenHttp' ($http.Length -gt 0)
if ($null -eq $fetch -or $null -eq $escape -or $http.Length -eq 0) { Done }

# ---- compile the real method against stubs ----------------------------------
#
# Discord and Config stand in for the launcher's own. The ticket is made up
# here and is not anybody's. Wire is one connection's worth of listening on
# loopback: whether anything connected, and every byte it sent. It answers
# with a token so that code which did send the ticket gets all the way to a
# success, which is what the old code did.
$ns = 'TsVoiceTicket' + [guid]::NewGuid().ToString('N')
$cs = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;

namespace NS
{
    public static class Discord
    {
        public static string Ticket = "";
    }

    public class Config
    {
        public string Base = "";
        public string VoiceBase() { return Base; }
    }

    public class Wire
    {
        TcpListener listener;
        Thread thread;
        volatile bool stop;
        volatile bool connected;
        readonly MemoryStream got = new MemoryStream();
        public int Port;

        public bool Connected { get { return connected; } }

        public void Start()
        {
            listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            Port = ((IPEndPoint)listener.LocalEndpoint).Port;
            thread = new Thread(Run);
            thread.IsBackground = true;
            thread.Start();
        }

        void Run()
        {
            try
            {
                DateTime until = DateTime.UtcNow.AddSeconds(15);
                while (!stop && DateTime.UtcNow < until)
                {
                    if (!listener.Pending()) { Thread.Sleep(20); continue; }
                    using (TcpClient c = listener.AcceptTcpClient())
                    {
                        connected = true;
                        c.ReceiveTimeout = 1000;
                        NetworkStream s = c.GetStream();
                        byte[] buf = new byte[4096];
                        while (true)
                        {
                            int n;
                            try { n = s.Read(buf, 0, buf.Length); } catch { break; }
                            if (n <= 0) break;
                            lock (got) { got.Write(buf, 0, n); }
                        }
                        byte[] reply = Encoding.ASCII.GetBytes(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" +
                            "Content-Length: 17\r\nConnection: close\r\n\r\n{\"token\":\"fresh\"}");
                        try { s.Write(reply, 0, reply.Length); s.Flush(); } catch { }
                    }
                    return;
                }
            }
            catch { }
        }

        public string Stop()
        {
            stop = true;
            if (thread != null) thread.Join(20000);
            try { listener.Stop(); } catch { }
            lock (got) { return Encoding.ASCII.GetString(got.ToArray()); }
        }
    }

    public static class Voice
    {
        static Config conf;

        FETCH

        TOKENHTTP

        ESCAPE

        public static string Run(string ticket, string vbase, bool haveConf, string host, string port, List<string> lines)
        {
            // Straight to the loopback socket, whatever proxy this machine names.
            HttpClient.DefaultProxy = new WebProxy();
            Discord.Ticket = ticket;
            if (haveConf) { conf = new Config(); conf.Base = vbase; } else { conf = null; }
            return FetchToken(host, port, 42, delegate(string s) { lines.Add(s); });
        }
    }
}
'@
$cs = $cs.Replace('namespace NS', 'namespace ' + $ns).Replace('TOKENHTTP', $http).Replace('ESCAPE', $escape).Replace('FETCH', $fetch)
$compiled = $true
try { $null = Add-LauncherType -Source $cs }
catch { $compiled = $false; Write-Host $_.Exception.Message }
Yes 'FetchToken compiles against the stubs, with the .NET 10 SDK' $compiled
if (-not $compiled) { Done }

$VoiceT = [type]($ns + '.Voice')
$WireT = [type]($ns + '.Wire')

$ticket = 'made-up-ticket-7f3a9c'

# One call: a fresh listener, FetchToken pointed at it, and what came back.
# The base is built from the listener's port, so {0} in it is the port.
function Probe([string]$ticketIn, [string]$baseFmt, [bool]$haveConf) {
    $w = New-Object $WireT
    $w.Start()
    $lines = New-Object 'System.Collections.Generic.List[string]'
    $base = $baseFmt -f $w.Port
    $got = $VoiceT::Run($ticketIn, $base, $haveConf, '127.0.0.1', [string]$w.Port, $lines)
    $wire = $w.Stop()
    return [pscustomobject]@{
        Token     = [string]$got
        Connected = [bool]$w.Connected
        Wire      = [string]$wire
        Log       = ($lines -join ' | ')
    }
}

# ---- the raw port, which is what an empty VoiceUrl gives --------------------
$r = Probe $ticket 'http://127.0.0.1:{0}' $true
Yes 'an http voice address gets no token' ($r.Token -eq '')
Yes 'an http voice address is never even connected to' (-not $r.Connected)
Yes 'the ticket does not cross the wire to an http address' ($r.Wire.IndexOf($ticket) -lt 0)
Yes 'the log says why there is no token' ($r.Log -match 'not https')

# FetchToken builds http://host:port itself when there is no config at all.
$r = Probe $ticket '' $false
Yes 'with no config at all, nothing is connected to' (-not $r.Connected)
Yes 'with no config at all, the ticket stays home' ($r.Wire.IndexOf($ticket) -lt 0)

# The scheme is what counts, not the word appearing somewhere in the address.
$r = Probe $ticket 'http://127.0.0.1:{0}/https://thornswood.net/voice' $true
Yes 'https later in an http address does not count' (-not $r.Connected)

$r = Probe $ticket 'HTTP://127.0.0.1:{0}' $true
Yes 'an http address in capitals is refused too' (-not $r.Connected)

# ---- not linked, which was already handled and must stay so -----------------
$r = Probe '' 'https://127.0.0.1:{0}' $true
Yes 'not linked to Discord still gets no token' ($r.Token -eq '')
Yes 'not linked to Discord still connects to nothing' (-not $r.Connected)
Yes 'not linked to Discord still says so' ($r.Log -match 'not linked to Discord')

# ---- https still asks -------------------------------------------------------
#
# The listener speaks plain HTTP, so the handshake fails and there is no token.
# What matters is that the request was made: a fix that simply stopped asking
# would pass everything above and take the join token away from everybody.
$r = Probe $ticket 'https://127.0.0.1:{0}' $true
Yes 'an https voice address is still asked for a token' $r.Connected
Yes 'the ticket is never readable on the wire to an https address' ($r.Wire.IndexOf($ticket) -lt 0)
Yes 'a failed handshake is reported as a failed fetch' ($r.Log -match 'could not get a join token')

$r = Probe $ticket 'HTTPS://127.0.0.1:{0}' $true
Yes 'an https address in capitals is asked too' $r.Connected

Done
