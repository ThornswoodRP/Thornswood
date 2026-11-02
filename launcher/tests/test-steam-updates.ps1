<#
  test-steam-updates.ps1

      pwsh -NoProfile -File .\launcher\tests\test-steam-updates.ps1

  Steam's Updates setting for Skyrim, which nothing in the launcher read or
  set until 24 September (entry 271 on the To Do List, "Nothing stops Steam
  putting Skyrim back on the wrong build").

  WHY IT MATTERS. The downgrade puts the 1.6.1170 files in place, and Steam
  still believes the game is on the newest build. Unless its setting says to
  wait for a launch, the next Skyrim update Steam takes by itself undoes the
  downgrade. The only protection was a log line asking people not to start
  Skyrim through Steam. The setting is "AutoUpdateBehavior" in
  steamapps\appmanifest_489830.acf; 1 is "Wait until I launch the game" in
  the Automatic Updates list on Steam's own Properties, Updates page.

  STEAM'S OWN WORDS. The first version named choices Steam no longer shows
  ("Only update this game when I launch it", "Always keep this game
  updated"), and a review caught it. Measured on Patrick's machine on 24
  September: steamui\localization\steamui_english-json.js (8 August) names
  the four choices "Use global setting", "Wait until I launch the game",
  "Immediately download updates" and "Let Steam decide when to update", and
  the UI bundle, steamui\chunk~2dcc5aaf7.js, numbers them 0, 1, 2 and 3.
  Where this machine has Steam, the names and numbers are checked against
  those two files, so a rename in a later Steam shows up here.

  MEASURED 24 SEPTEMBER on Patrick's machine, read only: that file is 1156
  bytes of Valve's KeyValues text, tabs and LF, "AutoUpdateBehavior" "0", and
  it carries the ReadOnly attribute, the only one of twenty manifests there
  that does. Steam was running.

  WHAT THIS HOLDS THE LAUNCHER TO. A broken manifest is worse than an unwanted
  update, so only the value's bytes may change, anything not shaped the way
  Steam writes it is left alone, and nothing is written while Steam runs.
  Play is never held on it.

  THE LAUNCHER WRITES IT ITSELF (#493, Patrick, 29 September: "Our Repo
  should write this so it doesn't auto update the game and people have to re
  do the downgrade again"). On the way in, with Steam closed, it is written
  with nothing to ask; with Steam open, a question whose Yes closes Steam,
  waits for it to be gone, writes and starts Steam again.

  ALWAYS HELD, AND NO IS NOT NOW (#3600, Patrick, 27 Oct). A No used to be
  remembered and the question said "No leaves it as it is", while a start
  with Steam closed wrote the setting anyway, and this harness held both at
  once. Now No only means "do not close Steam now": nothing remembers it, the
  next start with Steam closed writes it and one with Steam open asks again,
  and the question says that before No is pressed. A Yes whose Steam takes
  longer than a minute to close is waited for, and Steam is started again
  whatever happens once it was asked to exit; it used to stay closed.

  WHY THE READ-ONLY MARK IS NOT NEEDED FOR THE GAME (measured 29 September,
  read only): Thornswood runs its own folder, whose exe, root files and
  masters are its own copies, and Steam commits an update by moving whole new
  files into the Steam copy (content_log: 8.8 GB staged, committed in the same
  second), so an update cannot reach the game Thornswood runs. What it would
  cost is the Steam copy, and so a second downgrade; the setting prevents that.

  A READ-ONLY FILE IS LEFT WRITABLE (issue #493). The read-only mark is how
  some guides hold the version, and it makes Steam fail to save the game's
  state in the file every six seconds (11,568 "Failed to write app state
  file" lines in Patrick's content_log.txt on 29 September). The setting is
  what holds the version, so Hold takes the mark off, a file already on 1
  that is only read only gets the mark taken off with its bytes untouched,
  the start line says when a file has the mark and how to take it off by
  hand, and nothing in the launcher puts it back.

  It builds the shipped launcher\app\SteamUpdates.cs the way the project
  builds it, with the .NET 10 SDK (Add-LauncherType, tests\Launcher-Csc.ps1,
  #4823, on any machine that has it), loads it into this PowerShell, and
  drives the real class. Where this machine has Steam and Skyrim, it also
  parses the real manifest, without writing to it.

  Read only apart from files under its own temp folder, and the build under
  out\harness, which git ignores.
#>
[CmdletBinding()]
param([string]$AppPath)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's compiler and C# version (#498)
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

# ---- compile the shipped class ---------------------------------------------
$src = Join-Path $AppPath 'SteamUpdates.cs'
Yes 'launcher\app\SteamUpdates.cs is there' (Test-Path -LiteralPath $src)
if (-not (Test-Path -LiteralPath $src)) { Done }

Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }

$work = Join-Path ([IO.Path]::GetTempPath()) ('thornswood-steam-updates-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force -Path $work
$asm = $null
try { $asm = Add-LauncherType -File $src } catch { Write-Host ('      ' + $_.Exception.Message) }
Yes 'it builds on its own, the way the project builds it' ($null -ne $asm)
if ($null -eq $asm) { Done }

$T = $asm.GetType('Thornswood.SteamUpdates', $true)
$flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
function Method([string]$name, [Type[]]$sig) {
    $m = $T.GetMethod($name, $flags, $null, $sig, $null)
    if (-not $m) { throw "SteamUpdates.$name is missing" }
    return $m
}
$mValue    = Method 'Value' @([string])
$mHeld     = Method 'Held' @([string])
$mManifest = Method 'ManifestFor' @([string])
$mRead     = Method 'Read' @([string])
$mReport   = Method 'Report' @([string])
$mNeeds    = Method 'NeedsHolding' @([string])
$mHold     = Method 'Hold' @([string], [bool])
$mSetting  = Method 'Setting' @([string])
function Value([string]$s)  { return $mValue.Invoke($null, [object[]]@($s)) }
function Held([string]$s)   { return $mHeld.Invoke($null, [object[]]@($s)) }
function ManifestFor([string]$s) { return $mManifest.Invoke($null, [object[]]@($s)) }
function ReadValue([string]$s) { return $mRead.Invoke($null, [object[]]@($s)) }
function Report([string]$s) { return $mReport.Invoke($null, [object[]]@($s)) }
function Needs([string]$s)  { return [bool]$mNeeds.Invoke($null, [object[]]@($s)) }
function Hold([string]$m, [bool]$running) { return $mHold.Invoke($null, [object[]]@($m, $running)) }
function Setting([string]$s) { return $mSetting.Invoke($null, [object[]]@($s)) }

$Latin = [Text.Encoding]::GetEncoding(28591)

# ---- a manifest shaped the way Steam writes one ------------------------------
#
# Line for line the shape of the real file, less the owner's account id.
# <T> is a tab and <AUTO> is where Steam puts AutoUpdateBehavior.
$Template = @'
"AppState"
{
<T>"appid"<T><T>"489830"
<T>"universe"<T><T>"1"
<T>"LauncherPath"<T><T>"C:\\Program Files (x86)\\Steam\\steam.exe"
<T>"name"<T><T>"The Elder Scrolls V: Skyrim Special Edition"
<T>"StateFlags"<T><T>"4"
<T>"installdir"<T><T>"Skyrim Special Edition"
<T>"lastupdated"<T><T>"1789059989"
<T>"SizeOnDisk"<T><T>"16092533099"
<T>"buildid"<T><T>"24914197"
<T>"TargetBuildID"<T><T>"24914197"
<AUTO>
<T>"AllowOtherDownloadsWhileRunning"<T><T>"0"
<T>"ScheduledAutoUpdate"<T><T>"0"
<T>"InstalledDepots"
<T>{
<T><T>"489831"
<T><T>{
<T><T><T>"manifest"<T><T>"4940892828028256588"
<T><T><T>"size"<T><T>"7490529657"
<T><T>}
<T>}
<T>"UserConfig"
<T>{
<T><T>"language"<T><T>"english"
<T>}
<T>"MountedConfig"
<T>{
<T><T>"language"<T><T>"english"
<T>}
}
'@

function Acf([string]$auto = 'absent', [string]$nl = "`n", [string]$extra = '') {
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($l in (($Template -replace "`r", '') -split "`n")) {
        if ($l -eq '') { continue }
        if ($l -eq '<AUTO>') {
            if ($auto -ne 'absent') { $lines.Add('<T>"AutoUpdateBehavior"<T><T>"' + $auto + '"') }
            if ($extra) { $lines.Add($extra) }
            continue
        }
        $lines.Add($l)
    }
    return (($lines -join $nl) + $nl).Replace('<T>', "`t")
}

# Positions at which two strings of the same length differ, or -1.
function Differ([string]$a, [string]$b) {
    if ($a.Length -ne $b.Length) { return -1 }
    $n = 0
    for ($i = 0; $i -lt $a.Length; $i++) { if ([int]$a[$i] -ne [int]$b[$i]) { $n++ } }
    return $n
}
function Same([byte[]]$a, [byte[]]$b) {
    if ($a.Length -ne $b.Length) { return $false }
    for ($i = 0; $i -lt $a.Length; $i++) { if ($a[$i] -ne $b[$i]) { return $false } }
    return $true
}
$Line1 = "`t`"AutoUpdateBehavior`"`t`t`"1`""

try {
    # ---- reading ------------------------------------------------------------
    Yes 'the value is read: 0' ((Value (Acf '0')) -ceq '0')
    Yes 'the value is read: 1' ((Value (Acf '1')) -ceq '1')
    Yes 'no key reads as empty, which Steam takes as its default' ((Value (Acf)) -ceq '')
    Yes 'the key is matched without regard to case, as Valve reads it' ((Value ((Acf '2').Replace('AutoUpdateBehavior', 'autoupdatebehavior'))) -ceq '2')

    # ---- changing the value, and only the value ------------------------------
    $a0 = Acf '0'
    $h0 = Held $a0
    Yes '0 becomes 1' ((Value $h0) -ceq '1')
    Yes 'and exactly one character of the file changed' ((Differ $a0 $h0) -eq 1)
    Yes 'and it is the value' ($h0 -ceq $a0.Replace('"AutoUpdateBehavior"' + "`t`t" + '"0"', '"AutoUpdateBehavior"' + "`t`t" + '"1"'))
    $a2 = Acf '2'
    Yes 'Immediately download updates (2) becomes 1 too' (((Held $a2) -ceq $a2.Replace("`t`t`"2`"`n`t`"AllowOther", "`t`t`"1`"`n`t`"AllowOther")) -and ((Differ $a2 (Held $a2)) -eq 1))
    $a3 = Acf '3'
    Yes 'and so does Let Steam decide when to update (3)' (((Held $a3) -ceq $a3.Replace("`t`t`"3`"`n`t`"AllowOther", "`t`t`"1`"`n`t`"AllowOther")) -and ((Differ $a3 (Held $a3)) -eq 1))
    $a1 = Acf '1'
    Yes 'already 1 comes back unchanged' ((Held $a1) -ceq $a1)

    $crlf = Acf '0' "`r`n"
    $hcrlf = Held $crlf
    Yes 'a CRLF file keeps its line endings' (((Differ $crlf $hcrlf) -eq 1) -and ((Value $hcrlf) -ceq '1'))

    # ---- no key at all ---------------------------------------------------------
    $none = Acf
    $hnone = Held $none
    $close = $none.LastIndexOf('}')
    $want = $none.Substring(0, $close) + $Line1 + "`n" + $none.Substring($close)
    Yes 'a missing key goes in on its own line above the closing brace, tab separated like the rest' ($hnone -ceq $want)
    Yes 'and reads back as 1' ((Value $hnone) -ceq '1')
    $nonecr = Acf 'absent' "`r`n"
    $closecr = $nonecr.LastIndexOf('}')
    Yes 'in a CRLF file it ends in CRLF' ((Held $nonecr) -ceq ($nonecr.Substring(0, $closecr) + $Line1 + "`r`n" + $nonecr.Substring($closecr)))

    # A key of the same name inside a block is not the setting.
    $nested = $none.Replace("`t`t`"language`"`t`t`"english`"`n`t}`n`t`"MountedConfig`"", "`t`t`"language`"`t`t`"english`"`n`t`t`"AutoUpdateBehavior`"`t`t`"0`"`n`t}`n`t`"MountedConfig`"")
    Yes 'the fixture has a nested key to ignore' ($nested -cne $none)
    Yes 'a nested key of the same name does not count as the setting' ((Value $nested) -ceq '')
    $hnested = Held $nested
    Yes 'and is left as it is while the top level one goes in' (($hnested.Contains("`t`t`"AutoUpdateBehavior`"`t`t`"0`"")) -and ((Value $hnested) -ceq '1'))

    # ---- escapes, byte order marks, other bytes --------------------------------
    $esc = (Acf '0').Replace('"The Elder Scrolls V: Skyrim Special Edition"', '"A \"quoted\" name ending in a backslash \\"')
    Yes 'escaped quotes and backslashes inside a value parse' ((Value $esc) -ceq '0')
    Yes 'and survive the change untouched' ((Differ $esc (Held $esc)) -eq 1)
    $bom = ([char]0xEF).ToString() + ([char]0xBB) + ([char]0xBF) + (Acf '0')
    Yes 'a UTF-8 byte order mark is stepped over' ((Value $bom) -ceq '0')
    Yes 'and kept' ((Held $bom).StartsWith($bom.Substring(0, 3), [StringComparison]::Ordinal))

    # ---- what is refused -------------------------------------------------------
    Yes 'an empty file is not a manifest' ($null -eq (Value ''))
    Yes 'and is not written into' ($null -eq (Held ''))
    Yes 'JSON is not a manifest' ($null -eq (Held '{"AppState": {"AutoUpdateBehavior": 0}}'))
    $cut = $a0.Substring(0, $a0.LastIndexOf('}'))
    Yes 'a file cut off before its closing brace is refused' ($null -eq (Held $cut))
    Yes 'anything after the closing brace is refused' ($null -eq (Held ($a0 + '"more"' + "`n")))
    Yes 'an unquoted word is refused rather than guessed at' ($null -eq (Held ((Acf 'absent' "`n" "`tAutoUpdateBehavior`t`t1"))))
    Yes 'a key with nothing after it is refused' ($null -eq (Held ((Acf 'absent' "`n" "`t`"AutoUpdateBehavior`""))))
    Yes 'an unterminated quote is refused' ($null -eq (Held ($a0.Replace('"buildid"', '"buildid'))))
    Yes 'another root than AppState is refused' ($null -eq (Held ($a0.Replace('"AppState"', '"UserLocalConfigStore"'))))
    $oneLine = '"AppState" { "appid" "489830" }'
    Yes 'a closing brace that is not on its own line is not written next to' ($null -eq (Held $oneLine))

    # ---- Steam's own words -----------------------------------------------------
    #
    # As the Automatic Updates list on the game's Properties, Updates page names
    # them. The first version named two choices Steam does not have, so the
    # line people get when they press No sent them looking for a menu item
    # that is not there, and a tester checking the list would have judged a
    # write that worked as failed.
    Yes 'Steam''s words for 1 are "Wait until I launch the game"' ((Setting '1') -ceq 'Wait until I launch the game')
    Yes 'for 0, "Use global setting"' ((Setting '0') -ceq 'Use global setting')
    Yes 'no key at all is taken as 0' ((Setting '') -ceq 'Use global setting')
    Yes 'for 2, "Immediately download updates"' ((Setting '2') -ceq 'Immediately download updates')
    Yes 'for 3, "Let Steam decide when to update"' ((Setting '3') -ceq 'Let Steam decide when to update')
    Yes 'a number Steam has no choice for is given as the number' ((Setting '7') -ceq 'AutoUpdateBehavior 7')
    $How = [string]$T.GetField('How', $flags).GetValue($null)
    Yes 'the way to do it by hand names that choice, under Automatic Updates on the Updates page' (($How -like '*Properties, Updates*') -and ($How -like '*Automatic Updates*') -and ($How -like ('*"' + (Setting '1') + '"*')))
    Yes 'and names the game the way Steam''s library does' ($How -like '*The Elder Scrolls V: Skyrim Special Edition*')
    $gone = @('Only update this game when I launch it', 'Always keep this game updated')
    $named = @(Get-ChildItem -LiteralPath $AppPath -Filter *.cs -File | Where-Object {
        $code = (Get-Content -LiteralPath $_.FullName | Where-Object { $_ -notmatch '^\s*//' }) -join "`n"
        @($gone | Where-Object { $code.Contains($_) }).Count -gt 0
    })
    Yes ('no launcher code names a choice Steam no longer has' + $(if ($named.Count) { ' (' + (($named | ForEach-Object { $_.Name }) -join ', ') + ')' } else { '' })) ($named.Count -eq 0)

    # ---- which file ------------------------------------------------------------
    # Two things the class does are Windows' alone, and off Windows they say
    # SKIP: a path with a drive letter and backslashes is a Windows path, and
    # the change goes in through kernel32's MoveFileEx (SwapIn), one rename
    # that takes the old file's place. Everything else runs anywhere.
    $winOnly = 'which only Windows has'
    if ($OnWindows) {
        Yes 'the manifest sits two folders up from the game, in that library' ((ManifestFor 'D:\SteamLibrary\steamapps\common\Skyrim Special Edition') -ceq 'D:\SteamLibrary\steamapps\appmanifest_489830.acf')
        Yes 'with or without a trailing backslash' ((ManifestFor 'D:\SteamLibrary\steamapps\common\Skyrim Special Edition\') -ceq 'D:\SteamLibrary\steamapps\appmanifest_489830.acf')
    } else {
        Write-Host "SKIP  the manifest two folders up from a game named by a drive letter and backslashes: that is a Windows path, $winOnly"
    }
    Yes 'a folder that is not in a Steam library has no manifest' ((ManifestFor 'C:\Thornswood\Game') -ceq '')
    Yes 'nor does no folder' ((ManifestFor '') -ceq '')

    # ---- the file itself --------------------------------------------------------
    $lib = Join-Path $work 'Library'
    $game = Join-Path $lib 'steamapps\common\Skyrim Special Edition'
    $null = New-Item -ItemType Directory -Force -Path $game
    $m = Join-Path $lib 'steamapps\appmanifest_489830.acf'
    $tmp = Join-Path $lib 'steamapps\thornswood-489830.tmp'
    Yes 'the test library resolves to its own manifest' ((ManifestFor $game) -ceq $m)

    function Put([string]$text) {
        if (Test-Path -LiteralPath $m) { [IO.File]::SetAttributes($m, [IO.FileAttributes]::Normal) }
        [IO.File]::WriteAllBytes($m, $Latin.GetBytes($text))
    }

    Yes 'no file, nothing to report' ($null -eq (Report $game))
    Yes 'no file, nothing to ask' (-not (Needs $m))
    $r = Hold $m $false
    Yes 'no file: says so and makes none' (($r -like '*was not found*') -and -not (Test-Path -LiteralPath $m))

    Put (Acf '0')
    Yes 'the start line names Steam''s own words for 0' ((Report $game) -like '*"Use global setting"*')
    Yes 'and says how to change it in Steam' ((Report $game) -like '*Properties, Updates*')
    Yes 'the question is asked on 0' (Needs $m)

    $was = [IO.File]::ReadAllBytes($m)
    $r = Hold $m $true
    Yes 'Steam running: nothing is written' (Same $was ([IO.File]::ReadAllBytes($m)))
    Yes 'and it says why' ($r -like '*Steam is still running*')
    Yes 'and leaves no temporary file' (-not (Test-Path -LiteralPath $tmp))

    if ($OnWindows) {
        $r = Hold $m $false
        $now = [IO.File]::ReadAllBytes($m)
        Yes 'Steam closed: the file now says 1' ((ReadValue $m) -ceq '1')
        Yes 'one byte changed and no other' (($was.Length -eq $now.Length) -and ((Differ $Latin.GetString($was) $Latin.GetString($now)) -eq 1))
        Yes 'no temporary file is left beside it' (-not (Test-Path -LiteralPath $tmp))
        Yes 'and the log line says what changed and where' (($r -like '*is now "Wait until I launch the game"*') -and ($r -like ('*' + $m + '*')))
        Yes 'the start line then reads it back as held' ((Report $game) -like '*"Wait until I launch the game"*')
        Yes 'and the question is not asked again' (-not (Needs $m))
    } else {
        Write-Host "SKIP  Steam closed, the change written: it goes in through MoveFileEx, $winOnly"
        # What that write leaves, so the steps after it start where they do on
        # Windows.
        Put (Acf '1')
        Yes 'a file on 1 reads back as held at the start' ((Report $game) -like '*"Wait until I launch the game"*')
        Yes 'and asks no question' (-not (Needs $m))
    }

    [IO.File]::SetLastWriteTimeUtc($m, [DateTime]::new(2026, 1, 1, 0, 0, 0, [DateTimeKind]::Utc))
    $r = Hold $m $false
    Yes 'already 1: the file is not touched' ([IO.File]::GetLastWriteTimeUtc($m) -eq [DateTime]::new(2026, 1, 1, 0, 0, 0, [DateTimeKind]::Utc))
    Yes 'and it says so' ($r -like '*already*')

    # Read-only, as it is on Patrick's machine. Issue #493: the mark makes
    # Steam fail to save the game's state every six seconds, and the setting,
    # not the mark, is what holds the version, so the mark comes off.
    function IsRO([string]$p) { return (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReadOnly) -ne 0) }
    $mRO = Method 'IsReadOnly' @([string])
    function ReadOnlyByClass([string]$s) { return [bool]$mRO.Invoke($null, [object[]]@($s)) }
    Put (Acf '0')
    [IO.File]::SetAttributes($m, [IO.FileAttributes]::ReadOnly -bor [IO.FileAttributes]::Archive)
    Yes 'IsReadOnly sees the mark' (ReadOnlyByClass $m)
    Yes 'the start line on a read-only file says so, and how to take the mark off by hand' (((Report $game) -like '*marked read only*') -and ((Report $game) -like '*clear Read-only*') -and ((Report $game) -like ('*' + $m + '*')))
    if ($OnWindows) {
        $r = Hold $m $false
        Yes 'a read-only file is changed' ((ReadValue $m) -ceq '1')
        Yes 'and is left writable, so Steam can save its state in it (#493)' (-not (IsRO $m))
        Yes 'and the log line says so' ($r -like '*no longer marked read only*')
        Yes 'and the start line no longer mentions a mark' ((Report $game) -notlike '*read only*')
    } else {
        Write-Host "SKIP  a read-only file on 0 changed and left writable: the change goes in through MoveFileEx, $winOnly"
    }

    # Already on 1 and read only, as Patrick's is since 25 September: only the
    # mark comes off, and not a byte of the file changes.
    Put (Acf '1')
    [IO.File]::SetAttributes($m, [IO.FileAttributes]::ReadOnly -bor [IO.FileAttributes]::Archive)
    $was = [IO.File]::ReadAllBytes($m)
    Yes 'on 1 but read only: the question is still asked' (Needs $m)
    Yes 'and the start line says it is held and marked read only' (((Report $game) -like '*"Wait until I launch the game"*') -and ((Report $game) -like '*marked read only*'))
    $r = Hold $m $true
    Yes 'Steam running: the mark stays and nothing is written' ((IsRO $m) -and (Same $was ([IO.File]::ReadAllBytes($m))))
    $r = Hold $m $false
    Yes 'Steam closed: the mark comes off' (-not (IsRO $m))
    Yes '  and the bytes are exactly as they were' (Same $was ([IO.File]::ReadAllBytes($m)))
    Yes '  and no temporary file is left' (-not (Test-Path -LiteralPath $tmp))
    Yes '  and the log line says what changed' (($r -like '*already*') -and ($r -like '*no longer marked read only*'))
    Yes '  and the question is not asked again' (-not (Needs $m))

    # No launcher code puts the mark back on.
    $marks = @(Get-ChildItem -LiteralPath $AppPath -Filter *.cs -File | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match '\|\s*FileAttributes\.ReadOnly' })
    Yes ('no launcher file sets the read-only mark on anything' + $(if ($marks.Count) { ': ' + (($marks | ForEach-Object { $_.Name }) -join ', ') } else { '' })) ($marks.Count -eq 0)

    # Bytes that are not ASCII, a byte order mark, and CRLF, all kept.
    $name = 'C:\\Games\\Caf' + [char]0x00E9 + '\\Steam\\steam.exe'
    $utf = [Text.Encoding]::UTF8.GetBytes((Acf 'absent' "`r`n").Replace('C:\\Program Files (x86)\\Steam\\steam.exe', $name))
    $bytes = New-Object byte[] ($utf.Length + 3)
    $bytes[0] = 0xEF; $bytes[1] = 0xBB; $bytes[2] = 0xBF
    [Array]::Copy($utf, 0, $bytes, 3, $utf.Length)
    [IO.File]::SetAttributes($m, [IO.FileAttributes]::Normal)
    [IO.File]::WriteAllBytes($m, $bytes)
    $insert = [Text.Encoding]::ASCII.GetBytes($Line1 + "`r`n")
    $at = $bytes.Length - 3   # before the final "}\r\n"
    $expect = New-Object byte[] ($bytes.Length + $insert.Length)
    [Array]::Copy($bytes, 0, $expect, 0, $at)
    [Array]::Copy($insert, 0, $expect, $at, $insert.Length)
    [Array]::Copy($bytes, $at, $expect, $at + $insert.Length, 3)
    # What Hold would write, worked out in memory, runs anywhere; the write is Windows'.
    Yes 'UTF-8, a byte order mark and CRLF are kept byte for byte in what Hold works out, with one line added' (Same $expect $Latin.GetBytes((Held $Latin.GetString($bytes))))
    if ($OnWindows) {
        $r = Hold $m $false
        $after = [IO.File]::ReadAllBytes($m)
        Yes 'UTF-8, a byte order mark and CRLF come back byte for byte, with one line added' (Same $expect $after)
    } else {
        Write-Host "SKIP  the same bytes written to the file: the change goes in through MoveFileEx, $winOnly"
    }

    # Something that is not a manifest is never written.
    Put '{"AppState": {"AutoUpdateBehavior": 0}}'
    $was = [IO.File]::ReadAllBytes($m)
    $r = Hold $m $false
    Yes 'a file not shaped like Steam''s is left alone' (Same $was ([IO.File]::ReadAllBytes($m)))
    Yes 'and it says so, with the way to do it in Steam' (($r -like '*left it alone*') -and ($r -like '*Properties, Updates*'))
    Yes 'and no question is asked about it' (-not (Needs $m))
    Yes 'and no start line is made up about it' ($null -eq (Report $game))

    # What the question checks before it writes, against this machine's own list.
    $mRunning = Method 'SteamRunning' @()
    $steamUp = @(Get-Process -Name steam -ErrorAction SilentlyContinue).Count -gt 0
    Yes ('Steam is seen as ' + $(if ($steamUp) { 'running' } else { 'closed' }) + ', as the process list has it') ([bool]$mRunning.Invoke($null, @()) -eq $steamUp)

    # ---- what the start does, and the question (#493) ------------------------------
    #
    # Patrick, 29 September: "Our Repo should write this so it doesn't auto
    # update the game and people have to re do the downgrade again". Until then
    # the setting was only offered right after a downgrade. Now the start sets
    # it itself: with Steam closed at once, with Steam open through a question
    # whose Yes closes Steam, writes and starts Steam again. Patrick, 27 Oct
    # (#3600): always, so nothing the person answered goes into OnStart.
    $mOnStart = Method 'OnStart' @([bool], [bool], [bool])
    Yes 'OnStart takes no answer of the person''s, so no No can stop the start writing it' (($null -ne $mOnStart) -and (@($T.GetMethods($flags) | Where-Object { $_.Name -eq 'OnStart' }).Count -eq 1))
    function OnStart([bool]$needs, [bool]$steam, [bool]$game) { return [string]$mOnStart.Invoke($null, [object[]]@($needs, $steam, $game)) }
    $W = [string]$T.GetField('Write', $flags).GetValue($null)
    $A = [string]$T.GetField('Ask', $flags).GetValue($null)
    $N = [string]$T.GetField('Nothing', $flags).GetValue($null)
    Yes 'the three answers are different words' ((@($W, $A, $N) | Sort-Object -Unique).Count -eq 3)
    Yes 'held already: the start does nothing, whatever else is true' ((@(
        (OnStart $false $false $false), (OnStart $false $true $false),
        (OnStart $false $false $true), (OnStart $false $true $true)) | Where-Object { $_ -ne $N }).Count -eq 0)
    $closedWrites = (OnStart $true $false $false) -ceq $W
    Yes 'not held and Steam closed: written with nothing to ask' $closedWrites
    Yes 'not held and Steam open: the question, at every such start' ((OnStart $true $true $false) -ceq $A)
    Yes '  but not while Skyrim runs, which needs Steam' ((OnStart $true $true $true) -ceq $N)

    # Only before Thornswood's own folder exists (#1226, Patrick, 29 Sep):
    # "after that, people's Steam copy is theirs to update however they like".
    $mLooks = Method 'LooksAtStart' @([bool], [bool])
    function Looks([bool]$own, [bool]$down) { return [bool]$mLooks.Invoke($null, [object[]]@($own, $down)) }
    Yes 'the start looks at the setting while there is no folder of its own and no downgrade is needed' (Looks $false $false)
    Yes '  not while a downgrade is needed first' (-not (Looks $false $true))
    Yes '  and never once the own folder exists, whatever else is true' ((-not (Looks $true $false)) -and (-not (Looks $true $true)))

    # The question is only put while Steam is open, so it has no Steam-closed
    # form, and it asks to close Steam now, not whether to change the setting.
    $mQuestion = Method 'Question' @([string])
    function Question([string]$m) { return [string]$mQuestion.Invoke($null, [object[]]@($m)) }
    $notNow = [string]$T.GetField('NotNow', $flags).GetValue($null)
    Put (Acf '0')
    $q = Question $m
    Yes 'the question says what the launcher changes, in Steam''s own words, and where' (($q -like '*the launcher changes Steam''s Updates setting for Skyrim to "Wait until I launch the game"*') -and ($q -like '*Automatic Updates*') -and ($q -like ('*' + $m + '*')))
    Yes 'says Thornswood never starts Skyrim through Steam' ($q -like '*never starts Skyrim through Steam*')
    Yes 'asks to close Steam now, and says Yes closes Steam and starts it again' (($q -like '*Close Steam now?*') -and ($q -like '*Yes closes Steam, makes the change and starts Steam again*'))
    # #3600: these two are one check, so the start and the question can no
    # longer each pass while saying different things. The start writes with
    # Steam closed whatever was answered, so No has to say so before it is
    # pressed, and nothing may still say No leaves the setting alone.
    Yes 'No is not now, and says what the start then does, the same as the start does it' (
        $closedWrites -and ((OnStart $true $true $false) -ceq $A) -and
        ($q -like ('*' + $notNow)) -and
        ($notNow -like '*makes the change by itself the next time it starts while Steam is closed*') -and
        ($notNow -like '*asks again the next time it starts while Steam is open*') -and
        ($q -notlike '*leaves it as it is*'))
    Yes 'a writable file is not called read only' ($q -notlike '*read only*')
    [IO.File]::SetAttributes($m, [IO.FileAttributes]::ReadOnly -bor [IO.FileAttributes]::Archive)
    Yes 'a read-only file on 0: the launcher also takes the mark off' ((Question $m) -like '*marked read only*The launcher also takes that mark off*')
    Put (Acf '1')
    [IO.File]::SetAttributes($m, [IO.FileAttributes]::ReadOnly -bor [IO.FileAttributes]::Archive)
    $q1 = Question $m
    Yes 'on 1 and read only, as Patrick''s is: the question says it is already held and only the mark comes off' (($q1 -like '*already "Wait until I launch the game"*') -and ($q1 -like '*takes that mark off and changes nothing in the file*') -and ($q1 -like '*Close Steam now?*') -and ($q1 -like ('*' + $notNow)))
    [IO.File]::SetAttributes($m, [IO.FileAttributes]::Normal)

    $mWait = Method 'WaitClosed' @([int])
    if (@(Get-Process -Name steam -ErrorAction SilentlyContinue).Count -eq 0) {
        $t0 = [DateTime]::UtcNow
        Yes 'with no Steam running, waiting for it to close answers at once' (([bool]$mWait.Invoke($null, [object[]]@(5))) -and (([DateTime]::UtcNow - $t0).TotalSeconds -lt 2))
        $noLimit = [int]$T.GetField('NoLimit', $flags).GetValue($null)
        $t0 = [DateTime]::UtcNow
        Yes '  and so does waiting with no limit' (($noLimit -lt 0) -and ([bool]$mWait.Invoke($null, [object[]]@($noLimit))) -and (([DateTime]::UtcNow - $t0).TotalSeconds -lt 2))
    } else {
        $t0 = [DateTime]::UtcNow
        $r = [bool]$mWait.Invoke($null, [object[]]@(1))
        $took = ([DateTime]::UtcNow - $t0).TotalSeconds
        Yes ('with Steam running and not asked to close, waiting gives up after its time (' + [Math]::Round($took, 1) + ' s) and says it is still open') ((-not $r) -and ($took -ge 0.9) -and ($took -lt 5))
    }

    # ---- how the launcher reaches it ---------------------------------------------
    #
    # By text, because these are the window's and cannot be driven from here. What they
    # pin: the file is only ever written from ShellSteamUpdates.cs; on the way
    # in only when OnStart says Write; in the question only after Yes and with
    # Steam closed (by the person, or by Yes, waited for); and nothing about it
    # touches Play.
    $shell = Get-Content -LiteralPath (Join-Path $AppPath 'Shell.cs') -Raw
    $askPath = Join-Path $AppPath 'ShellSteamUpdates.cs'
    $askSrc = if (Test-Path -LiteralPath $askPath) { Get-Content -LiteralPath $askPath -Raw } else { '' }

    function Body([string]$text, [string]$head) {
        $at = $text.IndexOf($head)
        if ($at -lt 0) { return '' }
        $b = $text.IndexOf('{', $at)
        $depth = 0
        for ($i = $b; $i -lt $text.Length; $i++) {
            if ($text[$i] -eq '{') { $depth++ }
            elseif ($text[$i] -eq '}') { $depth--; if ($depth -eq 0) { return $text.Substring($at, $i - $at + 1) } }
        }
        return ''
    }

    $writers = @(Get-ChildItem -LiteralPath $AppPath -Filter *.cs -File | Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'SteamUpdates\.Hold\(' })
    Yes 'exactly one launcher file writes the setting, ShellSteamUpdates.cs' (($writers.Count -eq 1) -and ($writers[0].Name -eq 'ShellSteamUpdates.cs'))

    $start = Body $askSrc 'static void HoldSteamUpdatesOnStart()'
    Yes 'the start decides by OnStart, with the game''s state and nothing the person answered' (($start -match 'SteamUpdates\.OnStart\(SteamUpdates\.NeedsHolding\(manifest\), SteamUpdates\.SteamRunning\(\), playing\)'))
    Yes 'and writes only when it says Write' ($start -match 'if \(what == SteamUpdates\.Write\) \{ Log\(SteamUpdates\.Hold\(manifest\)\); return; \}')
    Yes 'otherwise logs the start line' ($start -match 'SteamUpdates\.Report\(target\)')
    Yes 'and puts the question once the window is idle, only when it says Ask' (($start -match 'if \(what != SteamUpdates\.Ask\) return;') -and ($start -match '(?s)Dispatcher\.UIThread\.Post\(delegate.*?AskToHoldSteamUpdates\(\).*?\}, DispatcherPriority\.ApplicationIdle\);'))

    $ask = Body $askSrc 'static void AskToHoldSteamUpdates()'
    $close = Body $askSrc 'static string CloseSteamAndHold(string manifest)'
    # The box is Ask.YesNo (Ask.cs), which puts the question and gives back
    # the answer in one call, so the question and Yes are at the same place.
    $showAt = $ask.IndexOf('if (!Ask.YesNo(SteamUpdates.Question(manifest),')
    $yesAt = $showAt
    $gameAt = $ask.IndexOf('Checks.GameRunning()')
    $closedAt = $ask.IndexOf('if (!SteamUpdates.SteamRunning()) { Log(SteamUpdates.Hold(manifest)); return; }')
    Yes 'the question is never put while Skyrim runs' (($gameAt -ge 0) -and ($showAt -ge 0) -and ($gameAt -lt $yesAt))
    Yes 'nor with Steam closed by then, which is written with nothing to ask, as the start does' (($closedAt -gt $gameAt) -and ($closedAt -lt $showAt))
    Yes 'the only other write is Yes''s, off the window''s thread' (([regex]::Matches($ask, 'SteamUpdates\.Hold\(')).Count -eq 1 -and ($ask -match 'ThreadPool\.QueueUserWorkItem') -and ($ask.IndexOf('CloseSteamAndHold(manifest)') -gt $yesAt))
    Yes 'No is not now: nothing is remembered, and the log says the same as the question and how to do it in Steam' (
        ($ask -match 'Log\(SteamUpdates\.NotNow \+ " " \+ SteamUpdates\.How\);') -and ($askSrc -notmatch 'cfg\.SteamUpdates') -and ($ask -notmatch 'leaves it as it is|as it is\.'))
    Yes 'the question is SteamUpdates.Question, the one tested above' ($ask -match 'SteamUpdates\.Question\(manifest\)')

    # Yes, in CloseSteamAndHold (#3600). The exit request cannot be taken
    # back, so the minute only decides when the person is told; the wait goes
    # on until Steam has gone, and every way out after the request starts
    # Steam again. Until then a timed out Yes said "nothing was changed" and
    # left Steam closed.
    $exitAt = $close.IndexOf('asked = Downgrade.AskSteam("steam://exit", LogOnly);')
    $waitAt = $close.IndexOf('SteamUpdates.WaitClosed(60)')
    $stillAt = $close.IndexOf('SayFromPool(SteamUpdates.StillClosing);')
    $onAt = $close.IndexOf('SteamUpdates.WaitClosed(SteamUpdates.NoLimit)')
    $holdAt = $close.IndexOf('SteamUpdates.Hold(manifest, false)')
    $catchAt = $close.IndexOf('catch (Exception ex)')
    $againAt = $close.IndexOf('if (asked)')
    Yes 'Yes asks Steam to exit and goes no further when it could not be asked' (($exitAt -ge 0) -and ($close -match 'if \(!asked\)\s+said = "Steam could not be asked to close, so nothing was changed\. "'))
    Yes 'then waits for it to be gone before writing' (($waitAt -gt $exitAt) -and ($holdAt -gt $waitAt) -and ($close -match 'said = closed\s+\? SteamUpdates\.Hold\(manifest, false\)'))
    Yes 'after a minute says Steam is still closing, and keeps waiting rather than giving up' (($stillAt -gt $waitAt) -and ($onAt -gt $stillAt) -and ($onAt -lt $holdAt) -and ($close -notmatch 'nothing was changed, and the launcher asks again'))
    Yes 'and starts Steam again outside every branch, after the catch, whenever Steam was asked to exit' (
        ($catchAt -gt $holdAt) -and ($againAt -gt $catchAt) -and ($close.IndexOf('StartSteamAgain()') -gt $againAt) -and
        (([regex]::Matches($askSrc, 'StartSteamAgain\(\);')).Count -eq 1))
    $still = [string]$T.GetField('StillClosing', $flags).GetValue($null)
    Yes 'the still-closing line says Steam was asked to exit and what happens if the launcher closes first' (($still -like '*asked to close*') -and ($still -like '*starts Steam again*') -and ($still -like '*start Steam yourself*') -and ($still -like '*next time it starts while Steam is closed*'))
    $again = Body $askSrc 'static void StartSteamAgain()'
    # Since #2627 the start is Upkeep.StartSteam, which Fix also runs when
    # Scan finds Steam not running; StartSteamAgain hands on to it.
    $upkeepPath = Join-Path $AppPath 'Upkeep.cs'
    if (($again -match 'Upkeep\.StartSteam\(') -and (Test-Path -LiteralPath $upkeepPath)) {
        $again = Body (Get-Content -LiteralPath $upkeepPath -Raw) 'public static bool StartSteam(Action<string> say)'
    }
    Yes 'Steam starts again in the tray, with its link as the fallback' (($again -match '"-silent"') -and ($again -match 'steam://open/main'))
    $cfgSrc = Get-Content -LiteralPath (Join-Path $AppPath 'Config.cs') -Raw
    Yes 'no config setting remembers a No' ($cfgSrc -notmatch 'SteamUpdatesDeclined')

    $down = Body $shell 'static void RunDowngrade()'
    # Since #1218 the downgrade never writes the Steam copy, so there is nothing
    # there for the setting to hold afterwards, and the question does not
    # follow it (test-own-folder-alone.ps1).
    Yes 'the question does not follow a downgrade, which no longer writes the Steam copy' (($down.Length -gt 0) -and ($down -notmatch 'AskToHoldSteamUpdates'))
    Yes 'the start calls it only before the own folder exists and once no downgrade is needed' ($shell -match 'if \(SteamUpdates\.LooksAtStart\(!Paths\.Collection, Downgrade\.Needed\(cfg\)\)\) HoldSteamUpdatesOnStart\(\);')
    Yes 'and reads Steam''s file for the Steam copy, never Thornswood''s folder' (($start -match 'string target = OwnGame\.Source\(cfg\);') -and ($ask -match 'SteamUpdates\.ManifestFor\(OwnGame\.Source\(cfg\)\)'))
    Yes 'the start line is read only there' ((([regex]::Matches($shell + $askSrc, 'SteamUpdates\.Report\(')).Count -eq 1) -and ($start -match 'SteamUpdates\.Report\('))
    $draw = Body $shell 'static bool DrawStatus()'
    Yes 'the Play button does not look at it' (($draw.Length -gt 0) -and ($draw -notmatch 'SteamUpdates'))
    $checks = Join-Path $AppPath 'Checks.cs'
    Yes 'nor do the checks that gate Play' ((Get-Content -LiteralPath $checks -Raw) -notmatch 'SteamUpdates')

    # ---- what a Steam update could reach (#493) ---------------------------------
    #
    # The reason the mark is not needed for the game itself: Thornswood's own
    # folder has its own SkyrimSE.exe, root files and masters (OwnGame.MustCopy
    # copies them), and Play checks that folder's exe, not the Steam copy's.
    $own = Get-Content -LiteralPath (Join-Path $AppPath 'OwnGame.cs') -Raw
    Yes 'every file in the game''s root is copied into Thornswood''s folder, never linked' ($own -match "if \(rel\.IndexOf\('\\\\'\) < 0\) return true;")
    $chk = Get-Content -LiteralPath $checks -Raw
    # Before a folder chosen at install is made, Paths.Game is Profile\Payload
    # and the game is the Steam copy it will be made from (#1226).
    Yes 'the Game build check reads the exe Thornswood runs (Paths.Game, or the Steam copy its chosen folder is made from)' (
        ($chk -match 'string game = Paths\.OwnFirst \? Paths\.SteamCopy : Paths\.Game;') -and ($chk -match 'new FileInfo\(exe\)\.Length') -and
        ($chk -match 'new Check\("Game build", bytes == cfg\.ExpectedExeBytes'))
    # Since #1218 a Steam copy on another build no longer stops a made folder
    # following Vortex; only a first build asks for the Downgrade, and that
    # leaves the Steam copy on its build (test-own-folder-alone.ps1).
    Yes 'and a Steam copy on another build no longer stops a made folder following Vortex' (($own -notmatch 'most likely because Steam updated it') -and ($own -match 'if \(!made\)'))

    # ---- this machine's own manifest, read only ------------------------------------
    $libs = New-Object System.Collections.Generic.List[string]
    try {
        $sp = (Get-ItemProperty -Path 'HKCU:\Software\Valve\Steam' -Name SteamPath -ErrorAction Stop).SteamPath
        if ($sp) {
            $sp = $sp.Replace('/', '\')
            $libs.Add($sp)
            $vdf = Join-Path $sp 'config\libraryfolders.vdf'
            if (Test-Path -LiteralPath $vdf) {
                foreach ($l in (Get-Content -LiteralPath $vdf)) {
                    if ($l -match '^\s*"path"\s+"(.*)"\s*$') { $libs.Add($Matches[1].Replace('\\', '\')) }
                }
            }
        }
    } catch { }
    $real = ''
    foreach ($l in $libs) {
        $g = Join-Path $l 'steamapps\common\Skyrim Special Edition'
        $c = ManifestFor $g
        if ($c -and (Test-Path -LiteralPath $c)) { $real = $c; break }
    }
    if (-not $real) {
        Write-Host 'SKIP  no Steam copy of Skyrim on this machine, so the real manifest is not read'
    } else {
        $text = $Latin.GetString([IO.File]::ReadAllBytes($real))
        $v = Value $text
        Yes ('this machine''s manifest parses, AutoUpdateBehavior is "' + $v + '"') ($null -ne $v)
        $h = Held $text
        $ok = $false
        if ($v -ceq '1') { $ok = ($h -ceq $text) }
        elseif ($v -ceq '') { $ok = ($h.Length -eq $text.Length + $Line1.Length + 1) -or ($h.Length -eq $text.Length + $Line1.Length + 2) }
        elseif ($v.Length -eq 1) { $ok = ((Differ $text $h) -eq 1) }
        else { $ok = ((Value $h) -ceq '1') }
        Yes 'and changing it would touch that value and nothing else (worked out in memory, not written)' $ok
    }

    # ---- Steam's own words, against the Steam on this machine, read only ---------
    #
    # The names come from Steam's English strings. The numbers come from its UI
    # bundle, which builds the list as {value:X.name,title:...
    # "#AppProperties_AutoUpdate..."}, where X is a module whose exports are
    # plain numbers (T=0,j=1,k=2,D=3 on 24 September). The bundle is minified
    # and renamed with every Steam update, so a shape this cannot find is a
    # SKIP, not a pass. Steam's key for "Let Steam decide when to update" is
    # still called Always.
    $steamDir = ''
    try { $steamDir = ([string](Get-ItemProperty -Path 'HKCU:\Software\Valve\Steam' -Name SteamPath -ErrorAction Stop).SteamPath).Replace('/', '\') } catch { }
    $locFile = if ($steamDir) { Join-Path $steamDir 'steamui\localization\steamui_english-json.js' } else { '' }
    if (-not $locFile -or -not (Test-Path -LiteralPath $locFile)) {
        Write-Host 'SKIP  no Steam on this machine, so its own names for the choices are not read'
    } else {
        $loc = [IO.File]::ReadAllText($locFile)
        $words = @{}
        foreach ($mm in [regex]::Matches($loc, '"AppProperties_AutoUpdate(UseDefault|OnLaunch|Always|HighPriority)":"([^"]*)"')) { $words[$mm.Groups[1].Value] = $mm.Groups[2].Value }
        Yes ('this Steam names four choices: ' + ((@('UseDefault', 'OnLaunch', 'HighPriority', 'Always') | ForEach-Object { '"' + $words[$_] + '"' }) -join ', ')) ($words.Count -eq 4)
        Yes 'and what the launcher calls 1 is its name for waiting for a launch, word for word' ($words['OnLaunch'] -ceq (Setting '1'))
        foreach ($old in $gone) { Yes ('"' + $old + '" is not among them') (-not $loc.Contains($old)) }

        $bundle = $null
        foreach ($f in @(Get-ChildItem -LiteralPath (Join-Path $steamDir 'steamui') -Filter 'chunk*.js' -File -ErrorAction SilentlyContinue)) {
            $s = [IO.File]::ReadAllText($f.FullName)
            if ($s.Contains('"#AppProperties_AutoUpdateOnLaunch"')) { $bundle = $s; break }
        }
        $nums = @{}
        if ($bundle) {
            $exp = @{}
            foreach ($mm in [regex]::Matches($bundle, '\{value:[\w$]+\.([\w$]+),title:[^}]*?"#AppProperties_AutoUpdate(UseDefault|OnLaunch|Always|HighPriority)[_"]')) { $exp[$mm.Groups[2].Value] = $mm.Groups[1].Value }
            if ($exp.Count -eq 4) {
                $at = 0
                while ($nums.Count -lt 4) {
                    $at = $bundle.IndexOf($exp['OnLaunch'] + ':()=>', $at, [StringComparison]::Ordinal)
                    if ($at -lt 0) { break }
                    $open = $bundle.LastIndexOf('{', $at)
                    $shut = $bundle.IndexOf('}', $at)
                    $at++
                    if ($open -lt 0 -or $shut -lt 0) { continue }
                    $map = $bundle.Substring($open, $shut - $open + 1)
                    $local = @{}
                    foreach ($k in $exp.Keys) {
                        $e = [regex]::Match($map, '[{,]' + [regex]::Escape($exp[$k]) + ':\(\)=>([\w$]+)[,}]')
                        if ($e.Success) { $local[$k] = $e.Groups[1].Value }
                    }
                    if ($local.Count -ne 4) { continue }
                    $window = $bundle.Substring($shut, [Math]::Min(60000, $bundle.Length - $shut))
                    $nums = @{}
                    foreach ($k in $local.Keys) {
                        $d = [regex]::Match($window, '[,;{\s]' + [regex]::Escape($local[$k]) + '=(\d+)[,;]')
                        if ($d.Success) { $nums[$k] = $d.Groups[1].Value }
                    }
                }
            }
        }
        if ($nums.Count -ne 4 -or @($nums.Values | Sort-Object -Unique).Count -ne 4) {
            Write-Host 'SKIP  this Steam''s UI bundle is not in a shape this can read, so its numbers for the choices are not checked'
        } else {
            Yes ('this Steam numbers them ' + ((@('UseDefault', 'OnLaunch', 'HighPriority', 'Always') | ForEach-Object { $words[$_] + ' ' + $nums[$_] }) -join ', ')) $true
            Yes 'waiting for a launch is 1, the value the launcher writes' ($nums['OnLaunch'] -ceq $T.GetField('OnLaunchOnly', $flags).GetValue($null))
            foreach ($k in @('UseDefault', 'OnLaunch', 'HighPriority', 'Always')) {
                Yes ('the launcher calls ' + $nums[$k] + ' "' + $words[$k] + '", as this Steam does') ((Setting $nums[$k]) -ceq $words[$k])
            }
        }
    }
}
finally {
    try {
        Get-ChildItem -LiteralPath $work -Recurse -File -ErrorAction SilentlyContinue |
            ForEach-Object { try { $_.Attributes = 'Normal' } catch { } }
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    } catch { }
}

Done
