<#
  test-5200-collection-in-vortex.ps1

  The collection buttons open Vortex at the server's revision, and Scan and
  Fix run by themselves when Vortex is done (#5200).

  WHY THIS EXISTS. Every collection button opened the revision's page on
  Nexus's site (#4115), where somebody still had to find the site's own
  button that hands Vortex the revision's nxm link. And when Vortex was done,
  Patrick, 31 Oct, after updating to revision 6 through the card: "I had to
  click in the diagnasotics page and manually click scan and fix". #5136 made
  the card come down by itself; nothing ran Scan and Fix.

  What it checks:
    - Checks.CollectionNxmUrl makes nxm://<game>/collections/<slug>/revisions/<N>
      from the configured address and the feed's revision, the link Vortex
      reads (/collections/(\w+)/revisions/(\d+|latest) in its NXMUrl), and
      nothing with no revision or no collection;
    - Checks.NxmStartsVortex says whether the nxm command Windows runs is
      Vortex.exe, read from HKEY_CLASSES_ROOT\nxm\shell\open\command;
    - Shell.OpenCollection opens the nxm link only when Vortex answers it,
      and the revision's page (CollectionLink) otherwise, and every
      collection button is OpenCollection;
    - with a revision already installed it hands Vortex no link and no page
      (#5546): a collection that comes in by link is installed beside the
      old one, and only Vortex's Update takes the old one off, so it starts
      Vortex itself (Checks.VortexExe) and says to press Update there, the
      button says Update in Vortex, and the cards say the same;
    - when the card comes down because Vortex finished, VortexChanged asks
      for Scan and Fix after the update check's answer, which runs them
      after LauncherAnswer and UpdateBySelf, once, and not beside an update
      UpdateBySelf started (whose own end runs Fix);
    - that Fix leaves a waiting update on the card, where UpdateBySelf left
      it, unmarked as tried, and waits for a folder being prepared the way
      Fix after an update does;
    - the two Checks methods compiled and run with the build's compiler
      (Windows only; SKIP elsewhere).

  Read only. Prints PASS or FAIL per check and exits 1 when any check fails.
#>
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')
$repo = Split-Path -Parent $PSScriptRoot
$app = Join-Path $repo 'launcher\app'
function Src([string]$name) { [IO.File]::ReadAllText((Join-Path $app $name)).Replace("`r", '') }
# Code only, comments taken out, so a line that talks about a call does not count as one.
function Code([string]$s) { (($s -split "`n") | ForEach-Object { $_ -replace '//.*$', '' }) -join "`n" }

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$ok) {
    if ($ok) { $script:pass++; Write-Host ('PASS  ' + $what) }
    else { $script:fail++; Write-Host ('FAIL  ' + $what) }
}
function Method([string]$text, [string]$signature) {
    $start = $text.IndexOf($signature)
    if ($start -lt 0) { return '' }
    $at = $text.IndexOf('{', $start); $depth = 1; $end = $at + 1
    while ($depth -gt 0 -and $end -lt $text.Length) {
        if ($text[$end] -eq '{') { $depth++ }
        if ($text[$end] -eq '}') { $depth-- }
        $end++
    }
    return $text.Substring($start, $end - $start)
}

$checks = Src 'Checks.cs'
$shell = Src 'Shell.cs'
$packs = Src 'ShellCollection.cs'
$play = Src 'ShellPlay.cs'
$update = Src 'ShellUpdate.cs'
$watch = Src 'ShellVortexWatch.cs'
$sf = Src 'ShellScanFix.cs'
$own = Src 'ShellOwnGame.cs'

# ---- the link ---------------------------------------------------------------
$nxmUrl = Method $checks 'public static string CollectionNxmUrl(Config cfg, int revision)'
Yes 'Checks.CollectionNxmUrl builds Nexus''s nxm link to the revision' ($nxmUrl.Contains('"nxm://" + game + "/collections/" + slug + "/revisions/" + revision') -and $nxmUrl.Contains('CollectionSlug(cfg)'))
Yes 'and nothing with no revision or no collection' ($nxmUrl.Contains('if (revision <= 0 || slug.Length == 0) return "";'))
$starts = Method $checks 'public static bool NxmStartsVortex(string command)'
$exeOf = Method $checks 'public static string VortexExe(string command)'
Yes 'Checks.NxmStartsVortex asks whether the command''s program is Vortex.exe' ($starts.Contains('return VortexExe(command).Length > 0;') -and
    $exeOf.Contains('string.Equals(name, "Vortex.exe", StringComparison.OrdinalIgnoreCase) ? exe : ""'))
$cmd = Method $checks 'public static string NxmCommand()'
Yes 'Checks.NxmCommand reads what Windows runs for an nxm link' ($cmd.Contains('Registry.ClassesRoot.OpenSubKey(@"nxm\shell\open\command")'))

# ---- the buttons ------------------------------------------------------------
$open = Code (Method $shell 'static void OpenCollection()')
Yes 'Shell.OpenCollection exists' ($open.Length -gt 0)
Yes 'it hands Vortex the link only when Vortex answers nxm links' ($open.Contains('bool vortex = nxm.Length > 0 && Checks.NxmStartsVortex(command);') -and
    $open.Contains('string command = Checks.NxmCommand();') -and
    $open.IndexOf('if (vortex)') -lt $open.IndexOf('new ProcessStartInfo(nxm)'))
Yes 'and opens the revision''s page otherwise' ($open.Contains('string page = CollectionLink();') -and $open.Contains('new ProcessStartInfo(page)') -and
    $open.IndexOf('new ProcessStartInfo(page)') -gt $open.IndexOf('new ProcessStartInfo(nxm)'))
Yes 'a failure to open says so in the log' ($open.Contains('Log("Could not open the collection: " + ex.Message);'))
Yes 'the card''s button, the missing-mods box and the Diagnostics cards are OpenCollection' (
    (Code (Method $update 'static void InstallNowPressed()')).Contains('OpenCollection();') -and
    ([regex]::Matches((Code $play), 'OpenCollection\(\);')).Count -eq 1 -and
    $packs.Contains('b.Click += delegate { OpenCollection(); };'))
Yes 'nothing else opens the collection''s page or link' (-not ([regex]::IsMatch((Code ($update + $play + $packs + $watch + $sf)), 'ProcessStartInfo\((CollectionLink\(\)|url|nxm|page)\)')))

# ---- a revision already installed (#5546) -------------------------------------
$installed = $open.IndexOf('if (mine > 0)')
$back = if ($installed -ge 0) { $open.IndexOf('return;', $installed) } else { -1 }
$branch = if ($back -gt $installed) { $open.Substring($installed, $back - $installed) } else { '' }
Yes 'OpenCollection reads the installed revision first' ($open.Contains('int mine = Checks.CollectionRevision(cfg);') -and $installed -ge 0 -and
    $installed -lt $open.IndexOf('new ProcessStartInfo(nxm)') -and $installed -lt $open.IndexOf('new ProcessStartInfo(page)'))
Yes 'with one installed it starts Vortex itself and returns, with no link and no page' ($branch.Contains('string exe = Checks.VortexExe(command);') -and
    $branch.Contains('new ProcessStartInfo(exe)') -and -not $branch.Contains('nxm') -and -not $branch.Contains('page'))
Yes 'and says to press Update on the collection Vortex has' ($branch.Contains('Log(UpdateInVortexLine(mine));') -and
    (Method $shell 'static string UpdateInVortexLine(int mine)').Contains('open Collections and press Update'))
$words = Code (Method $shell 'static string CollectionButtonText(int revision = -1)')
Yes 'the button says Update in Vortex for an older revision and Open Vortex for another' ($words.Contains('if (mine > 0) return wants > mine ? "Update in Vortex" : "Open Vortex";') -and
    $words.IndexOf('if (mine > 0)') -lt $words.IndexOf('"Open revision "'))
$bar = Method $shell 'static void ShowCollectionBar(int revision = -1)'
Yes 'the card above Play says to press Update in Vortex, not to install from Nexus' ($bar.Contains('press Update on the Thornswood collection') -and $bar.Contains('InstallLabel(CollectionButtonText(revision));') -and
    -not $bar.Contains('install that one in Vortex'))
Yes 'and so does the Diagnostics card' ((Method $packs 'static Control CollectionStatusCard()').Contains('press Update on the Thornswood collection'))
Yes 'the join guide says to update inside Vortex' (([IO.File]::ReadAllText((Join-Path $repo 'site\data\site\join.md')) -replace '\s+', ' ').Contains('press Update on the Thornswood collection'))

# ---- Scan and Fix when Vortex is done ---------------------------------------
$changed = Code (Method $watch 'static void VortexChanged(int revision, string problem)')
$down = $changed.IndexOf('if (!barWasUp || collectionBarUp)')
$asks = $changed.IndexOf('fixAfterVortex = true;')
$feed = $changed.IndexOf('CheckUpdatesBackground(false)')
Yes 'when the card came down, VortexChanged asks for Scan and Fix before it asks the feed' ($down -ge 0 -and $asks -gt $down -and $feed -gt $asks)
$bg = Code (Method $update 'static void CheckUpdatesBackground(bool loud)')
Yes 'the update check''s answer runs them after LauncherAnswer and UpdateBySelf' ($bg -match '(?s)LauncherAnswer\(asked, launcher, launcherNote, launcherWhy, loud\);\s*UpdateBySelf\(\);\s*FixAfterVortex\(\);')
$after = Code (Method $watch 'static void FixAfterVortex()')
Yes 'once, and only when asked' ($after -match '(?s)if \(!fixAfterVortex\) return;\s*fixAfterVortex = false;')
Yes 'not beside an update UpdateBySelf started, whose end runs Fix (FixAfterUpdate)' ($after.IndexOf('if (updating) return;') -gt $after.IndexOf('fixAfterVortex = false;') -and
    $after.IndexOf('if (updating) return;') -lt $after.IndexOf('RunFix(false, true);') -and
    $update -match 'static void UpdateNow\(\)\s*\{\s*RunUpdate\(FixAfterUpdate\);\s*\}')
$runFix = Code (Method $sf 'static void RunFix(bool afterUpdate, bool afterVortex = false, bool afterMake = false)')
Yes 'that Fix waits for a folder being prepared, as Fix after an update does' ($runFix.Contains('if (ownGameBusy && afterVortex) { fixWhenFolderReady = true; fixWhenFolderReadyAfterVortex = true;') -and
    $runFix.IndexOf('if (ownGameBusy && afterVortex)') -lt $runFix.IndexOf('if (ownGameBusy) {') -and
    $own.Contains('if (fixWhenFolderReadyAfterVortex) { fixWhenFolderReadyAfterVortex = false; RunFix(false, true); }'))
Yes 'and its log says it is the scan after Vortex' ($runFix.Contains('"Vortex is done. Scanning everything, and putting right what the scan finds."') -and $runFix.Contains('"The scan after Vortex found nothing wrong."'))
$rest = Code (Method $sf 'static void FixRest(bool afterUpdate, bool afterVortex)')
$left = $rest.IndexOf('bool leftOnCard = waiting && afterVortex;')
Yes 'it leaves a waiting update on the card, where UpdateBySelf left it, before Fix would take one' ($left -gt 0 -and $left -lt $rest.IndexOf('RunUpdate(delegate') -and
    $rest -match '(?s)if \(leftOnCard\)\s*\{\s*Log\("The update is on the card above Play\. Install now takes it\."\);\s*\}\s*else if \(waiting && afterUpdate')
Yes 'and does not mark it as tried by Fix' ($rest.Contains('if (Upkeep.LastIssues != null && !leftOnCard)'))
Yes 'the Fix button is still a plain Fix' ($shell.Contains('btnFix.Click += delegate { RunFix(); };') -and $sf.Contains('static void RunFix() { RunFix(false); }'))

# ---- the real methods, compiled ---------------------------------------------
if (-not $OnWindows) {
    Write-Host 'SKIP  Checks.CollectionNxmUrl and Checks.NxmStartsVortex compiled and run: the build''s compiler (the Build Tools'' csc, against .NET Framework 4.8.1) is only on Windows; their source was read above'
} else {
    $slug = Method $checks 'public static string CollectionSlug(Config cfg)'
    $fixture = @'
using System;
using System.IO;
namespace Thornswood {
 public class Config { public string CollectionUrl; }
 public static class CollectionNxmFixture {
  __METHODS__
  static string At(string url, int revision) { return CollectionNxmUrl(new Config { CollectionUrl = url }, revision); }
  public static string Run() {
   string c = "https://www.nexusmods.com/games/skyrimspecialedition/collections/7essxf";
   string n = "nxm://skyrimspecialedition/collections/7essxf/revisions/6";
   string[,] want = {
    { At(c, 6), n },
    { At(c + "/", 6), n },
    { At(c + "/revisions/5", 6), n },
    { At(c + "?tab=mods", 6), n },
    { At("https://next.nexusmods.com/skyrimspecialedition/collections/7essxf", 6), n },
    { At(c, 0), "" },
    { At("https://example/not-a-collection", 6), "" },
    { At(null, 6), "" },
    { CollectionNxmUrl(null, 6), "" },
   };
   for (int i = 0; i < want.GetLength(0); i++) if (want[i, 0] != want[i, 1]) return "link case " + i + ": " + want[i, 0];
   object[,] vortex = {
    { "\"C:\\Program Files\\Black Tree Gaming Ltd\\Vortex\\Vortex.exe\" -d \"%1\"", true },
    { "C:\\Vortex\\Vortex.exe -d \"%1\"", true },
    { "\"C:\\Modding\\MO2\\nxmhandler.exe\" \"%1\"", false },
    { "\"C:\\Tools\\NotVortex.exe\" \"%1\"", false },
    { "", false },
    { null, false },
    { "\"unclosed", false },
   };
   for (int i = 0; i < vortex.GetLength(0); i++) if (NxmStartsVortex((string)vortex[i, 0]) != (bool)vortex[i, 1]) return "handler case " + i;
   if (VortexExe("\"C:\\Program Files\\Black Tree Gaming Ltd\\Vortex\\Vortex.exe\" -d \"%1\"") != "C:\\Program Files\\Black Tree Gaming Ltd\\Vortex\\Vortex.exe") return "exe case 0";
   if (VortexExe("\"C:\\Modding\\MO2\\nxmhandler.exe\" \"%1\"") != "") return "exe case 1";
   return "";
  }
 }
}
'@
    $asm = Add-LauncherType -Source ($fixture.Replace('__METHODS__', $slug + "`n" + $nxmUrl + "`n" + $starts + "`n" + $exeOf))
    $said = [string]$asm.GetType('Thornswood.CollectionNxmFixture').GetMethod('Run').Invoke($null, @())
    Yes ('the real CollectionNxmUrl names the revision for both address shapes and nothing without one, and NxmStartsVortex knows Vortex from another handler' + $(if ($said) { ' (' + $said + ')' } else { '' })) ($said -eq '')
}

Write-Host ''
Write-Host ($script:pass.ToString() + ' passed, ' + $script:fail + ' failed')
if ($script:fail) { exit 1 }
exit 0
