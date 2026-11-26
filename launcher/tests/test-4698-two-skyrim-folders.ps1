<#
  test-4698-two-skyrim-folders.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4698-two-skyrim-folders.ps1

  #4698. With a real Skyrim settings folder and its .st-backup both there,
  Play renamed the backup to a dated folder nothing read again, which hid the
  person's own saves, settings and plugin lists beside the real ones.

  Swap.cs is built the way the project builds it, with stand-ins for the
  links and the game, against scratch folders:

    1. a real folder with a save in it and a backup with another:
         a. BothKept names the real folder;
         b. Apply refuses, naming both folders;
         c. no dated backup folder is made;
         d. both saves are where they were, and nothing was linked or recorded.
    2. an empty real folder beside a backup (a session that fell over half
       way): Apply clears the empty one, keeps the backup as it is, links,
       and makes no dated folder.
    3. a real folder and no backup: Apply moves it aside and links, as before.
    4. under the collection BothKept is empty, because Apply stands down.
    5. Teeth: Swap.cs with the refusal taken out and main's dated rename put
       back fails 1b, 1c and 1d.

  And read from the files:
    6. Play asks BothKept after ClearStuckGame and before Keep.Restore and
       Swap.Apply, and returns when it names any.
    7. Scan lists it as its own issue, which Fix does not claim to fix and
       which holds Play.

  Writes only under out\harness, which git ignores, and a scratch folder it
  removes.
#>
[CmdletBinding()]
param([string]$AppDir)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $AppDir) { $AppDir = Join-Path $Repo (Join-Path 'launcher' 'app') }

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

# ---- 6 and 7, read from the files -------------------------------------------------
$play = Body ([IO.File]::ReadAllText((Join-Path $AppDir 'ShellPlay.cs'))) 'static async Task PlayAsync()'
Yes '6. ShellPlay.cs has PlayAsync' ($play.Length -gt 0)
$clear = $play.IndexOf('ClearStuckGame(true)')
$asks = $play.IndexOf('Swap.BothKept()')
$keep = $play.IndexOf('Keep.Restore()')
$apply = $play.IndexOf('Swap.Apply()')
Yes '6. Play asks Swap.BothKept after ClearStuckGame and before Keep.Restore and Swap.Apply' (
    $clear -ge 0 -and $asks -gt $clear -and $keep -gt $asks -and $apply -gt $asks)
$guard = if ($asks -ge 0) { Body $play.Substring($asks) 'if (twice.Count > 0)' } else { '' }
Yes '6. and when it names any, Play says so, opens Diagnostics and returns' (
    $guard.Contains('Ask.Tell(') -and $guard.Contains('ShowPage(PageDiag)') -and $guard -match 'return;\s*\}$')

$upkeep = [IO.File]::ReadAllText((Join-Path $AppDir 'Upkeep.cs'))
$verify = [IO.File]::ReadAllText((Join-Path $AppDir 'Verify.cs'))
Yes '7. IssueKind has BothFolders' ($verify -match 'public const string BothFolders = "[a-z-]+";')
$issue = [regex]::Match($upkeep, 'Issue\.Of\(IssueKind\.BothFolders,(?<args>[\s\S]*?)\)\);')
Yes '7. Scan lists two copies as its own issue' ($issue.Success -and $issue.Groups['args'].Value.Contains('.st-backup'))
Yes '7. which Fix does not claim (no Fix sentence) and which holds Play' ($issue.Success -and $issue.Groups['args'].Value -match ',\s*null,\s*\r?\n' -and $issue.Groups['args'].Value -match ',\s*true$')

# ---- 1 to 5, Swap.cs built and run ----------------------------------------------
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$swap = [IO.File]::ReadAllText((Join-Path $AppDir 'Swap.cs'))

$driver = @'
using System;
using System.Collections.Generic;
using System.IO;

namespace Thornswood
{
    static class Swallow { public static void Note(string where, Exception e) { } }
    static class Checks
    {
        public static int CloseGame() { return 0; }
        public static string StuckReport() { return ""; }
    }
    static class Junction
    {
        public static readonly HashSet<string> Links = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        public static bool IsLink(string p) { return Links.Contains(Path.GetFullPath(p)); }
        public static bool Create(string link, string target, out string why)
        {
            Directory.CreateDirectory(link);
            Links.Add(Path.GetFullPath(link));
            why = "";
            return true;
        }
    }
    static class Paths
    {
        public static string Root = "";
        public static bool Collection = false;
        public static string MyGames { get { return Path.Combine(Root, "Profile", "My Games"); } }
        public static string LocalAD { get { return Path.Combine(Root, "Profile", "Local"); } }
        public static string WinMyGames { get { return Path.Combine(Root, "Documents", "My Games", "Skyrim Special Edition"); } }
        public static string WinLocalAD { get { return Path.Combine(Root, "AppData", "Local", "Skyrim Special Edition"); } }
        public static string StateFile { get { return Path.Combine(Root, "Profile", "swap.json"); } }
        public static string Golden { get { return Path.Combine(Root, "Golden"); } }
    }

    static class TwoFolders
    {
        static int pass, fail;
        static void Yes(string what, bool ok)
        {
            if (ok) { pass++; Console.WriteLine("PASS  " + what); }
            else { fail++; Console.WriteLine("FAIL  " + what); }
        }
        static void Put(string file, string text) { Directory.CreateDirectory(Path.GetDirectoryName(file)); File.WriteAllText(file, text); }
        static string Get(string file) { return File.Exists(file) ? File.ReadAllText(file) : null; }
        static int Dated(string win)
        {
            string parent = Path.GetDirectoryName(win);
            if (!Directory.Exists(parent)) return 0;
            return Directory.GetDirectories(parent, Path.GetFileName(win) + ".st-backup-*").Length;
        }
        static void Fresh(string scratch, string name)
        {
            Paths.Root = Path.Combine(scratch, name);
            Paths.Collection = false;
            Junction.Links.Clear();
        }

