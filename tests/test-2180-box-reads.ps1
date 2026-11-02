# test-2180-box-reads.ps1
#
#     pwsh -NoProfile -File .\tests\test-2180-box-reads.ps1
#
# The box-side reads of server-settings.json and server-build.json hold them to
# RecordShape.ps1 (#2180, slice 4). The box has no checkout, so the contract
# goes there as text in front of Swap.ps1's stage check, and as two files
# beside Install-ThornswoodServer.ps1 that Publish-Server.ps1 sends. A bad file
# is refused naming the file and the field, instead of read as whatever
# ConvertFrom-Json made of it. The text is run here the way the box runs it: a
# lone script file in a folder with nothing else in it. Offline.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pass = 0; $fail = 0
function Yes([string]$what, [bool]$cond) {
    if ($cond) { $script:pass++; Write-Host "PASS  $what" } else { $script:fail++; Write-Host "FAIL  $what" -ForegroundColor Red }
}
function Src([string]$rel) { return [IO.File]::ReadAllText((Join-Path $repo $rel)).Replace("`r`n", "`n") }

$rj = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\Read-JsonFile.ps1'))
$rs = [IO.File]::ReadAllText((Join-Path $repo 'scripts\release\RecordShape.ps1'))
Yes 'Read-JsonFile.ps1 and RecordShape.ps1 are ASCII, as everything sent to the box must be' (($rj + $rs) -notmatch '[^\x00-\x7F]')

