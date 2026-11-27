<#
  test-6229-deploy-folder.ps1

      pwsh -NoProfile -File .\launcher\tests\test-6229-deploy-folder.ps1

  Issue #6229. A tester with five Skyrim copies, other servers' among them,
  had the launcher go from "Skyrim Special Edition - Thornswood" to
  "DEAEDRIC ONLINE" 16 seconds apart while Vortex deployed, then refuse to
  refresh because 67 of Thornswood's 100 plugins were not in the other
  server's folder. OwnGame.Find took the newest Vortex record whatever it
  named, and a record Vortex was rewriting dropped Thornswood's folder out.
  In the same runs Checks.VortexProfileDir swallowed "MANIFEST-000565 is
  being used by another process" and the log said the Thornswood profile was
  not found.

  WHAT IT HOLDS THE LAUNCHER TO, running OwnGame.Choose and
  OwnGame.ReadRecord out of launcher\app\OwnGame.cs over records written to
  a scratch folder:
    1. the folder whose record names Thornswood's collection is taken, not
       another server's newer one; a gap of a few plugins still holds it
    2. Thornswood's record being written, or held by another program, is
       said as unreadable and naming that folder, and no other server's
       folder is taken in its place; gone, no folder is taken and the
       nearest other collection is named with its count
    3. among folders that hold it the Steam copy comes first, then the
       record that names the most, then the newest; with no shipped list yet
       the newest readable record wins, as before
    4. ReadRecord counts the shipped plugins a record names, by Vortex's
       relPath with its escapes, reads a record again once it is rewritten,
       and answers null for a record that is not there
    5. DeploysInto takes the Steam copy only through Find, and says why when
       no folder is taken; VortexProfileDir no longer swallows what it
       cannot read, and BakeVortexList says that apart from no profile

  -Repo points it at another checkout, which is how it was shown to fail on
  main before the change. Nothing leaves this machine.
#>
[CmdletBinding()]
param([string]$Repo)

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Repo) { $Repo = Split-Path -Parent (Split-Path -Parent $Here) }

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Done {
    Write-Host ''
    Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
    if ($script:fail) { exit 1 }
    exit 0
}

$app = Join-Path $Repo 'launcher/app'
$own = (Get-Content -Raw (Join-Path $app 'OwnGame.cs')).Replace("`r`n", "`n")
$checks = (Get-Content -Raw (Join-Path $app 'Checks.cs')).Replace("`r`n", "`n")

function Cut([string]$text, [string]$from, [string]$to) {
    $a = $text.IndexOf($from)
    if ($a -lt 0) { return $null }
    $b = $text.IndexOf($to, $a + $from.Length)
    if ($b -lt 0) { return $null }
    return $text.Substring($a, $b - $a)
}
$parts = @(
    (Cut $own '        internal sealed class DeployRecord' '        static readonly object chosenLock'),
    (Cut $own '        public static bool NotThisCollection(' '        /// <summary>'),
    (Cut $own '        static readonly Regex RelPath' "`n        static HashSet<string> Deployed("),
    (Cut $own '        static string Unescape(string s)' '        static ')
)
# Unescape runs to the next member; take it to its own closing brace.
if ($parts[3]) { $parts[3] = $parts[3].Substring(0, $parts[3].IndexOf("`n        }`n") + 11) }
Yes '0 OwnGame.cs has Choose, ReadRecord and DeployRecord to run' (@($parts | Where-Object { -not $_ }).Count -eq 0)
if ($script:fail) { Done }
# The lines between RelPath and Deployed are other members; keep RelPath.
$parts[2] = ($parts[2] -split "`n" | Where-Object { $_ -match 'Regex RelPath' }) -join "`n"
# Public here, so the harness can hand records in.
$parts[0] = $parts[0].Replace('internal sealed class DeployRecord', 'public sealed class DeployRecord')

# The compiler the launcher builds with (#4823), as every launcher harness does.
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $Here)) 'tests') 'Launcher-Csc.ps1')
$code = @"
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
namespace T6229 {
    static class Failure { public static string Why(string where, Exception ex) { return ex.Message; } }
    public static class OwnGame {
$($parts -join "`n")
        public static string Pick(List<DeployRecord> looked, int wanted, out string why) { return Choose(looked, wanted, out why); }
        public static DeployRecord Read(string folder, string path, List<string> want) { return ReadRecord(folder, path, want); }
        public static DeployRecord Rec(string folder, bool steam, int named, long at, string unreadable) {
            return new DeployRecord { Folder = folder, Steam = steam, Named = named, At = at, Unreadable = unreadable };
        }
    }
}
"@
[void](Add-LauncherType -Source $code)

