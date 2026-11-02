<#
  test-feed-notice.ps1

  What the update feed says to everybody, and when it may hold Play.

  To Do List entry 262: "There is no way to say anything to everybody when an
  outside thing breaks". version.json has carried a message field from the
  start, and the launcher's whole treatment of it was one line in OnVersionDoc:

      if (!string.IsNullOrEmpty(v.message)) Log(v.message);

  a log line that scrolled away. Now the message is a bar above Play, and two
  new fields, maintenance and minLauncher, can hold Play with the reason in
  that bar. That makes it a kill switch, and a kill switch is only safe if
  every doubt comes out open. So this asks the launcher's own code, compiled
  from the files that ship, every case that could shut Play by accident:

    - a notice on its own never holds Play
    - a feed older than the new fields, or with them null, still reads, and
      holds nothing
    - a document that was never read holds nothing
    - a minimum that is not a version number holds nothing, and since #1329
      Updater.IsNewer by itself no longer calls "latest" newer either
    - a maintenance value that is not plainly on holds nothing, and a value
      that would have thrown as a bool reads without a word

  The launcher is built the way its project builds it (tests\Launcher-Csc.ps1,
  Add-LauncherAssembly, #4823), and its own VersionDoc.Parse, FeedNotice.From
  and Updater.IsNewer are asked, on any machine with the .NET 10 SDK. Until
  #4823 this compiled Config.cs and FeedNotice.cs alone and ran them under
  Windows PowerShell on the .NET Framework's serializer, which, measured on 24
  September, turned "maintenance": null or "yes" on a bool field into an
  exception, and an exception there is the whole document unread and Play
  shut for everybody. The field is still a string, and the cases below still
  ask it every such value.

  It also reads every file of the Shell class and the window,
  launcher\app\MainWindow.axaml, for the wiring: the bar is the window's
  NoticeBar, the log line is gone, the hold is on the button and in Play(),
  it can only be set from a document that was read, and the bar has a grid
  row of its own.

  Read only. The build goes under out\harness, which git ignores.
#>
[CmdletBinding()]
param(
    [string]$Xaml
)

$ErrorActionPreference = 'Stop'
. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's SDK and settings (#4823)
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
# This harness is in launcher\tests\, the repository is two folders up.
$Here = Split-Path -Parent (Split-Path -Parent $Here)
$AppDir = Join-Path $Here (Join-Path 'launcher' 'app')
if (-not $Xaml) { $Xaml = Join-Path $AppDir 'MainWindow.axaml' }

$script:pass = 0
$script:fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" }
    else { $script:fail++; Write-Host "FAIL  $what" }
}
function Done {
    Write-Host ''
    Write-Host "$script:pass passed, $script:fail failed"
    exit $(if ($script:fail) { 1 } else { 0 })
}
function Read-Text([string]$p) { return [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8) }

$noticePath = Join-Path $AppDir 'FeedNotice.cs'
$shellPath = Join-Path $AppDir 'Shell.cs'

Yes 'FeedNotice.cs is in the launcher source' (Test-Path -LiteralPath $noticePath)
if (-not (Test-Path -LiteralPath $noticePath)) { Done }

$noticeSrc = Read-Text $noticePath
# The Shell class is split across files (#500): ShowNotice, OnVersionDoc and
# CheckFailed are in ShellUpdate.cs. Every file of the class is read, so the
# counts below cover the whole class whichever file the code is in next.
$shellSrc = Read-Text $shellPath
foreach ($f in (Get-ChildItem -LiteralPath $AppDir -Filter '*.cs' | Sort-Object Name)) {
    if ($f.Name -eq 'Shell.cs') { continue }
    $t = Read-Text $f.FullName
    if ($t -match '\bpartial class Shell\b') { $shellSrc += "`r`n" + $t }
}

