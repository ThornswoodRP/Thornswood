# test-2180-record-readers.ps1
#
#     pwsh -NoProfile -File .\tests\test-2180-record-readers.ps1
#
# The local readers of the four high-risk records hold them to RecordShape.ps1
# (#2180, second slice), so a record at a version this checkout does not know,
# or short of a field, stops before anything is sent. Each reader's own code
# is checked for the call, placed before its first send, and the behaviour is
# run where the reader is a function (MaxOnline, CollectionPlugins). Offline.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Refusal([scriptblock]$b) { try { $null = & $b; return '' } catch { return $_.Exception.Message } }
function Src([string]$rel) { return [IO.File]::ReadAllText((Join-Path $repo $rel)).Replace("`r`n", "`n") }
function At([string]$text, [string]$needle) { return $text.IndexOf($needle) }

# ---- the call is there, and before anything goes
$ds = Src 'scripts\deploy\Deploy-Server.ps1'
$i = At $ds '$rec = Read-ThornswoodRecord -Path $recordPath -Kind server-build'
Yes 'Deploy-Server reads server-build.json through Read-ThornswoodRecord' ($i -gt 0 -and (At $ds ". (Join-Path `$Here '..\release\RecordShape.ps1')") -lt $i -and (At $ds ". (Join-Path `$Here '..\release\RecordShape.ps1')") -gt 0)
Yes '  before the first send or remote call' ($i -lt (At $ds 'Send-ThornswoodArtifact') -or (At $ds 'Send-ThornswoodArtifact') -lt 0)
Yes '  and has no bare read of the record left' (-not $ds.Contains('$rec = ConvertFrom-ThornswoodJson (Get-Content -LiteralPath $recordPath'))
$dd = Src 'scripts\deploy\Deploy-DevGamemode.ps1'
$i = At $dd '$devRecord = Read-ThornswoodRecord -Path $devRecordPath -Kind server-build'
Yes 'Deploy-DevGamemode takes the record, its commit and whether it loads light plugins, through Read-ThornswoodRecord' ($i -gt 0 -and (At $dd "RecordShape.ps1')") -lt $i -and (At $dd '$devRecordCommit = [string]$devRecord.source.commit') -gt $i)
Yes '  before the artifact is sent' ($i -lt (At $dd 'Send-ThornswoodArtifact -Artifact'))
$dg = Src 'scripts\deploy\Deploy-Gamemode.ps1'
$i = At $dg 'Read-ThornswoodRecord -Path $serverRecord -Kind server-build'
Yes 'Deploy-Gamemode holds server-build.json to its shape before the load order is worked out' ($i -gt 0 -and $i -lt (At $dg '$loadsLight = '))
$sc = Src 'scripts\release\Sync-Client.ps1'
$i = At $sc 'Get-ThornswoodRecordProblems -Doc $rec -Kind client-build'
Yes 'Sync-Client holds client-build.json to its shape right after it parses, and stops on a problem' ($i -gt (At $sc '$rec = $recText | ConvertFrom-Json') -and $sc.Contains('if ($recBad.Count) { Stop-Here'))
Yes '  before any file is copied' ($i -lt (At $sc 'Copy-Item'))
$ep = Src 'scripts\release\Export-ServerPayload.ps1'
Yes 'Export-ServerPayload holds server-build.json to its shape before packing' ((At $ep 'Get-ThornswoodRecordProblems -Doc $rec -Kind server-build') -gt (At $ep '$rec = [IO.File]::ReadAllText($Record)') -and $ep.Contains("Nothing was packed.') }"))

# ---- MaxOnline: an unknown version stops; missing data still says why
. (Join-Path $repo 'scripts\deploy\MaxOnline.ps1')
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-2180b [x] & ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $tmp
try {
    $mo = Join-Path $tmp 'most-online.json'
    [IO.File]::WriteAllText($mo, '{ "version": 2, "people": 25 }')
    $why = Refusal { Get-MostOnline $mo }
    Yes 'Get-MostOnline throws on a version this checkout does not know, naming the file' ($why.StartsWith($mo) -and $why -match 'it is version 2, and this checkout knows 1')
    [IO.File]::WriteAllText($mo, '{ "version": 1, "people": 25, "staffSeats": 5 }')
    $r = Get-MostOnline $mo
    Yes '  version 1 said out loud still reads' ($r.Value -eq 25 -and $r.Staff -eq 5)
    [IO.File]::WriteAllText($mo, '{ "people": 25 }')
    Yes '  and no version reads as before' ((Get-MostOnline $mo).Value -eq 25)
    [IO.File]::WriteAllText($mo, '{ "note": "x" }')
    $r = Get-MostOnline $mo
    Yes '  a record with no people still gives no number and says why (unchanged)' ($r.Value -eq 0 -and $r.Why -eq 'it has no people')
    Yes 'the committed most-online.json still reads' ((Get-MostOnline).Value -gt 0)

    # ---- CollectionPlugins: the reader holds the record to the same contract
    . (Join-Path $repo 'scripts\deploy\CollectionPlugins.ps1')
    $cp = Join-Path $tmp 'collection-plugins.json'
    $h = '0' * 64
    [IO.File]::WriteAllText($cp, ('{"version":1,"plugins":[{"name":"a.esp","size":"12","sha256":"' + $h + '"}]}'))
    $why = Refusal { Read-ThornswoodCollectionPluginRecord $cp }
    Yes 'Read-ThornswoodCollectionPluginRecord refuses a size that is a string, naming the file' ($why.StartsWith($cp) -and $why -match 'plugins\.a\.esp has no whole size')
    [IO.File]::WriteAllText($cp, ('{"version":2,"plugins":[{"name":"a.esp","size":12,"sha256":"' + $h + '"}]}'))
    Yes '  and still refuses version 2 (its own message)' ((Refusal { Read-ThornswoodCollectionPluginRecord $cp }) -match 'not a version 1 collection plugin record')
    [IO.File]::WriteAllText($cp, ('{"version":1,"plugins":[{"name":"a.esp","size":12,"sha256":"' + $h + '"}]}'))
    $t = Read-ThornswoodCollectionPluginRecord $cp
    Yes '  a good record still reads' ($t.ContainsKey('A.ESP') -and $t['a.esp'].Size -eq 12)
    Yes 'the committed collection-plugins.json still reads through the deploy reader' ((Read-ThornswoodCollectionPluginRecord (Join-Path $repo 'records\collection-plugins.json')).Count -gt 50)
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- build.yml runs Check-Records
$by = Src '.github\workflows\build.yml'
Yes 'build.yml runs Check-Records.ps1 and fails closed on it' ($by.Contains('scripts\release\Check-Records.ps1') -and $by -match 'Check-Records\.ps1[^\n]*\n\s+if \(\$LASTEXITCODE -ne 0\)')

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