$G = [T6229.OwnGame]
# A $null handed to a string parameter arrives as "", so a readable record
# passes NullString to keep Unreadable null.
function Rec6229($folder, $steam, $named, $at, $unreadable) {
    $u = if ($null -eq $unreadable) { [NullString]::Value } else { $unreadable }
    $G::Rec($folder, $steam, $named, $at, $u)
}
function Recs { $l = New-Object 'System.Collections.Generic.List[T6229.OwnGame+DeployRecord]'; foreach ($r in $args) { $l.Add($r) }; ,$l }
function Pick($looked, [int]$wanted) { $why = $null; $got = $G::Pick($looked, $wanted, [ref]$why); @($got, $why) }

$TW = 'S:\SteamLibrary\steamapps\common\Skyrim Special Edition - Thornswood'
$DO = 'S:\SteamLibrary\steamapps\common\Skyrim Special Edition - DEAEDRIC ONLINE'
$O1 = 'S:\SteamLibrary\steamapps\common\Skyrim Special Edition - Other'
$O2 = 'D:\SteamLibrary\steamapps\common\Skyrim Special Edition - Third'
$ST = 'C:\Steam\steamapps\common\Skyrim Special Edition'

# 1
$got = Pick (Recs (Rec6229 $TW $false 100 10 $null) (Rec6229 $DO $false 33 20 $null) (Rec6229 $O1 $false 5 30 $null) (Rec6229 $O2 $false 0 40 $null) (Rec6229 $ST $true 0 5 $null)) 100
Yes "1 Thornswood's folder is taken over another server's newer record (got $($got[0]))" ($got[0] -eq $TW)
Yes '1 and why says what its record names, and names the other collection with its count' `
    ($got[1] -match 'names 100 of Thornswood''s 100 plugins' -and $got[1] -match [regex]::Escape($DO) -and $got[1] -match 'naming 33')
$got = Pick (Recs (Rec6229 $TW $false 95 10 $null) (Rec6229 $DO $false 33 20 $null)) 100
Yes '1 a gap of five still holds the collection' ($got[0] -eq $TW)

# 2
$got = Pick (Recs (Rec6229 $TW $false -1 10 'it is not whole, as a record Vortex is still writing is not') (Rec6229 $DO $false 33 20 $null) (Rec6229 $O1 $false 5 30 $null)) 100
Yes "2 with Thornswood's record being written, no other server's folder is taken (got '$($got[0])')" ($got[0] -eq '')
Yes '2 and why says its record could not be read, naming the folder, never that it is not there' `
    ($got[1] -match 'could not be read in' -and $got[1] -match [regex]::Escape($TW) -and $got[1] -match 'cannot be told yet' -and $got[1] -notmatch 'no record')
