# Compile the actual ownership writers and uninstaller, not the launcher.
$ErrorActionPreference = 'Stop'
$app = Join-Path $PSScriptRoot '../app'
function Methods($file, $first, $next) {
    $code = Get-Content -Raw (Join-Path $app $file)
    $start = $code.IndexOf($first)
    return $code.Substring($start, $code.IndexOf($next, $start) - $start)
}
$record = Methods 'InstallSteps.cs' '        void RecordIntoGame(' '        // A hard link'
$update = Methods 'Updater.cs' '        static void NoteInstalledIntoGame(' '        /// <summary>'
$remove = Methods 'Uninstall.cs' '        public static string[] OurGameFiles(' '        static void Kill()'
$fence = Get-Content -Raw (Join-Path $app 'PathFence.cs')
Add-Type -TypeDefinition @"
using System.Collections.Generic;
using System.Globalization;
using System.Text;
$fence
namespace Thornswood {
    public sealed class Config {}
    static class Paths {
        public static string ProfileDir, SteamCopy;
        public static bool Collection => true;
        public static bool OwnFirst => false;
    }
    static class OwnGame {
        public static bool Active => false;
        public static string Source(Config cfg) => "";
        public static HashSet<string> DeployedIn(string root) => new(StringComparer.OrdinalIgnoreCase) { "Vortex.esp" };
    }
    static class Swallow { public static void Note(string where, Exception e) => throw new Exception(where, e); }
    public class OwnershipFixture {
        bool ownFirst, madeOwn;
        string ProfileDir => Paths.ProfileDir;
        static void Say(string text) { Console.WriteLine(text); }
$record
$update
$remove
        public static string[] Setup(string profile, string game, bool own, string[] files) {
            Paths.ProfileDir = profile;
            Paths.SteamCopy = game;
            var copying = new List<string>(files);
            new OwnershipFixture { ownFirst = own, madeOwn = false }.RecordIntoGame(copying, game);
            return copying.ToArray();
        }
        public static void Update(string name) => NoteInstalledIntoGame(new List<string> { name });
        public static int Remove() => RemoveOurGameFiles(new Config(), Say);
    }
}
"@
$script:failed = 0
function Check($name, $ok) {
    if ($ok) { Write-Host "PASS $name" }
    else { Write-Host "FAIL $name"; $script:failed++ }
}
$root = Join-Path ([IO.Path]::GetTempPath()) ('tw-ownership-' + [Guid]::NewGuid())
$game = Join-Path $root 'SteamSkyrim'
$profile = Join-Path $root 'Profile'
$list = Join-Path $profile 'installed-into-game.txt'
[IO.Directory]::CreateDirectory($game) | Out-Null
try {
    $first = [string[]]@('Older.esp', 'Shared.esp', 'Vortex.esp')
    $second = [string[]]@('shared.esp', 'Newer.esp', 'Unmanaged.esp')
    [Thornswood.OwnershipFixture]::Setup($profile, $game, $false, $first)
    foreach ($name in $first + @('Skyrim.esm', 'Unmanaged.esp')) { [IO.File]::WriteAllText((Join-Path $game $name), 'first') }
    [IO.File]::WriteAllText((Join-Path $game 'Update.esp'), 'update')
    [Thornswood.OwnershipFixture]::Update('Update.esp')
    $copying = [Thornswood.OwnershipFixture]::Setup($profile, $game, $false, $second)
    [IO.File]::WriteAllText((Join-Path $game 'Shared.esp'), 'second')
    [IO.File]::WriteAllText((Join-Path $game 'Newer.esp'), 'second')
    $entries = [IO.File]::ReadAllLines($list)
    Check 'repeat setup keeps both builds and the update' ($entries.Count -eq 5 -and 'Older.esp' -in $entries -and 'Newer.esp' -in $entries -and 'Update.esp' -in $entries)
    Check 'a case-only overlap is one entry' (@($entries -ieq 'Shared.esp').Count -eq 1)
    Check 'setup does not claim files it did not put there' ('Skyrim.esm' -notin $entries -and 'Unmanaged.esp' -notin $entries -and 'Unmanaged.esp' -notin $copying)
    [Thornswood.OwnershipFixture]::Setup($profile, $game, $true, [string[]]@('OwnOnly.esp'))
    Check 'own-folder setup does not change the Steam list' (([IO.File]::ReadAllLines($list) -join '|') -ceq ($entries -join '|'))
    $gone = [Thornswood.OwnershipFixture]::Remove()
    $left = @([IO.Directory]::GetFiles($game) | ForEach-Object { [IO.Path]::GetFileName($_) } | Sort-Object)
    Check 'uninstall removes exactly the four tracked files not deployed by Vortex' ($gone -eq 4 -and ($left -join '|') -ceq 'Skyrim.esm|Unmanaged.esp|Vortex.esp')
} finally { [IO.Directory]::Delete($root, $true) }
Write-Host "$(5 - $failed) passed, $failed failed"
if ($failed) { exit 1 }
