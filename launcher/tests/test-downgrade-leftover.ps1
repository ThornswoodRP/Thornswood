<#
  test-downgrade-leftover.ps1

      pwsh -NoProfile -File .\launcher\tests\test-downgrade-leftover.ps1

  The Downgrade button removes a depot folder an earlier attempt left behind
  before it asks Steam for that part, and keeps one this build finished.

  WHY THIS EXISTS. A tester on launcher 1.1.94, 25 September. Part 1 came
  down and Steam said "Depot download complete". The launcher opened Steam's
  console again for part 2 and nothing was typed, and the card said "8,169 MB
  down so far (Steam shows the rest in its console)" and never moved (Patrick:
  "it correctly put the first command in it finnished and than it redid the
  open console command and stopped"). Depot 489832 is 7,260 MB at 1.6.1170,
  so that folder was there from an attempt at another build before Steam was
  asked for anything. With it there:

    1. the check for whether Steam took the command passed at once, on the
       folder being there, so the second try at the console never ran;
    2. the card showed that folder's size where it should have said the
       command was on the clipboard and where to paste it;
    3. Steam fills a depot folder without emptying it, so the other build's
       files would have been copied over the game with the 1.6.1170 ones.

  HOW. ClearLeftover, MarkerIs and FolderSize are lifted out of
  launcher\app\Downgrade.cs by brace match and compiled with the .NET SDK the
  launcher builds with (tests\Launcher-Csc.ps1), and run against folders
  made under a temp folder. Case 5 runs on Windows only: a file held open
  with no sharing keeps its folder only there. Run itself drives Steam's window and cannot be run
  here, so where it calls ClearLeftover is read from its text. Nothing here
  opens Steam or touches Steam's folders.
#>
[CmdletBinding()]
param([string]$AppPath)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the .NET SDK the launcher builds with (#498, #4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in launcher\tests\, the repository is two folders up.
$Here = Split-Path -Parent (Split-Path -Parent $Here)
if (-not $AppPath) { $AppPath = Join-Path $Here 'launcher\app' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail -gt 0) { exit 1 }
    exit 0
}

$src = Join-Path $AppPath 'Downgrade.cs'
Yes 'launcher\app\Downgrade.cs is there' (Test-Path -LiteralPath $src)
if (-not (Test-Path -LiteralPath $src)) { Done }
$text = [IO.File]::ReadAllText($src)