$got = Pick (Recs (Rec6229 $DO $false 33 20 $null) (Rec6229 $O1 $false 5 30 $null) (Rec6229 $O2 $false 0 40 $null) (Rec6229 $ST $true 0 5 $null)) 100
Yes "2 with Thornswood's record gone, nothing is taken (got '$($got[0])')" ($got[0] -eq '')
Yes '2 and why says none holds the collection, naming the nearest with its count' `
    ($got[1] -match '4 folders in Steam''s libraries have Vortex''s record and none holds Thornswood''s collection' -and $got[1] -match [regex]::Escape($DO) -and $got[1] -match 'names 33 of')
$got = Pick (Recs) 100
Yes '2 no folder with a record at all is "" with nothing to say' ($got[0] -eq '' -and $null -eq $got[1])

# 3
$got = Pick (Recs (Rec6229 $ST $true 96 1 $null) (Rec6229 $TW $false 100 50 $null)) 100
Yes '3 among folders that hold it the Steam copy comes first' ($got[0] -eq $ST -and $got[1] -match 'Steam copy of Skyrim Special Edition comes first')
$got = Pick (Recs (Rec6229 $TW $false 100 10 $null) (Rec6229 $O1 $false 97 50 $null)) 100
Yes '3 then the record that names the most, though older' ($got[0] -eq $TW)
$got = Pick (Recs (Rec6229 $TW $false 100 10 $null) (Rec6229 $O1 $false 100 50 $null)) 100
Yes '3 then the newest' ($got[0] -eq $O1)
$got = Pick (Recs (Rec6229 $TW $false 0 10 $null) (Rec6229 $DO $false 0 20 $null)) 0
Yes '3 with no shipped list yet the newest readable record wins, as before' ($got[0] -eq $DO)
$got = Pick (Recs (Rec6229 $TW $false 0 10 $null) (Rec6229 $DO $false -1 20 'busy')) 0
Yes '3 and an unreadable one is still never taken' ($got[0] -eq $TW -and $got[1] -match 'could not be read in')

# 4
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('t6229-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
    $want = New-Object 'System.Collections.Generic.List[string]'
    foreach ($p in @('Skyrim.esm', 'Update.esm', 'Thornswood-Content.esp', 'Odd Name [1].esp')) { $want.Add($p) }
    $rec = Join-Path $scratch 'vortex.deployment.json'
    $body = '{"instance":"x","files":[{"relPath":"Skyrim.esm","source":"a"},{"relPath":"\\Thornswood-Content.esp","source":"b"},' +
            '{"relPath":"Odd Name [1].esp","source":"c"},{"relPath":"meshes/x.nif","source":"d"}],"stagingPath":"C:\\Mods"}'
    [IO.File]::WriteAllText($rec, $body)
    $r = $G::Read('F', $rec, $want)
    Yes "4 a record names the shipped plugins it deploys, by relPath with its escapes ($($r.Named) of 4)" ($r.Named -eq 3 -and $null -eq $r.Unreadable)
    [IO.File]::WriteAllText($rec, $body.Replace('{"relPath":"Skyrim.esm","source":"a"},', '{"relPath":"Skyrim.esm","source":"a"},{"relPath":"Update.esm","source":"a"},'))
    [IO.File]::SetLastWriteTimeUtc($rec, [DateTime]::UtcNow.AddMinutes(1))
    Yes '4 and is read again once Vortex rewrites it' ($G::Read('F', $rec, $want).Named -eq 4)
    [IO.File]::WriteAllText($rec, $body.Substring(0, 60))
    $r = $G::Read('F', $rec, $want)
    Yes '4 a record cut short, as one Vortex is writing, is unreadable and names nothing' ($r.Named -eq -1 -and $r.Unreadable -match 'not whole')
    [IO.File]::WriteAllText($rec, $body)
    [IO.File]::SetLastWriteTimeUtc($rec, [DateTime]::UtcNow.AddMinutes(2))
    $held = [IO.File]::Open($rec, 'Open', 'ReadWrite', 'None')
    try { $r = $G::Read('F', $rec, $want) } finally { $held.Dispose() }
    Yes "4 a record another program holds is unreadable, with its reason ($($r.Unreadable))" ($r.Named -eq -1 -and [string]$r.Unreadable -ne '')
    Yes '4 a record that is not there is null, not unreadable' ($null -eq $G::Read('F', (Join-Path $scratch 'none.json'), $want))
}
finally { Remove-Item -Recurse -Force $scratch -ErrorAction SilentlyContinue }

# 5
$into = Cut $own '        public static string DeploysInto(Config cfg)' '        /// <summary>'
Yes '5 DeploysInto no longer takes the Steam copy for having any record, and says why when nothing is taken' `
    ($into -and $into -notmatch 'Vortex''s record is in the Steam copy' -and $into -match 'if \(why != null\) Said\(')
$vpd = Cut $checks '        public static string VortexProfileDir(string name)' '        public static int EnabledPlugins()'
Yes '5 VortexProfileDir swallows nothing it cannot read' ($vpd -and $vpd -notmatch 'Swallow\.Note' -and $vpd -notmatch 'catch')
$bake = Cut $own '        static void BakeVortexList()' '        /// <summary>'
Yes '5 BakeVortexList says Vortex''s state could not be told, apart from no Thornswood profile' `
    ($bake -and $bake -match 'could not be told from Vortex''s state' -and $bake -match 'which is not the same as there being none' -and $bake -match 'was not found')

Done
