<#
  test-skyrim-pin.ps1

  The Skyrim build the launcher checks for, and the depots the Downgrade
  button asks Steam for, come from the update feed (issue #471).

  Until 27 September the pin was compiled into the exe: the exe size in
  Config.cs, the three depot manifests and the newer build's size in
  Downgrade.cs, and a second copy of the depots in the install script. Now
  version.json carries expectedExeBytes, newerExeBytes and depots, written by
  Publish-Update from records\skyrim-pin.json, OnVersionDoc takes them through
  Downgrade.AdoptPin into config.json, and the compiled numbers are the
  labelled fallback. The fields have to be optional both ways, because every
  launcher already out there reads the same file:

    - a feed without the fields reads, and leaves a new launcher exactly as
      it is today, on the compiled numbers
    - a launcher older than the fields reads a feed that has them
    - a feed with them moves the checks and the three download_depot lines
    - half a pin, or a depot list the button cannot use, is not taken
    - what the publisher writes is what the launcher reads
    - the record and the compiled fallback agree, and the install (the
      launcher's InstallSteps.cs since #4824) reads the build's exe size out of
      records\skyrim-files.json rather than keeping a copy

  Config.cs is compiled whole, with LooseString.cs that its serializer
  reads strings with, and the pin methods are lifted out of Downgrade.cs by
  brace matching, all with the .NET 10 SDK the build runs at the C# version
  the project names (Add-LauncherType, tests\Launcher-Csc.ps1, #2821), and
  run in this pwsh, which is .NET 10 too, so on any machine (#4823). The
  feed and config.json are read and written by Config.cs's own
  System.Text.Json code (VersionDoc.Parse, Config.Save, Config.Load). The
  launcher from before the pin fields is a WPF one, which read the feed with
  the DataContract serializer, so P2 reads it with that.

  Read only apart from its own scratch folder under the temp folder, which it
  removes.
#>
[CmdletBinding()]
param([string]$Root)
# Scripts this runs whole go to a stand-in box, so the freshness guard lets them be (#2118).
$env:THORNSWOOD_HARNESS = '1'

$ErrorActionPreference = 'Stop'
$Here = $PSScriptRoot
if (-not $Here) { $Here = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Root) { $Root = Split-Path -Parent (Split-Path -Parent $Here) }

. (Join-Path (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'tests') 'Launcher-Csc.ps1')   # the build's compiler and C# version (#2821)

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

$app = Join-Path (Join-Path $Root 'launcher') 'app'
$downSrc = Read-Text (Join-Path $app 'Downgrade.cs')
$configSrc = Read-Text (Join-Path $app 'Config.cs')
$recordPath = Join-Path $Root 'records\skyrim-pin.json'
$publishPath = Join-Path $Root 'scripts\release\Publish-Update.ps1'
$setupPath = Join-Path $app 'InstallSteps.cs'

# ---- lift the pin methods out of Downgrade.cs ---------------------------------
# From the start of the signature's line to the brace that closes it, and the
# semicolon after it for a field initialiser.
function Lift([string]$src, [string]$signature) {
    $at = $src.IndexOf($signature)
    if ($at -lt 0) { return $null }
    $lineStart = $src.LastIndexOf("`n", $at) + 1
    $open = $src.IndexOf('{', $at)
    $depth = 0
    for ($i = $open; $i -lt $src.Length; $i++) {
        $c = $src[$i]
        if ($c -eq '{') { $depth++ }
        elseif ($c -eq '}') {
            $depth--
            if ($depth -eq 0) {
                $end = $i + 1
                if ($end -lt $src.Length -and $src[$end] -eq ';') { $end++ }
                return $src.Substring($lineStart, $end - $lineStart)
            }
        }
    }
    return $null
}
$wanted = [ordered]@{
    'FallbackDepots' = 'static readonly string[][] FallbackDepots ='
    'Describe'       = 'public static string Describe(Config cfg, string exe)'
    'Commands'       = 'public static string[] Commands(Config cfg)'
    'Command'        = 'static string Command(string[] depot)'
    'PinnedDepots'   = 'static string[][] PinnedDepots(Config cfg)'
    'Newer'          = 'static long Newer(Config cfg)'
    'Usable'         = 'static bool Usable(PinDepot[] d)'
    'AllDigits'      = 'static bool AllDigits(string s)'
    'FeedBytes'      = 'static long FeedBytes(string s)'
    'AdoptPin'       = 'public static bool AdoptPin(Config cfg, VersionDoc v)'
}
$lifted = New-Object System.Text.StringBuilder
foreach ($k in $wanted.Keys) {
    $m = Lift $downSrc $wanted[$k]
    Yes "Downgrade.cs has $k" ($null -ne $m)
    if ($null -eq $m) { Done }
    [void]$lifted.AppendLine($m)
}
$newerConst = [regex]::Match($downSrc, '(?m)^\s*public const long NewerExeBytes = (\d+);')
$appIdConst = [regex]::Match($downSrc, '(?m)^\s*const int AppId = (\d+);')
Yes 'Downgrade.cs still has the newer build''s size as a constant' $newerConst.Success
Yes 'Downgrade.cs has AppId' $appIdConst.Success
if (-not $newerConst.Success -or -not $appIdConst.Success) { Done }

$downStub = "using System;`r`nusing System.IO;`r`nnamespace Thornswood`r`n{`r`n    static class Downgrade`r`n    {`r`n" +
            $appIdConst.Value + "`r`n" + $newerConst.Value + "`r`n" + $lifted.ToString() + "`r`n    }`r`n}`r`n"

# Config.Load and Save need Secrets and Swallow, which come along, and its
# serializer LooseString; Paths is a stand-in with the one field Swallow
# reads, left null so nothing is written.
$looseSrc = Read-Text (Join-Path $app 'LooseString.cs')
$secretsSrc = Read-Text (Join-Path $app 'Secrets.cs')
$swallowSrc = Read-Text (Join-Path $app 'Swallow.cs')
$pathsStub = "namespace Thornswood`r`n{`r`n    static class Paths { public static string LogFile; }`r`n}`r`n"
# A launcher from before the pin fields: the feed class as it was, trimmed to
# a few of the fields it had.
$oldDoc = @'
using System.Runtime.Serialization;
namespace Older
{
    [DataContract]
    public class VersionDoc
    {
        [DataMember] public string launcherVersion = "";
        [DataMember] public string serverPort = "";
        [DataMember] public int maxOnline;
    }
}
'@

$asm = $null
try { $asm = Add-LauncherType -Source $configSrc, $looseSrc, $secretsSrc, $swallowSrc, $pathsStub, $downStub, $oldDoc }
catch { Write-Host ('      ' + $_.Exception.Message) }
Yes 'Config.cs and the pin methods compile with the compiler the build runs' ($null -ne $asm)
if ($null -eq $asm) { Done }

$DocT = $asm.GetType('Thornswood.VersionDoc')
$CfgT = $asm.GetType('Thornswood.Config')
$DownT = $asm.GetType('Thornswood.Downgrade')
$OldT = $asm.GetType('Older.VersionDoc')
$flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
function Down([string]$name, [object[]]$a) {
    # Reflection wants the values themselves, not PowerShell's wrappers round them.
    $args2 = New-Object 'object[]' $a.Count
    for ($i = 0; $i -lt $a.Count; $i++) { $x = $a[$i]; if ($x -is [psobject]) { $x = $x.PSObject.BaseObject }; $args2[$i] = $x }
    return $DownT.GetMethod($name, $flags).Invoke($null, $args2)
}
function Parse([string]$json) { return $DocT::Parse([Text.Encoding]::UTF8.GetBytes($json)) }
function Fresh { return [Activator]::CreateInstance($CfgT) }

$fallback = @(
    'download_depot 489830 489831 8442952117333549665',
    'download_depot 489830 489832 8042843504692938467',
    'download_depot 489830 489833 1914580699073641964'
)
function Same([object[]]$a, [object[]]$b) { return ($a.Count -eq $b.Count) -and (($a -join "`n") -eq ($b -join "`n")) }

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('ts-skyrim-pin-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
# An exe of a given size, for Describe. SetLength makes it without writing.
function Exe([long]$bytes) {
    $p = Join-Path $scratch ('SkyrimSE-' + $bytes + '.exe')
    $fs = [IO.File]::Create($p); $fs.SetLength($bytes); $fs.Close()
    return $p
}

try {
    # ---- P1: a feed without the pin changes nothing ----------------------------
    $doc = Parse '{"launcherVersion":"1.1.101","serverPort":"7777","maxOnline":25,"packs":[]}'
    Yes 'P1 a feed without the pin fields reads' ($null -ne $doc)
    Yes 'P1 and carries no pin' ($null -eq $doc.expectedExeBytes -and $null -eq $doc.newerExeBytes -and $null -eq $doc.depots)
    $cfg = Fresh
    Yes 'P1 a new config starts on the compiled exe size' ($cfg.ExpectedExeBytes -eq 37157144)
    Yes 'P1 AdoptPin says nothing moved' (-not (Down 'AdoptPin' @($cfg, $doc)))
    Yes 'P1 the exe size is still the compiled one' ($cfg.ExpectedExeBytes -eq 37157144)
    Yes 'P1 nothing is stored for the newer size or the depots' ($cfg.NewerExeBytes -eq 0 -and $null -eq $cfg.SkyrimDepots)
    Yes 'P1 the Downgrade question shows the compiled three lines' (Same @(Down 'Commands' @($cfg)) $fallback)
    Yes 'P1 a 1.7.104 exe is still named as 1.7.104' ((Down 'Describe' @($cfg, (Exe 37910440))) -eq '1.7.104, the server runs 1.6.1170')
    Yes 'P1 a 1.6.1170 exe is still named as 1.6.1170' ((Down 'Describe' @($cfg, (Exe 37157144))) -eq '1.6.1170')
    Yes 'P1 an empty document reads and moves nothing' (-not (Down 'AdoptPin' @($cfg, (Parse '{}'))))
    Yes 'P1 every pin field null reads and moves nothing' (-not (Down 'AdoptPin' @($cfg, (Parse '{"expectedExeBytes":null,"newerExeBytes":null,"depots":null}'))))
    Yes 'P1 no document at all moves nothing' (-not (Down 'AdoptPin' @($cfg, $null)))

    # ---- P2: an older launcher reads a feed that has the pin --------------------
    $withPin = '{"launcherVersion":"1.1.102","serverPort":"7777","maxOnline":25,"expectedExeBytes":37157144,"newerExeBytes":37910440,' +
               '"depots":[{"id":"489831","manifest":"8442952117333549665"},{"id":"489832","manifest":"8042843504692938467"},{"id":"489833","manifest":"1914580699073641964"}]}'
    $old = $null; $threw = $null
    try {
        $ser = New-Object System.Runtime.Serialization.Json.DataContractJsonSerializer($OldT)
        $ms = New-Object IO.MemoryStream(, [Text.Encoding]::UTF8.GetBytes($withPin))
        $old = $ser.ReadObject($ms)
    } catch { $threw = $_.Exception.GetBaseException().Message }
    Yes 'P2 a launcher from before the pin fields reads a feed that has them' ($null -eq $threw -and $null -ne $old)
    if ($threw) { Write-Host "      $threw" }
    Yes 'P2 and still gets what it knew about' ($null -ne $old -and $old.launcherVersion -eq '1.1.102' -and $old.maxOnline -eq 25)

    # ---- P3: a feed with the same pin as the fallback ---------------------------
    $cfg = Fresh
    $doc = Parse $withPin
    Yes 'P3 the pin reads out of the feed' ($doc.expectedExeBytes -eq '37157144' -and $doc.newerExeBytes -eq '37910440' -and $doc.depots.Length -eq 3)
    Yes 'P3 the first time, the newer size and depots are stored' ((Down 'AdoptPin' @($cfg, $doc)) -and $cfg.NewerExeBytes -eq 37910440 -and $cfg.SkyrimDepots.Length -eq 3)
    Yes 'P3 the second time nothing moves, so nothing is saved again' (-not (Down 'AdoptPin' @($cfg, $doc)))
    Yes 'P3 the three lines are the same as the fallback' (Same @(Down 'Commands' @($cfg)) $fallback)

    # ---- P4: a feed that moves the pin ------------------------------------------
    $moved = '{"expectedExeBytes":40000001,"newerExeBytes":41000002,' +
             '"depots":[{"id":"489831","manifest":"1111111111111111111"},{"id":"489832","manifest":"2222222222222222222"},{"id":"489833","manifest":"13333333333333333333"}]}'
    $cfg = Fresh
    Yes 'P4 a moved pin is taken' (Down 'AdoptPin' @($cfg, (Parse $moved)))
    Yes 'P4 the checks now look for the new exe size' ($cfg.ExpectedExeBytes -eq 40000001)
    Yes 'P4 an exe of the new size reads as the pinned build' ((Down 'Describe' @($cfg, (Exe 40000001))) -eq '1.6.1170')
    Yes 'P4 the new newer size is named as the newer build' ((Down 'Describe' @($cfg, (Exe 41000002))) -eq '1.7.104, the server runs 1.6.1170')
    $lines = @(Down 'Commands' @($cfg))
    Yes 'P4 the Downgrade question shows the new manifests' (Same $lines @('download_depot 489830 489831 1111111111111111111', 'download_depot 489830 489832 2222222222222222222', 'download_depot 489830 489833 13333333333333333333'))
    Yes 'P4 a manifest bigger than a long survives as it was written' ($lines[2].EndsWith('13333333333333333333'))

    # ---- P5: what is taken survives a restart -----------------------------------
    # Through Config.Save and Config.Load, as the launcher writes and reads it.
    $cfgFile = Join-Path $scratch 'config.json'
    $cfg.Save($cfgFile)
    $back = $CfgT.GetMethod('Load').Invoke($null, [object[]]@([string]$cfgFile))
    Yes 'P5 config.json keeps the pin' ($back.ExpectedExeBytes -eq 40000001 -and $back.NewerExeBytes -eq 41000002 -and $back.SkyrimDepots.Length -eq 3)
    Yes 'P5 and the lines after a restart are the feed''s' (Same @(Down 'Commands' @($back)) $lines)
    # A port other than the default, so a file that did not load (Load then
    # hands back a new Config) cannot pass for one that did.
    $oldFile = Join-Path $scratch 'config-before-the-pin.json'
    [IO.File]::WriteAllText($oldFile, '{"ExpectedExeBytes":37157144,"ServerPort":"7778"}')
    $oldCfg = $CfgT.GetMethod('Load').Invoke($null, [object[]]@([string]$oldFile))
    Yes 'P5 a config.json from before the pin loads' ($oldCfg.ServerPort -eq '7778')
    Yes 'P5 and lands on the fallback' ($oldCfg.NewerExeBytes -eq 0 -and $null -eq $oldCfg.SkyrimDepots -and (Same @(Down 'Commands' @($oldCfg)) $fallback))
    Yes 'P5 and names a 1.7.104 exe as before' ((Down 'Describe' @($oldCfg, (Exe 37910440))) -eq '1.7.104, the server runs 1.6.1170')

    # ---- P6: half a pin, or depots the button cannot use -------------------------
    $bad = [ordered]@{
        'two depots'                  = '[{"id":"489831","manifest":"1"},{"id":"489832","manifest":"2"}]'
        'four depots'                 = '[{"id":"1","manifest":"1"},{"id":"2","manifest":"2"},{"id":"3","manifest":"3"},{"id":"4","manifest":"4"}]'
        'a manifest with a letter'    = '[{"id":"489831","manifest":"844295211733354966x"},{"id":"489832","manifest":"2"},{"id":"489833","manifest":"3"}]'
        'an empty id'                 = '[{"id":"","manifest":"1"},{"id":"489832","manifest":"2"},{"id":"489833","manifest":"3"}]'
        'a depot that is null'        = '[null,{"id":"489832","manifest":"2"},{"id":"489833","manifest":"3"}]'
        'a depot with no manifest'    = '[{"id":"489831"},{"id":"489832","manifest":"2"},{"id":"489833","manifest":"3"}]'
        'a manifest with a space'     = '[{"id":"489831","manifest":"1 1"},{"id":"489832","manifest":"2"},{"id":"489833","manifest":"3"}]'
        'no depots at all'            = '[]'
    }
    foreach ($k in $bad.Keys) {
        $cfg = Fresh
        $d = $null; $threw = $null
        try { $d = Parse ('{"depots":' + $bad[$k] + '}') } catch { $threw = $_.Exception.GetBaseException().Message }
        Yes "P6 $k reads" ($null -eq $threw)
        if ($threw) { Write-Host "      $threw"; continue }
        Yes "P6 $k is not taken, and the fallback lines stay" ((-not (Down 'AdoptPin' @($cfg, $d))) -and $null -eq $cfg.SkyrimDepots -and (Same @(Down 'Commands' @($cfg)) $fallback))
    }
    $cfg = Fresh
    [void](Down 'AdoptPin' @($cfg, (Parse $moved)))
    [void](Down 'AdoptPin' @($cfg, (Parse '{"depots":[{"id":"1","manifest":"1"}]}')))
    Yes 'P6 a bad list after a good one leaves the good one' ($cfg.SkyrimDepots[0].manifest -eq '1111111111111111111')
    # Sizes are read the forgiving way: anything that is not a plain number
    # above 0 is not taken, and none of it may stop the document reading.
    $sizes = [ordered]@{
        'sizes of 0 and below'  = '{"expectedExeBytes":0,"newerExeBytes":-5}'
        'sizes that are words'  = '{"expectedExeBytes":"soon","newerExeBytes":true}'
        'sizes with a fraction' = '{"expectedExeBytes":37157144.5,"newerExeBytes":"1e9"}'
        'empty sizes'           = '{"expectedExeBytes":"","newerExeBytes":""}'
    }
    foreach ($k in $sizes.Keys) {
        $cfg = Fresh
        $d = $null; $threw = $null
        try { $d = Parse $sizes[$k] } catch { $threw = $_.Exception.GetBaseException().Message }
        Yes "P6 $k read" ($null -eq $threw)
        if ($threw) { Write-Host "      $threw"; continue }
        Yes "P6 $k are not taken" ((-not (Down 'AdoptPin' @($cfg, $d))) -and $cfg.ExpectedExeBytes -eq 37157144 -and $cfg.NewerExeBytes -eq 0)
    }
    $cfg = Fresh
    Yes 'P6 a size written as a quoted number is taken' ((Down 'AdoptPin' @($cfg, (Parse '{"expectedExeBytes":"40000001"}'))) -and $cfg.ExpectedExeBytes -eq 40000001)
    $cfg = Fresh
    Yes 'P6 an exe size on its own is taken on its own' ((Down 'AdoptPin' @($cfg, (Parse '{"expectedExeBytes":40000001}'))) -and $cfg.ExpectedExeBytes -eq 40000001 -and (Same @(Down 'Commands' @($cfg)) $fallback))

    # ---- P7: what the publisher writes is what the launcher reads ---------------
    $pub = Read-Text $publishPath
    $start = $pub.IndexOf('$pinPath = Join-Path $PSScriptRoot')
    $end = $pub.IndexOf("could not read records\skyrim-pin.json", $start)
    Yes 'P7 Publish-Update.ps1 reads records\skyrim-pin.json' ($start -gt 0 -and $end -gt $start)
    if ($start -gt 0 -and $end -gt $start) {
        $end = $pub.IndexOf("`n}", $end) + 2
        $block = $pub.Substring($start, $end - $start).Replace('Join-Path $PSScriptRoot ''..\..\records\skyrim-pin.json''', '$script:PinUnderTest')
        # The three helpers the block uses, as Publish-Update defines them.
        function Set-Prop($obj, [string]$name, $value) {
            if ($obj.PSObject.Properties.Name -contains $name) { $obj.$name = $value }
            else { $obj | Add-Member -NotePropertyName $name -NotePropertyValue $value }
        }
        function Val($o, [string]$k) {
            if ($null -ne $o -and $o.PSObject.Properties.Name -contains $k) { return [string]$o.$k }
            return ''
        }
        function Say($m, $c) { $script:said += $m }
        # Publish-Update loads RecordShape.ps1 at its top (#2180); the block asks it.
        . (Join-Path $Root 'scripts\release\RecordShape.ps1')
        $run = [scriptblock]::Create($block)

        $script:PinUnderTest = $recordPath
        $script:said = @()
        $doc = '{"launcherVersion":"1.1.102","packs":[]}' | ConvertFrom-Json
        . $run
        $json = $doc | ConvertTo-Json -Depth 6
        $read = Parse $json
        Yes 'P7 the feed it writes from the record reads in the launcher' ($read.expectedExeBytes -gt 0 -and $read.newerExeBytes -gt 0 -and $read.depots.Length -eq 3)
        $cfg = Fresh
        [void](Down 'AdoptPin' @($cfg, $read))
        Yes 'P7 and gives the same three lines as the compiled fallback' (Same @(Down 'Commands' @($cfg)) $fallback)
        Yes 'P7 the depot ids and manifests go out as strings' ($json -match '"manifest":\s*"8442952117333549665"')

        $broken = Join-Path $scratch 'skyrim-pin-broken.json'
        [IO.File]::WriteAllText($broken, '{"expectedExeBytes":37157144,"depots":[{"id":"489831","manifest":"1"}]}')
        $script:PinUnderTest = $broken
        $script:said = @()
        $doc = '{"launcherVersion":"1.1.102","expectedExeBytes":37157144}' | ConvertFrom-Json
        . $run
        Yes 'P7 a record with half a pin leaves the feed as it was' (-not ($doc.PSObject.Properties.Name -contains 'depots') -and -not ($doc.PSObject.Properties.Name -contains 'newerExeBytes'))
        Yes 'P7 and says so' (($script:said -join ' ') -match 'keeps the Skyrim pin it had')
        $script:PinUnderTest = Join-Path $scratch 'not-there.json'
        $doc = '{"launcherVersion":"1.1.102"}' | ConvertFrom-Json
        . $run
        Yes 'P7 no record at all leaves the feed as it was' (-not ($doc.PSObject.Properties.Name -contains 'expectedExeBytes'))
    }

    # ---- P8: one pin, everywhere it is written down ------------------------------
    $rec = (Read-Text $recordPath).TrimStart([char]0xFEFF) | ConvertFrom-Json
    $recLines = @($rec.depots | ForEach-Object { 'download_depot ' + $rec.appId + ' ' + $_.id + ' ' + $_.manifest })
    Yes 'P8 records\skyrim-pin.json has the same depots as the compiled fallback' (Same $recLines $fallback)
    Yes 'P8 and the same app as Downgrade.cs' ([string]$rec.appId -eq $appIdConst.Groups[1].Value)
    Yes 'P8 and the same newer size as Downgrade.cs' ([string]$rec.newerExeBytes -eq $newerConst.Groups[1].Value)
    $cfgDefaults = @([regex]::Matches($configSrc, 'ExpectedExeBytes(?: <= 0\) ExpectedExeBytes)? = (\d+);') | ForEach-Object { $_.Groups[1].Value })
    Yes "P8 and the same exe size as both of Config.cs's defaults ($($cfgDefaults -join ', '))" ($cfgDefaults.Count -eq 2 -and @($cfgDefaults | Where-Object { $_ -ne [string]$rec.expectedExeBytes }).Count -eq 0)
    $setup = Read-Text $setupPath
    Yes 'P8 the install reads the exe size out of records\skyrim-files.json and keeps no copy of the pin' (
        $setup.Contains('GetManifestResourceStream("skyrim-files.json")') -and
        $setup.Contains('GetProperty("SkyrimSE.exe").GetProperty("bytes")') -and
        -not $setup.Contains([string]$rec.expectedExeBytes) -and -not $setup.Contains('download_depot'))

    # ---- P9: the wiring ---------------------------------------------------------
    $ovd = $null
    foreach ($f in Get-ChildItem -LiteralPath $app -Filter 'Shell*.cs') {
        $m = Lift (Read-Text $f.FullName) 'static void OnVersionDoc(VersionDoc v, bool loud)'
        if ($m) { $ovd = $m }
    }
    Yes 'P9 OnVersionDoc is in the launcher' ($null -ne $ovd)
    if ($ovd) {
        Yes 'P9 it takes the pin through Downgrade.AdoptPin and saves it' ($ovd -match 'if \(Downgrade\.AdoptPin\(cfg, v\)\) \{[^}]*quiet = true; \}' -and $ovd.IndexOf('Downgrade.AdoptPin(cfg, v)') -lt $ovd.IndexOf('if (quiet)'))
        $line = [regex]::Match($ovd, 'Downgrade\.AdoptPin\(cfg, v\)\) \{ LogOnly\("([^"]*)"').Groups[1].Value
        Yes 'P9 the log line is plain words' ($line.Length -gt 0 -and -not ($line -match ('(?i)play' + 'er')) -and -not $line.Contains([string][char]0x2014))
    }
    $fbStart = $downSrc.IndexOf('THE COMPILED FALLBACK')
    $fbEnd = $downSrc.IndexOf('end of the compiled fallback')
    # In code, that is: a comment quoting what Steam once ran does not count.
    $hits = @([regex]::Matches($downSrc, '8442952117333549665') | Where-Object {
        $ls = $downSrc.LastIndexOf("`n", $_.Index) + 1
        -not $downSrc.Substring($ls, $_.Index - $ls).TrimStart().StartsWith('//')
    } | ForEach-Object { $_.Index })
    Yes "P9 the first manifest is in Downgrade.cs's code only inside the fallback block ($($hits.Count) found)" ($fbStart -gt 0 -and $fbEnd -gt $fbStart -and $hits.Count -ge 1 -and @($hits | Where-Object { $_ -lt $fbStart -or $_ -gt $fbEnd }).Count -eq 0)
    Yes 'P9 Run asks for the pinned depots, not the fallback directly' ((Lift $downSrc 'static bool Run(Config cfg, Action<string> log, Action<string> status)') -match 'Depots = PinnedDepots\(cfg\);')

    # ---- P10: the pinned build's own files (#1232) --------------------------------
    # records\skyrim-files.json lists every file of the three pinned depots, read
    # out of Steam's manifests of them by New-SkyrimFilesRecord.ps1. OwnGame takes
    # a file from the Steam copy as Skyrim's own only when it is on this list, so
    # the list has to be the pin's, moved in the same pull request.
    $filesPath = Join-Path $Root 'records\skyrim-files.json'
    Yes 'P10 records\skyrim-files.json is there' (Test-Path -LiteralPath $filesPath)
    if (Test-Path -LiteralPath $filesPath) {
        $filesText = (Read-Text $filesPath).TrimStart([char]0xFEFF)
        $files = $filesText | ConvertFrom-Json
        Yes 'P10 it is for the pinned build and app' ([string]$files.build -eq [string]$rec.build -and [string]$files.appId -eq [string]$rec.appId)
        $fileDepots = @($files.depots | ForEach-Object { 'download_depot ' + $files.appId + ' ' + $_.id + ' ' + $_.manifest })
        Yes 'P10 it was read from the same three depot manifests as the pin' (Same $fileDepots $recLines)
        $props = @($files.files.PSObject.Properties)
        $paths = @($props | ForEach-Object { $_.Name })
        $depotIds = @($rec.depots | ForEach-Object { [string]$_.id })
        $badRows = @($props | Where-Object { ([string]$_.Value.bytes) -notmatch '^\d+$' -or ([string]$_.Value.sha1) -notmatch '^[0-9a-f]{40}$' -or $depotIds -notcontains [string]$_.Value.depot })
        Yes "P10 it lists files ($($paths.Count)), each with its bytes, SHA-1 and depot" ($paths.Count -gt 0 -and $badRows.Count -eq 0)
        $counted = 0; foreach ($d in $files.depots) { $counted += [int]$d.files }
        Yes 'P10 and as many as the depots say they hold' ($counted -eq $paths.Count)
        Yes 'P10 its SkyrimSE.exe is the pin''s size' ($paths -contains 'SkyrimSE.exe' -and [string]$files.files.'SkyrimSE.exe'.bytes -eq [string]$rec.expectedExeBytes)
        Yes 'P10 every path stays under the game folder: no drive, no leading slash, no ..' (@($paths | Where-Object { $_ -match ':|^\\|(^|\\)\.\.(\\|$)' }).Count -eq 0)
        $mustHave = @('Data\Skyrim.esm', 'Data\Update.esm', 'Data\Dawnguard.esm', 'Data\HearthFires.esm', 'Data\Dragonborn.esm', 'Data\Skyrim - Textures0.bsa')
        Yes 'P10 the masters and the archives are on it' (@($mustHave | Where-Object { $paths -notcontains $_ }).Count -eq 0)
        $kinds = Read-Text (Join-Path $app 'OwnGameKinds.cs')
        # The launcher's own pattern, over the record as it is.
        $pattern = [regex]::Match($kinds, 'Regex\.Matches\(text, "((?:[^"\\]|\\.)*)"\)').Groups[1].Value
        $pattern = $pattern.Replace('\\', '\').Replace('\"', '"')
        $readBack = @([regex]::Matches($filesText, $pattern) | ForEach-Object { $_.Groups[1].Value.Replace('\\', '\') })
        Yes "P10 the launcher's own pattern reads every path back out of it ($($readBack.Count))" ($pattern.Length -gt 0 -and (Same @($readBack | Sort-Object) @($paths | Sort-Object)))
        # The launcher's project file embeds it; the compiler stops the build
        # when an embedded file is missing (CS1566), naming the file.
        $appProj = Read-Text (Join-Path $app 'Thornswood.csproj')
        Yes 'P10 Thornswood.csproj puts it inside the launcher as skyrim-files.json' (
            $appProj -match '<EmbeddedResource Include="\.\.\\\.\.\\records\\skyrim-files\.json"><LogicalName>skyrim-files\.json</LogicalName>')
        $gen = Join-Path $Root 'scripts\release\New-SkyrimFilesRecord.ps1'
        Yes 'P10 New-SkyrimFilesRecord.ps1, which writes it, is there' (Test-Path -LiteralPath $gen)
        # On a machine whose Steam has the three manifests, the record is what
        # the script writes from them today.
        $steamDir = ''
        try { $steamDir = [string](Get-ItemProperty -Path 'HKCU:\Software\Valve\Steam' -Name SteamPath -ErrorAction Stop).SteamPath } catch { $steamDir = '' }
        $have = $steamDir.Length -gt 0 -and @($rec.depots | Where-Object { -not (Test-Path -LiteralPath (Join-Path $steamDir ('depotcache\{0}_{1}.manifest' -f $_.id, $_.manifest))) }).Count -eq 0
        if ($have -and (Test-Path -LiteralPath $gen)) {
            $again = Join-Path $scratch 'skyrim-files.json'
            # In its own process: it stops with exit when something disagrees.
            $null = & ([Diagnostics.Process]::GetCurrentProcess().MainModule.FileName) -NoProfile -ExecutionPolicy Bypass -File $gen -Steam $steamDir -Out $again
            # Line ends aside: git may check the record out with CRLF.
            Yes 'P10 written again from this machine''s Steam manifests, it is the same file' ((Test-Path -LiteralPath $again) -and ((Read-Text $again).Replace("`r`n", "`n") -eq (Read-Text $filesPath).Replace("`r`n", "`n")))
        }
        else { Write-Host '      (this machine''s Steam does not have the three manifests, so the record is not written again here)' }
    }
}
finally {
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}

Done