# A method's text, cut out of the source by brace matching.
function Lift([string]$src, [string]$signature) {
    $at = $src.IndexOf($signature)
    if ($at -lt 0) { return $null }
    $lineStart = $src.LastIndexOf("`n", $at) + 1
    $open = $src.IndexOf('{', $at)
    $depth = 0
    for ($i = $open; $i -lt $src.Length; $i++) {
        $c = $src[$i]
        if ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') { $depth--; if ($depth -eq 0) { return $src.Substring($lineStart, $i - $lineStart + 1) } }
    }
    return $null
}

# ---- build the launcher, as the project builds it ---------------------------
Yes ('the .NET SDK the launcher builds with is on this machine (' + $LauncherDotnet + ')') (Test-Path -LiteralPath $LauncherDotnet)
if (-not (Test-Path -LiteralPath $LauncherDotnet)) { Done }
$asm = $null
try { $asm = Add-LauncherAssembly }
catch { foreach ($l in @(($_.Exception.Message -split "`r?`n") | Where-Object { $_ -match 'error' } | Select-Object -First 20)) { Write-Host "      $l" } }
Yes 'the launcher builds' ($null -ne $asm)
if ($null -eq $asm) { Done }

$DocT = $asm.GetType('Thornswood.VersionDoc')
$NoticeT = $asm.GetType('Thornswood.FeedNotice')
$UpdaterT = $asm.GetType('Thornswood.Updater')
Yes 'VersionDoc, FeedNotice and Updater are in it' ($null -ne $DocT -and $null -ne $NoticeT -and $null -ne $UpdaterT)
if ($null -eq $DocT -or $null -eq $NoticeT -or $null -eq $UpdaterT) { Done }
$mParse = $DocT.GetMethod('Parse', [Reflection.BindingFlags]'Static, Public', $null, [Type[]]@([byte[]]), $null)
$mFrom = $NoticeT.GetMethod('From', [Reflection.BindingFlags]'Static, Public')
$mNewer = $UpdaterT.GetMethod('IsNewer', [Reflection.BindingFlags]'Static, Public')
Yes 'VersionDoc.Parse, FeedNotice.From and Updater.IsNewer are public and static' ($null -ne $mParse -and $null -ne $mFrom -and $null -ne $mNewer)
if ($null -eq $mParse -or $null -eq $mFrom -or $null -eq $mNewer) { Done }

$Running = '1.1.92'

# One feed, as the launcher reads it: bytes through VersionDoc.Parse, then
# FeedNotice.From. A throw anywhere is reported, not swallowed.
function Ask([string]$json, [string]$running = $Running) {
    $r = @{ Threw = $null; Notice = $null }
    try {
        $doc = $mParse.Invoke($null, @(, [Text.Encoding]::UTF8.GetBytes($json)))
        $r.Notice = $mFrom.Invoke($null, @($doc, $running))
    }
    catch { $r.Threw = $_.Exception.GetBaseException().Message }
    return $r
}
# The case that must never hold: no bar and no hold, and it read.
function Quiet([string]$what, [string]$json) {
    $a = Ask $json
    Yes "$what reads without a throw" ($null -eq $a.Threw)
    if ($a.Threw) { Write-Host "      $($a.Threw)"; return }
    Yes "$what shows no bar" ($null -eq $a.Notice.Title)
    Yes "$what leaves Play open" ($null -eq $a.Notice.Hold)
}
# A notice that shows but must not hold.
function Says([string]$what, [string]$json) {
    $a = Ask $json
    Yes "$what reads without a throw" ($null -eq $a.Threw)
    if ($a.Threw) { Write-Host "      $($a.Threw)"; return $null }
    Yes "$what shows the bar" ($null -ne $a.Notice.Title)
    Yes "$what leaves Play open" ($null -eq $a.Notice.Hold)
    return $a.Notice
}
# A hold, with everything the button and the bar need to say why.
function Holds([string]$what, [string]$json, [string]$running = $Running) {
    $a = Ask $json $running
    Yes "$what reads without a throw" ($null -eq $a.Threw)
    if ($a.Threw) { Write-Host "      $($a.Threw)"; return $null }
    $n = $a.Notice
    Yes "$what holds Play" ($null -ne $n.Hold)
    Yes "$what says why in the bar and on the button" ($n.Title -and $n.Text -and $n.Button -and $n.Hold)
    return $n
}

