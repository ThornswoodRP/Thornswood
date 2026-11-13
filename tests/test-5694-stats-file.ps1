<#
  test-5694-stats-file.ps1

      pwsh -NoProfile -File .\tests\test-5694-stats-file.ps1

  #5694, part of #4351: launcher\app\Stats.cs reads and writes stats.txt in
  the profile (sessions, minutes played, when it was last played and the
  last update), and no harness compiled it, so a change that lost a line of
  it, wrote it in the machine's own number format or threw out of Play
  passed every check.

    1. Save into a profile folder that is not there yet makes it, and Load
       reads back every value Save wrote.
    2. The file is four lines in a fixed order, its numbers written the
       same way whatever the machine's language, and a machine whose
       language writes 125,5 still reads 125.5 back.
    3. No stats.txt: Load leaves what it had and notes nothing.
    4. Lines it does not know, and lines with no key, are passed over; the
       ones it knows are still read.
    5. A Save that cannot write throws nothing out of it and notes why.
    6. StartedPlaying counts one more session, on disk.
    7. A copy of Stats.cs whose Save drops the last update fails check 1,
       so the round trip has teeth.

  HOW. Compiles the shipped Stats.cs with stand-ins for Paths and Swallow,
  with the .NET SDK the launcher builds with (Add-LauncherType,
  tests\Launcher-Csc.ps1), and runs it against a scratch profile in a temp
  folder Get-ScratchDir.ps1 names. Changes nothing outside that folder. Runs
  everywhere.
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
# Stats.cs in a namespace of its own, with stand-ins for what it calls and a
# public door the harness reaches it through.
function Build-Stats([string]$source, [string]$ns) {
    $cs = $source -replace 'namespace Thornswood\b', "namespace $ns"
    $stubs = @'
namespace __NS__
{
    static class Paths { public static string ProfileDir = ""; }
    static class Swallow
    {
        public static System.Collections.Generic.List<string> Said = new System.Collections.Generic.List<string>();
        public static void Note(string where, System.Exception e) { Said.Add(where + ": " + e.GetType().Name); }
    }
    public static class Api
    {
        public static void SetProfile(string dir) { Paths.ProfileDir = dir; }
        public static void Set(int sessions, double minutes, System.DateTime last, string update)
        { Stats.Sessions = sessions; Stats.Minutes = minutes; Stats.LastPlayed = last; Stats.LastUpdate = update; }
        public static int Sessions() { return Stats.Sessions; }
        public static double Minutes() { return Stats.Minutes; }
        public static System.DateTime LastPlayed() { return Stats.LastPlayed; }
        public static string LastUpdate() { return Stats.LastUpdate; }
        public static void Load() { Stats.Load(); }
        public static void Save() { Stats.Save(); }
        public static void Started() { Stats.StartedPlaying(); }
        public static string Notes() { return string.Join("; ", Swallow.Said); }
        public static void ClearNotes() { Swallow.Said.Clear(); }
    }
}
'@ -replace '__NS__', $ns
    $null = Add-LauncherType -Source $cs, $stubs
    return ($ns + '.Api')
}

$shipped = [IO.File]::ReadAllText((Join-Path $app 'Stats.cs'))
$apiName = $null
try { $apiName = Build-Stats $shipped 'Thornswood5694' }
catch { Write-Host ('      ' + $_.Exception.Message) }
Yes "Stats.cs compiles with the .NET SDK the launcher builds with, C# $LauncherLangVersion" ($null -ne $apiName)
if (-not $apiName) { Done }
$Api = $apiName -as [type]

$last = [datetime]::new(2026, 11, 13, 3, 15, 30, [DateTimeKind]::Utc)
$inv = [Globalization.CultureInfo]::InvariantCulture

# Save, forget, Load: does every value come back? Used for the shipped copy
# and for the broken one in 7.
function Test-RoundTrip($api, [string]$prof) {
    $api::SetProfile($prof)
    $api::Set(3, 125.46, $last, '1.3.42')
    $api::Save()
    $api::Set(0, 0, [datetime]::MinValue, '')
    $api::Load()
    return [pscustomobject]@{
        Made     = [IO.Directory]::Exists($prof)
        Sessions = $api::Sessions()
        Minutes  = $api::Minutes()
        Last     = $api::LastPlayed()
        Update   = $api::LastUpdate()
    }
}

