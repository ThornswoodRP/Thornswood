# test-2180-release-records.ps1
#
#     pwsh -NoProfile -File .\tests\test-2180-release-records.ps1
#
# #2180 slice 3: the release records the launcher and Ship are built on
# (skyrim-pin, skyrim-files, ui-gone, generated) are held to RecordShape.ps1,
# their readers ask before they use them, and Check-Records says when the pin
# and the file list name different builds. Offline.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\release\RecordShape.ps1')
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Refusal([scriptblock]$b) { try { $null = & $b; return '' } catch { return $_.Exception.Message } }
function Src([string]$rel) { return [IO.File]::ReadAllText((Join-Path $repo $rel)).Replace("`r`n", "`n") }
function Real([string]$kind) { return [IO.File]::ReadAllText((Join-Path $repo $script:ThornswoodRecordKinds[$kind].File)) | ConvertFrom-Json }
function Why($doc, [string]$kind) { return (@(Get-ThornswoodRecordProblems -Doc $doc -Kind $kind) -join '; ') }

foreach ($k in 'skyrim-pin', 'skyrim-files', 'ui-gone', 'generated') {
    Yes "the committed $k record has no problems" ((Why (Real $k) $k) -eq '')
}

# ---- skyrim-pin
$d = Real 'skyrim-pin'; $d.depots = @($d.depots | Select-Object -First 2)
Yes 'skyrim-pin: two depots is refused' ((Why $d 'skyrim-pin') -match 'not three depots')
$d = Real 'skyrim-pin'; $d.depots[0].manifest = [long]8442952117
Yes 'skyrim-pin: a manifest as a number, not digits in a string, is refused' ((Why $d 'skyrim-pin') -match 'a depot is not an id and a manifest')
$d = Real 'skyrim-pin'; $d.expectedExeBytes = 0; $d.build = '1.6'
$w = Why $d 'skyrim-pin'
Yes 'skyrim-pin: exe bytes 0 and a build that is not x.y.z are both named' ($w -match 'expectedExeBytes' -and $w -match 'build is missing or not a version')

# ---- skyrim-files
$d = Real 'skyrim-files'; $first = @($d.files.PSObject.Properties)[0].Name; $d.files.$first.sha1 = 'abc'
Yes 'skyrim-files: a short sha1 is refused, naming the file' ((Why $d 'skyrim-files').Contains("files.$first has no sha1"))
$d = Real 'skyrim-files'; $d.files.$first.depot = 489832
Yes 'skyrim-files: a depot as a number is refused' ((Why $d 'skyrim-files').Contains("files.$first has no depot"))
$d = Real 'skyrim-files'; $d.files = [pscustomobject]@{}
Yes 'skyrim-files: an empty files map is refused' ((Why $d 'skyrim-files') -match 'files is missing, empty')

# ---- ui-gone
$d = Real 'ui-gone'; $n = @($d.daedric.PSObject.Properties)[0].Name; $d.daedric.$n = 'nothex'
Yes 'ui-gone: a Daedric name with no sha256 is refused, named' ((Why $d 'ui-gone').Contains("daedric.$n is not a sha256"))
$d = Real 'ui-gone'; $d.unused = @()
Yes 'ui-gone: an empty unused list is refused' ((Why $d 'ui-gone') -match 'unused is missing, empty')
$d = Real 'ui-gone'; $d.PSObject.Properties.Remove('daedric')
Yes 'ui-gone: no daedric map is refused' ((Why $d 'ui-gone') -match 'daedric is missing')

# ---- generated
Yes 'generated: neither part is refused' ((Why ('{ "about": "x" }' | ConvertFrom-Json) 'generated') -match 'neither pandora nor bodyslide')
Yes 'generated: patches as a string is refused' ((Why ('{ "pandora": { "patches": "colis" } }' | ConvertFrom-Json) 'generated') -match 'pandora\.patches')
Yes 'generated: an empty set name is refused' ((Why ('{ "bodyslide": { "sets": ["a", " "] } }' | ConvertFrom-Json) 'generated') -match 'bodyslide\.sets')
Yes 'generated: sliders as a list is refused' ((Why ('{ "bodyslide": { "sets": ["a"], "sliders": [] } }' | ConvertFrom-Json) 'generated') -match 'bodyslide\.sliders')
Yes 'generated: one part alone is fine' ((Why ('{ "pandora": { "patches": [] } }' | ConvertFrom-Json) 'generated') -eq '')
foreach ($k in 'skyrim-pin', 'skyrim-files', 'ui-gone', 'generated') {
    $d = Real $k; $d | Add-Member -NotePropertyName version -NotePropertyValue 2 -Force
    Yes "$k`: version 2 is refused" ((Why $d $k) -match 'it is version 2')
}