        static int Main(string[] args)
        {
            string scratch = args[0];
            string win, bak;

            Fresh(scratch, "both");
            win = Paths.WinMyGames; bak = win + ".st-backup";
            Put(Path.Combine(win, "Saves", "now.ess"), "THE REAL ONE");
            Put(Path.Combine(bak, "Saves", "mine.ess"), "THE BACKUP");
            List<string> twice = Swap.BothKept();
            Yes("1a. BothKept names the real folder", twice.Count == 1 && twice[0] == win);
            Exception refused = null;
            try { Swap.Apply(); } catch (Exception ex) { refused = ex; }
            Yes("1b. Apply refuses, naming both folders", refused != null && refused.Message.Contains(win + "\n") && refused.Message.Contains(bak));
            Yes("1c. no dated backup folder is made (" + Dated(win) + ")", Dated(win) == 0);
            Yes("1d. both saves are where they were, and nothing was linked or recorded",
                Get(Path.Combine(win, "Saves", "now.ess")) == "THE REAL ONE" && Get(Path.Combine(bak, "Saves", "mine.ess")) == "THE BACKUP" &&
                Junction.Links.Count == 0 && !File.Exists(Paths.StateFile));

            Fresh(scratch, "empty");
            win = Paths.WinMyGames; bak = win + ".st-backup";
            Directory.CreateDirectory(win);
            Put(Path.Combine(bak, "Saves", "mine.ess"), "THE BACKUP");
            Exception emptyWhy = null;
            try { Swap.Apply(); } catch (Exception ex) { emptyWhy = ex; }
            Yes("2. an empty folder beside a backup: Apply goes on (" + (emptyWhy == null ? "" : emptyWhy.Message) + ")", emptyWhy == null);
            Yes("2. the backup is kept as it is, the folder is linked, no dated folder",
                Get(Path.Combine(bak, "Saves", "mine.ess")) == "THE BACKUP" && Junction.IsLink(win) && Dated(win) == 0);

            Fresh(scratch, "plain");
            win = Paths.WinMyGames; bak = win + ".st-backup";
            Put(Path.Combine(win, "Saves", "mine.ess"), "MINE");
            Exception plainWhy = null;
            try { Swap.Apply(); } catch (Exception ex) { plainWhy = ex; }
            Yes("3. a real folder and no backup: moved aside and linked",
                plainWhy == null && Get(Path.Combine(bak, "Saves", "mine.ess")) == "MINE" && Junction.IsLink(win) && Dated(win) == 0);

            Fresh(scratch, "collection");
            win = Paths.WinMyGames; bak = win + ".st-backup";
            Put(Path.Combine(win, "Saves", "now.ess"), "THE REAL ONE");
            Put(Path.Combine(bak, "Saves", "mine.ess"), "THE BACKUP");
            Paths.Collection = true;
            Yes("4. under the collection BothKept is empty", Swap.BothKept().Count == 0);

            Console.WriteLine(pass + " passed, " + fail + " failed");
            return fail == 0 ? 0 : 1;
        }
    }
}
'@

function Run-Swap([string]$swapSrc, [string]$label) {
    $built = $null
    try { $built = Build-LauncherCode -Source @($swapSrc, $driver) -Exe }
    catch { ($_.Exception.Message -split "`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
    Yes "$label builds the way the project builds" ($null -ne $built)
    if (-not $built) { return @() }
    $scratch = Join-Path ([IO.Path]::GetTempPath()) ('tw-4698-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $scratch | Out-Null
    try { return @(Invoke-LauncherExe $built $scratch | ForEach-Object { "$_" }) }
    finally { Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue }
}

foreach ($l in (Run-Swap $swap 'Swap.cs')) {
    if ($l -like 'PASS  *') { $script:pass++; Write-Host $l }
    elseif ($l -like 'FAIL  *') { $script:fail++; Write-Host $l }
}

# ---- 5. teeth: main's Apply, which set the backup aside under a date ------------
$refusal = "            List<string> twice = BothKept();`n            if (twice.Count > 0) throw new Exception(BothKeptSays(twice));"
$moveLine = "                    found = `"a folder there, moved aside`";`n                    MoveAside(win, bak);"
$dated = @'
                    found = "a folder there, moved aside";
                    if (Directory.Exists(bak))
                    {
                        string aside = bak + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss");
                        try { Directory.Move(bak, aside); found += " after the backup left from before went to " + Path.GetFileName(aside); }
                        catch (Exception ex) { Swallow.Note("Swap.Apply, renaming leftover backup", ex); }
                    }
                    MoveAside(win, bak);
'@
$n = $swap.Replace("`r`n", "`n")
$old = $n.Replace($refusal, '').Replace($moveLine, $dated.Replace("`r`n", "`n").TrimEnd("`n"))
Yes "5. main's Apply rebuilt from this one (the refusal out, the dated rename back)" ($old -ne $n -and $old.Contains('yyyyMMdd-HHmmss') -and -not $old.Contains('throw new Exception(BothKeptSays'))
$lines = Run-Swap $old "5. main's Apply"
$bit = @($lines | Where-Object { $_ -like 'FAIL  1b. *' -or $_ -like 'FAIL  1c. *' -or $_ -like 'FAIL  1d. *' }).Count
Yes "5. and it fails 1b, 1c and 1d ($bit of 3)" ($bit -eq 3)

Done
