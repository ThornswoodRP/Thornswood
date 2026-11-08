<#
  test-own-folder-record.ps1

      pwsh -NoProfile -File .\launcher\tests\test-own-folder-record.ps1

  Thornswood's own Skyrim folder counts as made only when Root\Game and the
  record OwnGame.Make writes as it finishes (Profile\OwnGame\files.txt) are
  both there. Paths.Init used to decide it from the folder alone.

  Measured on One on 8 Nov: Root\Game was deleted while the launcher ran, the
  update wrote its few files back into a new Root\Game (Data\Interface,
  Platform, SKSE and Scripts, nothing else), and Paths.Init took that for the
  game. The plugin list was then read from Profile\LocalAppData, which had
  none, so Checks.EnabledPlugins said 0, the card above Play said "Your mods
  are not installed yet" with revision 7 deployed by Vortex, and OwnGame.Make
  refused to make the folder because one was already there. The second case
  below is that machine, and fails on the code before the change.

  Compiles the real Paths.cs and Swallow.cs with a stand-in Steam that names
  a folder of the test's own, with the .NET SDK the launcher builds with
  (tests\Launcher-Csc.ps1). Also reads OwnGame.cs, to hold its record and
  Paths' to the one name. Writes only under its own temp folder.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$Repo = Split-Path -Parent (Split-Path -Parent $Here)
$app = [IO.Path]::Combine($Repo, 'launcher', 'app')

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

# OwnGame reads and writes its record through Paths, so the two cannot name
# different files.
$own = Get-Content -LiteralPath (Join-Path $app 'OwnGame.cs') -Raw
Yes 'OwnGame.FilesList is Paths.OwnGameRecord' ($own -match 'static string FilesList \{ get \{ return Paths\.OwnGameRecord\(Paths\.Root\); \} \}')
Yes 'Make refuses only a Game folder that has its record' ($own -match 'if \(Directory\.Exists\(Folder\) && File\.Exists\(FilesList\)\)')

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$cs = @'
using System;
using System.IO;

namespace Thornswood
{
    // The Steam copy is a folder of the test's own.
    static class Steam
    {
        public static string Copy = "";
        public static string SkyrimPath() { return Copy; }
    }

    static class Driver
    {
        static int fail;
        static void Yes(string what, bool cond)
        {
            if (cond) { Console.WriteLine("PASS  " + what); }
            else { Console.WriteLine("FAIL  " + what); fail++; }
        }

        static bool Same(string a, string b)
        {
            return string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
        }

        static int Main(string[] args)
        {
            string root = args[0];
            Steam.Copy = args[1];
            string own = Path.Combine(root, "Game");
            string record = Path.Combine(root, "Profile", "OwnGame", "files.txt");

            Yes("OwnGameRecord is Profile\\OwnGame\\files.txt under the root", Same(Paths.OwnGameRecord(root), record));

            Paths.Init(root);
            Yes("no Game folder: the collection, from the Steam copy", Paths.Collection && Same(Paths.Game, Steam.Copy));
            Yes("no Game folder: the plugin list is Windows' own", Same(Paths.Live, Paths.WinLocalAD));

            // One on 8 Nov: what the update left in a Game folder that had been deleted.
            foreach (string d in new[] { "Interface", "Platform", "SKSE", "Scripts" })
                Directory.CreateDirectory(Path.Combine(own, "Data", d));
            File.WriteAllText(Path.Combine(own, "Data", "SKSE", "Thornswood.ini"), "");
            Paths.Init(root);
            Yes("a Game folder with no record is not Thornswood's own: still the collection", Paths.Collection);
            Yes("and the game is still the Steam copy", Same(Paths.Game, Steam.Copy));
            Yes("and the plugin list is still Windows' own, where Vortex writes it", Same(Paths.Live, Paths.WinLocalAD));

            // Made: the folder and its record, as Make leaves them.
            Directory.CreateDirectory(Path.GetDirectoryName(record));
            File.WriteAllText(record, "C|O|1|1|SkyrimSE.exe\n");
            Paths.Init(root);
            Yes("Game folder and record: Thornswood's own folder", !Paths.Collection && Same(Paths.Game, own));
            Yes("and the plugin list is the install's own", Same(Paths.Live, Paths.LocalAD));

            // A record whose folder has gone is not a folder.
            Directory.Delete(own, true);
            Paths.Init(root);
            Yes("a record with no Game folder: the collection, from the Steam copy", Paths.Collection && Same(Paths.Game, Steam.Copy));
            return fail == 0 ? 0 : 1;
        }
    }
}
'@

$exe = $null
try { $exe = Build-LauncherCode -Exe -Source $cs -File (Join-Path $app 'Paths.cs'), (Join-Path $app 'Swallow.cs') }
catch { ($_.Exception.Message -split "`n") | Select-Object -First 20 | ForEach-Object { Write-Host "      $_" } }
Yes 'Paths.cs builds with the driver, with the .NET SDK the launcher builds with' ($null -ne $exe)
if (-not $exe) { Done }

$tmp = Join-Path ([IO.Path]::GetTempPath()) ('own-folder-record-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$root = Join-Path $tmp 'Thornswood'
$steam = Join-Path $tmp 'steamapps\common\Skyrim Special Edition'
New-Item -ItemType Directory -Force -Path (Join-Path $root 'Profile'), $steam | Out-Null

Invoke-LauncherExe $exe $root $steam | ForEach-Object {
    Write-Host $_
    if ($_ -like 'PASS  *') { $script:pass++ } elseif ($_ -like 'FAIL  *') { $script:fail++ }
}
Yes 'the driver finished' ($LASTEXITCODE -eq 0 -or $script:fail -gt 0)

try { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction Stop } catch { }
Done
