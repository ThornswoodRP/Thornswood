<#
  test-4690-play-catch-names.ps1

      pwsh -NoProfile -File .\launcher\tests\test-4690-play-catch-names.ps1

  What Play could not do is said in launcher.log under a name that says what
  it was (#4690).

  Before, a hold on the game files that failed was noted only as "Swallowed in
  Shell.Play, dispose", a step Play does not have, so nobody reading the log
  knew the game files went unguarded that session. Six more of Play's catches
  said only "Shell.Play". And the collection readers in Checks.cs ended in
  catch { return 0; }: a Vortex state that would not read left the collection
  card at "not confirmed" with no line anywhere saying why.

  This holds:
    1. the hold's catch in Play writes a plain line saying the game files are
       not held this session, with the reason
    2. every Swallow.Note in ShellPlay.cs names what it guards: never bare
       "Shell.Play", never "dispose", and a one-line try names the call it
       wraps
    3. the real CollectionRevisionFromState and CollectionRevisionFromFolder,
       lifted from Checks.cs and run with a Vortex state that throws, still
       give 0 and note why, naming the reader and the exception
    4. the same reason twice is noted once (the status redraws every two
       seconds), and a different reason is noted again
    5. no collection reader in Checks.cs ends in a catch that only returns

  Compiled with Add-LauncherType (tests\Launcher-Csc.ps1), the compiler the
  launcher's build runs. Nothing connects anywhere.
#>
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
$repo = Split-Path -Parent (Split-Path -Parent $Here)
. (Join-Path (Join-Path $repo 'tests') 'Launcher-Csc.ps1')
$app = Join-Path $repo 'launcher\app'
if (-not (Test-Path -LiteralPath $app)) { $app = Join-Path $repo 'launcher/app' }

$script:pass = 0; $script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}

# The text of the member that starts at $sig, through its closing brace.
function Member([string]$text, [string]$sig) {
    $at = $text.IndexOf($sig)
    if ($at -lt 0) { return '' }
    $open = $text.IndexOf('{', $at)
    $depth = 0
    for ($i = $open; $i -lt $text.Length; $i++) {
        if ($text[$i] -eq '{') { $depth++ }
        elseif ($text[$i] -eq '}') { $depth--; if ($depth -eq 0) { return $text.Substring($at, $i - $at + 1) } }
    }
    return ''
}

$play = [IO.File]::ReadAllText((Join-Path $app 'ShellPlay.cs'))
$checks = [IO.File]::ReadAllText((Join-Path $app 'Checks.cs'))

# ---- 1. the hold -------------------------------------------------------------------
Write-Host ''; Write-Host 'a failed hold on the game files'
$holdAt = $play.IndexOf('try { holding = Hold.Take(PresenceLog); }')
Yes 'Play takes the hold in a try of its own' ($holdAt -ge 0)
$holdCatch = if ($holdAt -ge 0) { Member $play.Substring($holdAt + 'try { holding = Hold.Take(PresenceLog); }'.Length) 'catch' } else { '' }
$hold = [regex]::Match($holdCatch, '^catch \(Exception (\w+)\)')
$holdBody = $holdCatch
# The hold runs off the window's thread (#4628), so its catch keeps the
# reason and the line goes to the log once the wait is back on the window.
$why = [regex]::Match($holdBody, '\b(\w+) = Failure\.Why\(')
$said = if ($why.Success) { [regex]::Match($play, '\bif \(' + $why.Groups[1].Value + ' != null\)\s*Log\((?<line>[^;]*)\);') } else { $null }
Yes '  and its catch keeps a reason that goes to the log, not only a swallowed note' (($null -ne $said) -and $said.Success -and $said.Groups['line'].Value.Contains($why.Groups[1].Value))
Yes '  saying the game files are not held this session' (($null -ne $said) -and $said.Groups['line'].Value -match 'game files are not held this session')
Yes '  with the reason' ($holdBody -match ('Failure\.Why\("Shell\.Play, Hold\.Take", ' + $(if ($hold.Success) { $hold.Groups[1].Value } else { 'ex' }) + '\)'))

# ---- 2. every catch in Play names what it guards -----------------------------------
Write-Host ''; Write-Host 'the names of the catches in ShellPlay.cs'
$notes = [regex]::Matches($play, 'Swallow\.Note\("([^"]*)"')
Yes ("ShellPlay.cs notes what it swallows ({0} notes)" -f $notes.Count) ($notes.Count -ge 8)
$bare = @($notes | Where-Object { $_.Groups[1].Value -eq 'Shell.Play' })
Yes '  none is noted as bare "Shell.Play"' ($bare.Count -eq 0)
$disposeNotes = @($notes | Where-Object { $_.Groups[1].Value -match 'dispose' })
Yes '  none names a dispose step Play does not have' ($disposeNotes.Count -eq 0)
foreach ($n in $bare + $disposeNotes) { Write-Host ('      ' + $n.Groups[1].Value) -ForegroundColor DarkGray }
# A one-line try: the label names the call it wraps (Type.Method).
$oneLine = [regex]::Matches($play, 'try \{ (?<body>[^\r\n]*?) \} catch \(Exception \w+\) \{ Swallow\.Note\("(?<label>[^"]*)"')
$unnamed = @()
foreach ($m in $oneLine) {
    $calls = @([regex]::Matches($m.Groups['body'].Value, '\b([A-Z]\w*\.[A-Z]\w*)\b') | ForEach-Object { $_.Groups[1].Value })
    if ($calls.Count -eq 0) { continue }
    $named = $false
    foreach ($c in $calls) { if ($m.Groups['label'].Value.Contains($c)) { $named = $true } }
    if (-not $named) { $unnamed += ($m.Groups['label'].Value + '  <-  ' + $m.Groups['body'].Value) }
}
Yes ("  each one-line try's note names the call it wraps ({0} read)" -f $oneLine.Count) ($oneLine.Count -ge 6 -and $unnamed.Count -eq 0)
foreach ($u in $unnamed) { Write-Host ('      ' + $u) -ForegroundColor DarkGray }

