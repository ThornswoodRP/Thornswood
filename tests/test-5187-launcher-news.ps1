<#
  test-5187-launcher-news.ps1

      pwsh -NoProfile -File .\tests\test-5187-launcher-news.ps1

  The launcher's News tab reads the notes of the build Releases on GitHub
  that its channel's Deployment has reached (#5187, plan line 32), not the
  feed's news file.

  WHY THIS EXISTS. The tab read the feed's news file (FeedNews.cs, #1050),
  and only a Ship writes the feed. Every merge now makes a build Release with
  its notes in the body (merge-release.yml), deployed to Dev and then to Main
  by a Deployment, and nothing of that reaches the feed. Measured 1 Nov:
  build-20261101.9, "Downloads page names the publisher", was deployed to dev
  at 4:10 PM, and the dev feed's news file still ended at the 2:22 PM Ship.
  What this proves, against a stand-in for GitHub's API on 127.0.0.1:
    - a Release body reads as one note: its first line the title, each "- "
      line a line of what changed, any other line its text, and the time it
      was published its date; an empty body and merge-release.yml's "Nothing
      people would notice" line are no note
    - build tags sort by day and then by the day's count, and anything else
      is not a build tag
    - a dev launcher shows the Releases at or before the one the newest
      successful Dev Deployment names, newest first, and marks DEV each one
      the newest successful Main Deployment has not reached; a main launcher
      shows the ones at or before Main's, with no marks
    - a Deployment that names no build Release (a Ship's record, a payload
      that is a string) is passed over without asking its status; a newer one
      still running or failed leaves the one before as the answer
    - drafts, the gamemode-only builds from before #5313 (titled "Gamemode
      build-...") and every other kind of Release are left out
    - a channel with no successful Deployment of a build Release shows
      nothing and does not ask for the Releases
    - an error from GitHub throws, so FillNews keeps the notes it had; too
      many Deployments in a row without a success throws too
    - FillNews hands back the notes it holds while the last read is newer
      than fifteen minutes, without asking GitHub
    - the feed's "news" and "newsFile" are no longer read, FeedNews.cs is gone,
      and the update check fills the news before the window reads it

  HOW. Builds launcher\app\Thornswood.csproj as it is, with the .NET 10 SDK
  the launcher builds with (Add-LauncherAssembly, tests\Launcher-Csc.ps1,
  #4823), loads it into this PowerShell, which runs on .NET 10 as the
  launcher does, and calls Updater.ReadReleaseNews, NoteOf and BuildKey by
  reflection with the stand-in's address. Nothing leaves 127.0.0.1.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the build's SDK (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Here = Split-Path -Parent $Here
$Src = Join-Path (Join-Path $Here 'launcher') 'app'

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tsreleasenews-' + [Guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Force -Path $tmp

# ---- a stand-in for GitHub's API, on 127.0.0.1 -------------------------------
# Answers each path by the longest prefix it was given, 404 for the rest, and
# writes down each path and query it was asked, with the headers it got.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

public class TsGitHubStandIn
{
    TcpListener listener;
    public int Port;
    readonly Dictionary<string, KeyValuePair<string, string>> answers = new Dictionary<string, KeyValuePair<string, string>>();
    public readonly List<string> Seen = new List<string>();
    public readonly List<string> Heads = new List<string>();

    public void Answer(string prefix, string status, string body)
    {
        lock (answers) answers[prefix] = new KeyValuePair<string, string>(status, body);
    }

    public void Clear()
    {
        lock (answers) answers.Clear();
        lock (Seen) { Seen.Clear(); Heads.Clear(); }
    }

    public string[] Asked() { lock (Seen) return Seen.ToArray(); }
    public string[] Headers() { lock (Seen) return Heads.ToArray(); }

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
        string head = sb.ToString();
        string path = head.Split(' ')[1];
        string status = "404 Not Found", body = "{\"message\":\"Not Found\"}";
        int best = -1;
        lock (answers)
        {
            foreach (var kv in answers)
            {
                if (path.StartsWith(kv.Key, StringComparison.Ordinal) && kv.Key.Length > best)
                {
                    best = kv.Key.Length; status = kv.Value.Key; body = kv.Value.Value;
                }
            }
        }
        lock (Seen) { Seen.Add(path); Heads.Add(head); }
        byte[] bytes = Encoding.UTF8.GetBytes(body);
        byte[] h = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + "\r\nContent-Type: application/json\r\nContent-Length: " + bytes.Length + "\r\nConnection: close\r\n\r\n");
        s.Write(h, 0, h.Length);
        if (bytes.Length > 0) s.Write(bytes, 0, bytes.Length);
        s.Flush();
    }
}
'@