# ---- the text, run alone, the way the box runs it
$exe = (Get-Process -Id $PID).Path
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('tw-2180box ' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Path $tmp
try {
    $u = New-Object Text.UTF8Encoding($false)
    function Put([string]$name, [string]$text) { $p = Join-Path $tmp $name; [IO.File]::WriteAllText($p, $text, $u); return $p }
    $good = Put 'good-settings.json' '{ "port": 7777, "dataDir": "data", "loadOrder": [ "C:/Thornswood-Server/plugins/Skyrim.esm" ] }'
    $strPort = Put 'string-port.json' '{ "port": "7777x", "dataDir": "data" }'
    $noPort = Put 'no-port.json' '{ "dataDir": "data" }'
    $badDir = Put 'bad-dir.json' '{ "port": 7787, "dataDir": 5 }'
    $v2 = Put 'v2-settings.json' '{ "version": 2, "port": 7777 }'
    $cut = Put 'cut-settings.json' '{ "port": 77'
    $shortRec = Put 'short-build.json' ('{ "bytes": 10, "source": { "commit": "' + ('a' * 40) + '" }, "files": { "scam_native.node": { "sha256": "' + ('b' * 64) + '", "bytes": 10 } } }')
    $script = Put 'box-run.ps1' ('param([string]$Path, [string]$Kind)' + "`r`n" + $rj + "`r`n" + $rs + "`r`n" + @'
try { $null = Read-ThornswoodRecord -Path $Path -Kind $Kind; 'READ OK' } catch { 'REFUSED ' + $_.Exception.Message }
'@)
    function Box([string]$path, [string]$kind) { return ((& $exe -NoProfile -NonInteractive -File $script -Path $path -Kind $kind) -join ' ') }

    Yes 'a lone copy of the text loads with no Read-JsonFile.ps1 beside it, and reads good settings' ((Box $good 'server-settings') -eq 'READ OK')
    $r = Box $strPort 'server-settings'
    Yes 'settings whose port is not a number are refused, naming the file and port' ($r -like 'REFUSED *' -and $r.Contains('string-port.json') -and $r.Contains('port is missing or not a whole number'))
    $r = Box $noPort 'server-settings'
    Yes 'settings with no port are refused, naming port' ($r -like 'REFUSED *' -and $r.Contains('port is missing'))
    $r = Box $badDir 'server-settings'
    Yes 'a dataDir that is not a folder name is refused, naming dataDir' ($r -like 'REFUSED *' -and $r.Contains('dataDir is there and not a folder name'))
    $r = Box $v2 'server-settings'
    Yes 'settings at a version this checkout does not know are refused' ($r -like 'REFUSED *' -and $r.Contains('it is version 2'))
    $r = Box $cut 'server-settings'
    Yes 'settings cut off mid-write are refused, naming the file' ($r -like 'REFUSED *' -and $r.Contains('cut-settings.json') -and $r.Contains('not valid JSON'))
    $r = Box $shortRec 'server-build'
    Yes 'a server-build.json with no sha256 is refused, naming sha256' ($r -like 'REFUSED *' -and $r.Contains('short-build.json') -and $r.Contains('sha256 is missing'))
    $r = Box (Join-Path $tmp 'not-there.json') 'server-settings'
    Yes 'a missing file is refused, naming it' ($r -like 'REFUSED *' -and $r.Contains('not-there.json'))
} finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

# ---- Swap.ps1: the stage check carries the contract and reads through it
$sw = Src 'scripts\deploy\Swap.ps1'
Yes 'Swap.ps1 puts Read-JsonFile.ps1 and RecordShape.ps1 in front of the stage check' (
    $sw.Contains("'..\release\Read-JsonFile.ps1'") -and $sw.Contains("'..\release\RecordShape.ps1'") -and $sw.Contains('$checkBlock = $ThornswoodRecordShapeText + $checkBlock'))
$a = $sw.IndexOf('# ==== deploy-server remote blocks ===='); $b = $sw.IndexOf('# ==== end deploy-server remote blocks ====')
$blocks = if ($a -ge 0 -and $b -gt $a) { $sw.Substring($a, $b - $a) } else { '' }
$check = [regex]::Match($blocks, "(?s)\`$checkBlock = @'.*?\n'@").Value
Yes 'the stage check reads the staged settings through the contract' ($check.Contains('$new = Read-ThornswoodRecord -Path $sp -Kind server-settings'))
Yes '  and the running settings, saying why when it cannot' ($check.Contains("Read-ThornswoodRecord -Path (Join-Path `$Root 'server-settings.json') -Kind server-settings") -and $check.Contains('$nowWhy'))
Yes '  and the staged server-build.json' ($check.Contains('$rec = Read-ThornswoodRecord -Path $rp -Kind server-build'))
Yes '  with no bare ConvertFrom-Json of either left in it' ($check -notmatch 'ConvertFrom-Json')

# ---- the installer: loads both, refuses without them, reads through them
$in = Src 'scripts\deploy\Install-ThornswoodServer.ps1'
Yes 'the installer loads Read-JsonFile.ps1 and RecordShape.ps1 from beside itself' ($in.Contains("(Join-Path `$here 'RecordShape.ps1')") -and $in.Contains("'Read-JsonFile.ps1', 'RecordShape.ps1'"))
Yes '  and refuses, changing nothing, without them' ($in -match "is not beside this installer, so the payload's settings and record could not be held to their shape")
Yes '  and reads the payload''s settings and record through them' ($in.Contains('$s = Read-ThornswoodRecord -Path $settingsPath -Kind server-settings') -and $in.Contains('$recObj = Read-ThornswoodRecord -Path $rec -Kind server-build'))

# ---- Publish-Server sends both, committed, on a publish and a put-back
$ps = Src 'scripts\release\Publish-Server.ps1'
Yes 'Publish-Server holds both to the commit before sending' ($ps.Contains("'scripts/release/Read-JsonFile.ps1', 'scripts/release/RecordShape.ps1')"))
Yes '  and sends them beside the installer on a publish and on a put-back' (([regex]::Matches($ps, 'Send-ShapeLibs ''')).Count -eq 2)

# ---- Check-Records still passes: the box's own settings have no committed file
& $exe -NoProfile -NonInteractive -File (Join-Path $repo 'scripts\release\Check-Records.ps1') | Out-Null
Yes 'Check-Records.ps1 passes the committed records and skips server-settings, which is each box''s own' ($LASTEXITCODE -eq 0)

Write-Host ''
Write-Host "$pass passed, $fail failed"
if ($fail) { exit 1 }