# ---- the readers ask, before they use the record
$sr = Src 'scripts\release\Ship-Rules.ps1'
Yes 'Ship-Rules holds ui-gone.json to its shape right after it parses, before the lists are built' ($sr.IndexOf('Get-ThornswoodRecordProblems -Doc $script:ShipUiGoneDoc -Kind ui-gone') -gt $sr.IndexOf('$script:ShipUiGoneDoc = $ShipUiGoneText') -and $sr.IndexOf('Get-ThornswoodRecordProblems -Doc $script:ShipUiGoneDoc -Kind ui-gone') -lt $sr.IndexOf('$ShipDaedricMenu = [ordered]@{}'))
$bl = Src 'scripts\release\Build-Launcher.ps1'
$i = $bl.IndexOf('Read-ThornswoodRecord -Path $embedded.Path -Kind $embedded.Kind')
Yes 'Build-Launcher reads both embedded records through Read-ThornswoodRecord before MSBuild compiles them in' ($i -gt 0 -and $i -lt $bl.IndexOf('& $found.MSBuild (Resolve-Path -LiteralPath $proj).Path') -and $bl.Contains("Kind = 'skyrim-files'") -and $bl.Contains("Kind = 'ui-gone'") -and $bl.Contains("Die (`$_.Exception.Message + ' Nothing was built.')"))
$pu = Src 'scripts\release\Publish-Update.ps1'
$i = $pu.IndexOf('Get-ThornswoodRecordProblems -Doc $pin -Kind skyrim-pin')
Yes 'Publish-Update holds skyrim-pin.json to its shape before anything goes into the feed (and keeps the feed''s pin on a problem)' ($i -gt 0 -and $i -lt $pu.IndexOf("Set-Prop `$doc 'expectedExeBytes'") -and $i -gt $pu.IndexOf('$pin = (Get-Content -LiteralPath $pinPath'))

# ---- Generated.ps1 behaviour: the build list refuses a newer version
. (Join-Path $repo 'scripts\mods\Generated.ps1')
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-2180c [x] & ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $tmp
try {
    $g = Join-Path $tmp 'generated.json'
    [IO.File]::WriteAllText($g, '{ "version": 2, "pandora": { "patches": ["colis"] } }')
    $w = Refusal { Get-GeneratedBuildList $g }
    Yes 'Get-GeneratedBuildList refuses version 2, naming the file' ($w.StartsWith($g) -and $w -match 'it is version 2')
    Yes '  and the committed build list still reads' ((Refusal { Get-GeneratedBuildList (Join-Path $repo 'records\generated.json') }) -eq '')

    # ---- Check-Records: pin and file list on different builds
    $fake = Join-Path $tmp 'repo'
    $null = New-Item -ItemType Directory -Path (Join-Path $fake 'records')
    foreach ($k in @($script:ThornswoodRecordKinds.Keys | Where-Object { $script:ThornswoodRecordKinds[$_].File })) { Copy-Item -LiteralPath (Join-Path $repo $script:ThornswoodRecordKinds[$k].File) -Destination (Join-Path $fake $script:ThornswoodRecordKinds[$k].File) }
    $pinPath = Join-Path $fake 'records\skyrim-pin.json'
    [IO.File]::WriteAllText($pinPath, [IO.File]::ReadAllText($pinPath).Replace('"build": "1.6.1170"', '"build": "1.6.1179"'))
    $out = & pwsh -NoProfile -File (Join-Path $repo 'scripts\release\Check-Records.ps1') -Repo $fake 2>&1
    Yes 'Check-Records refuses a pin and a file list on different builds (exit 1), naming both' ($LASTEXITCODE -eq 1 -and @($out | Where-Object { "$_" -match 'REFUSED\s+skyrim pin and files.*1\.6\.1179.*1\.6\.1170' }).Count -eq 1)
    # A comparison that cannot be made says so (#2711): its catch was empty.
    Remove-Item -LiteralPath (Join-Path $fake 'records\skyrim-files.json')
    $out = & pwsh -NoProfile -File (Join-Path $repo 'scripts\release\Check-Records.ps1') -Repo $fake 2>&1
    Yes 'Check-Records says when it cannot compare the pin with the file list (exit 1)' ($LASTEXITCODE -eq 1 -and @($out | Where-Object { "$_" -match 'REFUSED\s+skyrim pin and files\s+could not compare' }).Count -eq 1)
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
