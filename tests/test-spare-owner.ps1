<#
  test-spare-owner.ps1

      powershell -NoProfile -File .\tests\test-spare-owner.ps1

  The launcher's half of To Do List entry 142's join check: the id the
  menu's New character uses belongs to the Discord account it was minted
  under.

  The site's /api/play/join files an id under the first account that checks
  in with it and moves it only once that account has left the Discord,
  because it cannot tell somebody's own id from one they learned off the
  voice service. The launcher mints one spare id per
  install and checks it in at every Play, so the account the install was
  linked to first already holds it. A reviewer walked it through on
  24 September: account A plays, the install is relinked to account B with
  Unlink and Connect Discord, B's New character is made on A's spare, and from
  then on the site files it under A. /owns tells voice it is somebody else's,
  /roster gives B's menu card no name, and the game's door lets it in on A's
  standing.

  So Chars.EnsureSpare writes down which account a spare was minted under and
  mints a fresh one when the install is linked to another. This compiles the
  real Chars.cs and Slots.cs with the .NET SDK the launcher is built with
  (tests\Launcher-Csc.ps1, #4823), against stand-ins for what they call, on
  every machine. The ticket reading runs everywhere; the walk through Chars
  runs on Windows only, since Chars names the install's files by Windows
  paths (Data\Platform\...), and says SKIP elsewhere. Discord.AccountIdOf and the Field it reads with are lifted out of
  the real Discord.cs by brace match, so the ticket is read the way the
  launcher reads it. test-play-join.js is the site's half.

  Read only apart from files under its own temp folder and its build under
  out\harness.
#>
[CmdletBinding()]
param([string]$CharsPath, [string]$SlotsPath, [string]$DiscordPath)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $CharsPath) { $CharsPath = Join-Path $Here '..\launcher\app\Chars.cs' }
if (-not $SlotsPath) { $SlotsPath = Join-Path $Here '..\launcher\app\Slots.cs' }
if (-not $DiscordPath) { $DiscordPath = Join-Path $Here '..\launcher\app\Discord.cs' }

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

# ---- the .NET SDK the launcher is built with (tests\Launcher-Csc.ps1) -------
Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