$tmp = & (Join-Path $root 'scripts\release\Get-ScratchDir.ps1') ('test-5694-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$culture = [Globalization.CultureInfo]::CurrentCulture
try {
    # ---- 1. the round trip ---------------------------------------------------
    Write-Host ''; Write-Host 'save and load'
    $prof = Join-Path $tmp 'one\Profile'
    $r = Test-RoundTrip $Api $prof
    Yes '1. Save makes a profile folder that is not there yet' $r.Made
    Yes "1. sessions come back ($($r.Sessions))" ($r.Sessions -eq 3)
    Yes ("1. minutes come back, to a tenth ({0})" -f $r.Minutes.ToString($inv)) ($r.Minutes -eq 125.5)
    Yes ("1. when it was last played comes back ({0:o})" -f $r.Last) ($r.Last -eq $last -and $r.Last.Kind -eq [DateTimeKind]::Utc)
    Yes "1. the last update comes back ($($r.Update))" ($r.Update -eq '1.3.42')
    Yes '1. and nothing was noted' ($Api::Notes() -eq '')

    # ---- 2. the file, whatever the machine's language -------------------------
    Write-Host ''; Write-Host 'the file'
    $file = Join-Path $prof 'stats.txt'
    $lines = @([IO.File]::ReadAllLines($file))
    Yes ("2. stats.txt is four lines in order ({0})" -f ($lines -join ' | ')) (
        $lines.Count -eq 4 -and $lines[0] -eq 'sessions=3' -and $lines[1] -eq 'minutes=125.5' -and
        $lines[2] -eq ('lastPlayed=' + $last.ToString('o')) -and $lines[3] -eq 'lastUpdate=1.3.42')
    [Globalization.CultureInfo]::CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo('de-DE')
    Yes ('2. this machine now writes one and a half as {0}' -f (1.5).ToString()) ((1.5).ToString() -eq '1,5')
    $Api::Set(3, 125.46, $last, '1.3.42')
    $Api::Save()
    $german = @([IO.File]::ReadAllLines($file))
    Yes ("2. on a machine that writes 125,5 the file still says {0}" -f $german[1]) ($german[1] -eq 'minutes=125.5')
    $Api::Set(0, 0, [datetime]::MinValue, '')
    $Api::Load()
    Yes ('2. and that machine reads 125.5 back ({0})' -f $Api::Minutes().ToString($inv)) ($Api::Minutes() -eq 125.5 -and $Api::LastPlayed() -eq $last)
    [Globalization.CultureInfo]::CurrentCulture = $culture

    # ---- 3. no file -------------------------------------------------------------
    Write-Host ''; Write-Host 'no stats.txt'
    $none = Join-Path $tmp 'none\Profile'
    $Api::SetProfile($none)
    $Api::Set(5, 12, $last, '1.3.40')
    $Api::ClearNotes()
    $Api::Load()
    Yes '3. Load leaves what it had' ($Api::Sessions() -eq 5 -and $Api::Minutes() -eq 12 -and $Api::LastPlayed() -eq $last -and $Api::LastUpdate() -eq '1.3.40')
    Yes '3. notes nothing' ($Api::Notes() -eq '')
    Yes '3. and makes no folder' (-not [IO.Directory]::Exists($none))

    # ---- 4. lines it does not know -------------------------------------------
    Write-Host ''; Write-Host 'lines it does not know'
    $odd = Join-Path $tmp 'odd\Profile'
    New-Item -ItemType Directory -Force -Path $odd | Out-Null
    [IO.File]::WriteAllLines((Join-Path $odd 'stats.txt'), [string[]]@('# kept by hand', '=7', 'colour=blue', 'sessions = 7', 'no equals sign', 'lastUpdate=1.2.9'))
    $Api::SetProfile($odd)
    $Api::Set(0, 0, [datetime]::MinValue, '')
    $Api::ClearNotes()
    $threw = $null
    try { $Api::Load() } catch { $threw = $_.Exception.Message }
    Yes '4. Load throws nothing on lines it does not know' ($null -eq $threw)
    Yes "4. and still reads the ones it knows (sessions $($Api::Sessions()), last update $($Api::LastUpdate()))" ($Api::Sessions() -eq 7 -and $Api::LastUpdate() -eq '1.2.9')
    Yes '4. a value it never saw stays as it was' ($Api::LastPlayed() -eq [datetime]::MinValue)

    # ---- 5. a Save that cannot write ------------------------------------------
    Write-Host ''; Write-Host 'a Save that cannot write'
    # The profile path is a file, so neither the folder nor stats.txt can be made.
    $blocked = Join-Path $tmp 'blocked'
    [IO.File]::WriteAllText($blocked, 'not a folder')
    $Api::SetProfile($blocked)
    $Api::ClearNotes()
    $threw = $null
    try { $Api::Save() } catch { $threw = $_.Exception.Message }
    Yes '5. Save throws nothing out of it, so Play goes on' ($null -eq $threw)
    Yes ("5. and notes why, as Stats.Save ({0})" -f $Api::Notes()) ($Api::Notes() -like 'Stats.Save: *')

    # ---- 6. StartedPlaying ------------------------------------------------------
    Write-Host ''; Write-Host 'a Play'
    $play = Join-Path $tmp 'play\Profile'
    $Api::SetProfile($play)
    $Api::Set(4, 30, [datetime]::MinValue, '1.3.42')
    $Api::Started()
    $onDisk = @([IO.File]::ReadAllLines((Join-Path $play 'stats.txt')))
    Yes ("6. StartedPlaying counts one more session, on disk ({0})" -f $onDisk[0]) ($Api::Sessions() -eq 5 -and $onDisk[0] -eq 'sessions=5')
    Yes '6. and sets when it was last played' ($Api::LastPlayed() -ne [datetime]::MinValue -and $onDisk[2] -ne 'lastPlayed=')

    # ---- 7. the round trip has teeth --------------------------------------------
    Write-Host ''; Write-Host 'a broken copy'
    $broken = $shipped.Replace('"lastUpdate=" + LastUpdate + Environment.NewLine', '""')
    Yes '7. the broken copy differs from the shipped one' ($broken -ne $shipped)
    $brokenName = $null
    try { $brokenName = Build-Stats $broken 'Thornswood5694Broken' }
    catch { Write-Host ('      ' + $_.Exception.Message) }
    if ($brokenName) {
        $b = Test-RoundTrip ($brokenName -as [type]) (Join-Path $tmp 'broken\Profile')
        Yes ("7. a Save that drops the last update fails check 1 (it came back '{0}')" -f $b.Update) ($b.Update -ne '1.3.42')
    } else { Yes '7. the broken copy compiles' $false }
}
finally {
    [Globalization.CultureInfo]::CurrentCulture = $culture
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Done
