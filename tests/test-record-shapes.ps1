# test-record-shapes.ps1
#
#     pwsh -NoProfile -File .\tests\test-record-shapes.ps1
#     powershell -NoProfile -File .\tests\test-record-shapes.ps1
#
# The high-risk records are held to a known version and the fields their
# readers depend on, fail closed (#2180, first slice): RecordShape.ps1's
# Read-ThornswoodRecord, and Check-Records.ps1 over the committed records.
# Offline: bad copies are written to a scratch folder; no record is changed.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Windows.ps1')
# What this runs, every machine runs in PowerShell 7 since #5356, the box
# included, and this harness runs in it too.
$boxPs = Get-BoxPowerShell
$repo = Split-Path -Parent $PSScriptRoot
. (Join-Path $repo 'scripts\release\RecordShape.ps1')
# Kinds with a committed file; server-settings is each box's own (#2180, slice 4).
$fileKinds = @($script:ThornswoodRecordKinds.Keys | Where-Object { $script:ThornswoodRecordKinds[$_].File })

$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Refusal([scriptblock]$b) { try { $null = & $b; return '' } catch { return $_.Exception.Message } }

# ---- the committed records pass
foreach ($kind in $fileKinds) {
    $p = Join-Path $repo $script:ThornswoodRecordKinds[$kind].File
    Yes "the committed $kind record reads at a known version with its fields" ((Refusal { Read-ThornswoodRecord -Path $p -Kind $kind }) -eq '')
}
$out = & $boxPs -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo 'scripts\release\Check-Records.ps1') 2>&1
# One OK line per record, and three for records held to each other: the
# Skyrim pin with its files, the client's licences with its build (#3099),
# and the front's packages with their texts (#3751).
Yes 'Check-Records passes this checkout (exit 0), one OK line per record' ($LASTEXITCODE -eq 0 -and @($out | Where-Object { "$_" -match '^\s+OK ' }).Count -eq ($fileKinds.Count + 3))
Yes 'Check-Records holds the client licences to the client build and their texts' (@($out | Where-Object { "$_" -match '^\s+OK\s+client licences\s+\d+ texts, of [0-9a-f]{8}' }).Count -eq 1)
Yes 'docs\JSON-STATE-INVENTORY.md lists each of these records' ((Test-Path -LiteralPath (Join-Path $repo 'docs\JSON-STATE-INVENTORY.md')) -and -not @($script:ThornswoodRecordKinds.Values | Where-Object { $_.File } | Where-Object { -not ([IO.File]::ReadAllText((Join-Path $repo 'docs\JSON-STATE-INVENTORY.md')).Contains($_.File.Replace('\', '/'))) }).Count)

# ---- bad copies are refused, naming the file and the reason
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-2180 [x] & ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $tmp
try {
    function Bad([string]$kind, [string]$text) {
        $p = Join-Path $tmp ($kind + '.json'); [IO.File]::WriteAllText($p, $text)
        return @{ Path = $p; Why = (Refusal { Read-ThornswoodRecord -Path $p -Kind $kind }) }
    }
    $real = @{}
    foreach ($kind in $fileKinds) { $real[$kind] = [IO.File]::ReadAllText((Join-Path $repo $script:ThornswoodRecordKinds[$kind].File)) }

    foreach ($kind in $fileKinds) {
        $b = Bad $kind ''
        Yes "$kind`: an empty file is refused as empty, named" ($b.Why -eq "$($b.Path) is empty")
        $b = Bad $kind $real[$kind].Substring(0, [int]($real[$kind].Length / 2))
        Yes "$kind`: a cut-off file is refused as not valid JSON, named" ($b.Why.StartsWith($b.Path + ' is not valid JSON'))
        $b = Bad $kind '[1, 2]'
        Yes "$kind`: an array is refused as not an object" ($b.Why.Contains('it is not a JSON object'))
        $doc = $real[$kind] | ConvertFrom-Json
        $doc | Add-Member -NotePropertyName version -NotePropertyValue 2 -Force
        $b = Bad $kind ($doc | ConvertTo-Json -Depth 10)
        Yes "$kind`: a version this checkout does not know (2) is refused, saying which it knows" ($b.Why.StartsWith($b.Path) -and $b.Why -match 'it is version 2, and this checkout knows 1')
        $doc.version = 'one'
        $b = Bad $kind ($doc | ConvertTo-Json -Depth 10)
        Yes "$kind`: a version that is not a number is refused" ($b.Why -match 'it is version one')
    }
    $b = Bad 'server-build' ($real['server-build'].Replace('"sha256"', '"sha_256"'))
    Yes 'server-build: a missing sha256 (top and per file) is refused, naming the field' ($b.Why -match 'sha256 is missing' -and $b.Why -match 'files\..+ has no sha256')
    $d = $real['server-build'] | ConvertFrom-Json; $d.source.commit = '1afaf2e'; $d.bytes = '5775872'
    $b = Bad 'server-build' ($d | ConvertTo-Json -Depth 10)
    Yes 'server-build: a short source.commit and bytes as a string are refused, both named' ($b.Why -match 'source\.commit is missing or not a full commit SHA' -and $b.Why -match 'bytes is missing or not a whole number')
    # The front (#2754): built from the pinned commit, written out in full.
    $d = $real['front-build'] | ConvertFrom-Json; $d.forkCommit = '596055b2'
    Yes 'front-build: a short forkCommit is refused' ((Bad 'front-build' ($d | ConvertTo-Json -Depth 10)).Why -match 'forkCommit is missing or not a full commit SHA')
    $d = $real['front-build'] | ConvertFrom-Json; $d.files = [pscustomobject]@{}
    Yes 'front-build: an empty files map is refused' ((Bad 'front-build' ($d | ConvertTo-Json -Depth 10)).Why -match 'files is missing, empty')
    # The client's libraries and their texts (#3099).
    $d = $real['client-licences'] | ConvertFrom-Json
    $first = @($d.ports.PSObject.Properties)[0].Name
    $d.ports.$first.sha256 = 'abc'
    Yes 'client-licences: a port with no whole sha256 is refused, named' ((Bad 'client-licences' ($d | ConvertTo-Json -Depth 10)).Why -match ('ports\.' + [regex]::Escape($first) + ' has no sha256'))
    $d = $real['client-licences'] | ConvertFrom-Json
    $d.ports.PSObject.Properties.Remove($first)
    Yes 'client-licences: a file naming a port the record does not list is refused' ((Bad 'client-licences' ($d | ConvertTo-Json -Depth 10)).Why -match ('names ' + [regex]::Escape($first) + ', which ports does not list'))
    $d = $real['client-licences'] | ConvertFrom-Json; $d.files = [pscustomobject]@{}
    Yes 'client-licences: an empty files map is refused' ((Bad 'client-licences' ($d | ConvertTo-Json -Depth 10)).Why -match 'files is missing, empty')
    $d = $real['server-build'] | ConvertFrom-Json; $d | Add-Member -NotePropertyName lightPlugins -NotePropertyValue 'yes' -Force
    $b = Bad 'server-build' ($d | ConvertTo-Json -Depth 10)
    Yes 'server-build: lightPlugins that is not true or false is refused' ($b.Why -match 'lightPlugins is there and not true or false')
    $d = $real['server-build'] | ConvertFrom-Json; $d | Add-Member -NotePropertyName version -NotePropertyValue 1 -Force
    Yes 'server-build: saying version 1 out loud is fine' ((Bad 'server-build' ($d | ConvertTo-Json -Depth 10)).Why -eq '')
    $d = $real['client-build'] | ConvertFrom-Json; $d.files = [pscustomobject]@{}
    $b = Bad 'client-build' ($d | ConvertTo-Json -Depth 10)
    Yes 'client-build: an empty files map is refused' ($b.Why -match 'files is missing, empty')
    $d = $real['client-build'] | ConvertFrom-Json; $d.PSObject.Properties.Remove('forkCommit')
    Yes 'client-build: no forkCommit is refused' ((Bad 'client-build' ($d | ConvertTo-Json -Depth 10)).Why -match 'forkCommit is missing')
    Yes 'most-online: people 0 is refused' ((Bad 'most-online' '{ "people": 0 }').Why -match 'people is missing or not a whole number above zero')
    Yes 'most-online: people 1001 is refused, the engine''s limit' ((Bad 'most-online' '{ "people": 1001 }').Why -match 'over 1000')
    Yes 'most-online: people "25" (a string) is refused' ((Bad 'most-online' '{ "people": "25" }').Why -match 'people is missing')
    Yes 'most-online: negative staffSeats is refused' ((Bad 'most-online' '{ "people": 25, "staffSeats": -1 }').Why -match 'staffSeats')
    Yes 'most-online: a byte order mark and the minimum fields read fine' ((Bad 'most-online' ([string][char]0xFEFF + '{ "people": 25 }')).Why -eq '')
    # Dev's own numbers, its dev object (Patrick, 12 Oct), held the same way.
    Yes 'most-online: a dev object of the same three reads fine' ((Bad 'most-online' '{ "dev": { "people": 5, "staffSeats": 0, "voice": 5, "note": "x" }, "people": 25 }').Why -eq '')
    Yes 'most-online: the committed record has its dev numbers' (($real['most-online'] | ConvertFrom-Json).dev.people -eq 5)
    Yes 'most-online: a dev that is not an object is refused' ((Bad 'most-online' '{ "dev": 5, "people": 25 }').Why -match 'dev is there and not an object')
    Yes 'most-online: dev with no people is refused, named as dev''s' ((Bad 'most-online' '{ "dev": { "voice": 5 }, "people": 25 }').Why -match 'dev\.people is missing or not a whole number above zero')
    Yes 'most-online: dev people 1001 is refused, the engine''s limit' ((Bad 'most-online' '{ "dev": { "people": 1001 }, "people": 25 }').Why -match 'dev\.people is over 1000')
    Yes 'most-online: dev staffSeats -1 is refused' ((Bad 'most-online' '{ "dev": { "people": 5, "staffSeats": -1 }, "people": 25 }').Why -match 'dev\.staffSeats is there and not a whole number')
    Yes 'most-online: a bad dev does not hide a bad main' ((Bad 'most-online' '{ "dev": { "people": 0 }, "people": 0 }').Why -match '(?s)people is missing.*dev\.people is missing')
    $d = $real['collection-plugins'] | ConvertFrom-Json; $d.PSObject.Properties.Remove('version')
    Yes 'collection-plugins: it must say its version' ((Bad 'collection-plugins' ($d | ConvertTo-Json -Depth 10)).Why -match 'it has no version')
    Yes 'collection-plugins: a plugin twice and a row without sha256 are refused' ((Bad 'collection-plugins' ('{"version":1,"plugins":[{"name":"a.esp","size":1,"sha256":"' + ('0' * 64) + '"},{"name":"A.esp","size":1}]}')).Why -match 'lists A\.esp twice.*has no sha256')
    Yes 'a record that is not there is refused, named' ((Refusal { Read-ThornswoodRecord -Path (Join-Path $tmp 'none.json') -Kind most-online }) -match 'there is no most-online record at')
    Yes 'an unknown kind is refused' ((Refusal { Get-ThornswoodRecordProblems -Doc ([pscustomobject]@{}) -Kind nope }) -match "no record kind 'nope'")

    # Check-Records against a checkout with one bad record: exit 1, naming it.
    $fake = Join-Path $tmp 'repo'
    $null = New-Item -ItemType Directory -Path (Join-Path $fake 'records')
    foreach ($kind in $fileKinds) { [IO.File]::WriteAllText((Join-Path $fake $script:ThornswoodRecordKinds[$kind].File), $real[$kind]) }
    [IO.File]::WriteAllText((Join-Path $fake 'records\most-online.json'), '{ "people": "lots" }')
    $out = & pwsh -NoProfile -File (Join-Path $repo 'scripts\release\Check-Records.ps1') -Repo $fake 2>&1
    Yes 'Check-Records exits 1 on one bad record, naming it, and still checks the others' ($LASTEXITCODE -eq 1 -and @($out | Where-Object { "$_" -match 'REFUSED\s+most-online' }).Count -eq 1 -and @($out | Where-Object { "$_" -match '^\s+OK ' }).Count -eq $fileKinds.Count)
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