# ---- S1: nothing to say. None of these may show anything or hold anything ---
Quiet 'S1 the feed as it is today, message ""' '{"launcherVersion":"1.1.92","message":""}'
Quiet 'S1 a feed from before the message field' '{"launcherVersion":"1.0.1","packs":[]}'
Quiet 'S1 an empty document' '{}'
Quiet 'S1 a message of spaces' '{"message":"   "}'
Quiet 'S1 every new field null' '{"message":null,"maintenance":null,"minLauncher":null}'
$none = $mFrom.Invoke($null, @($null, $Running))
Yes 'S1 a check that got no document shows no bar' ($null -eq $none.Title)
Yes 'S1 and leaves Play open' ($null -eq $none.Hold)

# ---- S2: a notice on its own never holds Play --------------------------------
$msg = 'Steam updated Skyrim tonight. Do not let it update again; the fix is on its way.'
$n = Says 'S2 a message on its own' ('{"message":"' + $msg + '"}')
if ($n) {
    Yes 'S2 the bar carries the message word for word' ($n.Text -eq $msg)
    Yes 'S2 and the button is left alone' ($null -eq $n.Button)
}
$n = Says 'S2 a message with maintenance false' ('{"message":"' + $msg + '","maintenance":false}')
$n = Says 'S2 a message with a minimum this launcher meets' ('{"message":"' + $msg + '","minLauncher":"1.1.92"}')

# ---- S3: maintenance ---------------------------------------------------------
$n = Holds 'S3 maintenance true with a message' ('{"maintenance":true,"message":"' + $msg + '"}')
if ($n) {
    Yes 'S3 the bar gives the message as the reason' ($n.Text.Contains($msg))
    Yes 'S3 the log line gives it too' ($n.Hold.Contains($msg))
    Yes "S3 the button says $($n.Button)" ($n.Button -eq 'CLOSED FOR MAINTENANCE')
}
$n = Holds 'S3 maintenance true and no message' '{"maintenance":true}'
if ($n) { Yes 'S3 the bar still says something' ($n.Text.Length -gt 20) }
$n = Holds 'S3 maintenance with a message that has no full stop' '{"maintenance":true,"message":"Steam broke SKSE"}'
if ($n) { Yes 'S3 the reason still reads as a sentence' ($n.Text.StartsWith('Steam broke SKSE. Open Diagnostics')) }
$n = Says 'S3 the same message with no maintenance' '{"message":"Steam broke SKSE"}'
if ($n) { Yes 'S3 is shown exactly as it was written' ($n.Text -eq 'Steam broke SKSE') }
$n = Holds 'S3 maintenance "true" as a string' '{"maintenance":"true"}'
$n = Holds 'S3 maintenance 1' '{"maintenance":1}'
$n = Holds 'S3 maintenance "yes"' '{"maintenance":"yes"}'
Quiet 'S3 maintenance false' '{"maintenance":false}'
Quiet 'S3 maintenance "false"' '{"maintenance":"false"}'
Quiet 'S3 maintenance 0' '{"maintenance":0}'
Quiet 'S3 maintenance ""' '{"maintenance":""}'
Quiet 'S3 maintenance "maybe", a typo' '{"maintenance":"maybe"}'

