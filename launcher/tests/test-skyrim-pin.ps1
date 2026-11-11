<#
  test-skyrim-pin.ps1

  The Skyrim build the launcher checks for, and the depots the Downgrade
  button asks Steam for (issue #471), compiled into the launcher.

  From 27 September to 11 November 2026 the update feed carried the pin
  (version.json's expectedExeBytes, newerExeBytes and depots, taken through
  Downgrade.AdoptPin into config.json) and the compiled numbers were the
  fallback. The launcher reads no update feed since #5608, so the pin is
  compiled in again, in one block of Downgrade.cs and Config.PinnedExeBytes,
  and a new pin goes out as a new launcher. This holds:

    - the compiled numbers are what the checks and the three download_depot
      lines use, and a 1.7.104 and a 1.6.1170 exe are named as such
    - the record (records\skyrim-pin.json) and the compiled pin agree, and
      the install (the launcher's InstallSteps.cs since #4824) reads the
      build's exe size out of records\skyrim-files.json rather than keeping
      a copy
    - the depots are in Downgrade.cs's code only inside the pin's block, and
      the Downgrade asks for them through PinnedDepots
    - records\skyrim-files.json is the pinned build's own file list

  Config.cs is compiled whole, with LooseString.cs that its serializer
  reads strings with, and the pin methods are lifted out of Downgrade.cs by
  brace matching, all with the .NET 10 SDK the build runs at the C# version
  the project names (Add-LauncherType, tests\Launcher-Csc.ps1, #2821), and
  run in this pwsh, which is .NET 10 too, so on any machine (#4823).

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
    'PinDepots'      = 'static readonly string[][] PinDepots ='
    'Describe'       = 'public static string Describe(Config cfg, string exe)'
    'Commands'       = 'public static string[] Commands(Config cfg)'
    'Command'        = 'static string Command(string[] depot)'
    'PinnedDepots'   = 'static string[][] PinnedDepots(Config cfg)'
    'Newer'          = 'static long Newer(Config cfg)'
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

$asm = $null
try { $asm = Add-LauncherType -Source $configSrc, $looseSrc, $secretsSrc, $swallowSrc, $pathsStub, $downStub }
catch { Write-Host ('      ' + $_.Exception.Message) }
Yes 'Config.cs and the pin methods compile with the compiler the build runs' ($null -ne $asm)
if ($null -eq $asm) { Done }

$CfgT = $asm.GetType('Thornswood.Config')
$DownT = $asm.GetType('Thornswood.Downgrade')
$flags = [Reflection.BindingFlags]'Static, Public, NonPublic'
function Down([string]$name, [object[]]$a) {
    # Reflection wants the values themselves, not PowerShell's wrappers round them.
    $args2 = New-Object 'object[]' $a.Count
    for ($i = 0; $i -lt $a.Count; $i++) { $x = $a[$i]; if ($x -is [psobject]) { $x = $x.PSObject.BaseObject }; $args2[$i] = $x }
    return $DownT.GetMethod($name, $flags).Invoke($null, $args2)
}
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
    # ---- P1: the compiled pin is the one used ----------------------------------
    $cfg = Fresh
    Yes 'P1 a config checks for the compiled exe size' ($cfg.ExpectedExeBytes -eq 37157144)
    Yes 'P1 the Downgrade question shows the compiled three lines' (Same @(Down 'Commands' @($cfg)) $fallback)
    Yes 'P1 a 1.7.104 exe is named as 1.7.104' ((Down 'Describe' @($cfg, (Exe 37910440))) -eq '1.7.104, the server runs 1.6.1170')
    Yes 'P1 a 1.6.1170 exe is named as 1.6.1170' ((Down 'Describe' @($cfg, (Exe 37157144))) -eq '1.6.1170')
    Yes 'P1 config.json keeps no copy of the pin' ($configSrc -notmatch '\[JsonInclude\][^\n]*(ExpectedExeBytes|NewerExeBytes|SkyrimDepots)')

    # ---- P8: one pin, everywhere it is written down ------------------------------
    $rec = (Read-Text $recordPath).TrimStart([char]0xFEFF) | ConvertFrom-Json
    $recLines = @($rec.depots | ForEach-Object { 'download_depot ' + $rec.appId + ' ' + $_.id + ' ' + $_.manifest })
    Yes 'P8 records\skyrim-pin.json has the same depots as the compiled pin' (Same $recLines $fallback)
    Yes 'P8 and the same app as Downgrade.cs' ([string]$rec.appId -eq $appIdConst.Groups[1].Value)
    Yes 'P8 and the same newer size as Downgrade.cs' ([string]$rec.newerExeBytes -eq $newerConst.Groups[1].Value)
    $pinned = [regex]::Match($configSrc, 'public const long PinnedExeBytes = (\d+);')
    Yes 'P8 and the same exe size as Config.PinnedExeBytes' ($pinned.Success -and $pinned.Groups[1].Value -eq [string]$rec.expectedExeBytes)
    $setup = Read-Text $setupPath
    Yes 'P8 the install reads the exe size out of records\skyrim-files.json and keeps no copy of the pin' (
        $setup.Contains('GetManifestResourceStream("skyrim-files.json")') -and
        $setup.Contains('GetProperty("SkyrimSE.exe").GetProperty("bytes")') -and
        -not $setup.Contains([string]$rec.expectedExeBytes) -and -not $setup.Contains('download_depot'))

    # ---- P9: the wiring ---------------------------------------------------------
    $fbStart = $downSrc.IndexOf('---- THE PIN (#471), COMPILED IN ----')
    $fbEnd = $downSrc.IndexOf('---- end of the pin ----')
    # In code, that is: a comment quoting what Steam once ran does not count.
    $hits = @([regex]::Matches($downSrc, '8442952117333549665') | Where-Object {
        $ls = $downSrc.LastIndexOf("`n", $_.Index) + 1
        -not $downSrc.Substring($ls, $_.Index - $ls).TrimStart().StartsWith('//')
    } | ForEach-Object { $_.Index })
    Yes "P9 the first manifest is in Downgrade.cs's code only inside the pin's block ($($hits.Count) found)" ($fbStart -gt 0 -and $fbEnd -gt $fbStart -and $hits.Count -ge 1 -and @($hits | Where-Object { $_ -lt $fbStart -or $_ -gt $fbEnd }).Count -eq 0)
    Yes 'P9 Run asks for the depots through PinnedDepots' ((Lift $downSrc 'static bool Run(Config cfg, Action<string> log, Action<string> status)') -match 'Depots = PinnedDepots\(cfg\);')

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
