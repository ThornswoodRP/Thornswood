# Run setup's actual copy and ownership paths against disposable directories.
$ErrorActionPreference = 'Stop'
$app = Join-Path $PSScriptRoot '../app'
function Section($code, $first, $next) {
    $start = $code.IndexOf($first)
    return $code.Substring($start, $code.IndexOf($next, $start) - $start)
}
$install = Get-Content -Raw (Join-Path $app 'InstallSteps.cs')
$run = (Section $install '            List<string> files = PayloadFiles(payload);' '            // ------------------------------------------------- profile').Replace('            if (madeOwn) RemoveSharedNames(payload, files, gameDir);', '')
$listFiles = Section $install '        static List<string> PayloadFiles(' '        // ---- a record'
$ownership = (Section $install '        // ---- a record' '        // A hard link').Replace('string staged = manifest +', 'BeforeOwnershipWrite(); string staged = manifest +')
$copy = Section $install '        void CopyPayload(' '        // ---------------------------------------------------------------- settings'
$update = Section (Get-Content -Raw (Join-Path $app 'Updater.cs')) '        static void NoteInstalledIntoGame(' '        /// <summary>'
$remove = Section (Get-Content -Raw (Join-Path $app 'Uninstall.cs')) '        public static string[] OurGameFiles(' '        static void Kill()'
$fence = (Get-Content -Raw (Join-Path $app 'PathFence.cs')).Replace('using System;', '').Replace('using System.IO;', '')
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
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
    static class Swallow {
        internal static string MissingDestination;
        public static void Note(string where, Exception e) {
            if (e is FileNotFoundException || e is DirectoryNotFoundException) { MissingDestination = where; return; }
            throw new Exception(where, e);
        }
    }
    static class Failure { public static string Why(string where, Exception e, string target) => e.Message; }
    public class OwnershipFixture {
        bool ownFirst, madeOwn;
        string ProfileDir => Paths.ProfileDir;
        static void Say(string text) { Console.WriteLine(text); }
        static Exception Die(string text) => new InvalidOperationException(text);
        static int WritesUntilFailure;
        static void BeforeOwnershipWrite() {
            if (WritesUntilFailure > 0 && --WritesUntilFailure == 0) throw new IOException("fixture: second ownership write failed");
        }
        public static void BlockCompaction() => WritesUntilFailure = 2;
        static Action AfterCopy;
        static void progress(double value) => AfterCopy?.Invoke();
        public static void PlantLateCollision(string dest) => AfterCopy = () => {
            AfterCopy = null;
            File.WriteAllText(dest, "late unmanaged bytes");
        };
$listFiles
$ownership
$copy
$update
$remove
        void CopyStage(string payload, string gameDir) {
$run
        }
        public static string Setup(string profile, string game, bool own, string payload) {
            Paths.ProfileDir = profile;
            if (!own) Paths.SteamCopy = game;
            Directory.CreateDirectory(profile);
            try { new OwnershipFixture { ownFirst = own, madeOwn = false }.CopyStage(payload, game); return ""; }
            catch (Exception e) when (e is InvalidOperationException || e is IOException || e is UnauthorizedAccessException) { return e.Message; }
        }
        public static void Update(string name) => NoteInstalledIntoGame(new List<string> { name });
        public static int Remove() => RemoveOurGameFiles(new Config(), Say);
        public static string MissingDestination => Swallow.MissingDestination;
    }
}
"@
$script:failed = 0
function Check($name, $ok) {
    if ($ok) { Write-Host "PASS $name" }
    else { Write-Host "FAIL $name"; $script:failed++ }
}
function Put($dir, $name, $text) {
    $file = Join-Path $dir $name
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($file)) | Out-Null
    [IO.File]::WriteAllText($file, $text)
}
$root = Join-Path ([IO.Path]::GetTempPath()) ('tw-ownership-' + [Guid]::NewGuid())
$game = Join-Path $root 'SteamSkyrim'
$profile = Join-Path $root 'Profile'
$list = Join-Path $profile 'installed-into-game.txt'
$first = Join-Path $root 'first'
$second = Join-Path $root 'second'
$collision = Join-Path $root 'collision'
$failure = Join-Path $root 'failure'
$own = Join-Path $root 'own'
[IO.Directory]::CreateDirectory($root) | Out-Null
try {
    foreach ($name in @('Older.esp', 'Shared.esp', 'Vortex.esp')) { Put $first $name 'first' }
    Put $game 'Skyrim.esm' 'Bethesda'
    Put $game 'Unmanaged.esp' 'unrelated bytes'
    $one = [Thornswood.OwnershipFixture]::Setup($profile, $game, $false, $first)
    Put $game 'Update.esp' 'update'
    [Thornswood.OwnershipFixture]::Update('Update.esp')
    Put $second 'Shared.esp' 'new shared'
    Put $second 'Newer.esp' 'second'
    $two = [Thornswood.OwnershipFixture]::Setup($profile, $game, $false, $second)
    $entries = [IO.File]::ReadAllLines($list)
    Check 'two setups really copy and keep ownership from both builds and the update' (!$one -and !$two -and $entries.Count -eq 5 -and 'Older.esp' -in $entries -and 'Newer.esp' -in $entries -and 'Update.esp' -in $entries -and [IO.File]::ReadAllText((Join-Path $game 'Shared.esp')) -ceq 'new shared')
    Check 'the overlapping path is listed once' (@($entries -ieq 'Shared.esp').Count -eq 1)
    Put $collision 'Unmanaged.esp' 'different package bytes'
    $why = [Thornswood.OwnershipFixture]::Setup($profile, $game, $false, $collision)
    Check 'setup names the unowned collision and what to do about it' ($why -like '*Unmanaged.esp*' -and $why -like '*own folder*')
    Check 'setup neither overwrites nor claims the unowned file' ([IO.File]::ReadAllText((Join-Path $game 'Unmanaged.esp')) -ceq 'unrelated bytes' -and 'Unmanaged.esp' -notin [IO.File]::ReadAllLines($list))
    Put $failure 'A-Copied.esp' 'new owned'
    Put $failure 'Z-Blocked/Failed.esp' 'could not copy'
    Put $game 'Z-Blocked' 'a file, not a directory'
    $why = [Thornswood.OwnershipFixture]::Setup($profile, $game, $false, $failure)
    $entries = [IO.File]::ReadAllLines($list)
    Check 'failed copy reports the file and records only the earlier successful copy' ($why -like '*Could not copy*Failed.esp*' -and 'A-Copied.esp' -in $entries -and !($entries -match 'Failed\.esp$') -and [IO.File]::Exists((Join-Path $game 'A-Copied.esp')))
    Put $own 'OwnOnly.esp' 'own copy'
    $why = [Thornswood.OwnershipFixture]::Setup($profile, (Join-Path $root 'OwnGame'), $true, $own)
    Check 'own-folder setup does not change the Steam list' (!$why -and ([IO.File]::ReadAllLines($list) -join '|') -ceq ($entries -join '|'))
    $gone = [Thornswood.OwnershipFixture]::Remove()
    $left = @([IO.Directory]::GetFiles($game) | ForEach-Object { [IO.Path]::GetFileName($_) } | Sort-Object)
    Check 'uninstall removes only tracked files not deployed by Vortex' ($gone -eq 5 -and ($left -join '|') -ceq 'Skyrim.esm|Unmanaged.esp|Vortex.esp|Z-Blocked')
    $blockedProfile = Join-Path $root 'BlockedProfile'
    $blockedList = Join-Path $blockedProfile 'installed-into-game.txt'
    $otherGame = Join-Path $root 'OtherSteam'
    $otherPayload = Join-Path $root 'OtherPayload'
    Put $blockedList 'keep.txt' 'blocks replacing the ownership list'
    Put $otherPayload 'Fresh.esp' 'new setup bytes'
    Put $otherGame 'Skyrim.esm' 'Bethesda'
    $why = [Thornswood.OwnershipFixture]::Setup($blockedProfile, $otherGame, $false, $otherPayload)
    $fresh = Join-Path $otherGame 'Fresh.esp'
    Write-Host "Blocked list: $why; new file left in Steam: $([IO.File]::Exists($fresh))"
    Check 'ownership write failure names the list and leaves no new Steam file or staging file' ($why -like '*installed-into-game.txt*' -and @([IO.Directory]::GetFileSystemEntries($otherGame)).Count -eq 1 -and @([IO.Directory]::GetFiles($blockedProfile)).Count -eq 0 -and [IO.File]::ReadAllText((Join-Path $blockedList 'keep.txt')) -ceq 'blocks replacing the ownership list')
    [IO.Directory]::Delete($blockedList, $true)
    $why = [Thornswood.OwnershipFixture]::Setup($blockedProfile, $otherGame, $false, $otherPayload)
    Write-Host "Setup after removing the fixture obstruction: $why"
    Check 'setup can run again and record the new copy without claiming Skyrim' (!$why -and [IO.File]::ReadAllText($fresh) -ceq 'new setup bytes' -and ([IO.File]::ReadAllLines($blockedList) -join '|') -ceq 'Fresh.esp' -and [IO.File]::ReadAllText((Join-Path $otherGame 'Skyrim.esm')) -ceq 'Bethesda')
    $late = Join-Path $root 'LatePayload'
    $lateDest = Join-Path $otherGame 'Late.esp'
    Put $late 'Late.esp' 'package bytes'
    [Thornswood.OwnershipFixture]::PlantLateCollision($lateDest)
    $why = [Thornswood.OwnershipFixture]::Setup($blockedProfile, $otherGame, $false, $late)
    Check 'a file arriving after staging is not replaced or recorded' ($why -like '*Could not copy*Late.esp*' -and [IO.File]::ReadAllText($lateDest) -ceq 'late unmanaged bytes' -and ([IO.File]::ReadAllLines($blockedList) -join '|') -ceq 'Fresh.esp')
    $pending = Join-Path $root 'PendingPayload'
    Put $pending 'Pending.esp' 'pending bytes'
    [Thornswood.OwnershipFixture]::BlockCompaction()
    $why = [Thornswood.OwnershipFixture]::Setup($blockedProfile, $otherGame, $false, $pending)
    $published = Join-Path $otherGame 'Pending.esp'
    $record = [IO.File]::ReadAllLines($blockedList)
    Check 'a failed compaction leaves a published copy with durable ownership' ($why -like '*fixture: second ownership write failed*' -and [IO.File]::ReadAllText($published) -ceq 'pending bytes' -and @($record -like 'setup|*|Pending.esp').Count -eq 1)
    $why = [Thornswood.OwnershipFixture]::Setup($blockedProfile, $otherGame, $false, $pending)
    Check 'setup recovers a completed move without treating it as a collision' (!$why -and ([IO.File]::ReadAllLines($blockedList) -join '|') -ceq 'Fresh.esp|Pending.esp' -and @([IO.Directory]::GetDirectories($otherGame, '.tw-setup-*')).Count -eq 0)
    Put $root 'replacement' 'unrelated replacement'
    Put $late 'Late.esp' 'package bytes'
    [IO.File]::Delete($lateDest)
    [Thornswood.OwnershipFixture]::BlockCompaction()
    $why = [Thornswood.OwnershipFixture]::Setup($blockedProfile, $otherGame, $false, $late)
    [IO.File]::Move((Join-Path $root 'replacement'), $lateDest, $true)
    $gone = [Thornswood.OwnershipFixture]::Remove()
    Check 'uninstall does not use a prepared receipt for a replacement file' ($why -like '*fixture: second ownership write failed*' -and $gone -eq 2 -and [IO.File]::ReadAllText($lateDest) -ceq 'unrelated replacement')
    $missingPayload = Join-Path $root 'MissingPayload'
    $missingGame = Join-Path $root 'MissingSteam'
    $missingProfile = Join-Path $root 'MissingProfile'
    $missingPath = Join-Path $missingGame 'Missing.esp'
    Put $missingPayload 'Missing.esp' 'setup bytes'
    [Thornswood.OwnershipFixture]::BlockCompaction()
    $why = [Thornswood.OwnershipFixture]::Setup($missingProfile, $missingGame, $false, $missingPayload)
    [IO.File]::Delete($missingPath)
    $gone = [Thornswood.OwnershipFixture]::Remove()
    Check 'a missing prepared destination is logged and not claimed' ($why -like '*fixture: second ownership write failed*' -and $gone -eq 0 -and [Thornswood.OwnershipFixture]::MissingDestination -like '*Missing.esp')
} finally { [IO.Directory]::Delete($root, $true) }
Write-Host "$(14 - $failed) passed, $failed failed"
if ($failed) { exit 1 }