# ---- S4: the minimum launcher version ----------------------------------------
$n = Holds 'S4 a minimum above this launcher' '{"minLauncher":"1.1.93"}'
if ($n) {
    Yes "S4 the button says $($n.Button)" ($n.Button -eq 'UPDATE THE LAUNCHER')
    Yes 'S4 the bar names both versions' ($n.Text.Contains('1.1.93') -and $n.Text.Contains($Running))
}
Quiet 'S4 a minimum equal to this launcher' '{"minLauncher":"1.1.92"}'
Quiet 'S4 a minimum below this launcher' '{"minLauncher":"1.1.40"}'
Quiet 'S4 an empty minimum' '{"minLauncher":""}'
$n = Holds 'S4 a minimum with a leading v' '{"minLauncher":"v1.1.93"}'
$n = Holds 'S4 a minimum written as a JSON number' '{"minLauncher":1.2}'
# #1329: a version on either side that does not read as dotted numbers is not
# an update. It used to be, which is why the notice reads the minimum itself.
Yes ('S4 Updater.IsNewer on its own no longer calls "latest" newer than ' + $Running) (-not $mNewer.Invoke($null, @('latest', $Running)))
Quiet 'S4 so a minimum of "latest" is not a version and holds nothing' '{"minLauncher":"latest"}'
Quiet 'S4 a minimum of "1.1."' '{"minLauncher":"1.1."}'
Quiet 'S4 a minimum with a part too long for an int' '{"minLauncher":"1.1.9999999999"}'
$a = Ask '{"minLauncher":"1.1.92"}' '1.1.92.1'
Yes 'S4 a dev build 1.1.92.1 meets a minimum of 1.1.92' ($null -eq $a.Threw -and $null -eq $a.Notice.Hold)
$n = Holds 'S4 a dev build 1.1.92.1 below a minimum of 1.1.93' '{"minLauncher":"1.1.93"}' '1.1.92.1'
$a = Ask '{"minLauncher":"1.1.93"}' 'dev'
Yes 'S4 a running version that is not a number is never held' ($null -eq $a.Threw -and $null -eq $a.Notice.Hold)

# ---- S5: both at once --------------------------------------------------------
$n = Holds 'S5 maintenance and a minimum above' '{"maintenance":true,"minLauncher":"1.1.93"}'
if ($n) { Yes 'S5 maintenance is what it says' ($n.Button -eq 'CLOSED FOR MAINTENANCE') }
$n = Holds 'S5 a minimum above with a message' ('{"minLauncher":"1.1.93","message":"' + $msg + '"}')
if ($n) { Yes 'S5 the message still reaches the bar' ($n.Text.Contains($msg)) }

# ---- S6: the words people read -----------------------------------------------
$strings = [regex]::Matches($noticeSrc, '"((?:[^"\\]|\\.)*)"') | ForEach-Object { $_.Groups[1].Value }
$said = ($strings -join ' ')
# Built from two halves so a search of the repository for the word finds real
# uses and not this check.
$banned = 'play' + 'er'
Yes 'S6 no text in FeedNotice.cs uses the word CLAUDE.md rules out for people' (-not ($said -match ('(?i)' + $banned)))
Yes 'S6 no text in FeedNotice.cs carries an em dash' (-not $said.Contains([string][char]0x2014))