# ---- the real ticket reading, out of Discord.cs -----------------------------
$discordSrc = Get-Content -LiteralPath $DiscordPath -Raw
# One method, from its signature to its closing brace. Braces inside a string
# or a character literal do not count: Field compares against '}'.
function Lift([string]$src, [string]$head) {
    $at = $src.IndexOf($head)
    if ($at -lt 0) { return $null }
    $b = $src.IndexOf('{', $at)
    $depth = 0
    $quote = [char]0
    for ($i = $b; $i -lt $src.Length; $i++) {
        $c = $src[$i]
        if ($quote -ne [char]0) {
            if ($c -eq [char]92) { $i++ }
            elseif ($c -eq $quote) { $quote = [char]0 }
            continue
        }
        if ($c -eq [char]34 -or $c -eq [char]39) { $quote = $c }
        elseif ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') { $depth--; if ($depth -eq 0) { return $src.Substring($at, $i - $at + 1) } }
    }
    return $null
}
$accountIdOf = Lift $discordSrc 'public static string AccountIdOf(string ticket)'
$field = Lift $discordSrc 'static string Field(string json, string key)'
Yes 'Discord.cs has AccountIdOf' ($null -ne $accountIdOf)
Yes 'Discord.cs has the Field it reads the ticket with' ($null -ne $field)
Yes 'Discord.AccountId is the ticket this copy holds, read by AccountIdOf' `
    ($discordSrc -match 'public static string AccountId \{ get \{ return AccountIdOf\(Ticket\); \} \}')
if ($null -eq $accountIdOf -or $null -eq $field) { Done }

# ---- stand-ins for what Chars.cs calls, and a driver ------------------------
#
# The driver walks one install through the reviewer's case and prints what it
# finds as key=value lines, one step at a time. The steps are named in the
# order they run: a is account A, b is the same install relinked to B, and so
# on. Everything is under the folder given as the first argument.
$driver = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Thornswood
{
    public class Config { }
    public class Standing { public int Slots = 2; }
    public static class Paths { public static string Game = ""; public static string ProfileDir = ""; }
    public static class Files { public static string SaveDir = ""; }
    public static class Junction
    {
        public static bool IsLink(string p) { return false; }
        public static bool Create(string link, string target, out string why) { why = "not made in the test"; return false; }
    }
    public static class AutoJoin
    {
        public static int Point;
        public static void SetChooseAtMenu(int id) { Point = id; }
    }
    public static class Voice { public static void Reconfigure(int id) { } }
    // Stands in for launcher\app\Swallow.cs, which Chars.cs calls from its
    // catch blocks since the silent catches were given a log line (#461).
    public static class Swallow { public static void Note(string where, Exception e) { } }
    public static class Door { public static Standing Last; }
    public static class Roster
    {
        public class Row { public string Name = ""; public string Race = ""; public string Trade = ""; public string Town = ""; public string Where = ""; }
        public static void Refresh(Config c) { }
        public static Row For(int id) { return null; }
        // What the site says about this account's characters (#955, #1010):
        // nothing here, so none is gone, dead, banned by itself or brought back.
        public static bool Gone(int id, DateTime played) { return false; }
        public static bool Dead(int id) { return false; }
        public static bool Barred(int id) { return false; }
        public static bool Revived(int id) { return false; }
    }

    public static class Discord
    {
        public static string Ticket = null;
        public static string AccountId { get { return AccountIdOf(Ticket); } }

        ACCOUNT_ID_OF_GOES_HERE

        FIELD_GOES_HERE
    }

    public static class SpareOwnerTest
    {
        static Config cfg = new Config();

        static string B64Url(byte[] b)
        {
            return Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        // The shape the site's makeTicket writes. The signature is not read
        // by the launcher, so any text stands in for it.
        static string Body(string d, string n)
        {
            return B64Url(Encoding.UTF8.GetBytes("{\"d\":\"" + d + "\",\"n\":\"" + n + "\",\"x\":4102444800000}"));
        }
        static string TicketFor(string d, string n) { return "tk1." + Body(d, n) + ".c2lnbmF0dXJl"; }

        static string ProfileFile { get { return Path.Combine(Paths.ProfileDir, "Characters\\profiles.txt"); } }
        static string RetiredFile { get { return Path.Combine(Paths.ProfileDir, "Characters\\retired.txt"); } }

        static string[] Line(int slot)
        {
            if (!File.Exists(ProfileFile)) return new string[0];
            foreach (string l in File.ReadAllLines(ProfileFile))
            {
                string[] p = l.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (p.Length >= 2 && p[0] == slot.ToString()) return p;
            }
            return new string[0];
        }
        static string[] LineFor(int id)
        {
            if (!File.Exists(ProfileFile)) return new string[0];
            foreach (string l in File.ReadAllLines(ProfileFile))
            {
                string[] p = l.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (p.Length >= 2 && p[1] == id.ToString()) return p;
            }
            return new string[0];
        }
        static string At(string[] p, int i) { return p.Length > i ? p[i] : ""; }

        static string Retired()
        {
            if (!File.Exists(RetiredFile)) return "";
            var l = new List<string>();
            foreach (string s in File.ReadAllLines(RetiredFile)) if (s.Trim().Length > 0) l.Add(s.Trim());
            return string.Join(",", l.ToArray());
        }

        static string MenuSpare()
        {
            string f = Path.Combine(Paths.Game, "Data\\Platform\\thornswood-characters.json");
            if (!File.Exists(f)) return "";
            string t = File.ReadAllText(f);
            int i = t.IndexOf("\"spare\":");
            if (i < 0) return "";
            i += 8;
            int e = i;
            while (e < t.Length && char.IsDigit(t[e])) e++;
            return t.Substring(i, e - i);
        }

        static void Say(string k, string v)
        {
            Console.WriteLine(k + "=" + (v ?? "").Replace("\r", " ").Replace("\n", " "));
        }

        static int Snap(string step, string note)
        {
            var known = new List<string>();
            foreach (int id in Chars.KnownIds()) known.Add(id.ToString());
            string[] sp = Line(0);
            Say(step + ".known", string.Join(",", known.ToArray()));
            Say(step + ".spare", At(sp, 1));
            Say(step + ".owner", At(sp, 6));
            Say(step + ".point", AutoJoin.Point.ToString());
            Say(step + ".menu", MenuSpare());
            Say(step + ".retired", Retired());
            Say(step + ".note", note);
            int n;
            return int.TryParse(At(sp, 1), out n) ? n : 0;
        }

        public static int Main(string[] args)
        {
            string root = args[0];
            Paths.ProfileDir = Path.Combine(root, "Profile");
            Paths.Game = Path.Combine(root, "Game");
            Files.SaveDir = Path.Combine(root, "MyGames\\Saves");

            const string A = "111111111111111111";
            const string B = "222222222222222222";

            // A name that makes the body carry the url safe characters and
            // need padding back, so both halves of base64url are read.
            string nameB = "b";
            for (int k = 0; k < 40; k++)
            {
                string cand = "b" + new string('?', k) + ">";
                string body = Body(B, cand);
                if ((body.IndexOf('-') >= 0 || body.IndexOf('_') >= 0) && body.Length % 4 != 0) { nameB = cand; break; }
            }
            string ta = TicketFor(A, "a");
            string tb = TicketFor(B, nameB);
            string bodyB = tb.Split('.')[1];
            Say("ticket.urlsafe", (bodyB.IndexOf('-') >= 0 || bodyB.IndexOf('_') >= 0) ? "yes" : "no");
            Say("ticket.padded", (bodyB.Length % 4 != 0) ? "yes" : "no");
            Say("id.a", Discord.AccountIdOf(ta));
            Say("id.b", Discord.AccountIdOf(tb));
            Say("id.null", Discord.AccountIdOf(null));
            Say("id.empty", Discord.AccountIdOf(""));
            Say("id.garbage", Discord.AccountIdOf("not a ticket"));
            Say("id.otherkind", Discord.AccountIdOf("tk2." + Body(B, "b") + ".sig"));
            Say("id.badbody", Discord.AccountIdOf("tk1.!!!!.sig"));
            Say("id.letters", Discord.AccountIdOf("tk1." + Body("12ab", "x") + ".sig"));
            Say("id.nod", Discord.AccountIdOf("tk1." + B64Url(Encoding.UTF8.GetBytes("{\"n\":\"x\"}")) + ".sig"));
            // "ids": the ticket reading only, which touches no file.
            if (root == "ids") return 0;

            // a: account A, a fresh install.
            Discord.Ticket = ta;
            string note = Chars.Prepare(cfg);
            int a1 = Snap("a1", note);

            // A makes a character on it at the menu.
            Chars.Chose(a1);
            Snap("a2", "");
            string[] ch = LineFor(a1);
            Say("a2.charslot", At(ch, 0));

            // A presses Play again. Nothing about the spare changes.
            note = Chars.Prepare(cfg);
            int a3 = Snap("a3", note);

            // b: Unlink and Connect Discord, now account B.
            Discord.Ticket = tb;
            note = Chars.Prepare(cfg);
            int b1 = Snap("b1", note);

            // B makes a character of their own at the menu.
            Chars.Chose(b1);
            Snap("b2", "");
            ch = LineFor(b1);
            Say("b2.charslot", At(ch, 0));
            Say("b2.charowner", At(ch, 6));

            // B presses Play again. Nothing about the spare changes.
            note = Chars.Prepare(cfg);
            Snap("b3", note);

            // c: Reconnect straight to A, without Unlink first.
            Discord.Ticket = ta;
            note = Chars.Prepare(cfg);
            Snap("c1", note);

            // d: not linked at all, and then a ticket nobody can read. Neither
            // says who the account is, so neither moves the spare.
            Discord.Ticket = null;
            note = Chars.Prepare(cfg);
            Snap("d1", note);
            Discord.Ticket = "not a ticket";
            note = Chars.Prepare(cfg);
            Snap("d2", note);

            // e: a list an older launcher wrote, six fields and no account,
            // on an install linked to B.
            File.WriteAllText(ProfileFile,
                "1 42 " + new DateTime(2026, 9, 20, 18, 0, 0).Ticks + " 3600 - -" + Environment.NewLine +
                "0 555 0 0 - -" + Environment.NewLine);
            File.Delete(RetiredFile);
            Discord.Ticket = tb;
            note = Chars.Prepare(cfg);
            Snap("e1", note);
            ch = LineFor(42);
            Say("e1.charslot", At(ch, 0));
            Say("e1.charseconds", At(ch, 3));
            bool seven = true;
            foreach (string l in File.ReadAllLines(ProfileFile))
            {
                if (l.Trim().Length == 0) continue;
                if (l.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries).Length != 7) seven = false;
            }
            Say("e1.seven", seven ? "yes" : "no");
            return 0;
        }
    }
}
'@
$driver = $driver.Replace('ACCOUNT_ID_OF_GOES_HERE', $accountIdOf).Replace('FIELD_GOES_HERE', $field)

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-spare-owner-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    $work = Join-Path $tmp 'install'
    $exe = $null
    try { $exe = Build-LauncherCode -Exe -Main 'Thornswood.SpareOwnerTest' -Source $driver -File (Resolve-Path -LiteralPath $CharsPath).Path, (Resolve-Path -LiteralPath $SlotsPath).Path }
    catch { ($_.Exception.Message -split "`n") | ForEach-Object { Write-Host "      $_" } }
    Yes 'Chars.cs and the lifted ticket reading build with the .NET SDK the launcher builds with' ($null -ne $exe)
    if (-not $exe) { Done }

    # The whole walk on Windows; elsewhere the ticket reading alone, since
    # Chars names the install's files by Windows paths.
    $out = Invoke-LauncherExe $exe $(if ($OnWindows) { $work } else { 'ids' })
    Yes 'the driver ran to the end' ($LASTEXITCODE -eq 0)
    $f = @{}
    foreach ($l in @($out)) {
        $i = "$l".IndexOf('=')
        if ($i -gt 0) { $f["$l".Substring(0, $i)] = "$l".Substring($i + 1) }
    }
    function Ids([string]$s) { if (-not $s) { return @() } return @($s.Split(',')) }

    $A = '111111111111111111'
    $B = '222222222222222222'

    # ---- reading the ticket
    Yes 'the Discord id comes out of a ticket in the site''s shape' ($f['id.a'] -eq $A)
    Yes 'and out of one whose body has the url safe characters and needs padding back' `
        ($f['id.b'] -eq $B -and $f['ticket.urlsafe'] -eq 'yes' -and $f['ticket.padded'] -eq 'yes')
    Yes 'no ticket, or one that is not a ticket, is no account' `
        ($f['id.null'] -eq '' -and $f['id.empty'] -eq '' -and $f['id.garbage'] -eq '' -and
         $f['id.otherkind'] -eq '' -and $f['id.badbody'] -eq '' -and $f['id.nod'] -eq '')
    Yes 'and an id that is not all digits is not a Discord id' ($f['id.letters'] -eq '')
    if (-not $OnWindows) {
        Write-Host 'SKIP  the reviewer''s case driven through Chars: Chars names the install''s files by Windows paths (Data\Platform\thornswood-characters.json and the rest), so it runs on Windows only'
        Done
    }

    # ---- account A
    $a1 = $f['a1.spare']
    Yes 'a fresh install mints a spare' ([long]$a1 -gt 0)
    Yes 'and writes down that it was minted under account A' ($f['a1.owner'] -eq $A)
    Yes 'and the menu and the settings file both offer it' ($f['a1.menu'] -eq $a1 -and $f['a1.point'] -eq $a1)
    Yes 'and it is the id the check ins carry' ($f['a1.known'] -eq $a1)
    $a2 = $f['a2.spare']
    Yes 'A''s New character turns the spare into a character' ($f['a2.charslot'] -eq '1')
    Yes 'and a fresh spare, also A''s, is minted behind it' `
        ($a2 -and $a2 -ne $a1 -and $f['a2.owner'] -eq $A -and $f['a2.known'] -eq "$a1,$a2")
    Yes 'Play again as A leaves the spare alone' ($f['a3.spare'] -eq $a2 -and $f['a3.owner'] -eq $A)
    Yes 'and retires nothing, and says nothing about it' `
        ($f['a3.retired'] -eq '' -and ($f['a3.note'] -notmatch 'New character''s id'))

    # ---- relinked to account B
    $b1 = $f['b1.spare']
    Yes 'relinked to B, the spare A was holding is not what New character uses any more' ($b1 -and $b1 -ne $a2)
    Yes 'the fresh one is written down as B''s' ($f['b1.owner'] -eq $B)
    Yes 'the spare A holds is retired, so this install never mints it again' ((Ids $f['b1.retired']) -contains $a2)
    Yes 'the check ins carry A''s character and B''s own spare, and not A''s spare' `
        ($f['b1.known'] -eq "$a1,$b1" -and (-not ((Ids $f['b1.known']) -contains $a2)))
    Yes 'the menu offers B''s spare for New character' ($f['b1.menu'] -eq $b1)
    Yes 'launcher.log says whose spare it was, whose it is now, and both ids' `
        ($f['b1.note'] -match [regex]::Escape("New character's id $a2 was made under Discord $A") -and
         $f['b1.note'] -match [regex]::Escape("linked to Discord $B") -and
         $f['b1.note'] -match [regex]::Escape("uses $b1 instead"))
    $b2 = $f['b2.spare']
    Yes 'B''s New character is made on B''s own spare' ($f['b2.charslot'] -eq '2' -and $f['b2.charowner'] -eq $B)
    Yes 'and the next spare behind it is B''s too' ($b2 -and $b2 -ne $b1 -and $f['b2.owner'] -eq $B)
    Yes 'and the check ins carry both characters and B''s next spare' ($f['b2.known'] -eq "$a1,$b1,$b2")
    Yes 'Play again as B leaves B''s spare alone' ($f['b3.spare'] -eq $b2 -and ((Ids $f['b3.retired']).Count -eq 1))

    # ---- Reconnect straight to another account
    Yes 'Reconnect to A without Unlink first retires B''s spare as well' `
        ($f['c1.spare'] -ne $b2 -and $f['c1.owner'] -eq $A -and ((Ids $f['c1.retired']) -contains $b2))

    # ---- nobody to compare against
    Yes 'not linked, the spare is left exactly where it was' `
        ($f['d1.spare'] -eq $f['c1.spare'] -and $f['d1.retired'] -eq $f['c1.retired'])
    Yes 'and a ticket nobody can read leaves it alone too' `
        ($f['d2.spare'] -eq $f['c1.spare'] -and $f['d2.retired'] -eq $f['c1.retired'])

    # ---- a list written before the account was
    Yes 'a spare from an older list, with no account written down, is retired once' `
        ($f['e1.spare'] -ne '555' -and $f['e1.owner'] -eq $B -and $f['e1.retired'] -eq '555')
    Yes 'and the character on that list keeps its slot and its time' `
        ($f['e1.charslot'] -eq '1' -and $f['e1.charseconds'] -eq '3600' -and $f['e1.known'] -eq "42,$($f['e1.spare'])")
    Yes 'and says in launcher.log why' ($f['e1.note'] -match 'made before the launcher wrote down which Discord account')
    Yes 'every row is written back with the account field, seven in all' ($f['e1.seven'] -eq 'yes')

    # ---- nothing minted twice
    $spares = @($a1, $a2, $b1, $b2, $f['c1.spare'], $f['e1.spare'])
    Yes 'no id is minted twice on one install' ((@($spares | Select-Object -Unique)).Count -eq $spares.Count)
}
finally {
    try { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue } catch { }
}
Done