# From the start of the line the signature is on to the brace that closes it.
# Strings, characters and comments are stepped over, so a brace inside one of
# them cannot end the method early. The same walk as
# test-downgrade-steam-window.ps1.
function Get-Member([string]$all, [string]$signature) {
    $at = $all.IndexOf($signature)
    if ($at -lt 0) { return $null }
    $lineStart = $all.LastIndexOf("`n", $at) + 1
    $open = $all.IndexOf('{', $at + $signature.Length)
    if ($open -lt 0) { return $null }
    $depth = 0
    $i = $open
    while ($i -lt $all.Length) {
        $c = $all[$i]
        if ($c -eq '"' -or $c -eq "'") {
            $q = $c; $i++
            while ($i -lt $all.Length -and $all[$i] -ne $q) { if ($all[$i] -eq '\') { $i++ }; $i++ }
        }
        elseif ($c -eq '/' -and $i + 1 -lt $all.Length -and $all[$i + 1] -eq '/') {
            $i = $all.IndexOf("`n", $i); if ($i -lt 0) { return $null }
        }
        elseif ($c -eq '/' -and $i + 1 -lt $all.Length -and $all[$i + 1] -eq '*') {
            $i = $all.IndexOf('*/', $i + 2); if ($i -lt 0) { return $null }; $i++
        }
        elseif ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') {
            $depth--
            if ($depth -eq 0) { return $all.Substring($lineStart, $i + 1 - $lineStart) }
        }
        $i++
    }
    return $null
}

$wanted = [ordered]@{
    'ClearLeftover' = 'static bool ClearLeftover(string folder, int part, Action<string> log, Action<string> status)'
    'MarkerIs'      = 'static bool MarkerIs(string folder, string manifest)'
    'WriteMarker'   = 'static void WriteMarker(string folder, string manifest)'
    'FolderSize'    = 'static long FolderSize(string folder)'
    'Run'           = 'static bool Run(Config cfg, Action<string> log, Action<string> status)'
}
$lifted = [ordered]@{}
foreach ($k in $wanted.Keys) {
    $m = Get-Member $text $wanted[$k]
    Yes ("Downgrade.cs has {0}" -f $k) ($null -ne $m)
    if ($null -ne $m) { $lifted[$k] = $m }
}
if ($lifted.Count -ne $wanted.Count) { Done }

# ---- where Run calls it ------------------------------------------------------
#
# After the marker check, so a part this build finished is kept, and before the
# command goes to Steam, so nothing is watched against a folder Steam has not
# made. A false answer ends the run.
$run = $lifted['Run']
$call = 'if (!ClearLeftover(folder, i + 1, log, status)) return false;'
$atMarker = $run.IndexOf('MarkerIs(folder, manifest)')
$atCall = $run.IndexOf($call)
$atHad = $run.IndexOf('bool hadFolder = Directory.Exists(folder);')
$atType = $run.IndexOf('TypeIntoConsole(cmd, log)')
Yes 'Run removes a leftover folder and stops when it cannot' ($atCall -ge 0)
Yes 'after the check that keeps a part this build finished' ($atMarker -ge 0 -and $atCall -gt $atMarker)
Yes 'and before it looks at the folder or asks Steam for the part' ($atHad -gt $atCall -and $atType -gt $atCall)

# ---- the lifted methods, run -------------------------------------------------
$probe = @'
using System;
using System.Collections.Generic;
using System.IO;

namespace Probe
{
    static class Swallow { public static void Note(string where, Exception e) { } }

    public static class Downgrade
    {
__LIFTED__
    }
}
'@
$body = New-Object System.Text.StringBuilder
foreach ($k in 'ClearLeftover', 'MarkerIs', 'WriteMarker', 'FolderSize') { [void]$body.AppendLine($lifted[$k]) }
# Since #343 an early stop goes through Stop, which also hides the Downgrade
# card's bar. Stop is lifted as it is; the bar is a stand-in that counts.
$stop = Get-Member $text 'static bool Stop(string why, Action<string> log, Action<string> status)'
if ($stop) {
    [void]$body.AppendLine($stop)
    [void]$body.AppendLine('        public static int BarHidden; static void Progress(int percent) { if (percent == -1) BarHidden++; }')
}
$probe = $probe.Replace('__LIFTED__', $body.ToString())

Yes 'the .NET SDK the launcher builds with is on this machine' (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-downgrade-leftover-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
$held = $null
try {
    $asm = $null
    try { $asm = Add-LauncherType -Source $probe }
    catch { $out = $_.Exception.Message }
    Yes 'the lifted methods compile with the .NET SDK the launcher builds with' ($null -ne $asm)
    if (-not $asm) { $out -split "`n" | ForEach-Object { Write-Host "      $_" }; Done }

    $T = $asm.GetType('Probe.Downgrade', $true)
    $flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
    $script:logged = New-Object System.Collections.Generic.List[string]
    $script:shown = New-Object System.Collections.Generic.List[string]
    $log = [Action[string]] { param($s) $script:logged.Add($s) }
    $status = [Action[string]] { param($s) $script:shown.Add($s) }
    function Clear-Said { $script:logged.Clear(); $script:shown.Clear() }
    function Clear-Leftover([string]$folder, [int]$part) {
        return [bool]$T.GetMethod('ClearLeftover', $flags).Invoke($null, @($folder, $part, $log, $status))
    }
    function Marker-Is([string]$folder, [string]$manifest) {
        return [bool]$T.GetMethod('MarkerIs', $flags).Invoke($null, @($folder, $manifest))
    }

    # A depot folder the way Steam leaves one: files at the top and in a Data
    # folder under it, and one of them read only.
    function New-Depot([string]$name, [string]$marker) {
        $d = Join-Path $work $name
        $null = New-Item -ItemType Directory -Force -Path (Join-Path $d 'Data')
        [IO.File]::WriteAllBytes((Join-Path $d 'SkyrimSE.exe'), (New-Object byte[] 4096))
        [IO.File]::WriteAllBytes((Join-Path $d 'Data\Skyrim - Textures0.bsa'), (New-Object byte[] 8192))
        $ro = Join-Path $d 'Data\Leftover - Another Build.bsa'
        [IO.File]::WriteAllBytes($ro, (New-Object byte[] 1024))
        [IO.File]::SetAttributes($ro, [IO.FileAttributes]::ReadOnly)
        if ($marker) { [IO.File]::WriteAllText((Join-Path $d '.thornswood-complete'), $marker) }
        return $d
    }

    # 1. The tester's case: a folder from an attempt at another build, no marker.
    Clear-Said
    $d = New-Depot 'depot_489832' ''
    Yes 'a folder with no marker does not count as this build' (-not (Marker-Is $d '8042843504692938467'))
    $ok = Clear-Leftover $d 2
    Yes 'a leftover depot folder is removed, read only file and all' ($ok -and -not (Test-Path -LiteralPath $d))
    Yes 'and the log names the folder, its size and why' ($script:logged.Count -eq 1 -and $script:logged[0].Contains($d) -and $script:logged[0].Contains('left over') -and $script:logged[0] -match '\d+ MB')
    Yes 'and the card is left for the part that follows' ($script:shown.Count -eq 0)

    # 2. A folder another build finished: a marker, for another manifest.
    Clear-Said
    $d = New-Depot 'depot_489833' '9999999999999999999'
    Yes 'a marker for another manifest does not count as this build' (-not (Marker-Is $d '1914580699073641964'))
    Yes 'and that folder is removed too' ((Clear-Leftover $d 3) -and -not (Test-Path -LiteralPath $d))

    # 3. A part this build finished is never handed to ClearLeftover: Run skips
    #    it on the marker first (checked above). The marker is read the same
    #    way here.
    $d = New-Depot 'depot_489831' '8442952117333549665'
    Yes 'a marker for this manifest counts as this build, so Run keeps it' (Marker-Is $d '8442952117333549665')

    # 3b. And the files it was written for have to still be there. A marker on
    #     its own said the part was downloaded even when the folder had been
    #     emptied since, by a disk cleaner or by somebody clearing space part
    #     way through eleven gigabytes. Run then skipped the part rather than
    #     fetching it again, and the copy put nothing of it into the game while
    #     the exe out of another part made the game read as 1.6.1170. That is
    #     the mixed build the clearing is for.
    function Write-Marker([string]$folder, [string]$manifest) {
        $T.GetMethod('WriteMarker', $flags).Invoke($null, @($folder, $manifest)) | Out-Null
    }
    $d = New-Depot 'depot_489831b' ''
    Write-Marker $d '8442952117333549665'
    Yes 'the marker Run writes records the manifest and the size' (
        (Marker-Is $d '8442952117333549665') -and
        ([IO.File]::ReadAllText((Join-Path $d '.thornswood-complete')).Trim() -match '^8442952117333549665\s+13312$'))
    Yes 'and it is still not another build''s' (-not (Marker-Is $d '1914580699073641964'))
    [IO.File]::SetAttributes((Join-Path $d 'Data\Leftover - Another Build.bsa'), [IO.FileAttributes]::Normal)
    [IO.File]::Delete((Join-Path $d 'Data\Skyrim - Textures0.bsa'))
    Yes 'a folder that has lost files since is not taken as downloaded' (-not (Marker-Is $d '8442952117333549665'))
    Yes 'so it goes to ClearLeftover and Steam is asked for the part again' ((Clear-Leftover $d 1) -and -not (Test-Path -LiteralPath $d))

    # 3c. A marker from before the size was written holds the manifest alone.
    #     One of those still counts, as long as the folder has something in it.
    $d = New-Depot 'depot_489833b' '1914580699073641964'
    Yes 'a marker from an older launcher, with no size in it, still counts' (Marker-Is $d '1914580699073641964')
    foreach ($f in [IO.Directory]::GetFiles($d, '*', 'AllDirectories')) {
        [IO.File]::SetAttributes($f, [IO.FileAttributes]::Normal)
        if (-not $f.EndsWith('.thornswood-complete')) { [IO.File]::Delete($f) }
    }
    Yes 'and an emptied folder with one of those does not' (-not (Marker-Is $d '1914580699073641964'))

    # 4. Nothing there.
    Clear-Said
    $none = Join-Path $work 'depot_never'
    Yes 'no folder is nothing to do' ((Clear-Leftover $none 1) -and $script:logged.Count -eq 0 -and $script:shown.Count -eq 0)

    # 5. A folder that cannot be removed, the way one Steam is still writing
    #    to is: a file in it held open with no sharing. Only Windows keeps a
    #    file held that way; elsewhere it is deleted under the open handle.
    if ($OnWindows) {
        Clear-Said
        $d = New-Depot 'depot_busy' ''
        $held = [IO.File]::Open((Join-Path $d 'SkyrimSE.exe'), 'Open', 'ReadWrite', 'None')
        $ok = Clear-Leftover $d 2
        Yes 'a folder that cannot be removed stops the run' (-not $ok)
        Yes 'and the card says so, and what to do' ($script:shown.Count -eq 1 -and $script:shown[0].Contains('Could not remove') -and $script:shown[0].Contains('press the button again'))
        Yes 'and the log says the same' ($script:logged.Count -ge 2 -and $script:logged[$script:logged.Count - 1] -eq $script:shown[0])
        if ($stop) { Yes 'and the card''s bar is hidden, as every other early stop hides it' (([int]$T.GetField('BarHidden', $flags).GetValue($null)) -ge 1) }
    } else {
        Write-Host 'SKIP  5, a folder that cannot be removed: a file held open with no sharing keeps its folder only on Windows'
    }
}
finally {
    if ($held) { $held.Dispose() }
    Get-ChildItem -LiteralPath $work -Recurse -Force -File -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Attributes = 'Normal' } catch { } }
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

Done