# ---- S7: the wiring in the Shell class ---------------------------------------
Yes 'S7 the message no longer goes only to the log' (-not $shellSrc.Contains('Log(v.message)'))
Yes 'S7 the bar, its heading and its sentence are the window''s, by name' ($shellSrc.Contains('noticeBar = win.NoticeBar; txtNoticeTitle = win.TxtNoticeTitle; txtNoticeNote = win.TxtNoticeNote;'))
$gate = [regex]::Match($shellSrc, 'btnPlay\.IsEnabled = all [^;]*;').Value
Yes 'S7 the Play button is shut while the feed holds it' ($gate.Contains('feedNotice.Hold == null'))
Yes 'S7 Play() refuses too, for the ways in that are not the button' ($shellSrc.Contains('if (feedNotice.Hold != null) { Log(feedNotice.Hold); return; }'))
$sets = @([regex]::Matches($shellSrc, '\bfeedNotice\s*=[^=]') | ForEach-Object { $_.Value })
Yes "S7 feedNotice is set in two places, its declaration and ShowNotice ($($sets.Count) found)" ($sets.Count -eq 2)
Yes 'S7 it starts empty, so nothing is held before a document is read' ($shellSrc.Contains('static FeedNotice feedNotice = new FeedNotice();'))
Yes 'S7 ShowNotice sets it from the document' ($shellSrc.Contains('feedNotice = FeedNotice.From(v, Updater.Version);'))
$calls = @([regex]::Matches($shellSrc, '\bShowNotice\(') ).Count
Yes "S7 ShowNotice is defined once and called once ($calls found)" ($calls -eq 2)
$ovd = Lift $shellSrc 'static void OnVersionDoc(VersionDoc v, bool loud)'
Yes 'S7 and the one call is in OnVersionDoc, which only ever has a document that was read' ($null -ne $ovd -and $ovd.Contains('ShowNotice(v);'))
$failed = Lift $shellSrc 'static void CheckFailed(string why)'
Yes 'S7 a failed check does not touch the notice' ($null -ne $failed -and -not $failed.Contains('feedNotice') -and -not $failed.Contains('ShowNotice'))

# ---- S8: the bar in the window, MainWindow.axaml -----------------------------
# Avalonia's markup since #4823: x:Name in the same XAML namespace as WPF's,
# IsVisible in place of Visibility, and the rows either as elements or as one
# RowDefinitions="Auto,*" attribute.
$xns = 'http://schemas.microsoft.com/winfx/2006/xaml'
[xml]$ui = Read-Text $Xaml
$page = $null
foreach ($g in $ui.GetElementsByTagName('Grid')) { if ($g.GetAttribute('Name', $xns) -eq 'PagePlay') { $page = $g; break } }
Yes 'S8 the Play page is in MainWindow.axaml' ($null -ne $page)
if ($page) {
    $rows = 0
    if ($page.GetAttribute('RowDefinitions')) { $rows = @($page.GetAttribute('RowDefinitions') -split ',').Count }
    $kids = @()
    foreach ($k in $page.ChildNodes) {
        if ($k.NodeType -ne 'Element') { continue }
        if ($k.LocalName -eq 'Grid.RowDefinitions') { $rows = @($k.ChildNodes | Where-Object { $_.NodeType -eq 'Element' }).Count; continue }
        $kids += $k
    }
    $bar = $null; $playRow = -1; $maxRow = 0
    foreach ($k in $kids) {
        $r = 0; if ($k.GetAttribute('Grid.Row')) { $r = [int]$k.GetAttribute('Grid.Row') }
        if ($r -gt $maxRow) { $maxRow = $r }
        if ($k.GetAttribute('Name', $xns) -eq 'NoticeBar') { $bar = $k }
        if ($k.OuterXml.Contains('x:Name="BtnPlay"') -or $k.OuterXml.Contains('Name="BtnPlay"')) { $playRow = $r }
    }
    Yes 'S8 NoticeBar sits on the Play page' ($null -ne $bar)
    if ($bar) {
        $barRow = [int]$bar.GetAttribute('Grid.Row')
        $shared = @($kids | Where-Object { $_ -ne $bar -and ([int]$_.GetAttribute('Grid.Row')) -eq $barRow })
        Yes "S8 it has row $barRow to itself, so it cannot cover an update card" ($shared.Count -eq 0)
        Yes 'S8 it sits above the Play button' ($playRow -gt $barRow)
        Yes 'S8 it is hidden until a feed says something' ($bar.GetAttribute('IsVisible') -eq 'False')
        Yes 'S8 it holds the heading and the sentence' ($bar.OuterXml.Contains('Name="TxtNoticeTitle"') -and $bar.OuterXml.Contains('Name="TxtNoticeNote"'))
    }
    Yes "S8 every row the page uses is defined ($rows rows, highest used $maxRow)" ($maxRow -lt $rows)
}

Done
