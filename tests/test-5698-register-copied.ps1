<#
  test-5698-register-copied.ps1

      pwsh -NoProfile -File .\tests\test-5698-register-copied.ps1

  #5698, part of #4351: launcher\app\Register.cs reads OwnGame's build
  record, Profile\OwnGame\made.txt, for the size it gives Installed apps
  (TryReadCopied). launcher\tests\test-uninstall-held-file.ps1 compiles
  Register.cs for HideEntry, but nothing ran the read, so a change that
  invented a size for a missing or damaged record passed every check.

    1. A whole record: its copied= figure, and true.
    2. No record: false and 0, and nothing noted.
    3. A record with no copied= line: false.
    4. A damaged figure (not a number, below zero): false, never a guess.
    5. A record that cannot be read: false, and the reason is noted.
    6. A copy of Register.cs that answers true for a missing record fails
       check 2, so the checks have teeth.

  HOW. Compiles the shipped Register.cs with stand-ins for Paths, Swallow,
  Config and Velo, with the .NET SDK the launcher builds with
  (Add-LauncherType, tests\Launcher-Csc.ps1), and calls TryReadCopied on a
  scratch profile in a temp folder Get-ScratchDir.ps1 names. Touches no
  registry and nothing outside that folder. Runs everywhere.
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'launcher\app'
. (Join-Path $PSScriptRoot 'Launcher-Csc.ps1')

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ""
    Write-Host "$($script:pass) passed, $($script:fail) failed"
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}

# ------------------------------------------------------------------ compile
function Build-Register([string]$source, [string]$ns) {
    $cs = $source -replace 'namespace Thornswood\b', "namespace $ns"
    $stubs = @'
namespace __NS__
{
    static class Paths { public static string Root = ""; public static string ProfileDir = ""; }
    public class Config { public string BuildName = "Thornswood"; public string SiteUrl = ""; }
    static class Velo
    {
        public static bool Installed = false;
        public class Where { public string AppId = ""; public string UpdateExePath = ""; }
        public static Where Locator = new Where();
    }
    static class Swallow
    {
        public static System.Collections.Generic.List<string> Said = new System.Collections.Generic.List<string>();
        public static void Note(string where, System.Exception e) { Said.Add(where + ": " + e.GetType().Name); }
    }
    public static class Api
    {
        public static void SetProfile(string dir) { Paths.ProfileDir = dir; }
        public static string Notes() { return string.Join("; ", Swallow.Said); }
        public static void ClearNotes() { Swallow.Said.Clear(); }
        // TryReadCopied is private to Register, as it ships; read through reflection.
        public static string Copied()
        {
            var m = typeof(Register).GetMethod("TryReadCopied", System.Reflection.BindingFlags.NonPublic | System.Reflection.BindingFlags.Static);
            if (m == null) return "no TryReadCopied";
            object[] a = new object[] { 0L };
            bool ok = (bool)m.Invoke(null, a);
            return ok + " " + (long)a[0];
        }
    }
}
'@ -replace '__NS__', $ns
    $null = Add-LauncherType -Source $cs, $stubs
    return ($ns + '.Api')
}

$shipped = [IO.File]::ReadAllText((Join-Path $app 'Register.cs'))
$apiName = $null
try { $apiName = Build-Register $shipped 'Thornswood5698' }
catch { Write-Host ('      ' + $_.Exception.Message) }
Yes "Register.cs compiles with the .NET SDK the launcher builds with, C# $LauncherLangVersion" ($null -ne $apiName)
if (-not $apiName) { Done }
$Api = $apiName -as [type]

$tmp = & (Join-Path $root 'scripts\release\Get-ScratchDir.ps1') ('test-5698-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
# Path.Combine(ProfileDir, "OwnGame", "made.txt"), with this system's separator.
function Record([string]$prof) { [IO.Path]::Combine($prof, 'OwnGame', 'made.txt') }
function Plant([string]$name, [string[]]$lines) {
    $prof = Join-Path $tmp $name
    $f = Record $prof
    New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($f)) | Out-Null
    [IO.File]::WriteAllLines($f, $lines)
    return $prof
}
function Read-Copied($api, [string]$prof) {
    $api::SetProfile($prof)
    $api::ClearNotes()
    return $api::Copied()
}

try {
    # ---- 1. a whole record -------------------------------------------------------
    $p = Plant 'whole' @('built=2026-11-12T20:00:00Z', 'files=1203', 'copied=123456789', 'skipped=4')
    $got = Read-Copied $Api $p
    Yes "1. a whole record gives its copied= figure ($got)" ($got -eq 'True 123456789')
    Yes '1. and notes nothing' ($Api::Notes() -eq '')

    # ---- 2. no record -----------------------------------------------------------
    $got = Read-Copied $Api (Join-Path $tmp 'none')
    Yes "2. no record: false and 0, no invented size ($got)" ($got -eq 'False 0')
    Yes '2. and notes nothing, since a new install has none' ($Api::Notes() -eq '')

    # ---- 3. no copied= line -----------------------------------------------------
    $got = Read-Copied $Api (Plant 'noline' @('built=2026-11-12T20:00:00Z', 'files=1203'))
    Yes "3. a record with no copied= line: false ($got)" ($got -eq 'False 0')

    # ---- 4. damaged figures -----------------------------------------------------
    $n = 0
    foreach ($bad in 'copied=lots', 'copied=-5', 'copied=', 'copied=12.5') {
        $n++
        $got = Read-Copied $Api (Plant ('bad' + $n) @('built=x', $bad))
        Yes "4. '$bad' is no size: false, never a guess ($got)" ($got -eq 'False 0')
    }

    # ---- 5. a record that cannot be read ----------------------------------------
    # made.txt is a folder, so File.Exists is false and nothing is read; a
    # file that exists and cannot be opened is the case to note. Hold it open
    # for writing with no sharing, which Windows refuses a reader; elsewhere
    # the read goes through, so the check is Windows' alone.
    $p = Plant 'held' @('copied=99')
    $onWindows = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT
    if ($onWindows) {
        $hold = [IO.File]::Open((Record $p), 'Open', 'ReadWrite', 'None')
        try { $got = Read-Copied $Api $p } finally { $hold.Dispose() }
        Yes "5. a record held by another program: false ($got)" ($got -eq 'False 0')
        Yes ("5. and the reason is noted ({0})" -f $Api::Notes()) ($Api::Notes() -like 'Register.TryReadCopied*')
    } else {
        Write-Host 'SKIP  5. a record held by another program: only Windows refuses a reader a file held with no sharing'
    }

    # ---- 6. teeth ---------------------------------------------------------------
    $broken = $shipped.Replace('if (!File.Exists(path)) return false;', 'if (!File.Exists(path)) return true;')
    Yes '6. the broken copy differs from the shipped one' ($broken -ne $shipped)
    $brokenName = $null
    try { $brokenName = Build-Register $broken 'Thornswood5698Broken' }
    catch { Write-Host ('      ' + $_.Exception.Message) }
    if ($brokenName) {
        $got = Read-Copied ($brokenName -as [type]) (Join-Path $tmp 'none')
        Yes "6. a copy that answers true for no record fails check 2 ($got)" ($got -ne 'False 0')
    } else { Yes '6. the broken copy compiles' $false }
}
finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }

Done