# ---- 3 and 4. the collection readers, run ------------------------------------------
Write-Host ''; Write-Host 'the collection readers in Checks.cs, with a Vortex state that will not read'
$fromState = Member $checks 'public static int CollectionRevisionFromState(string slug)'
$fromFolder = Member $checks 'public static int CollectionRevisionFromFolder(string slug)'
$failed = Member $checks 'static void CollectionReadFailed(string where, Exception ex)'
Yes 'Checks.cs has both readers' ($fromState.Length -gt 0 -and $fromFolder.Length -gt 0)
Yes '  and one place that notes why a read gave 0' ($failed.Length -gt 0)
$fields = (@([regex]::Matches($checks, '(?m)^\s*static (readonly object collectionWhyGate|string lastCollectionWhy)\b[^;]*;') | ForEach-Object { $_.Value.Trim() }) -join "`n")
Yes '  with the last reason it noted kept beside it' (([regex]::Matches($fields, ';')).Count -eq 2)
$n = [guid]::NewGuid().ToString('N').Substring(0, 8)
$src = @"
using System;
using System.IO;
using System.Collections.Generic;
namespace T4690_$n {
  static class Swallow {
    public static List<string> Said = new List<string>();
    public static void Note(string where, Exception e) { Said.Add("Swallowed in " + where + ": " + e.GetType().Name + ": " + e.Message); }
  }
  static class Failure {
    public static string Plain(Exception e, string what) { return e.Message; }
  }
  static class VortexProfileState {
    public static string Why = "state.v2 is not a LevelDB: bad magic";
    public static int CollectionRevision(string dir, string slug) { throw new InvalidDataException(Why); }
  }
  public static class Checks {
    $fields
    $failed
    $fromState
    $fromFolder
    public static string[] Said() { return Swallow.Said.ToArray(); }
    public static void Why(string w) { VortexProfileState.Why = w; }
  }
}
"@
$T = $null
try { $asm = Add-LauncherType -Source $src; $T = $asm.GetType("T4690_$n.Checks") }
catch { Write-Host $_.Exception.Message -ForegroundColor DarkGray }
Yes '  the lifted readers compile' ($null -ne $T)
if ($T) {
    $got = $T::CollectionRevisionFromState('7essxf')
    $said = @($T::Said())
    Yes '  a state that throws still reads as revision 0' ($got -eq 0)
    Yes '  and launcher.log gets a line saying why' ($said.Count -eq 1)
    $line = if ($said.Count) { $said[0] } else { '' }
    Yes '  naming the reader and Vortex''s state.v2' ($line -match 'Checks\.CollectionRevisionFromState' -and $line -match 'state\.v2')
    Yes '  and the exception' ($line -match 'InvalidDataException: state\.v2 is not a LevelDB: bad magic')
    $null = $T::CollectionRevisionFromState('7essxf'); $null = $T::CollectionRevisionFromState('7essxf')
    Yes '  the same reason again is not written again' (@($T::Said()).Count -eq 1)
    $T::Why('state.v2 is locked by Vortex')
    $null = $T::CollectionRevisionFromState('7essxf')
    $said = @($T::Said())
    Yes '  a different reason is' ($said.Count -eq 2 -and $said[1] -match 'locked by Vortex')
}

# ---- 5. no reader ends in a catch that only returns -------------------------------
Write-Host ''; Write-Host 'Checks.cs'
$revision = Member $checks 'public static int CollectionRevision(Config cfg)'
$silent = @()
foreach ($pair in @(@('CollectionRevision', $revision), @('CollectionRevisionFromState', $fromState), @('CollectionRevisionFromFolder', $fromFolder))) {
    if ($pair[1] -match 'catch\s*\{\s*return' -or $pair[1] -match 'catch\s*\(Exception\)\s*\{\s*return') { $silent += $pair[0] }
}
Yes 'no collection revision reader ends in a catch that only returns' ($revision.Length -gt 0 -and $silent.Count -eq 0)
foreach ($s in $silent) { Write-Host ('      ' + $s) -ForegroundColor DarkGray }
Yes '  CollectionRevision notes its own failure too' ($revision -match 'catch \(Exception (\w+)\) \{ CollectionReadFailed\("Checks\.CollectionRevision", \1\); return 0; \}')

Write-Host ''
Write-Host ("{0} passed, {1} failed" -f $script:pass, $script:fail)
if ($script:fail) { exit 1 }
exit 0