function Esc([string]$s) { return ($s -replace '\\', '\\' -replace '"', '\"' -replace "`n", '\n') }
# A Release the way GitHub lists one.
function Rel([string]$tag, [string]$name, [string]$body, [bool]$draft = $false, [string]$at = '2026-11-01T23:10:44Z') {
    $pub = if ($draft) { 'null' } else { '"' + $at + '"' }
    return ('{"tag_name":"' + $tag + '","name":"' + (Esc $name) + '","body":"' + (Esc $body) + '","draft":' + $draft.ToString().ToLowerInvariant() + ',"prerelease":true,"published_at":' + $pub + ',"assets":[]}')
}
# A Deployment the way GitHub lists one; payload is the JSON as it comes.
function Dep([long]$id, [string]$payload) { return ('{"id":' + $id + ',"environment":"x","payload":' + $payload + ',"ref":"main"}') }
function State([string]$state) { return ('[{"state":"' + $state + '","environment":"x"}]') }
function Titles($items) { return (@($items | ForEach-Object { [string]$_.title + $(if ($_.channel -eq 'dev') { '*' } else { '' }) }) -join '|') }

function Run {
    Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
    if (-not (Test-Path -LiteralPath $LauncherDotnet)) { return }
    $asm = $null
    try { $asm = Add-LauncherAssembly } catch { Write-Host ('      ' + $_.Exception.Message) }
    Yes 'the launcher builds from its project, the way the build makes it' ($null -ne $asm)
    if ($null -eq $asm) { return }

    $U = $asm.GetType('Thornswood.Updater')
    $C = $asm.GetType('Thornswood.Config')
    $V = $asm.GetType('Thornswood.VersionDoc')
    $NewsType = $asm.GetType('Thornswood.NewsItem')
    $P = $asm.GetType('Thornswood.Paths')
    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    $mRead = $U.GetMethod('ReadReleaseNews', $flags)
    $mNote = $U.GetMethod('NoteOf', $flags)
    $mKey = $U.GetMethod('BuildKey', $flags)
    $mFill = $U.GetMethod('FillNews', $flags)
    Yes 'Updater.ReadReleaseNews, NoteOf, BuildKey and FillNews are in the build' ($null -ne $mRead -and $null -ne $mNote -and $null -ne $mKey -and $null -ne $mFill)
    if ($null -eq $mRead -or $null -eq $mNote -or $null -eq $mKey) { return }

    $profile = Join-Path $tmp 'Profile'
    $null = New-Item -ItemType Directory -Force -Path $profile
    $P.GetField('ProfileDir').SetValue($null, $profile)
    $P.GetField('LogFile').SetValue($null, (Join-Path $profile 'launcher.log'))

    # ---- 1. one Release's body as one note -----------------------------------------
    $at = [DateTimeOffset]::Parse('2026-11-01T23:10:44Z', [Globalization.CultureInfo]::InvariantCulture)
    $body = "Downloads page names the publisher`r`n- The line under the installer's button now names who signed it.`r`n- The mods button opens Vortex at the server's revision`r`n`r`nA line that is not a bullet.`r`n"
    $n = $mNote.Invoke($null, @($body, [Nullable[DateTimeOffset]]$at))
    Yes ('the first line is the title: ' + $n.title) ($n.title -eq 'Downloads page names the publisher')
    Yes '  each "- " line is a line of what changed, without its dash' (@($n.details).Count -eq 2 -and $n.details[0] -eq "The line under the installer's button now names who signed it." -and $n.details[1] -eq "The mods button opens Vortex at the server's revision")
    Yes '  any other line is the note''s text' ($n.body -eq 'A line that is not a bullet.')
    $want = $at.ToLocalTime().ToString('M-d-yyyy h:mm tt', [Globalization.CultureInfo]::InvariantCulture)
    Yes ('  the date is when it was published, in this machine''s time, as the tab shows dates: ' + $n.date) ($n.date -eq $want -and $n.DateText -eq $want)
    Yes '  and it is no dev note by itself' ($n.channel -eq '')
    Yes 'a body that is only a "- " headline still has a title' (([string]$mNote.Invoke($null, @('- Only a bullet', $null)).title) -eq 'Only a bullet')
    Yes 'merge-release.yml''s "Nothing people would notice" body is no note' ($null -eq $mNote.Invoke($null, @("Nothing people would notice: every change in this release says none.`n", [Nullable[DateTimeOffset]]$at)))
    Yes 'an empty body is no note' ($null -eq $mNote.Invoke($null, @("  `r`n ", [Nullable[DateTimeOffset]]$at)) -and $null -eq $mNote.Invoke($null, @($null, $null)))
    $mr = Get-Content -LiteralPath (Join-Path $Here '.github/workflows/merge-release.yml') -Raw
    Yes '  and that is the line merge-release.yml writes' ($mr -match "NOTHING_TO_TELL: 'Nothing people would notice: every change in this release says none\.'")
    Yes '  and merge-release.yml titles a Release with notes "Release <tag>"' ($mr -match '--title "Release \$\(\$env:TAG\)"')

    # ---- 2. build tags ---------------------------------------------------------------
    $k = { param($t) [long]$mKey.Invoke($null, @([string]$t)) }
    Yes 'build tags sort by day, then by the day''s count (.10 after .9, the next day after both)' ((& $k 'build-20261101.10') -gt (& $k 'build-20261101.9') -and (& $k 'build-20261102.1') -gt (& $k 'build-20261101.10'))
    Yes 'anything else is not a build tag' ((& $k 'release/main/20261101-101056') -eq -1 -and (& $k 'main-build-20261101.9') -eq -1 -and (& $k 'agent-v1.0.40') -eq -1 -and (& $k 'build-2026110.1') -eq -1 -and (& $k '') -eq -1 -and (& $k $null) -eq -1)

    # ---- 3. the Releases a channel's Deployment reached -------------------------------
    $srv = New-Object TsGitHubStandIn
    $srv.Start()
    try {
        $api = "http://127.0.0.1:$($srv.Port)/repos/ThornswoodRP/Thornswood"
        $base = "/repos/ThornswoodRP/Thornswood"
        $releases = '[' + ((@(
            (Rel 'build-20261101.12' 'Release build-20261101.12' 'Not deployed anywhere yet'),
            (Rel 'build-20261101.11' 'Release build-20261101.11' "Being deployed`n- Still running on dev"),
            (Rel 'agent-v1.0.40' 'Deploy agent 1.0.40' 'The deploy agent'),
            (Rel 'build-20261101.10' 'Release build-20261101.10' "Assigned loot on bodies`n- A body keeps what it carried"),
            (Rel 'build-20261101.13' 'Release build-20261101.13' 'A draft' $true),
            (Rel 'release/main/20261101-101056' 'Thornswood main release 20261101-101056' 'The files of a Ship'),
            (Rel 'build-20261101.9' 'Release build-20261101.9' "Downloads page names the publisher`n- The line under the button"),
            (Rel 'build-20261101.8' 'Gamemode build-20261101.8' 'The gamemode and the server build, for the box deploy agent'),
            (Rel 'build-20261031.4' 'Release build-20261031.4' 'Nothing people would notice: every change in this release says none.'),
            (Rel 'build-20261031.3' 'Release build-20261031.3' "Study at the College`n- Desks in the hall" $false '2026-10-31T23:00:00Z')
        )) -join ',') + ']'
        $srv.Answer("$base/releases", '200 OK', $releases)
        # Dev: the newest is still running, the one before it succeeded; a Ship's
        # record and a payload that is a string name no build Release.
        $srv.Answer("$base/deployments?environment=Dev", '200 OK', ('[' + ((@(
            (Dep 911 '{"release":"build-20261101.11"}'),
            (Dep 910 '{}'),
            (Dep 909 '""'),
            (Dep 908 '{"release":"build-20261101.10"}'),
            (Dep 907 '{"release":"build-20261101.9"}')
        )) -join ',') + ']'))
        $srv.Answer("$base/deployments/911/statuses", '200 OK', (State 'in_progress'))
        $srv.Answer("$base/deployments/908/statuses", '200 OK', (State 'success'))
        $srv.Answer("$base/deployments/907/statuses", '200 OK', (State 'inactive'))
        $srv.Answer("$base/deployments?environment=Main", '200 OK', ('[' + ((@(
            (Dep 801 '{}'),
            (Dep 800 '{"release":"build-20261101.9"}')
        )) -join ',') + ']'))
        $srv.Answer("$base/deployments/800/statuses", '200 OK', (State 'success'))

        $items = @($mRead.Invoke($null, @($api, $true)))
        Yes ('a dev launcher shows the Releases at or before Dev''s newest success, newest first, DEV on what Main has not reached: ' + (Titles $items)) ((Titles $items) -eq 'Assigned loot on bodies*|Downloads page names the publisher|Study at the College')
        Yes '  so a Release still being deployed, one not deployed, a draft, a gamemode-only build, a Ship''s files, the agent and a nothing to tell are left out' ($items.Count -eq 3)
        Yes '  each note carries its lines of what changed' (@($items[0].details).Count -eq 1 -and $items[0].details[0] -eq 'A body keeps what it carried')
        $asked = @($srv.Asked())
        $statuses = @($asked | Where-Object { $_ -match '/statuses' })
        Yes ('  the statuses asked are only those of Deployments that name a build Release, newest first, up to the first success: ' + ($statuses -join ' ')) (($statuses -join ' ') -eq "$base/deployments/911/statuses?per_page=1 $base/deployments/908/statuses?per_page=1 $base/deployments/800/statuses?per_page=1")
        Yes '  Dev and Main''s Deployments, then one list of the newest hundred Releases' ((@($asked | Where-Object { $_ -notmatch '/statuses' }) -join ' ') -eq "$base/deployments?environment=Dev&per_page=20 $base/deployments?environment=Main&per_page=20 $base/releases?per_page=100")
        $heads = @($srv.Headers())
        Yes '  every request asks for GitHub''s JSON with the launcher''s name and no token' (@($heads | Where-Object { $_ -match '(?im)^Accept: application/vnd\.github\+json' -and $_ -match '(?im)^User-Agent: ThornswoodLauncher/' -and $_ -notmatch '(?im)^Authorization:' }).Count -eq $heads.Count -and $heads.Count -eq 6)

        $srv.Clear()
        $srv.Answer("$base/releases", '200 OK', $releases)
        $srv.Answer("$base/deployments?environment=Main", '200 OK', ('[' + (Dep 800 '{"release":"build-20261101.9"}') + ']'))
        $srv.Answer("$base/deployments/800/statuses", '200 OK', (State 'success'))
        $items = @($mRead.Invoke($null, @($api, $false)))
        Yes ('a main launcher shows the Releases at or before Main''s, with no DEV marks: ' + (Titles $items)) ((Titles $items) -eq 'Downloads page names the publisher|Study at the College')
        Yes '  and asks Main''s Deployments only once' (@($srv.Asked() | Where-Object { $_ -match 'environment=' }).Count -eq 1)

        $srv.Clear()
        $srv.Answer("$base/releases", '200 OK', $releases)
        $srv.Answer("$base/deployments?environment=Dev", '200 OK', ('[' + (Dep 908 '{"release":"build-20261101.10"}') + ']'))
        $srv.Answer("$base/deployments/908/statuses", '200 OK', (State 'success'))
        $srv.Answer("$base/deployments?environment=Main", '200 OK', ('[' + (Dep 801 '{}') + ']'))
        $items = @($mRead.Invoke($null, @($api, $true)))
        Yes ('before main has run a build Release, every dev note is marked DEV: ' + (Titles $items)) ((Titles $items) -eq 'Assigned loot on bodies*|Downloads page names the publisher*|Study at the College*')
        $items = @($mRead.Invoke($null, @($api, $false)))
        Yes '  and a main launcher shows nothing' ($items.Count -eq 0)
        Yes '  without asking for the Releases' (@($srv.Asked() | Where-Object { $_ -match '/releases' }).Count -eq 1)

        # ---- 4. failures throw, so FillNews keeps what it had --------------------------
        $srv.Clear()
        $srv.Answer("$base/deployments?environment=Main", '200 OK', ('[' + (Dep 800 '{"release":"build-20261101.9"}') + ']'))
        $srv.Answer("$base/deployments/800/statuses", '200 OK', (State 'success'))
        $srv.Answer("$base/releases", '403 rate limit exceeded', '{"message":"API rate limit exceeded"}')
        $why = ''
        try { [void]$mRead.Invoke($null, @($api, $false)) } catch { $why = [string]$_.Exception.InnerException.Message }
        Yes ('an error from GitHub throws with its status: ' + $why) ($why -match '403')
        $srv.Clear()
        $many = @(); $id = 700
        foreach ($i in 1..7) { $many += (Dep ($id + $i) ('{"release":"build-20261101.' + $i + '"}')); $srv.Answer("$base/deployments/$($id + $i)/statuses", '200 OK', (State 'failure')) }
        $srv.Answer("$base/deployments?environment=Main", '200 OK', ('[' + ($many -join ',') + ']'))
        $why = ''
        try { [void]$mRead.Invoke($null, @($api, $false)) } catch { $why = [string]$_.Exception.InnerException.Message }
        Yes ('seven Deployments in a row without a success throw rather than show nothing: ' + $why) ($why -match 'ended in success')
        Yes ('  after asking six statuses, not seven') (@($srv.Asked() | Where-Object { $_ -match '/statuses' }).Count -eq 6)
        $srv.Clear()
        $srv.Answer("$base/deployments?environment=Main", '200 OK', '[]')
        Yes 'a channel with no Deployments shows nothing' (@($mRead.Invoke($null, @($api, $false))).Count -eq 0)
    } finally { $srv.Stop() }

    # ---- 5. FillNews keeps a read for fifteen minutes --------------------------------
    $held = [Array]::CreateInstance($NewsType, 1)
    $one = [Activator]::CreateInstance($NewsType); $one.title = 'Held from the last read'
    $held[0] = $one
    $U.GetField('newsHeld', $flags).SetValue($null, $held)
    $U.GetField('newsChannel', $flags).SetValue($null, 'dev')
    $U.GetField('newsAsked', $flags).SetValue($null, [DateTime]::UtcNow)
    $cfg = [Activator]::CreateInstance($C)
    $cfg.Channel = 'dev'
    $doc = [Activator]::CreateInstance($V)
    [void]$mFill.Invoke($null, @($cfg, $doc))
    Yes 'FillNews hands back the notes of a read newer than fifteen minutes, without asking GitHub' ((Titles $doc.news) -eq 'Held from the last read')
    Yes '  and fifteen minutes is the wait' ($U.GetField('NewsEvery', $flags).GetValue($null) -eq [TimeSpan]::FromMinutes(15))
    $rn = Get-Content -LiteralPath (Join-Path $Src 'ReleaseNews.cs') -Raw
    Yes 'FillNews marks the time before it reads, so a failed read is not asked again on every check' ($rn -match '(?s)if \(ask\) newsAsked = DateTime\.UtcNow;.*?ReadReleaseNews\(ReleasesApi, dev\)')
    Yes '  and a read that throws leaves the notes it held, with a line in launcher.log' ($rn -match '(?s)catch \(Exception ex\) \{ Swallow\.Note\("Updater\.FillNews, the Releases on GitHub", ex\); \}\s*\}\s*lock \(newsLock\) \{ v\.news = newsHeld \?\? new NewsItem\[0\]; \}')
    Yes '  and it asks GitHub''s API for the Thornswood repository' ([string]$U.GetField('ReleasesApi', $flags).GetValue($null) -eq 'https://api.github.com/repos/ThornswoodRP/Thornswood')

    # ---- 6. the feed's news is not read --------------------------------------------
    $feed = [Text.Encoding]::UTF8.GetBytes('{"launcherVersion":"1.2.4","packs":[],"news":[{"date":"11-1-2026 2:22 PM","title":"A Ship''s note","body":"","channel":"dev"}],"newsFile":{"url":"https://thornswood.net/feed-dev/assets/' + ('a' * 64) + '","sha256":"' + ('a' * 64) + '","count":1}}')
    $parsed = $V.GetMethod('Parse', $flags).Invoke($null, @(, [byte[]]$feed))
    Yes 'a feed''s "news" and "newsFile" are not read: the tab is the Releases''' ($null -ne $parsed -and @($parsed.news).Count -eq 0 -and $null -eq $V.GetField('newsRef'))
    Yes 'FeedNews.cs, the feed''s news file reader, is gone' (-not (Test-Path -LiteralPath (Join-Path $Src 'FeedNews.cs')))
    $su = Get-Content -LiteralPath (Join-Path $Src 'ShellUpdate.cs') -Raw
    Yes 'the update check fills the news on its own thread before the window reads the document' ($su -match '(?s)VersionDoc v = Updater\.Check\(cfg\);.*?Updater\.FillNews\(cfg, v\);(\s*//[^\n]*)*\s*Dispatcher\.UIThread\.Post\(delegate \{ OnVersionDoc\(v, loud\);')
    $sn = Get-Content -LiteralPath (Join-Path $Src 'ShellNews.cs') -Raw
    Yes 'the tab no longer has a files list, which no Release carries' ($sn -notmatch 'n\.files' -and $null -eq $NewsType.GetField('files'))
    Yes 'an empty tab says where the notes come from, not the update feed' ($sn -notmatch 'writes to the update feed' -and $sn -match 'once the dev server runs it' -and $sn -match 'once the live server runs it')
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
