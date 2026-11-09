<#
  test-discord-ticket-runout.ps1

      pwsh -NoProfile -File .\launcher\tests\test-discord-ticket-runout.ps1

  A Discord sign-in past its own end is no sign-in. The site's makeTicket
  gives every ticket thirty days (x in its body) and refuses it after that,
  at the door and for a voice token alike, but Discord.Linked said linked for
  as long as the file was on disk. On One on 8 Nov voice was refused a token
  every half minute with "this Discord account does not own profile
  908245719", a profile no account held, and nothing offered Connect Discord.

  Proves Discord.RunsOut reads the end out of a ticket, a ticket past it is
  not linked and says when it ran out, and one still good is linked.
  Voice.Refusal is held to the site's whys by reading Voice.cs. Compiles the real Discord.cs with the stand-ins
  test-discord-forget.ps1 uses, with the .NET SDK the launcher builds with.
  Writes only under its own temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 } else { exit 0 }
}

$voice = Get-Content -LiteralPath ([IO.Path]::Combine($Repo, 'launcher', 'app', 'Voice.cs')) -Raw
foreach ($why in @('ticket', 'role', 'somebody else')) {
    Yes ("Voice.Refusal has words for the site's why '" + $why + "'") ($voice.Contains('case "' + $why + '":'))
}
Yes 'and a 403 is read for its why, not taken as "does not own profile"' ($voice.Contains('log("Voice: no join token: " + Refusal(why, profile))') -and -not $voice.Contains('does not own profile " + profile'))

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('discord-runout-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$cs = @(
'using System;',
'using System.IO;',
'',
'namespace Thornswood',
'{',
'    static class Paths',
'    {',
'        public static string Game = "";',
'        public static string LogFile = "";',
'    }',
'',
'    public class Config { }',
'    public class Check',
'    {',
'        public bool Ok;',
'        public string Name = "";',
'        public string Detail = "";',
'    }',
'    static class Checks',
'    {',
'        public static Check[] All(Config c) { return new Check[0]; }',
'    }',
'',
'    static class AutoJoin { public static int GetProfileId() { return 0; } }',
'    static class Updater { public static string Version = ""; }',
'    static class Files { public static string SkseLogDir = ""; }',
'    // Since #2380 the crash log line finds its snapshot by CrashDump.Beside.',
'    // CrashDump.cs needs Enforce and a full Config, so its rule is stood in',
'    // for here, as test-log-upload.ps1 does (test-crash-snapshot.ps1 holds the real one).',
'    // Since #2319 the check in and the session logs also ask it which snapshots it holds; none here.',
'    static class CrashDump',
'    {',
'        public static string Beside(string l) { string d = Path.ChangeExtension(l, ".dmp"); return File.Exists(d) ? d : null; }',
'        public static string HeldSessions() { return ""; }',
'        public static void NoteLookedAt(string csv) { }',
'        public static void Remember(string crashLog, string session) { }',
'    }',
'    public class Issue',
'    {',
'        public string Text = "";',
'        public bool Blocking;',
'        public bool Absent;',
'        public string Plugin = "";',
'        public long WantSize;',
'        public uint WantCrc;',
'        public int WantIndex;',
'    }',
'    static class Verify { public static Issue[] Run() { return new Issue[0]; } }',
'',
'    static class Driver',
'    {',
'        static int fail;',
'        static void Yes(string what, bool cond)',
'        {',
'            if (cond) { Console.WriteLine("PASS  " + what); }',
'            else { Console.WriteLine("FAIL  " + what); fail++; }',
'        }',
'',
'        static string Ticket(long endMs)',
'        {',
'            string json = "{\"d\":\"123456789012345678\",\"n\":\"x\",\"x\":" + endMs + "}";',
'            string b = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(json)).TrimEnd((char)61).Replace((char)43, (char)45).Replace((char)47, (char)95);',
'            return "tk1." + b + ".sig";',
'        }',
'',
'        static int Main(string[] args)',
'        {',
'            string dir = args[0];',
'            Discord.Folder = dir;',
'            long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();',
'            if (args.Length > 1 && args[1] == "good")',
'            {',
'                // A run of its own: Discord keeps the ticket it read for the life of the process.',
'                File.WriteAllText(Path.Combine(dir, "discord.txt"), Ticket(now + 86400000L));',
'                Yes("a ticket still good is linked", Discord.Linked && !Discord.RanOut.HasValue);',
'                return fail == 0 ? 0 : 1;',
'            }',
'            string old = Ticket(now - 86400000L);',
'            DateTime? end = Discord.RunsOut(old);',
'            Yes("RunsOut reads the end out of the ticket body", end.HasValue && Math.Abs((end.Value - DateTime.UtcNow.AddDays(-1)).TotalMinutes) < 5);',
'            Yes("RunsOut is null for something that is not a ticket", Discord.RunsOut("not.a.ticket") == null && Discord.RunsOut("tk1.e30.sig") == null);',
'            File.WriteAllText(Path.Combine(dir, "discord.txt"), old);',
'            Yes("a ticket past its end is not linked", !Discord.Linked && Discord.Ticket == null);',
'            Yes("and says when it ran out", Discord.RanOut.HasValue);',
'            Yes("and the refusal says it ran out and to connect again", Discord.NotLinked().Contains("ran out") && Discord.NotLinked().Contains("Connect Discord"));',

'            return fail == 0 ? 0 : 1;',
'        }',
'    }',
'}'
)
$app = [IO.Path]::Combine($Repo, 'launcher', 'app')
$exe = $null
try { $exe = Build-LauncherCode -Exe -Source (($cs -join "`r`n") + "`r`n") -File (Join-Path $app 'Discord.cs'), (Join-Path $app 'Secrets.cs'), (Join-Path $app 'Swallow.cs'), (Join-Path $app 'Http.cs') }
catch { ($_.Exception.Message -split "`n") | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
Yes 'Discord.cs compiles with RunsOut under the .NET SDK the launcher builds with' ($null -ne $exe)
if (-not $exe) { Done }

$profile = Join-Path $tmp 'Profile'
New-Item -ItemType Directory -Force -Path $profile | Out-Null

Invoke-LauncherExe $exe $profile | ForEach-Object { Write-Host $_ }
Yes 'the driver agrees about a ticket past its end' ($LASTEXITCODE -eq 0)
$good = Join-Path $tmp 'Good'
New-Item -ItemType Directory -Force -Path $good | Out-Null
Invoke-LauncherExe $exe $good 'good' | ForEach-Object { Write-Host $_ }
Yes 'the driver agrees about a ticket still good' ($LASTEXITCODE -eq 0)

try { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction Stop } catch { }
Done
